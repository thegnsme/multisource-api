/**
 * embedmaster.link — Embed master player.
 * Status: embed (JS-rendered).
 */
const { scrapeEmbedSource } = require('../utils/embedScraper');
const BASE = 'https://embedmaster.link';
async function scrapeSource({ tmdbId, type, season, episode }) {
  const embedUrl = type === 'movie'
    ? `${BASE}/movie/${tmdbId}`
    : `${BASE}/tv/${tmdbId}/${season}/${episode}`;
  return await scrapeEmbedSource({ name: 'embedmaster.link', embedUrl, referer: BASE });
}
module.exports = { scrapeSource };
