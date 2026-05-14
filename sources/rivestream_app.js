/**
 * rivestream.app — RiveStream embed player.
 * Status: embed (JS-rendered).
 */
const { scrapeEmbedSource } = require('../utils/embedScraper');
const BASE = 'https://www.rivestream.app';
async function scrapeSource({ tmdbId, type, season, episode }) {
  const embedUrl = type === 'movie'
    ? `${BASE}/embed?type=movie&id=${tmdbId}`
    : `${BASE}/embed?type=tv&id=${tmdbId}&season=${season}&episode=${episode}`;
  return await scrapeEmbedSource({ name: 'rivestream.app', embedUrl, referer: BASE });
}
module.exports = { scrapeSource };
