/**
 * multiembed.mov — SuperEmbed multi-source player (Cloudflare protected).
 * 
 * Has documented JSON API at seapi.link:
 *   GET https://seapi.link/?type=tmdb&id={tmdbId}
 *
 * Status: embed (Cloudflare protected, needs browser)
 */
const { fetchUrl } = require('../utils/fetcher');

const BASE = 'https://multiembed.mov';

async function scrapeSource({ tmdbId, type, season, episode }) {
  const embedUrl = type === 'movie'
    ? `${BASE}/?video_id=${tmdbId}&tmdb=1`
    : `${BASE}/?video_id=${tmdbId}&tmdb=1&s=${season}&e=${episode}`;

  // Try the JSON API first
  try {
    const apiResp = await fetchUrl(`https://seapi.link/?type=tmdb&id=${tmdbId}`, { timeout: 5000 });
    if (apiResp.html && apiResp.status === 200) {
      let data;
      try { data = JSON.parse(apiResp.html); } catch (_) { data = null; }
      if (data && data.streams && data.streams.length > 0) {
        const streams = data.streams.map(s => ({
          url: s.url || s.file || '',
          type: 'hls',
          quality: s.quality || s.label || '',
        })).filter(s => s.url);
        if (streams.length > 0) {
          return { source: 'multiembed.mov', embedUrl, status: 'working', streams };
        }
      }
    }
  } catch (_) { /* fall through to embed */ }

  // Fallback: try fetching the embed page
  const { html, status } = await fetchUrl(embedUrl, { referer: BASE, timeout: 8000 });
  const streams = [];
  if (html && status >= 200 && status < 400) {
    const m3u8s = html.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/g);
    if (m3u8s) {
      for (const url of m3u8s) streams.push({ url: url.replace(/['")>]+$/g, ''), type: 'hls', quality: '' });
    }
  }
  return { source: 'multiembed.mov', embedUrl, status: streams.length > 0 ? 'working' : 'embed', streams };
}
module.exports = { scrapeSource };
