/**
 * vidsrc.wtf — Has 4 API variants + embed player.
 * Status: embed (JS-rendered, APIs may work)
 */
const { scrapeEmbedSource } = require('../utils/embedScraper');
const BASE = 'https://vidsrc.wtf';
async function scrapeSource({ tmdbId, type, season, episode }) {
  const embedUrl = type === 'movie'
    ? `${BASE}/embed/movie/${tmdbId}`
    : `${BASE}/embed/tv/${tmdbId}/${season}/${episode}`;
  // Try 4 API variants
  const apiUrls = [];
  for (const v of [1, 2, 3, 4]) {
    apiUrls.push(type === 'movie'
      ? `${BASE}/api/${v}/movie/?id=${tmdbId}&color=ffffff`
      : `${BASE}/api/${v}/tv/?id=${tmdbId}&s=${season}&e=${episode}&color=ffffff`);
  }
  // Try each API variant
  for (const apiUrl of apiUrls) {
    const result = await scrapeEmbedSource({ name: 'vidsrc.wtf', embedUrl, apiUrl, referer: BASE });
    if (result.streams.length > 0) return result;
  }
  return await scrapeEmbedSource({ name: 'vidsrc.wtf', embedUrl, referer: BASE });
}
module.exports = { scrapeSource };
