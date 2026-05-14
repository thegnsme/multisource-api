/**
 * autoembed.co — Server selection page (redirects to vidsrc.xyz / 2embed.cc).
 * Status: embed (JS-rendered, just a server list).
 */
const { scrapeEmbedSource } = require('../utils/embedScraper');
const BASE = 'https://autoembed.co';
async function scrapeSource({ tmdbId, type, season, episode }) {
  const embedUrl = type === 'movie'
    ? `${BASE}/movie/tmdb/${tmdbId}`
    : `${BASE}/tv/tmdb/${tmdbId}-${season}-${episode}`;
  return await scrapeEmbedSource({ name: 'autoembed.co', embedUrl, referer: BASE });
}
module.exports = { scrapeSource };
