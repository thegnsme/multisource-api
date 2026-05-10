/**
 * Update all 32 embed source files with proper implementations.
 * Categories:
 *   - cloudnestra: share the cloudnestra CDN chain
 *   - ezvidapi: use api.ezvidapi.com proxy
 *   - embed_js: needs JS execution (keep embed URL)
 *   - dead: DNS/connection errors
 *   - error: HTTP 4xx/5xx
 *   - redirect: ad redirect only
 */

const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'sources');

// ---------------------------------------------------------------------------
//  Template factory functions
// ---------------------------------------------------------------------------

function embedOnly(name, base, moviePath, tvPath, note) {
  return `
const { fetchUrl } = require('../utils/fetcher');

const BASE = '${base}';

async function scrapeSource({ tmdbId, type, season, episode }) {
  const path = type === 'movie'
    ? '${moviePath}'.replace('{tmdb}', tmdbId)
    : '${tvPath}'.replace('{tmdb}', tmdbId).replace('{season}', season || 1).replace('{episode}', episode || 1);
  const embedUrl = BASE + path;

  // ${note}
  const { html, status } = await fetchUrl(embedUrl, { timeout: 10000 });
  const streams = [];

  if (html && status >= 200 && status < 400) {
    // Check for any m3u8 URLs in the page
    const m3u8s = html.match(/https?:\\/\\/[^\\s\\"'<>]+\\.m3u8[^\\s\\"'<>]*/g);
    if (m3u8s) {
      for (const url of m3u8s) {
        streams.push({ url: url.replace(/[\\'\\"\\)>\\s]+\$/g, ''), type: 'hls', quality: '' });
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
`.trim();
}

function deadSource(name, base, moviePath, tvPath, reason) {
  return `
const BASE = '${base}';

async function scrapeSource({ tmdbId, type, season, episode }) {
  const path = type === 'movie'
    ? '${moviePath}'.replace('{tmdb}', tmdbId)
    : '${tvPath}'.replace('{tmdb}', tmdbId).replace('{season}', season || 1).replace('{episode}', episode || 1);
  const embedUrl = BASE + path;

  return {
    source: '${name}',
    embedUrl,
    status: 'unavailable',
    error: '${reason}',
    streams: [],
  };
}

module.exports = { scrapeSource };
`.trim();
}

