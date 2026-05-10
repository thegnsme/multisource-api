const BASE = 'https://vidsrc.rip';

async function scrapeSource({ tmdbId, type, season, episode }) {
  const path = type === 'movie'
    ? '/embed/movie/{tmdb}'.replace('{tmdb}', tmdbId)
    : '/embed/tv/{tmdb}/{season}/{episode}'.replace('{tmdb}', tmdbId).replace('{season}', season || 1).replace('{episode}', episode || 1);
  const embedUrl = BASE + path;

  return {
    source: 'vidsrc.rip',
    embedUrl,
    status: 'unavailable',
    error: 'Page redirects to ad network (bulsis.net) — no video content',
    streams: [],
  };
}

module.exports = { scrapeSource };
