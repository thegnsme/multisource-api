/**
 * VidZee API — Encrypted HTTP API providing direct HLS streams with subtitles.
 * 
 * Chain:
 *   1. GET https://core.vidzee.wtf/api-key → base64 string
 *   2. Derive AES-CBC key: SHA-256("4f2a9c7d1e8b3a6f0d5c2e9a7b1f4d8c") + AES-GCM decrypt
 *   3. GET https://player.vidzee.wtf/api/server?id={tmdbId}&sr={serverId}[&ss={season}&ep={episode}]
 *   4. AES-CBC decrypt each link → direct m3u8 URL
 *   5. Subtitles: tracks[].url → direct vtt URLs
 * 
 * Status: working (HTTP API, no browser needed)
 */
const crypto = require('crypto');
const https = require('https');

const PLAYER_URL = 'https://player.vidzee.wtf';
const KEY_URL = 'https://core.vidzee.wtf/api-key';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const SOURCE_TIMEOUT = 20000;

// Axios v1.x needs IPv4 forced in some environments
const httpsAgent = new https.Agent({ family: 4, keepAlive: true, rejectUnauthorized: false });

// ── Base64 helpers ──────────────────────────────────────────────────────────

function base64ToBytes(str) {
  return new Uint8Array(Buffer.from(str.replace(/\s+/g, ''), 'base64'));
}

function bytesToBase64(bytes) {
  return Buffer.from(bytes).toString('base64');
}

// ── Key derivation ──────────────────────────────────────────────────────────

async function deriveKey(apiKey) {
  if (!apiKey) return '';
  
  const t = base64ToBytes(apiKey);
  if (t.length <= 28) return '';
  
  const iv = t.slice(0, 12);       // 12-byte IV for AES-GCM
  const salt = t.slice(12, 28);     // 16-byte salt
  const cipherData = t.slice(28);   // rest is ciphertext
  
  // Concatenate ciphertext + salt
  const combined = new Uint8Array(cipherData.length + salt.length);
  combined.set(cipherData, 0);
  combined.set(salt, cipherData.length);
  
  // SHA-256 of hardcoded string
  const encoder = new TextEncoder();
  const gcmKey = await crypto.subtle.digest(
    'SHA-256',
    encoder.encode('4f2a9c7d1e8b3a6f0d5c2e9a7b1f4d8c')
  );
  
  // Import AES-GCM key
  const importKey = await crypto.subtle.importKey(
    'raw', gcmKey,
    { name: 'AES-GCM' }, false, ['decrypt']
  );
  
  // AES-GCM decrypt
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    importKey,
    combined
  );
  
  return new TextDecoder().decode(decrypted);
}

// ── AES-CBC decryption ─────────────────────────────────────────────────────

function getKeyBytes(key) {
  const encoded = new TextEncoder().encode(key);
  const result = new Uint8Array(32);
  result.set(encoded.slice(0, 32));
  return result;
}

async function aesCbcDecrypt(encryptedData, decryptionKey) {
  if (!encryptedData || !decryptionKey) return '';
  
  // Decode outer base64: "iv:ciphertext"
  const decoded = Buffer.from(encryptedData, 'base64').toString('utf-8');
  const [ivBase64, cipherBase64] = decoded.split(':');
  if (!ivBase64 || !cipherBase64) return '';
  
  const iv = new Uint8Array(Buffer.from(ivBase64, 'base64'));
  const cipherBytes = new Uint8Array(Buffer.from(cipherBase64, 'base64'));
  const keyBytes = getKeyBytes(decryptionKey);
  
  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyBytes,
    { name: 'AES-CBC' }, false, ['decrypt']
  );
  
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-CBC', iv },
    cryptoKey,
    cipherBytes
  );
  
  return new TextDecoder().decode(decrypted);
}

// ── HTTP fetch using axios pattern ──────────────────────────────────────────

const axios = require('axios');

async function fetchJson(url, referer = '') {
  try {
    const resp = await axios.get(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Accept-Language': 'en-US,en;q=0.9',
        ...(referer ? { 'Referer': referer, 'Origin': new URL(referer).origin } : {}),
      },
      timeout: 10000,
      validateStatus: () => true,
      httpsAgent,
    });
    return { status: resp.status, data: resp.data };
  } catch (e) {
    return { status: 0, error: e.message };
  }
}

// ── Main scraper ────────────────────────────────────────────────────────────

