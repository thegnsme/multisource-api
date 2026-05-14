/**
 * nontongo.win — NontonGo embed player.
 * Status: embed (JS-rendered).
 */
const { scrapeEmbedSource } = require('../utils/embedScraper');
const BASE = 'https://www.NontonGo.win';
async function scrapeSource({ tmdbId, type, season, episode }) {
  const embedUrl = type === 'movie'
    ? `${BASE}/embed/movie/${tmdbId}`
    : `${BASE}/embed/tv/${tmdbId}/${season}/${episode}`;
  return await scrapeEmbedSource({ name: 'nontongo.win', embedUrl, referer: BASE });
}
module.exports = { scrapeSource };
