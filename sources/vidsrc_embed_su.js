/**
 * vidsrc-embed.su — Vidsrc embed player (Cloudnestra variant).
 * Status: embed (JS-rendered)
 */
const { scrapeEmbedSource } = require('../utils/embedScraper');
const BASE = 'https://vidsrc-embed.su';
async function scrapeSource({ tmdbId, type, season, episode }) {
  const embedUrl = type === 'movie'
    ? `${BASE}/embed/movie/${tmdbId}`
    : `${BASE}/embed/tv/${tmdbId}/${season}/${episode}`;
  return await scrapeEmbedSource({ name: 'vidsrc-embed.su', embedUrl, referer: BASE });
}
module.exports = { scrapeSource };