function cloudnestraSource(name, base, moviePath, tvPath) {
  return `
const cn = require('./cloudnestra');

const BASE = '${base}';

function embedUrl(tmdbId, type, season, episode) {
  if (type === 'movie') return BASE + '${moviePath}'.replace('{tmdb}', tmdbId);
  return BASE + '${tvPath}'.replace('{tmdb}', tmdbId).replace('{season}', season || 1).replace('{episode}', episode || 1);
}

async function scrapeSource({ tmdbId, type, season, episode }) {
  const start = Date.now();
  const embed = embedUrl(tmdbId, type, season, episode);

  try {
    const r1 = await cn.fetch(embed, { timeout: 15000 });
    if (!r1.data) throw new Error('No response');

    const iframeMatch = r1.data.match(/<iframe[^>]+src\\s*=\\s*["']([^"']*cloudnestra[^"']*)["']/i);
    if (!iframeMatch) throw new Error('No cloudnestra iframe found');

    let cnRcpUrl = iframeMatch[1];
    if (cnRcpUrl.startsWith('//')) cnRcpUrl = 'https:' + cnRcpUrl;

    const r2 = await cn.fetch(cnRcpUrl, { referer: embed, timeout: 25000 });
    const prorcpMatch = r2.data.match(/["'](\\/prorcp\\/[^"']+)["']/);
    if (!prorcpMatch) throw new Error('No prorcp path found (Turnstile blocked)');

    const prorcpFull = 'https://cloudnestra.com' + prorcpMatch[1];
    const r3 = await cn.fetch(prorcpFull, { referer: cnRcpUrl, timeout: 25000 });
    const html = r3.data;

    const rawUrls = html.match(/https?:\\/\\/[^\\s\\"'<>\`]+\\.m3u8[^\\s\\"'<>\`]*/g);
    if (!rawUrls || rawUrls.length === 0) throw new Error('No m3u8 URLs');

    const resolved = [...new Set(rawUrls.map(u => cn.resolveVars(u)))];
    const allStreams = [];
    const seen = new Set();

    for (const rawUrl of resolved) {
      try {
        const resp = await cn.fetch(rawUrl, { referer: prorcpFull, timeout: 12000, retries: 1 });
        if (resp.data?.startsWith?.('#EXTM3U')) {
          for (const v of cn.parseMasterPlaylist(resp.data, rawUrl)) {
            if (!seen.has(v.url)) { seen.add(v.url); allStreams.push(v); }
          }
        }
      } catch (_) {}
    }

    if (allStreams.length === 0) {
      for (const url of resolved) {
        if (!seen.has(url)) { seen.add(url); allStreams.push({ url, type: 'hls', quality: '', resolution: '' }); }
      }
    }

    const subtitles = cn.extractSubtitles(html, prorcpFull);
    const title = cn.extractTitle(html);

    return {
      source: '${name}',
      embedUrl: embed,
      status: allStreams.length > 0 ? 'working' : 'embed',
      title,
      streams: allStreams,
      subtitles: subtitles.length > 0 ? subtitles : undefined,
      latency_ms: Date.now() - start,
    };
  } catch (err) {
    return {
      source: '${name}',
      embedUrl: embed,
      status: 'embed',
      error: err.message,
      streams: [],
      latency_ms: Date.now() - start,
    };
  }
}

module.exports = { scrapeSource };
`.trim();
}

// ---------------------------------------------------------------------------
//  Source definitions: [filename, name, base, moviePath, tvPath, category, note]
//  category: 'cloudnestra' | 'ezvidapi' | 'embed_js' | 'dead' | 'error' | 'redirect'
// ---------------------------------------------------------------------------

