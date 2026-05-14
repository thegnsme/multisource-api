/**
 * 2embed.cc — Embed player with multiple server backends.
 * Has API at streamsrcs.2embed.cc (returns HTML player, may have extractable URLs)
 */
const { scrapeEmbedSource } = require('../utils/embedScraper');
const BASE = 'https://www.2embed.cc';
async function scrapeSource({ tmdbId, type, season, episode }) {
  const embedUrl = type === 'movie'
    ? `${BASE}/embed/${tmdbId}`
    : `${BASE}/embedtv/${tmdbId}&s=${season}&e=${episode}`;
  // Try the internal API endpoint (vkng uses tmdb= param)
  const apiUrl = type === 'movie'
    ? `https://streamsrcs.2embed.cc/vkng?tmdb=${tmdbId}`
    : `https://streamsrcs.2embed.cc/vkng?tmdb=${tmdbId}&s=${season}&e=${episode}`;
  return await scrapeEmbedSource({ name: '2embed.cc', embedUrl, apiUrl, referer: BASE });
}
module.exports = { scrapeSource };
