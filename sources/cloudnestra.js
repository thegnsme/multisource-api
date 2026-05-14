/**
 * cloudnestra.com — CloudNestra embed player (Cloudflare-protected).
 * Status: embed (JS-rendered, Cloudflare-protected)
 */
const { scrapeEmbedSource } = require('../utils/embedScraper');

const BASE = 'https://vidsrc.icu';
const BASE_API = 'https://vidsrc.icu/api';

async function scrapeSource({ tmdbId, type, season, episode }) {
  const embedUrl = type === 'movie'
    ? `${BASE}/embed/movie/${tmdbId}`
    : `${BASE}/embed/tv/${tmdbId}/${season}/${episode}`;
  const apiUrl = type === 'movie'
    ? `${BASE_API}/movie/${tmdbId}`
    : `${BASE_API}/tv/${tmdbId}/${season}/${episode}`;
  return await scrapeEmbedSource({
    name: 'cloudnestra.com',
    embedUrl,
    apiUrl,
    referer: BASE,
  });
}
module.exports = { scrapeSource };
