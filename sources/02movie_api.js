#!/usr/bin/env node
/**
 * 02MovieDownloader — Encrypted API with token-based auth and AES-256-CBC.
 *
 * Flow:
 *   1. POST https://02moviedownloader.site/api/verify-robot → get session token
 *   2. GET https://02moviedownloader.site/api/download/movie/{tmdbId}
 *      (or /tv/{tmdbId}/{season}/{episode}) with x-session-token header
 *   3. Response is { encrypted: true, data: "iv:ciphertext" } (base64)
 *   4. Decrypt: AES-256-CBC with SHA-256(token) as key
 *
 * Returns: MP4 download links + subtitles
 *
 * Status: working (HTTP API, decrypts, no browser needed)
 */
const crypto = require('crypto');
const https = require('https');

const BASE = 'https://02moviedownloader.site';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';
const httpsAgent = new https.Agent({ family: 4, keepAlive: true, rejectUnauthorized: false });

const axios = require('axios');

// ── Token fetching ──────────────────────────────────────────────────────────

async function getToken(media) {
  const { tmdbId, type, season, episode } = media;
  const isTv = type === 'tv';
  const path = isTv ? `/tv/${tmdbId}/${season || 1}/${episode || 1}` : `/movie/${tmdbId}`;
  const referer = `${BASE}/api/download${path}`;

  try {
    const resp = await axios.post(`${BASE}/api/verify-robot`, {}, {
      headers: {
        'User-Agent': UA,
        'Accept': '*/*',
        'Accept-Language': 'en-US,en;q=0.7',
        'Origin': BASE,
        'Referer': referer,
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'sec-ch-ua': '"(Not(A:Brand";v="99", "Google Chrome";v="134", "Chromium";v="134"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
      },
      timeout: 10000,
      validateStatus: () => true,
      httpsAgent,
    });

    if ((resp.status === 200 || resp.status === 201) && resp.data?.token) {
      return resp.data.token;
    }
    return '';
  } catch (e) {
    return '';
  }
}

// ── AES-256-CBC decryption ─────────────────────────────────────────────────

function decryptPayload(cipherBundle, token) {
  try {
    const parts = cipherBundle.split(':');
    if (parts.length !== 2) throw new Error('Invalid encrypted payload format');

    const iv = Buffer.from(parts[0], 'base64');
    const cipherBytes = Buffer.from(parts[1], 'base64');
    const key = crypto.createHash('sha256').update(token).digest();

    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    const decrypted = Buffer.concat([decipher.update(cipherBytes), decipher.final()]);
    return JSON.parse(decrypted.toString('utf8'));
  } catch (e) {
    return null;
  }
}

// ── HTTP fetch ──────────────────────────────────────────────────────────────

async function fetchApi(url, token, referer) {
  try {
    const resp = await axios.get(url, {
      headers: {
        'User-Agent': UA,
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        'x-session-token': token,
        'Referer': referer,
        'Origin': BASE,
        'Cache-Control': 'no-cache',
      },
      timeout: 15000,
      validateStatus: () => true,
      httpsAgent,
    });

    if (resp.status !== 200 || !resp.data) return null;

    // Handle encrypted response
    if (resp.data.encrypted === true && resp.data.data) {
      return decryptPayload(resp.data.data, token);
    }

    // Direct response
    return resp.data;
  } catch (e) {
    return null;
  }
}

// ── Main scraper ────────────────────────────────────────────────────────────

async function scrapeSource({ tmdbId, type, season, episode }) {
  const start = Date.now();
  const isTv = type === 'tv';
  const path = isTv ? `/tv/${tmdbId}/${season || 1}/${episode || 1}` : `/movie/${tmdbId}`;
  const url = `${BASE}/api/download${path}`;
  const referer = url;

  try {
    // Step 1: Get session token
    const token = await getToken({ tmdbId, type, season, episode });
    if (!token) {
      return {
        source: '02movie_api',
        embedUrl: url,
        status: 'error',
        error: 'Failed to get session token',
        streams: [],
        latency_ms: Date.now() - start,
      };
    }

    // Step 2: Fetch and decrypt
    const data = await fetchApi(url, token, referer);
    if (!data) {
      return {
        source: '02movie_api',
        embedUrl: url,
        status: 'error',
        error: 'API request or decryption failed',
        streams: [],
        latency_ms: Date.now() - start,
      };
    }

    // Step 3: Parse streams
    const streams = [];
    const subtitles = [];
    const seenUrls = new Set();
    const seenSubs = new Set();

    // downloads from data.data.downloadData.data.downloads
    if (data.data?.downloadData?.data?.downloads) {
      for (const d of data.data.downloadData.data.downloads) {
        if (d.url && d.url.startsWith('http') && !seenUrls.has(d.url)) {
          seenUrls.add(d.url);
          const quality = d.resolution ? `${d.resolution}p` : '';
          streams.push({
            url: d.url,
            type: 'mp4',
            quality,
            resolution: d.resolution ? `${d.resolution}x?` : '',
          });
        }
      }
    }

    // externalStreams
    if (data.externalStreams) {
      for (const s of data.externalStreams) {
        // Skip Cloudflare-blocked hosts
        if (s.url.includes('111477.xyz')) continue;
        if (s.url && s.url.startsWith('http') && !seenUrls.has(s.url)) {
          seenUrls.add(s.url);
          const qualityMatch = s.quality ? s.quality.match(/(\d+)/) : null;
          const quality = qualityMatch ? qualityMatch[1] + 'p' : '';
          const typeStr = s.url.includes('.mkv') ? 'mkv' : 'mp4';
          streams.push({
            url: s.url,
            type: typeStr,
            quality,
          });
        }
      }
    }

    // Subtitles from data.data.downloadData.data.captions
    if (data.data?.downloadData?.data?.captions) {
      for (const cap of data.data.downloadData.data.captions) {
        if (cap.url && cap.url.startsWith('http') && !seenSubs.has(cap.url)) {
          seenSubs.add(cap.url);
          subtitles.push({
            url: cap.url,
            lang: cap.lan || 'unknown',
            label: cap.lanName || cap.lan || '',
            type: cap.url.endsWith('.srt') ? 'srt' : 'vtt',
          });
        }
      }
    }

    return {
      source: '02movie_api',
      embedUrl: url,
      status: streams.length > 0 ? 'working' : 'no_streams',
      streams,
      ...(subtitles.length > 0 ? { subtitles } : {}),
      latency_ms: Date.now() - start,
    };
  } catch (err) {
    return {
      source: '02movie_api',
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
