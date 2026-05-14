/**
 * player.embed-api.stream — Embed player page.
 * Status: embed (requires browser JS)
 */
const { fetchUrl } = require('../utils/fetcher');

const BASE = 'https://player.embed-api.stream';

async function scrapeSource({ tmdbId, type, season, episode }) {
  const embedUrl = type === 'movie'
    ? `${BASE}/?id=${tmdbId}&autoplay=true&theme=3b82f6`
    : `${BASE}/?id=${tmdbId}&s=${season}&e=${episode}&autoplay=true&nextButton=true`;
  const { html, status } = await fetchUrl(embedUrl, { referer: BASE, timeout: 8000 });
  const streams = [];
  if (html && status >= 200 && status < 400) {
    const m3u8s = html.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/g);
    if (m3u8s) {
      for (const url of m3u8s) streams.push({ url: url.replace(/['")>]+$/g, ''), type: 'hls', quality: '' });
    }
  }
  return { source: 'player.embed-api.stream', embedUrl, status: streams.length > 0 ? 'working' : 'embed', streams };
}
module.exports = { scrapeSource };
