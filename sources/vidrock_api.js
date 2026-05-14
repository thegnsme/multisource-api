/**
 * VidRock API — Encrypted HTTP API providing direct HLS/MP4 streams with subtitles.
 * 
 * Chain:
 *   1. AES-CBC encrypt itemId (passphrase: "x7k9mPqT2rWvY8zA5bC3nF6hJ2lK4mN9")
 *   2. GET https://vidrock.net/api/movie/{encryptedId}
 *   3. Parse JSON response → Nova, Atlas, Orion etc servers → direct streams
 *   4. GET https://sub.vdrk.site/v2/movie/{tmdbId} → subtitle tracks
 * 
 * Status: working (HTTP API, no browser needed)
 */
const crypto = require('crypto');
const https = require('https');

const BASE = 'https://vidrock.net';
const SUB_BASE = 'https://sub.vdrk.site';
const PASSPHRASE = 'x7k9mPqT2rWvY8zA5bC3nF6hJ2lK4mN9';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36';

// Axios v1.x needs IPv4 forced in some environments
const httpsAgent = new https.Agent({ family: 4, keepAlive: true, rejectUnauthorized: false });

const axios = require('axios');

// ── Encryption ───────────────────────────────────────────────────────────────

async function encryptItemId(itemId) {
  const textEncoder = new TextEncoder();
  const keyData = textEncoder.encode(PASSPHRASE);
  const iv = textEncoder.encode(PASSPHRASE.substring(0, 16));
  
  const key = await crypto.subtle.importKey(
    'raw', keyData,
    { name: 'AES-CBC' }, false, ['encrypt']
  );
  
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-CBC', iv },
    key,
    textEncoder.encode(itemId)
  );
  
  // Convert to URL-safe base64
  const encryptedArray = new Uint8Array(encrypted);
  let binary = '';
  for (let i = 0; i < encryptedArray.length; i++) {
    binary += String.fromCharCode(encryptedArray[i]);
  }
  return Buffer.from(binary, 'binary').toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// ── Fetch helper ─────────────────────────────────────────────────────────────

async function fetchJson(url, referer = BASE + '/') {
  try {
    const resp = await axios.get(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': referer,
        'Origin': new URL(referer).origin,
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
  const embedUrl = `${BASE}/${type === 'movie' ? 'movie' : 'tv'}/${tmdbId}` +
    (type === 'tv' ? `/${season}/${episode}` : '');

  try {
    // Step 1: Encrypt itemId
    const itemId = type === 'tv'
      ? `${tmdbId}_${season || 1}_${episode || 1}`
      : String(tmdbId);
    
    const encryptedId = await encryptItemId(itemId);
    
    // Step 2: Fetch API
    const apiUrl = `${BASE}/api/${type}/${encryptedId}`;
    const apiResp = await fetchJson(apiUrl);
    
    if (apiResp.status !== 200 || !apiResp.data) {
      return { source: 'vidrock_api', embedUrl, status: 'no_streams', streams: [], latency_ms: Date.now() - start };
    }
    
    // Step 3: Parse stream entries
    const streams = [];
    const seenUrls = new Set();
    const streamData = apiResp.data;
    
    for (const [serverName, serverData] of Object.entries(streamData)) {
      if (!serverData?.url) continue;
      
      const streamUrl = serverData.url;
      const streamType = serverData.type || 'hls';
      
      // Handle hls2.vdrk.site special case — need to fetch CDN URLs
      if (streamUrl.includes('hls2.vdrk.site')) {
        try {
          const cdnResp = await fetchJson(streamUrl, BASE + '/');
          if (cdnResp.status === 200 && Array.isArray(cdnResp.data)) {
            for (const cdnEntry of cdnResp.data) {
              if (cdnEntry?.url) {
                let finalUrl = cdnEntry.url;
                // Remove proxy prefix if present
                if (finalUrl.startsWith('https://proxy.vidrock.store/')) {
                  finalUrl = decodeURIComponent(finalUrl.slice('https://proxy.vidrock.store/'.length).replace(/^\//, ''));
                }
                if (!seenUrls.has(finalUrl)) {
                  seenUrls.add(finalUrl);
                  streams.push({
                    url: finalUrl,
                    type: cdnEntry.url?.includes('.mp4') ? 'mp4' : 'hls',
                    quality: cdnEntry.resolution ? `${cdnEntry.resolution}p` : '',
                    resolution: cdnEntry.resolution ? `${cdnEntry.resolution}x${cdnEntry.resolution}` : '',
                    server: serverName,
                  });
                }
              }
            }
          }
        } catch (e) {
          // Fallback: push the original URL
          if (!seenUrls.has(streamUrl)) {
            seenUrls.add(streamUrl);
            streams.push({ url: streamUrl, type: streamType, quality: '', resolution: '', server: serverName });
          }
        }
      } else {
        if (!seenUrls.has(streamUrl)) {
          seenUrls.add(streamUrl);
          const quality = serverName?.includes('4K') ? '4K'
            : serverName?.includes('1080') ? '1080p'
            : serverName?.includes('720') ? '720p'
            : serverName?.includes('480') ? '480p'
            : '';
          streams.push({
            url: streamUrl,
            type: streamType === 'mp4' ? 'mp4' : 'hls',
            quality,
            resolution: quality ? { '4K': '3840x2160', '1080p': '1920x1080', '720p': '1280x720', '480p': '854x480' }[quality] || '' : '',
            server: serverName,
          });
        }
      }
    }
    
    // Step 4: Fetch subtitles
    const subtitles = [];
    const subUrl = type === 'tv'
      ? `${SUB_BASE}/v2/tv/${tmdbId}/${season || 1}/${episode || 1}`
      : `${SUB_BASE}/v2/movie/${tmdbId}`;
    
    try {
      const subResp = await fetchJson(subUrl);
      if (subResp.status === 200 && Array.isArray(subResp.data)) {
        for (const sub of subResp.data) {
          if (sub?.file) {
            subtitles.push({
              url: sub.file,
              lang: sub.label || 'unknown',
              type: sub.file?.endsWith('.vtt') ? 'vtt' : 'srt',
            });
          }
        }
      }
    } catch (e) {
      // Subtitles optional
    }
    
    return {
      source: 'vidrock_api',
      embedUrl,
      status: streams.length > 0 ? 'working' : 'no_streams',
      streams,
      ...(subtitles.length > 0 ? { subtitles } : {}),
      latency_ms: Date.now() - start,
    };
  } catch (err) {
    return {
      source: 'vidrock_api',
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
