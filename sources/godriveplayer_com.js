/**
 * godriveplayer.com — GoDriver player page.
 * Status: embed (JS-rendered).
 */
const { scrapeEmbedSource } = require('../utils/embedScraper');
const BASE = 'https://godriveplayer.com';
async function scrapeSource({ tmdbId, type, season, episode }) {
  const embedUrl = type === 'movie'
    ? `${BASE}/player.php?tmdb=${tmdbId}`
    : `${BASE}/player.php?type=series&tmdb=${tmdbId}&season=${season}&episode=${episode}`;
  return await scrapeEmbedSource({ name: 'godriveplayer.com', embedUrl, referer: BASE });
}
module.exports = { scrapeSource };
