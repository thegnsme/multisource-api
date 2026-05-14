/**
 * moviesapi.to — MoviesAPI embed (404 for many endpoints).
 * Status: embed (often returns 404).
 */
const { scrapeEmbedSource } = require('../utils/embedScraper');
const BASE = 'https://moviesapi.to';
async function scrapeSource({ tmdbId, type, season, episode }) {
  const embedUrl = type === 'movie'
    ? `${BASE}/movie/${tmdbId}`
    : `${BASE}/tv/${tmdbId}-${season}-${episode}`;
  return await scrapeEmbedSource({ name: 'moviesapi.to', embedUrl, referer: BASE });
}
module.exports = { scrapeSource };
