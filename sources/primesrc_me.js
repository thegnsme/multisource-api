/**
 * primesrc.me — PrimeSrc embed player.
 * Status: embed (JS-rendered).
 */
const { scrapeEmbedSource } = require('../utils/embedScraper');
const BASE = 'https://primesrc.me';
async function scrapeSource({ tmdbId, type, season, episode }) {
  const embedUrl = type === 'movie'
    ? `${BASE}/embed/movie?tmdb=${tmdbId}&fallback=true`
    : `${BASE}/embed/tv?tmdb=${tmdbId}&season=${season}&episode=${episode}&fallback=true`;
  return await scrapeEmbedSource({ name: 'primesrc.me', embedUrl, referer: BASE });
}
module.exports = { scrapeSource };