const sources = [

  // === DEAD / OFFLINE ===
  ['embed_su.js',        'embed.su',        'https://embed.su',        '/embed/movie/{tmdb}',                    '/embed/tv/{tmdb}/{season}/{episode}',        'dead', 'DNS error — domain does not resolve'],
  ['vidsrc_xyz.js',      'vidsrc.xyz',      'https://vidsrc.xyz',      '/embed/movie/{tmdb}',                    '/embed/tv/{tmdb}/{season}/{episode}',        'dead', 'DNS error — domain does not resolve'],
  ['vembed_stream.js',   'vembed.stream',   'https://vembed.stream',   '/embed/movie/{tmdb}',                    '/embed/tv/{tmdb}/{season}/{episode}',        'dead', 'DNS error — domain does not resolve'],
  ['rivestream_org.js',  'rivestream.org',  'https://rivestream.org',  '/embed/movie/{tmdb}',                    '/embed/tv/{tmdb}/{season}/{episode}',        'dead', 'DNS error — domain does not resolve'],
  ['vidembed_site.js',   'vidembed.site',   'https://vidembed.site',   '/embed/movie/{tmdb}',                    '/embed/tv/{tmdb}/{season}/{episode}',        'dead', 'DNS error — domain does not resolve'],
  ['vidsrc_pro.js',      'vidsrc.pro',      'https://vidsrc.pro',      '/embed/movie/{tmdb}',                    '/embed/tv/{tmdb}/{season}/{episode}',        'dead', 'DNS error — domain does not resolve'],
  ['vidsrc_network.js',  'vidsrc.network',  'https://vidsrc.network',  '/embed/movie/{tmdb}',                    '/embed/tv/{tmdb}/{season}/{episode}',        'dead', 'DNS error — domain does not resolve'],
  ['vidsrc_space.js',    'vidsrc.space',    'https://vidsrc.space',    '/embed/movie/{tmdb}',                    '/embed/tv/{tmdb}/{season}/{episode}',        'dead', 'DNS error — domain does not resolve'],
  ['vidsrc_link.js',     'vidsrc.link',     'https://vidsrc.link',     '/embed/movie/{tmdb}',                    '/embed/tv/{tmdb}/{season}/{episode}',        'dead', 'DNS error — domain does not resolve'],

  // === ERROR (HTTP 4xx/5xx) ===
  ['vidsrc_online.js',   'vidsrc.online',   'https://vidsrc.online',   '/embed/movie/{tmdb}',                    '/embed/tv/{tmdb}/{season}/{episode}',        'error', 'HTTP 404 — not found'],
  ['vidfast_pro.js',     'vidfast.pro',     'https://vidfast.pro',     '/embed/movie/{tmdb}',                    '/embed/tv/{tmdb}/{season}/{episode}',        'error', 'HTTP 404 — not found'],
  ['player_videasy_net.js', 'player.videasy.net', 'https://player.videasy.net', '/embed/movie/{tmdb}', '/embed/tv/{tmdb}/{season}/{episode}', 'error', 'HTTP 404 — not found'],
  ['vidbinge_to.js',     'vidbinge.to',     'https://vidbinge.to',     '/embed/movie/{tmdb}',                    '/embed/tv/{tmdb}/{season}/{episode}',        'error', 'HTTP 404 — not found'],
  ['vidlink_pro.js',     'vidlink.pro',     'https://vidlink.pro',     '/embed/movie/{tmdb}',                    '/embed/tv/{tmdb}/{season}/{episode}',        'error', 'HTTP 404 — not found'],
  ['vidpop_xyz.js',      'vidpop.xyz',      'https://vidpop.xyz',      '/embed/movie/{tmdb}',                    '/embed/tv/{tmdb}/{season}/{episode}',        'error', 'HTTP 404 — not found'],
  ['cinemaos_tech.js',   'cinemaos.tech',   'https://cinemaos.tech',   '/embed/movie/{tmdb}',                    '/embed/tv/{tmdb}/{season}/{episode}',        'error', 'HTTP 404 — not found'],
  ['streamsrc_cc.js',    'streamsrc.cc',    'https://streamsrc.cc',    '/embed/movie/{tmdb}',                    '/embed/tv/{tmdb}/{season}/{episode}',        'error', 'HTTP 404 — not found'],
  ['vidsrc_stream.js',   'vidsrc.stream',   'https://vidsrc.stream',   '/embed/movie/{tmdb}',                    '/embed/tv/{tmdb}/{season}/{episode}',        'error', 'HTTP 404 — not found'],
  ['multiembed_mov.js',  'multiembed.mov',  'https://multiembed.mov',  '/embed/movie/{tmdb}',                    '/embed/tv/{tmdb}/{season}/{episode}',        'error', 'HTTP 403 — forbidden'],
  ['player_vidplus_to.js', 'player.vidplus.to', 'https://player.vidplus.to', '/embed/movie/{tmdb}', '/embed/tv/{tmdb}/{season}/{episode}', 'error', 'HTTP 403 — forbidden'],
  ['player_embed_api_stream.js', 'player.embed-api.stream', 'https://player.embed-api.stream', '/embed/movie/{tmdb}', '/embed/tv/{tmdb}/{season}/{episode}', 'error', 'HTTP 400 — bad request'],
  ['vidmody_com.js',     'vidmody.com',     'https://vidmody.com',     '/embed/movie/{tmdb}',                    '/embed/tv/{tmdb}/{season}/{episode}',        'error', 'HTTP 502 — bad gateway'],

  // === REDIRECT ONLY ===
  ['vidsrc_rip.js',      'vidsrc.rip',      'https://vidsrc.rip',      '/embed/movie/{tmdb}',                    '/embed/tv/{tmdb}/{season}/{episode}',        'redirect', 'Page redirects to ad network (bulsis.net) — no video content'],

  // === CLOUDNESTRA (direct iframe) ===
  ['vidsrc_embed_su.js', 'vidsrc-embed.su', 'https://vidsrc-embed.su', '/embed/movie/{tmdb}',                   '/embed/tv/{tmdb}/{season}/{episode}',        'cloudnestra', 'Cloudnestra CDN backend'],

  // === NEEDS JS EXECUTION (embed only for now) ===
  ['vidapi_xyz.js',      'vidapi.xyz',      'https://vidapi.xyz',      '/embed/movie/{tmdb}',                    '/embed/tv/{tmdb}/{season}/{episode}',        'embed_js', 'Chain: vidapi.xyz → stream.vidapi.xyz/vkng → vidking.net (React app). Needs JS execution.'],
  ['cinesrc_st.js',      'cinesrc.st',      'https://cinesrc.st',      '/embed/movie/{tmdb}',                    '/embed/tv/{tmdb}/{season}/{episode}',        'embed_js', 'Next.js RSC app — streams loaded client-side via JS. No static API endpoint found.'],
];

