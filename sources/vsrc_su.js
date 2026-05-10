/**
 * vsrc.su — Cloudnestra CDN backend (mirror of vidsrcme.su).
 *
 * Chain: vsrc.su/embed/movie?tmdb={id} → iframe to cloudnestra.com/rcp/BASE64
 * → prorcp → m3u8
 */

const cn = require('./cloudnestra');

const BASE = 'https://vsrc.su';

function embedUrl(tmdbId, type, season, episode) {
  if (type === 'movie') return `${BASE}/embed/movie?tmdb=${tmdbId}`;
  return `${BASE}/embed/tv?tmdb=${tmdbId}&season=${season || 1}&episode=${episode || 1}`;
}

async function scrapeSource({ tmdbId, type, season, episode }) {
  const start = Date.now();
  const embed = embedUrl(tmdbId, type, season, episode);

  try {
    const r1 = await cn.fetch(embed, { timeout: 15000 });
    if (!r1.data) throw new Error('No response from vsrc.su');

    const iframeMatch = r1.data.match(/<iframe[^>]+src\s*=\s*["']([^"']*cloudnestra[^"']*)["']/i);
    if (!iframeMatch) throw new Error('No cloudnestra iframe found');

    let cnRcpUrl = iframeMatch[1];
    if (cnRcpUrl.startsWith('//')) cnRcpUrl = 'https:' + cnRcpUrl;

    const r2 = await cn.fetch(cnRcpUrl, { referer: embed, timeout: 25000 });
    const prorcpMatch = r2.data.match(/["'](\/prorcp\/[^"']+)["']/);
    if (!prorcpMatch) throw new Error('No prorcp path found (Turnstile blocked)');

    const prorcpFull = `https://cloudnestra.com${prorcpMatch[1]}`;
    const r3 = await cn.fetch(prorcpFull, { referer: cnRcpUrl, timeout: 25000 });
    const html = r3.data;

    const rawUrls = html.match(/https?:\/\/[^\s"'<>`]+\.m3u8[^\s"'<>`]*/g);
    if (!rawUrls || rawUrls.length === 0) throw new Error('No m3u8 URLs in prorcp page');

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
      source: 'vsrc.su',
      embedUrl: embed,
      status: allStreams.length > 0 ? 'working' : 'embed',
      title,
      streams: allStreams,
      subtitles: subtitles.length > 0 ? subtitles : undefined,
      latency_ms: Date.now() - start,
    };
  } catch (err) {
    return {
      source: 'vsrc.su',
      embedUrl: embed,
      status: 'embed',
      error: err.message,
      streams: [],
      latency_ms: Date.now() - start,
    };
  }
}

module.exports = { scrapeSource };
