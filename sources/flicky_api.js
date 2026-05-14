#!/usr/bin/env node
/**
 * Flicky API — Aggregated streaming proxy returning direct HLS URLs.
 *
 * Endpoints:
 *   v13/v14: Rich response (VidZee proxied URLs + subtitles, multi-quality)
 *   v15:     Direct m3u8 from senpai-stream (up to 4K + subtitles)
 *   v16:     Proxied m3u8 from tik.1x2.space (may return 404)
 *   v17:     Proxied m3u8 from 1shows.app (often 403)
 *
 * Status: working (v13, v14, v15 tested OK)
 */
const axios = require('axios');
const https = require('https');

const BASE = 'https://gate.flicky.host';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const SOURCE_TIMEOUT = 15000;
const httpsAgent = new https.Agent({ family: 4, keepAlive: true, rejectUnauthorized: false });

/**
 * Fetch JSON from Flicky endpoint.
 */
async function fetchJson(url) {
  try {
    const resp = await axios.get(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      timeout: 10000,
      validateStatus: () => true,
      httpsAgent,
    });
    return { status: resp.status, data: resp.data };
  } catch (e) {
    return { status: 0, error: e.message };
  }
}

/**
 * Scrape Flicky for movie/TV streams.
 */
async function scrapeSource({ tmdbId, type, season, episode }) {
  const start = Date.now();
  const isTv = type === 'tv';
  const pathSuffix = isTv ? `/${season || 1}/${episode || 1}` : '';
  const sourceName = 'flicky_api';

  try {
    // Try all versions in parallel: v13/v14 (rich), v15 (senpai-stream), v16 (tik), v17 (1shows)
    const versions = [
      { ver: 'v13', label: 'Flicky v13 (VidZee)' },
      { ver: 'v14', label: 'Flicky v14 (VidZee)' },
      { ver: 'v15', label: 'Flicky v15 (Senpai)' },
      { ver: 'v17', label: 'Flicky v17 (1Shows)' },
    ];

    const results = await Promise.allSettled(
      versions.map(v => fetchJson(`${BASE}/${v.ver}/${isTv ? 'tv' : 'movie'}/${tmdbId}${isTv ? pathSuffix : ''}`))
    );

    const streams = [];
    const subtitles = [];
    const seenUrls = new Set();

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const v = versions[i];
      if (r.status !== 'fulfilled') continue;

      const resp = r.value;
      if (resp.status !== 200 || !resp.data) continue;

      const data = resp.data;

      // v13/v14 format: { code: 0, data: { downloads: [...], captions: [...] } }
      if (data.code === 0 && data.data?.downloads) {
        for (const d of data.data.downloads) {
          if (d.url && d.url.startsWith('http') && !seenUrls.has(d.url)) {
            seenUrls.add(d.url);
            const quality = d.resolution ? `${d.resolution}p` : '';
            streams.push({
              url: d.url,
              type: 'hls',
              quality,
              resolution: d.resolution ? `${d.resolution}x?` : '',
              server: v.label,
            });
          }
        }
        // Collect subtitles
        if (data.data.captions) {
          for (const cap of data.data.captions) {
            if (cap.url && cap.url.startsWith('http')) {
              subtitles.push({
                url: cap.url,
                lang: cap.lan || 'unknown',
                label: cap.lanName || cap.lan || '',
                type: cap.url.endsWith('.vtt') ? 'vtt' : 'srt',
              });
            }
          }
        }
      }

      // v15 format: { stream: "https://...master.m3u8" }
      if (data.stream && typeof data.stream === 'string' && data.stream.startsWith('http') && !seenUrls.has(data.stream)) {
        seenUrls.add(data.stream);
        streams.push({
          url: data.stream,
          type: 'hls',
          quality: '',
          resolution: '',
          server: v.label,
        });
      }

      // v15 also sometimes returns { stream: { url: "..." } }
      if (data.stream?.url && typeof data.stream.url === 'string' && data.stream.url.startsWith('http') && !seenUrls.has(data.stream.url)) {
        seenUrls.add(data.stream.url);
        streams.push({
          url: data.stream.url,
          type: 'hls',
          quality: '',
          resolution: '',
          server: v.label,
        });
      }

      // v17 format: { stream: { url: "..." } }
      if (v.ver === 'v17' && data.stream?.url && !seenUrls.has(data.stream.url)) {
        // v17 often returns 403 — skip unless validated
        seenUrls.add(data.stream.url);
      }
    }

    // Deduplicate subtitles
    const seenSubs = new Set();
    const uniqueSubs = subtitles.filter(s => {
      if (seenSubs.has(s.url)) return false;
      seenSubs.add(s.url);
      return true;
    });

    const embedUrl = `${BASE}/${isTv ? `tv/${tmdbId}${pathSuffix}` : `movie/${tmdbId}`}`;

    return {
      source: sourceName,
      embedUrl,
      status: streams.length > 0 ? 'working' : 'no_streams',
      streams,
      ...(uniqueSubs.length > 0 ? { subtitles: uniqueSubs } : {}),
      latency_ms: Date.now() - start,
    };
  } catch (err) {
    return {
      source: sourceName,
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
      tmdbId: parseInt(args.tmdb || args.id || '24428'),
      type: args.type || 'movie',
      season: parseInt(args.season || '1'),
      episode: parseInt(args.episode || '1'),
    });
    console.log(JSON.stringify(result, null, 2));
  })();
}
