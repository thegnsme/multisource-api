/**
 * multiembed.mov — MultiEmbed player.
 * Status: embed (JS-rendered, often behind Cloudflare).
 */
const { scrapeEmbedSource } = require('../utils/embedScraper');
const BASE = 'https://multiembed.mov';
async function scrapeSource({ tmdbId, type, season, episode }) {
  const embedUrl = type === 'movie'
    ? `${BASE}/?video_id=${tmdbId}&tmdb=1`
    : `${BASE}/?video_id=${tmdbId}&tmdb=1&s=${season}&e=${episode}`;
  return await scrapeEmbedSource({ name: 'multiembed.mov', embedUrl, referer: BASE });
}
module.exports = { scrapeSource };
