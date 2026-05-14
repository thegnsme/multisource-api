/**
 * 2embed.cc — Embed player page.
 * Status: embed (requires browser JS, redirects to 2embed.skin)
 */
const { fetchUrl } = require('../utils/fetcher');

const BASE = 'https://www.2embed.cc';

async function scrapeSource({ tmdbId, type, season, episode }) {
  const embedUrl = type === 'movie'
    ? `${BASE}/embed/${tmdbId}`
    : `${BASE}/embedtv/${tmdbId}&s=${season}&e=${episode}`;
  const { html, status } = await fetchUrl(embedUrl, { referer: BASE, timeout: 8000 });
  const streams = [];
  if (html && status >= 200 && status < 400) {
    const m3u8s = html.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/g);
    if (m3u8s) {
      for (const url of m3u8s) streams.push({ url: url.replace(/['")>]+$/g, ''), type: 'hls', quality: '' });
    }
  }
  return { source: '2embed.cc', embedUrl, status: streams.length > 0 ? 'working' : 'embed', streams };
}
module.exports = { scrapeSource };