async function scrapeSource({ tmdbId, type, season, episode }) {
  const start = Date.now();
  const embedUrl = `${PLAYER_URL}/embed/${type}/${tmdbId}` +
    (type === 'tv' ? `/${season}/${episode}` : '');

  try {
    // Step 1: Fetch API key
    const keyResp = await fetchJson(KEY_URL);
    if (keyResp.status !== 200 || !keyResp.data) {
      return { source: 'vidzee_api', embedUrl, status: 'no_streams', streams: [], latency_ms: Date.now() - start };
    }
    
    // Step 2: Derive decryption key
    const apiKey = typeof keyResp.data === 'string' ? keyResp.data : String(keyResp.data);
    const decKey = await deriveKey(apiKey);
    if (!decKey) {
      return { source: 'vidzee_api', embedUrl, status: 'error', error: 'Key derivation failed', streams: [], latency_ms: Date.now() - start };
    }
    
    // Step 3: Try all 14 servers in parallel (with timeout)
    const MAX_SERVERS = 14;
    const serverPromises = [];
    for (let sr = 0; sr < MAX_SERVERS; sr++) {
      let url = `${PLAYER_URL}/api/server?id=${tmdbId}&sr=${sr}`;
      if (type === 'tv') {
        url += `&ss=${season || 1}&ep=${episode || 1}`;
      }
      serverPromises.push(
        fetchJson(url, PLAYER_URL).then(r => ({ sr, result: r }))
      );
    }
    
    const serverResults = await Promise.allSettled(serverPromises);
    
    // Step 4: Decrypt all successful responses
    const streams = [];
    const subtitles = [];
    const seenUrls = new Set();
    
    for (const settled of serverResults) {
      if (settled.status !== 'fulfilled') continue;
      const { sr, result: servResp } = settled.value;
      if (servResp.status !== 200 || !servResp.data?.url?.length) continue;
      
      const serverInfo = servResp.data.serverInfo || { number: sr, name: `Server ${sr}` };
      const serverLabel = `${serverInfo.name || `Server ${sr}`}`;
      
      // Decrypt each URL
      for (const item of servResp.data.url) {
        try {
          const decryptedUrl = await aesCbcDecrypt(item.link, decKey);
          if (decryptedUrl && decryptedUrl.startsWith('http') && !seenUrls.has(decryptedUrl)) {
            seenUrls.add(decryptedUrl);
            const quality = item.name?.includes('4K') ? '4K'
              : item.name?.includes('1080') ? '1080p'
              : item.name?.includes('720') ? '720p'
              : item.name?.includes('480') ? '480p'
              : '';
            streams.push({
              url: decryptedUrl,
              type: 'hls',
              quality,
              resolution: quality ? { '4K': '3840x2160', '1080p': '1920x1080', '720p': '1280x720', '480p': '854x480' }[quality] || '' : '',
              server: serverLabel,
            });
          }
        } catch (e) {
          // skip failed decryption
        }
      }
      
      // Collect subtitles
      if (servResp.data.tracks?.length) {
        for (const track of servResp.data.tracks) {
          if (track.url && track.url.startsWith('http')) {
            subtitles.push({
              url: track.url,
              lang: track.lang || 'unknown',
              type: track.url.endsWith('.vtt') ? 'vtt' : 'srt',
            });
          }
        }
      }
    }
    
    // Deduplicate subtitles by URL
    const seenSubs = new Set();
    const uniqueSubs = subtitles.filter(s => {
      if (seenSubs.has(s.url)) return false;
      seenSubs.add(s.url);
      return true;
    });
    
    return {
      source: 'vidzee_api',
      embedUrl,
      status: streams.length > 0 ? 'working' : 'no_streams',
      streams,
      ...(uniqueSubs.length > 0 ? { subtitles: uniqueSubs } : {}),
      latency_ms: Date.now() - start,
    };
  } catch (err) {
    return {
      source: 'vidzee_api',
      embedUrl,
      status: 'error',
      error: err.message,
      streams: [],
      latency_ms: Date.now() - start,
    };
  }
}

module.exports = { scrapeSource };

// ── Standalone CLI ───────────────────────────────────────────────────────────
if (require.main === module || module.id === '[stdin]') {
  (async () => {
    const args = {};
    process.argv.slice(2).forEach(a => {
      const [k, v] = a.replace(/^--/, '').split('=');
      args[k] = v || true;
    });
    const result = await scrapeSource({
      tmdbId: parseInt(args.tmdb || args.id || '24428'),
      type: args.type || 'movie',
      season: parseInt(args.season || '1'),
      episode: parseInt(args.episode || '1'),
    });
    console.log(JSON.stringify(result, null, 2));
  })();
}
