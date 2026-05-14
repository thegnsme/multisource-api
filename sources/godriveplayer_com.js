/**
 * godriveplayer.com — Embed player page (JWPlayer with AES-encrypted sources).
 * Status: embed (needs JS for AES decryption)
 */
const { fetchUrl } = require('../utils/fetcher');

const BASE = 'https://godriveplayer.com';

async function scrapeSource({ tmdbId, type, season, episode }) {
  const embedUrl = type === 'movie'
    ? `${BASE}/player.php?tmdb=${tmdbId}`
    : `${BASE}/player.php?type=series&tmdb=${tmdbId}&season=${season}&episode=${episode}`;
  const { html, status } = await fetchUrl(embedUrl, { referer: BASE, timeout: 8000 });
  const streams = [];
  if (html && status >= 200 && status < 400) {
    const m3u8s = html.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/g);
    if (m3u8s) {
      for (const url of m3u8s) streams.push({ url: url.replace(/['")>]+$/g, ''), type: 'hls', quality: '' });
    }
  }
  return { source: 'godriveplayer.com', embedUrl, status: streams.length > 0 ? 'working' : 'embed', streams };
}
module.exports = { scrapeSource };
