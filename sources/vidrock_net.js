/**
 * vidrock.net — Video streaming API (Next.js app).
 * Status: embed (JS-rendered). Has /api/movie/:id endpoint but returns Forbidden.
 * Try with /movie/:id direct path.
 */
const { scrapeEmbedSource } = require('../utils/embedScraper');
const BASE = 'https://vidrock.net';
async function scrapeSource({ tmdbId, type, season, episode }) {
  const embedUrl = type === 'movie'
    ? `${BASE}/movie/${tmdbId}`
    : `${BASE}/tv/${tmdbId}/${season}/${episode}`;
  const apiUrl = type === 'movie'
    ? `${BASE}/api/movie/${tmdbId}`
    : `${BASE}/api/tv/${tmdbId}/${season}/${episode}`;
  return await scrapeEmbedSource({ name: 'vidrock.net', embedUrl, apiUrl, referer: BASE });
}
module.exports = { scrapeSource };
