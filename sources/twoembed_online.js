/**
 * 2embed.online — 2Embed variant.
 * Status: embed (JS-rendered)
 */
const { scrapeEmbedSource } = require('../utils/embedScraper');
const BASE = 'https://www.2embed.online';
async function scrapeSource({ tmdbId, type, season, episode }) {
  const embedUrl = type === 'movie'
    ? `${BASE}/embed/movie/${tmdbId}`
    : `${BASE}/embed/tv/${tmdbId}/${season}/${episode}`;
  return await scrapeEmbedSource({ name: '2embed.online', embedUrl, referer: BASE });
}
module.exports = { scrapeSource };
