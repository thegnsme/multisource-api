/**
 * vidapi.xyz — VidAPI embed player.
 * Status: embed (JS-rendered, may have API endpoints).
 */
const { scrapeEmbedSource } = require('../utils/embedScraper');
const BASE = 'https://vidapi.xyz';
async function scrapeSource({ tmdbId, type, season, episode }) {
  const embedUrl = type === 'movie'
    ? `${BASE}/embed/movie/${tmdbId}`
    : `${BASE}/embed/tv/${tmdbId}/${season}/${episode}`;
  const apiUrl = type === 'movie'
    ? `${BASE}/api/movie/${tmdbId}`
    : `${BASE}/api/tv/${tmdbId}/${season}/${episode}`;
  return await scrapeEmbedSource({ name: 'vidapi.xyz', embedUrl, apiUrl, referer: BASE });
}
module.exports = { scrapeSource };
