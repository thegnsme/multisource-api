/**
 * vembed.click — VEmbed player page.
 * Status: embed (JS-rendered).
 */
const { scrapeEmbedSource } = require('../utils/embedScraper');
const BASE = 'https://vembed.click';
async function scrapeSource({ tmdbId, type, season, episode }) {
  const embedUrl = type === 'movie'
    ? `${BASE}/play/${tmdbId}`
    : `${BASE}/play/${tmdbId}_${season}_${episode}`;
  return await scrapeEmbedSource({ name: 'vembed.click', embedUrl, referer: BASE });
}
module.exports = { scrapeSource };
