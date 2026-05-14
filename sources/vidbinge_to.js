/**
 * vidbinge.to — Laravel movie API (redirects to vidora.stream).
 * Status: embed (JS-rendered, Laravel backend).
 */
const { scrapeEmbedSource } = require('../utils/embedScraper');
const BASE = 'https://vidbinge.to';
async function scrapeSource({ tmdbId, type, season, episode }) {
  const embedUrl = type === 'movie'
    ? `${BASE}/movie/${tmdbId}`
    : `${BASE}/tv/${tmdbId}/${season}/${episode}`;
  return await scrapeEmbedSource({ name: 'vidbinge.to', embedUrl, referer: BASE });
}
module.exports = { scrapeSource };
