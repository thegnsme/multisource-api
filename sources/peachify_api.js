#!/usr/bin/env node
/**
 * Peachify API — Encrypted API provider with AES-GCM decryption.
 *
 * Servers (4 working):
 *   • uwu.eat-peach.sbs/moviebox
 *   • usa.eat-peach.sbs/holly
 *   • usa.eat-peach.sbs/air
 *   • usa.eat-peach.sbs/multi
 *   • usa.eat-peach.sbs/net (returns 404 — skipped)
 *
 * Encryption: AES-256-GCM with key from CinePro core source.
 * Key (hex): d8f2a1b5e9c470814f6b2c3a5d8e7f9c1a2b3c4d5e3f7a8b9c0d1e2f3a4d5c6d
 * Payload format: base64url(iv).base64url(ciphertext).base64url(authTag)
 *
 * Status: working (HTTP API + decrypt, no browser needed)
 */
const crypto = require('crypto');
const https = require('https');

const PEACHIFY_SERVERS = [
  'https://uwu.eat-peach.sbs/moviebox',
  'https://usa.eat-peach.sbs/holly',
  'https://usa.eat-peach.sbs/air',
  'https://usa.eat-peach.sbs/multi',
];

const ENCRYPTION_KEY_HEX = 'd8f2a1b5e9c470814f6b2c3a5d8e7f9c1a2b3c4d5e3f7a8b9c0d1e2f3a4d5c6d';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const SOURCE_TIMEOUT = 20000;
const httpsAgent = new https.Agent({ family: 4, keepAlive: true, rejectUnauthorized: false });

const axios = require('axios');

// ── Base64 URL helpers ──────────────────────────────────────────────────────

function base64UrlToBytes(str) {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  return Buffer.from(padded, 'base64');
}

function hexToBytes(hex) {
  return Buffer.from(hex, 'hex');
}

// ── AES-GCM Decryption ──────────────────────────────────────────────────────

async function decryptPeachify(payload) {
  try {
    const parts = payload.split('.');
    if (parts.length !== 3) return null;

    const iv = base64UrlToBytes(parts[0]);
    const ciphertext = base64UrlToBytes(parts[1]);
    const authTag = base64UrlToBytes(parts[2]);

    // AES-GCM requires ciphertext + authTag concatenated
    const encryptedData = Buffer.concat([ciphertext, authTag]);
    const key = hexToBytes(ENCRYPTION_KEY_HEX);

    // Use Node.js crypto module's CipherIv for AES-256-GCM
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(ciphertext);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    return JSON.parse(decrypted.toString('utf-8'));
  } catch (e) {
    return null;
  }
}

// ── HTTP fetch ──────────────────────────────────────────────────────────────

async function fetchJson(url, referer = '') {
  try {
    const resp = await axios.get(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'application/json, text/javascript, */*; q=0.01',
        'Accept-Language': 'en-US,en;q=0.9',
        ...(referer ? { Referer: referer, Origin: new URL(referer).origin } : {}),
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
  const isTv = type === 'tv';
  const pathSuffix = isTv ? `/tv/${tmdbId}/${season || 1}/${episode || 1}` : `/movie/${tmdbId}`;

  try {
    // Query all Peachify servers in parallel
    const results = await Promise.allSettled(
      PEACHIFY_SERVERS.map(server =>
        fetchJson(`${server}${pathSuffix}`, 'https://peachify.top/')
      )
    );

    const streams = [];
    const subtitles = [];
    const seenUrls = new Set();
    const seenSubs = new Set();

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status !== 'fulfilled') continue;

      const resp = r.value;
      if (resp.status !== 200 || !resp.data) continue;

      let data = resp.data;

      // Decrypt if needed
      if (data.isEncrypted && data.data) {
        const decrypted = await decryptPeachify(data.data);
        if (!decrypted) continue;
        data = decrypted;
      }

      // Parse sources
      if (Array.isArray(data.sources)) {
        for (const src of data.sources) {
          // Multiple possible field names for URL
          const url = src.url || src.src || src.file || src.stream || '';
          if (url && url.startsWith('http') && !seenUrls.has(url)) {
            seenUrls.add(url);
            
            // Infer type
            const isM3u8 = url.includes('.m3u8') || (src.type && src.type.includes('hls'));
            const typeStr = isM3u8 ? 'hls' : 'mp4';
            
            // Quality
            const quality = src.quality || src.resolution || src.height || '';
            const qualityStr = quality ? `${quality}`.replace(/p$/, '') + 'p' : '';
            
            // Audio track info
            const dub = src.dub || src.audio || src.language || src.lang || '';
            
            streams.push({
              url,
              type: typeStr,
              quality: qualityStr,
              server: PEACHIFY_SERVERS[i],
            });
          }
        }
      }

      // Parse subtitles
      if (Array.isArray(data.subtitles)) {
        for (const sub of data.subtitles) {
          const subUrl = sub.url || sub.file || sub.src || '';
          if (subUrl && subUrl.startsWith('http') && !seenSubs.has(subUrl)) {
            seenSubs.add(subUrl);
            subtitles.push({
              url: subUrl,
              lang: sub.lang || sub.language || sub.label || 'unknown',
              label: sub.label || sub.name || sub.language || '',
              type: subUrl.endsWith('.vtt') ? 'vtt' : 'srt',
            });
          }
        }
      }
    }

    // Deduplicate streams by URL
    const uniqueStreams = streams.filter(s => {
      if (seenUrls.has(s.url)) return true; // already deduped
      return true;
    });

    const embedUrl = PEACHIFY_SERVERS[0] + pathSuffix;

    return {
      source: 'peachify_api',
      embedUrl,
      status: uniqueStreams.length > 0 ? 'working' : 'no_streams',
      streams: uniqueStreams,
      ...(subtitles.length > 0 ? { subtitles } : {}),
      latency_ms: Date.now() - start,
    };
  } catch (err) {
    return {
      source: 'peachify_api',
      embedUrl: '',
      status: 'error',
      error: err.message,
      streams: [],
      latency_ms: Date.now() - start,
    };
  }
}

module.exports = { scrapeSource };

// ── Standalone CLI ──
if (require.main === module || module.id === '[stdin]') {
  (async () => {
    const args = {};
    process.argv.slice(2).forEach(a => {
      const [k, v] = a.replace(/^--/, '').split('=');
      args[k] = v || true;
    });
    const result = await scrapeSource({
      tmdbId: parseInt(args.tmdb || args.id || '27205'),
      type: args.type || 'movie',
      season: parseInt(args.season || '1'),
      episode: parseInt(args.episode || '1'),
    });
    console.log(JSON.stringify(result, null, 2));
  })();
}
