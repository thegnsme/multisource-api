/**
 * vidstorm.ru — VidStorm video streaming API.
 * Status: embed (JS-rendered).
 */
const { scrapeEmbedSource } = require('../utils/embedScraper');
const BASE = 'https://vidstorm.ru';
async function scrapeSource({ tmdbId, type, season, episode }) {
  const embedUrl = type === 'movie'
    ? `${BASE}/movie/${tmdbId}`
    : `${BASE}/tv/${tmdbId}/${season}/${episode}`;
  return await scrapeEmbedSource({ name: 'vidstorm.ru', embedUrl, referer: BASE });
}
module.exports = { scrapeSource };
