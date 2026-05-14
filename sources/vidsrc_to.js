/**
 * vidsrc.to — Vidsrc embed player (redirects to vsembed.ru).
 * Status: embed (JS-rendered)
 */
const { scrapeEmbedSource } = require('../utils/embedScraper');
const BASE = 'https://vidsrc.to';
async function scrapeSource({ tmdbId, type, season, episode }) {
  const embedUrl = type === 'movie'
    ? `${BASE}/embed/movie/${tmdbId}`
    : `${BASE}/embed/tv/${tmdbId}/${season}/${episode}`;
  return await scrapeEmbedSource({ name: 'vidsrc.to', embedUrl, referer: BASE });
}
module.exports = { scrapeSource };
