/**
 * vidsrc.wtf — Next.js API player (4 API variants, client-side rendered).
 * 
 * API patterns:
 *   /api/1/movie/?id={tmdbId}
 *   /api/2/movie/?id={tmdbId}
 *   /api/3/movie/?id={tmdbId}
 *   /api/4/movie/?id={tmdbId}
 *
 * Status: embed (Next.js SPA, requires browser JS)
 */
const { fetchUrl } = require('../utils/fetcher');

const BASE = 'https://vidsrc.wtf';
const API_VERSIONS = [1, 2, 3, 4];

async function scrapeSource({ tmdbId, type, season, episode }) {
  const embedUrl = type === 'movie'
    ? `${BASE}/api/1/movie/?id=${tmdbId}`
    : `${BASE}/api/1/tv/?id=${tmdbId}&s=${season}&e=${episode}`;

  // Try all API variants for movies
  for (const ver of API_VERSIONS) {
    try {
      const apiUrl = type === 'movie'
        ? `${BASE}/api/${ver}/movie/?id=${tmdbId}`
        : `${BASE}/api/${ver}/tv/?id=${tmdbId}&s=${season}&e=${episode}`;
      const { html, status } = await fetchUrl(apiUrl, { referer: BASE, timeout: 6000 });
      if (html && status >= 200 && status < 400) {
        const m3u8s = html.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/g);
        if (m3u8s && m3u8s.length > 0) {
          const streams = m3u8s.map(url => ({ url: url.replace(/['")>]+$/g, ''), type: 'hls', quality: '' }));
          return { source: `vidsrc.wtf (api/${ver})`, embedUrl, status: 'working', streams };
        }
      }
    } catch (_) { /* try next variant */ }
  }

  return { source: 'vidsrc.wtf', embedUrl, status: 'embed', streams: [] };
}
module.exports = { scrapeSource };
