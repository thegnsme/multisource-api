/**
 * vidsrc.icu — CloudNestra embed player.
 * Status: embed (JS-rendered, Cloudflare-protected)
 */
const { scrapeEmbedSource } = require('../utils/embedScraper');
const BASE = 'https://vidsrc.icu';
async function scrapeSource({ tmdbId, type, season, episode }) {
  const embedUrl = type === 'movie'
    ? `${BASE}/embed/movie/${tmdbId}`
    : `${BASE}/embed/tv/${tmdbId}/${season}/${episode}`;
  return await scrapeEmbedSource({ name: 'vidsrc.icu', embedUrl, referer: BASE });
}
module.exports = { scrapeSource };
