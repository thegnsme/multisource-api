/**
 * vidfast.pro — Next.js video streaming app.
 * Status: embed (JS-rendered).
 */
const { scrapeEmbedSource } = require('../utils/embedScraper');
const BASE = 'https://vidfast.pro';
async function scrapeSource({ tmdbId, type, season, episode }) {
  const embedUrl = type === 'movie'
    ? `${BASE}/movie/${tmdbId}?autoPlay=true&theme=3b82f6`
    : `${BASE}/tv/${tmdbId}/${season}/${episode}?autoPlay=true&theme=3b82f6&nextButton=true`;
  return await scrapeEmbedSource({ name: 'vidfast.pro', embedUrl, referer: BASE });
}
module.exports = { scrapeSource };
