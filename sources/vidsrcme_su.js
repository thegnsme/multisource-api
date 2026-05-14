/**
 * vidsrcme.su — Vidsrc variant (Cloudnestra-based).
 * Status: embed (JS-rendered, Cloudflare-protected)
 */
const { scrapeEmbedSource } = require('../utils/embedScraper');
const BASE = 'https://vidsrcme.su';
async function scrapeSource({ tmdbId, type, season, episode }) {
  const embedUrl = type === 'movie'
    ? `${BASE}/embed/movie/${tmdbId}`
    : `${BASE}/embed/tv/${tmdbId}/${season}/${episode}`;
  return await scrapeEmbedSource({ name: 'vidsrcme.su', embedUrl, referer: BASE });
}
module.exports = { scrapeSource };
