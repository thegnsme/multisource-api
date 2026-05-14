/**
 * vsembed.su — VSembed player (used by vidsrc.to/fyi/mov).
 * Status: embed (JS-rendered).
 */
const { scrapeEmbedSource } = require('../utils/embedScraper');
const BASE = 'https://vsembed.su';
async function scrapeSource({ tmdbId, type, season, episode }) {
  const embedUrl = type === 'movie'
    ? `${BASE}/embed/movie?tmdb=${tmdbId}&autoplay=1`
    : `${BASE}/embed/tv?tmdb=${tmdbId}&season=${season}&episode=${episode}&autoplay=1`;
  return await scrapeEmbedSource({ name: 'vsembed.su', embedUrl, referer: BASE });
}
module.exports = { scrapeSource };
