/**
 * vidlux.online — Next.js video streaming app (Cloudflare).
 * Status: embed (JS-rendered, Cloudflare-protected).
 */
const { scrapeEmbedSource } = require('../utils/embedScraper');
const BASE = 'https://vidlux.online';
async function scrapeSource({ tmdbId, type, season, episode }) {
  const embedUrl = type === 'movie'
    ? `${BASE}/embed/movie/${tmdbId}?color=3b82f6&autoplay=true`
    : `${BASE}/embed/tv/${tmdbId}/${season}/${episode}?color=3b82f6&autoplay=true`;
  return await scrapeEmbedSource({ name: 'vidlux.online', embedUrl, referer: BASE });
}
module.exports = { scrapeSource };
