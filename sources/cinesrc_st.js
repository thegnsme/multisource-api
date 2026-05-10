const { fetchUrl } = require('../utils/fetcher');

const BASE = 'https://cinesrc.st';

async function scrapeSource({ tmdbId, type, season, episode }) {
  const path = type === 'movie'
    ? '/embed/movie/{tmdb}'.replace('{tmdb}', tmdbId)
    : '/embed/tv/{tmdb}/{season}/{episode}'.replace('{tmdb}', tmdbId).replace('{season}', season || 1).replace('{episode}', episode || 1);
  const embedUrl = BASE + path;

  // Next.js RSC app — streams loaded client-side via JS. No static API endpoint found.
  const { html, status } = await fetchUrl(embedUrl, { timeout: 5000 });
  const streams = [];

  if (html && status >= 200 && status < 400) {
    // Check for any m3u8 URLs in the page
    const m3u8s = html.match(/https?:\/\/[^\s\"'<>]+\.m3u8[^\s\"'<>]*/g);
    if (m3u8s) {
      for (const url of m3u8s) {
        streams.push({ url: url.replace(/[\'\"\)>\s]+$/g, ''), type: 'hls', quality: '' });
      }
    }
  }

  return {
    source: 'cinesrc.st',
    embedUrl,
    status: streams.length > 0 ? 'working' : 'embed',
    streams,
  };
}

module.exports = { scrapeSource };