// Also handle ezvidapi_com.js separately (uses API endpoint)
// Note: There's already an ezvidapi.js that we created manually

// ---------------------------------------------------------------------------
//  Write files
// ---------------------------------------------------------------------------

let updated = 0;

for (const [filename, name, base, moviePath, tvPath, category, note] of sources) {
  const fp = path.join(DIR, filename);

  let content;
  switch (category) {
    case 'dead':
      content = deadSource(name, base, moviePath, tvPath, note);
      break;
    case 'error':
      content = deadSource(name, base, moviePath, tvPath, note);
      break;
    case 'redirect':
      content = deadSource(name, base, moviePath, tvPath, note);
      break;
    case 'cloudnestra':
      content = cloudnestraSource(name, base, moviePath, tvPath);
      break;
    case 'embed_js':
      content = embedOnly(name, base, moviePath, tvPath, note);
      break;
    default:
      content = embedOnly(name, base, moviePath, tvPath, note);
  }

  fs.writeFileSync(fp, content + '\n');
  updated++;
  console.log(`  Updated: ${filename} (${category})`);
}

// Special: ezvidapi_com.js — use API endpoint, not cloudnestra
console.log('\n  Writing ezvidapi_com.js (uses api.ezvidapi.com)...');
const ezContent = `
/**
 * ezvidapi.com — Uses api.ezvidapi.com proxy to deliver HLS streams with subtitles.
 *
 * The embed page loads a Next.js player, but the underlying API at api.ezvidapi.com
 * returns proxied m3u8 master playlists with quality variants and subtitle tracks.
 *
 * Providers: vidrock (7-12 subtitles), vidzee (7-12 subtitles)
 */

const { fetchUrl } = require('../utils/fetcher');

const API_BASE = 'https://api.ezvidapi.com';

// Try providers in order until one works
const PROVIDERS = ['vidrock', 'vidzee'];

async function scrapeSource({ tmdbId, type, season, episode }) {
  const embedUrl = 'https://ezvidapi.com/embed/' + type + '/' + tmdbId +
    (type === 'tv' ? '?season=' + (season || 1) + '&episode=' + (episode || 1) : '');
  const start = Date.now();

  for (const provider of PROVIDERS) {
    try {
      const apiUrl = type === 'movie'
        ? API_BASE + '/movie/' + provider + '/' + tmdbId
        : API_BASE + '/tv/' + provider + '/' + tmdbId + '?season=' + (season || 1) + '&episode=' + (episode || 1);

      const resp = await fetchUrl(apiUrl, { referer: API_BASE, timeout: 10000 });
      if (resp.status !== 200 || !resp.html) continue;

      let data;
      try { data = JSON.parse(resp.html); } catch (_) { continue; }
      if (!data.stream_url) continue;

      // Fetch the proxy m3u8
      const m3u8Resp = await fetchUrl(data.stream_url, { referer: API_BASE, timeout: 15000, retries: 1 });
      const streams = [];

      if (m3u8Resp.html && m3u8Resp.html.startsWith('#EXTM3U')) {
        const m3u8 = m3u8Resp.html;
        if (m3u8.includes('#EXT-X-STREAM-INF:')) {
          const lines = m3u8.split('\\n');
          for (let i = 0; i < lines.length; i++) {
            if (!lines[i].startsWith('#EXT-X-STREAM-INF:')) continue;
            const bw = lines[i].match(/BANDWIDTH=(\\d+)/)?.[1];
            const res = lines[i].match(/RESOLUTION=(\\d+x\\d+)/)?.[1];
            const nl = lines[i + 1]?.trim();
            if (nl && !nl.startsWith('#')) {
              const vu = nl.startsWith('http') ? nl : new URL(nl, data.stream_url).href;
              const h = res ? res.split('x')[1] : '';
              const qMap = { '360': '360p', '480': '480p', '720': '720p', '1080': '1080p', '2160': '4K' };
              streams.push({ url: vu, type: 'hls', quality: qMap[h] || (h ? h + 'p' : ''), resolution: res || '', bandwidth: bw ? parseInt(bw) : undefined });
              i++;
            }
          }
        } else {
          const urls = m3u8.split('\\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
          for (const url of urls) {
            streams.push({ url: url.startsWith('http') ? url : new URL(url, data.stream_url).href, type: 'hls', quality: '', resolution: '' });
          }
        }
      }

      // Fallback: decode base64 payload
      if (streams.length === 0) {
        const b64 = data.stream_url.match(/proxy\\/master\\/([^.]+)/);
        if (b64) {
          try {
            const decoded = JSON.parse(Buffer.from(b64[1], 'base64').toString('utf-8'));
            if (decoded.u) streams.push({ url: decoded.u, type: 'hls', quality: '', resolution: '' });
          } catch (_) {}
        }
      }

      // Subtitles
      const subtitles = Array.isArray(data.subtitles)
        ? data.subtitles.map(s => ({ url: s.url || s.u, lang: s.label || s.l || s.language || s.n || 'unknown', type: (s.url || s.u || '').endsWith('.vtt') ? 'vtt' : 'srt' }))
        : undefined;

      // Extract subs from m3u8
      if (m3u8Resp.html) {
        const subRe = /#EXT-X-MEDIA:TYPE=SUBTITLES[^#]*?NAME="([^"]+)"[^#]*?URI="([^"]+)"/g;
        let m;
        const subFromM3u8 = [];
        while ((m = subRe.exec(m3u8Resp.html)) !== null) {
          subFromM3u8.push({ url: m[2], lang: m[1], type: 'vtt' });
        }
        if (subFromM3u8.length > 0) {
          // Merge with API subs
          for (const s of subFromM3u8) {
            if (!subtitles?.find(x => x.lang === s.lang)) {
              if (!subtitles) subtitles = [];
              subtitles.push(s);
            }
          }
        }
      }

      return {
        source: 'ezvidapi.com (' + provider + ')',
        embedUrl,
        status: streams.length > 0 ? 'working' : 'no_streams',
        streams,
        subtitles: subtitles?.length > 0 ? subtitles : undefined,
        latency_ms: Date.now() - start,
      };
    } catch (_) {
      continue;
    }
  }

  return {
    source: 'ezvidapi.com',
    embedUrl,
    status: 'embed',
    streams: [],
    latency_ms: Date.now() - start,
  };
}

module.exports = { scrapeSource };
`.trim();

fs.writeFileSync(path.join(DIR, 'ezvidapi_com.js'), ezContent + '\n');
updated++;

console.log(`\\nTotal updated: ${updated} files`);
