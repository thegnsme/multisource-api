/**
 * embed-api.stream — Embed player API.
 * Status: embed (JS-rendered).
 */
const { scrapeEmbedSource } = require('../utils/embedScraper');
const BASE = 'https://player.embed-api.stream';
async function scrapeSource({ tmdbId, type, season, episode }) {
  const embedUrl = type === 'movie'
    ? `${BASE}/?id=${tmdbId}&autoplay=true&theme=3b82f6`
    : `${BASE}/?id=${tmdbId}&s=${season}&e=${episode}&autoplay=true&nextButton=true`;
  return await scrapeEmbedSource({ name: 'player.embed-api.stream', embedUrl, referer: BASE });
}
module.exports = { scrapeSource };
