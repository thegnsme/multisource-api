/**
 * vidsrc.fyi — Cloudnestra CDN backend via vsembed.ru.
 *
 * Chain: vidsrc.fyi/embed/movie/{id} → iframe to vsembed.ru/embed/movie/{id}/
 * → iframe to cloudnestra.com/rcp/BASE64 → prorcp → m3u8
 */

const cn = require('./cloudnestra');

const BASE = 'https://vidsrc.fyi';

function embedUrl(tmdbId, type, season, episode) {
  if (type === 'movie') return `${BASE}/embed/movie/${tmdbId}`;
  return `${BASE}/embed/tv/${tmdbId}/${season || 1}/${episode || 1}`;
}

async function scrapeSource({ tmdbId, type, season, episode }) {
  const start = Date.now();
  const embed = embedUrl(tmdbId, type, season, episode);

  try {
    const r1 = await cn.fetch(embed, { timeout: 5000 });
    if (!r1.data) throw new Error('No response from vidsrc.fyi');

    const iframe1 = r1.data.match(/<iframe[^>]+src\s*=\s*["']([^"']+)["']/i);
    if (!iframe1) throw new Error('No iframe found on vidsrc.fyi');

    let vsembedUrl = iframe1[1];
    if (vsembedUrl.startsWith('//')) vsembedUrl = 'https:' + vsembedUrl;

    const r2 = await cn.fetch(vsembedUrl, { referer: embed, timeout: 5000 });
    if (!r2.data) throw new Error('No response from vsembed.ru');

    const iframe2 = r2.data.match(/<iframe[^>]+src\s*=\s*["']([^"']*cloudnestra[^"']*)["']/i);
    if (!iframe2) throw new Error('No cloudnestra iframe found');

    let cnRcpUrl = iframe2[1];
    if (cnRcpUrl.startsWith('//')) cnRcpUrl = 'https:' + cnRcpUrl;

    const r3 = await cn.fetch(cnRcpUrl, { referer: vsembedUrl, timeout: 5000 });
    const prorcpMatch = r3.data.match(/["'](\/prorcp\/[^"']+)["']/);
    if (!prorcpMatch) throw new Error('No prorcp path found (Turnstile blocked)');

    const prorcpFull = `https://cloudnestra.com${prorcpMatch[1]}`;
    const r4 = await cn.fetch(prorcpFull, { referer: cnRcpUrl, timeout: 5000 });
    const html = r4.data;

    const rawUrls = html.match(/https?:\/\/[^\s"'<>`]+\.m3u8[^\s"'<>`]*/g);
    if (!rawUrls || rawUrls.length === 0) throw new Error('No m3u8 URLs in prorcp page');

    const resolved = [...new Set(rawUrls.map(u => cn.resolveVars(u)))];
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
      source: 'vidsrc.fyi',
      embedUrl: embed,
      status: allStreams.length > 0 ? 'working' : 'embed',
      title,
      streams: allStreams,
      subtitles: subtitles.length > 0 ? subtitles : undefined,
      latency_ms: Date.now() - start,
    };
  } catch (err) {
    return {
      source: 'vidsrc.fyi',
      embedUrl: embed,
      status: 'embed',
      error: err.message,
      streams: [],
      latency_ms: Date.now() - start,
    };
  }
}

module.exports = { scrapeSource };
