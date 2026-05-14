/**
 * vidzee.wtf — VidZee embed player.
 * Status: embed (JS-rendered).
 */
const { scrapeEmbedSource } = require('../utils/embedScraper');
const BASE = 'https://player.vidzee.wtf';
async function scrapeSource({ tmdbId, type, season, episode }) {
  const embedUrl = type === 'movie'
    ? `${BASE}/embed/movie/${tmdbId}`
    : `${BASE}/embed/tv/${tmdbId}/${season}/${episode}`;
  return await scrapeEmbedSource({ name: 'player.vidzee.wtf', embedUrl, referer: BASE });
}
module.exports = { scrapeSource };
