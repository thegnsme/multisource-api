/**
 * embed.smashystream.com — SmashyStream embed player.
 * Status: embed (returns HTML with player).
 */
const { scrapeEmbedSource } = require('../utils/embedScraper');
const BASE = 'https://embed.smashystream.com';
async function scrapeSource({ tmdbId, type, season, episode }) {
  const embedUrl = type === 'movie'
    ? `${BASE}/playere.php?tmdb=${tmdbId}`
    : `${BASE}/playere.php?tmdb=${tmdbId}&season=${season}&episode=${episode}`;
  return await scrapeEmbedSource({ name: 'embed.smashystream.com', embedUrl, referer: BASE });
}
module.exports = { scrapeSource };
