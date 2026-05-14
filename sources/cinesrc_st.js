/**
 * cinesrc.st — Next.js embed player (Cloudflare).
 * Status: embed (JS-rendered, Cloudflare-protected).
 */
const { scrapeEmbedSource } = require('../utils/embedScraper');
const BASE = 'https://cinesrc.st';
async function scrapeSource({ tmdbId, type, season, episode }) {
  const embedUrl = type === 'movie'
    ? `${BASE}/embed/movie/${tmdbId}`
    : `${BASE}/embed/tv/${tmdbId}?s=${season}&e=${episode}`;
  return await scrapeEmbedSource({ name: 'cinesrc.st', embedUrl, referer: BASE });
}
module.exports = { scrapeSource };
