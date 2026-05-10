/**
 * vidsrcme.su — Cloudnestra CDN backend.
 *
 * Chain: vidsrcme.su/embed/movie?tmdb={id} → iframe to cloudnestra.com/rcp/BASE64
 * → prorcp → m3u8
 *
 * Shares cloudnestra.js parser for HLS variant extraction and subtitle parsing.
 */

const cn = require('./cloudnestra');

const BASE = 'https://vidsrcme.su';

function embedUrl(tmdbId, type, season, episode) {
  if (type === 'movie') return `${BASE}/embed/movie?tmdb=${tmdbId}`;
  return `${BASE}/embed/tv?tmdb=${tmdbId}&season=${season || 1}&episode=${episode || 1}`;
}

async function scrapeSource({ tmdbId, type, season, episode }) {
  const start = Date.now();
  const embed = embedUrl(tmdbId, type, season, episode);

  try {
    // 1 — Fetch the vidsrcme.su embed page
    const r1 = await cn.fetch(embed, { timeout: 5000 });
    if (!r1.data) throw new Error('No response from vidsrcme.su');

    // 2 — Extract cloudnestra iframe (direct, no intermediary)
    const iframeMatch = r1.data.match(/<iframe[^>]+src\s*=\s*["']([^"']*cloudnestra[^"']*)["']/i);
    if (!iframeMatch) throw new Error('No cloudnestra iframe found');

    let cnRcpUrl = iframeMatch[1];
    if (cnRcpUrl.startsWith('//')) cnRcpUrl = 'https:' + cnRcpUrl;

    // 3 — Fetch cloudnestra /rcp/ page
    const r2 = await cn.fetch(cnRcpUrl, { referer: embed, timeout: 5000 });

    // 4 — Extract prorcp path
    const prorcpMatch = r2.data.match(/["'](\/prorcp\/[^"']+)["']/);
    if (!prorcpMatch) throw new Error('No prorcp path found (Turnstile blocked)');

    const prorcpFull = `https://cloudnestra.com${prorcpMatch[1]}`;

    // 5 — Fetch prorcp page (contains m3u8 URLs)
    const r3 = await cn.fetch(prorcpFull, { referer: cnRcpUrl, timeout: 5000 });
    const html = r3.data;

    // 6 — Extract m3u8 raw URLs
    const rawUrls = html.match(/https?:\/\/[^\s"'<>`]+\.m3u8[^\s"'<>`]*/g);
    if (!rawUrls || rawUrls.length === 0) throw new Error('No m3u8 URLs in prorcp page');

    // 7 — Resolve {v1}..{v5} placeholders
    const resolved = [...new Set(rawUrls.map(u => cn.resolveVars(u)))];

    // 8 — Fetch each unique m3u8 and parse variants
    const allStreams = [];
    const seen = new Set();
    for (const rawUrl of resolved) {
      try {
        const resp = await cn.fetch(rawUrl, { referer: prorcpFull, timeout: 5000 });
        if (resp.data?.startsWith?.('#EXTM3U')) {
          for (const v of cn.parseMasterPlaylist(resp.data, rawUrl)) {
            if (!seen.has(v.url)) { seen.add(v.url); allStreams.push(v); }
          }
        }
      } catch (_) { /* CDN subdomain may be down */ }
    }

    // 9 — Fallback: include raw URLs if parsing produced nothing
    if (allStreams.length === 0) {
      for (const url of resolved) {
        if (!seen.has(url)) { seen.add(url); allStreams.push({ url, type: 'hls', quality: '', resolution: '' }); }
      }
    }

    // 10 — Subtitles & title
    const subtitles = cn.extractSubtitles(html, prorcpFull);
    const title = cn.extractTitle(html);

    return {
      source: 'vidsrcme.su',
      embedUrl: embed,
      status: allStreams.length > 0 ? 'working' : 'embed',
      title,
      streams: allStreams,
      subtitles: subtitles.length > 0 ? subtitles : undefined,
      latency_ms: Date.now() - start,
    };
  } catch (err) {
    return {
      source: 'vidsrcme.su',
      embedUrl: embed,
      status: 'embed',
      error: err.message,
      streams: [],
      latency_ms: Date.now() - start,
    };
  }
}

module.exports = { scrapeSource };
