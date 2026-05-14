/**
 * primesrc.me — Embed player page with TMDB query param.
 * Status: embed (requires browser JS)
 */
const { fetchUrl } = require('../utils/fetcher');

const BASE = 'https://primesrc.me';

async function scrapeSource({ tmdbId, type, season, episode }) {
  const embedUrl = type === 'movie'
    ? `${BASE}/embed/movie?tmdb=${tmdbId}&fallback=true`
    : `${BASE}/embed/tv?tmdb=${tmdbId}&season=${season}&episode=${episode}&fallback=true`;
  const { html, status } = await fetchUrl(embedUrl, { referer: BASE, timeout: 8000 });
  const streams = [];
  if (html && status >= 200 && status < 400) {
    const m3u8s = html.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/g);
    if (m3u8s) {
      for (const url of m3u8s) streams.push({ url: url.replace(/['")>]+$/g, ''), type: 'hls', quality: '' });
    }
  }
  return { source: 'primesrc.me', embedUrl, status: streams.length > 0 ? 'working' : 'embed', streams };
}
module.exports = { scrapeSource };
