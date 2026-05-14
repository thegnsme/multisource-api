/**
 * vidsrc.fyi — Vidsrc variant (redirects to vsembed.ru).
 * Status: embed (JS-rendered)
 */
const { scrapeEmbedSource } = require('../utils/embedScraper');
const BASE = 'https://vidsrc.fyi';
async function scrapeSource({ tmdbId, type, season, episode }) {
  const embedUrl = type === 'movie'
    ? `${BASE}/embed/movie/${tmdbId}`
    : `${BASE}/embed/tv/${tmdbId}/${season}/${episode}`;
  return await scrapeEmbedSource({ name: 'vidsrc.fyi', embedUrl, referer: BASE });
}
module.exports = { scrapeSource };
