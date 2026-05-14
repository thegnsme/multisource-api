/**
 * player.vidplus.to — Embed player page via cloudflare-protected iframe.
 * Status: embed (behind Cloudflare, requires browser)
 */
const { fetchUrl } = require('../utils/fetcher');

const BASE = 'https://player.vidplus.to';

async function scrapeSource({ tmdbId, type, season, episode }) {
  const embedUrl = type === 'movie'
    ? `${BASE}/embed/movie/${tmdbId}`
    : `${BASE}/embed/tv/${tmdbId}/${season}/${episode}`;
  const { html, status } = await fetchUrl(embedUrl, { referer: BASE, timeout: 8000 });
  const streams = [];
  if (html && status >= 200 && status < 400) {
    const m3u8s = html.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/g);
    if (m3u8s) {
      for (const url of m3u8s) streams.push({ url: url.replace(/['")>]+$/g, ''), type: 'hls', quality: '' });
    }
  }
  return { source: 'player.vidplus.to', embedUrl, status: streams.length > 0 ? 'working' : 'embed', streams };
}
module.exports = { scrapeSource };
