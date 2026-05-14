/**
 * www.rivestream.app — Next.js player (client-side rendered).
 * Uses torrent-based streaming backend.
 * Status: embed (requires browser JS, torrent-based not HLS)
 */
const { fetchUrl } = require('../utils/fetcher');

const BASE = 'https://www.rivestream.app';

async function scrapeSource({ tmdbId, type, season, episode }) {
  const embedUrl = type === 'movie'
    ? `${BASE}/embed?type=movie&id=${tmdbId}`
    : `${BASE}/embed?type=tv&id=${tmdbId}&season=${season}&episode=${episode}`;
  const { html, status } = await fetchUrl(embedUrl, { referer: BASE, timeout: 8000 });
  const streams = [];
  if (html && status >= 200 && status < 400) {
    const m3u8s = html.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/g);
    if (m3u8s) {
      for (const url of m3u8s) streams.push({ url: url.replace(/['")>]+$/g, ''), type: 'hls', quality: '' });
    }
    // Also check for direct torrent URLs
    const mags = html.match(/magnet:\?[^\s"'<>]+/g);
    if (mags) {
      for (const url of mags) streams.push({ url: url.replace(/['")>]+$/g, ''), type: 'torrent', quality: '' });
    }
  }
  return { source: 'rivestream.app', embedUrl, status: streams.length > 0 ? 'working' : 'embed', streams };
}
module.exports = { scrapeSource };
