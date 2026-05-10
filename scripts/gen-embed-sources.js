/**
 * Generate embed-only source files (provide embed URLs as fallback).
 */
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'sources');

const sources = [
  // [name, baseUrl, moviePattern, tvPattern]
  ['vidsrcme.su',     'https://vidsrcme.su',     '/embed/movie?tmdb={tmdb}',              '/embed/tv?tmdb={tmdb}&season={season}&episode={episode}'],
  ['vidsrc.to',       'https://vidsrc.to',       '/embed/movie/{tmdb}',                    '/embed/tv/{tmdb}/{season}/{episode}'],
  ['vidsrc.fyi',      'https://vidsrc.fyi',      '/embed/movie/{tmdb}',                    '/embed/tv/{tmdb}/{season}/{episode}'],
  ['embed.su',        'https://embed.su',        '/embed/movie/{tmdb}',                    '/embed/tv/{tmdb}/{season}/{episode}'],
  ['vidsrc.rip',      'https://vidsrc.rip',      '/embed/movie/{tmdb}',                    '/embed/tv/{tmdb}/{season}/{episode}'],
  ['vidsrc.icu',      'https://vidsrc.icu',      '/embed/movie/{tmdb}',                    '/embed/tv/{tmdb}/{season}/{episode}'],
  ['vidsrc.online',   'https://vidsrc.online',   '/embed/movie/{tmdb}',                    '/embed/tv/{tmdb}/{season}/{episode}'],
  ['vidsrc.xyz',      'https://vidsrc.xyz',      '/embed/movie/{tmdb}',                    '/embed/tv/{tmdb}/{season}/{episode}'],
  ['vidsrc-embed.su', 'https://vidsrc-embed.su', '/embed/movie/{tmdb}',                    '/embed/tv/{tmdb}/{season}/{episode}'],
  ['vsrc.su',         'https://vsrc.su',         '/embed/movie/{tmdb}',                    '/embed/tv/{tmdb}/{season}/{episode}'],
  ['vidapi.xyz',      'https://vidapi.xyz',      '/embed/movie/{tmdb}',                    '/embed/tv/{tmdb}/{season}/{episode}'],
  ['vidfast.pro',     'https://vidfast.pro',     '/embed/movie/{tmdb}',                    '/embed/tv/{tmdb}/{season}/{episode}'],
  ['player.videasy.net', 'https://player.videasy.net', '/embed/movie/{tmdb}',               '/embed/tv/{tmdb}/{season}/{episode}'],
  ['cinesrc.st',      'https://cinesrc.st',      '/embed/movie/{tmdb}',                    '/embed/tv/{tmdb}/{season}/{episode}'],
  ['vembed.stream',   'https://vembed.stream',   '/embed/movie/{tmdb}',                    '/embed/tv/{tmdb}/{season}/{episode}'],
  ['multiembed.mov',  'https://multiembed.mov',  '/embed/movie/{tmdb}',                    '/embed/tv/{tmdb}/{season}/{episode}'],
  ['vidbinge.to',     'https://vidbinge.to',     '/embed/movie/{tmdb}',                    '/embed/tv/{tmdb}/{season}/{episode}'],
  ['vidmody.com',     'https://vidmody.com',     '/embed/movie/{tmdb}',                    '/embed/tv/{tmdb}/{season}/{episode}'],
  ['vidlink.pro',     'https://vidlink.pro',     '/embed/movie/{tmdb}',                    '/embed/tv/{tmdb}/{season}/{episode}'],
  ['vidpop.xyz',      'https://vidpop.xyz',      '/embed/movie/{tmdb}',                    '/embed/tv/{tmdb}/{season}/{episode}'],
  ['cinemaos.tech',   'https://cinemaos.tech',   '/embed/movie/{tmdb}',                    '/embed/tv/{tmdb}/{season}/{episode}'],
  ['rivestream.org',  'https://rivestream.org',  '/embed/movie/{tmdb}',                    '/embed/tv/{tmdb}/{season}/{episode}'],
  ['player.embed-api.stream', 'https://player.embed-api.stream', '/embed/movie/{tmdb}',    '/embed/tv/{tmdb}/{season}/{episode}'],
  ['ezvidapi.com',    'https://ezvidapi.com',    '/embed/movie/{tmdb}',                    '/embed/tv/{tmdb}/{season}/{episode}'],
  ['player.vidplus.to', 'https://player.vidplus.to', '/embed/movie/{tmdb}',                '/embed/tv/{tmdb}/{season}/{episode}'],
  ['streamsrc.cc',    'https://streamsrc.cc',    '/embed/movie/{tmdb}',                    '/embed/tv/{tmdb}/{season}/{episode}'],
  ['vidembed.site',   'https://vidembed.site',   '/embed/movie/{tmdb}',                    '/embed/tv/{tmdb}/{season}/{episode}'],
  ['vidsrc.pro',      'https://vidsrc.pro',      '/embed/movie/{tmdb}',                    '/embed/tv/{tmdb}/{season}/{episode}'],
  ['vidsrc.network',  'https://vidsrc.network',  '/embed/movie/{tmdb}',                    '/embed/tv/{tmdb}/{season}/{episode}'],
  ['vidsrc.stream',   'https://vidsrc.stream',   '/embed/movie/{tmdb}',                    '/embed/tv/{tmdb}/{season}/{episode}'],
  ['vidsrc.space',    'https://vidsrc.space',    '/embed/movie/{tmdb}',                    '/embed/tv/{tmdb}/{season}/{episode}'],
  ['vidsrc.link',     'https://vidsrc.link',     '/embed/movie/{tmdb}',                    '/embed/tv/{tmdb}/{season}/{episode}'],
];

const template = (name, base, moviePat, tvPat) => `
const { fetchUrl } = require('../utils/fetcher');

const BASE = '${base}';

async function scrapeSource({ tmdbId, type, season, episode }) {
  const path = type === 'movie'
    ? '${moviePat}'.replace('{tmdb}', tmdbId)
    : '${tvPat}'.replace('{tmdb}', tmdbId).replace('{season}', season || 1).replace('{episode}', episode || 1);
  const embedUrl = BASE + path;

  // Return embed URL (users can open in browser)
  // Try to scrape for direct streams
  const { html } = await fetchUrl(embedUrl, { timeout: 10000 });
  const streams = [];
  
  if (html) {
    // Check for any m3u8 URLs in the page
    const m3u8s = html.match(/https?:\\/\\/[^\\s\\\"'<>]+\\.m3u8[^\\s\\\"'<>]*/g);
    if (m3u8s) {
      for (const url of m3u8s) {
        streams.push({ url: url.replace(/[\\'\"\\)>\\s]+\$/g, ''), type: 'hls', quality: '' });
      }
    }
  }

  return {
    source: '${name}',
    embedUrl,
    status: streams.length > 0 ? 'working' : 'embed',
    streams,
  };
}

module.exports = { scrapeSource };
`;

let count = 0;
for (const [name, base, moviePat, tvPat] of sources) {
  const fn = name.replace(/[^a-z0-9]/gi, '_') + '.js';
  const fp = path.join(dir, fn);
  if (!fs.existsSync(fp) && name !== 'vaplayer') {
    fs.writeFileSync(fp, template(name, base, moviePat, tvPat).trim());
    count++;
  }
}
console.log(`Generated ${count} embed source files`);
