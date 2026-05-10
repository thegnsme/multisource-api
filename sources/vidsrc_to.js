/**
 * vidsrc.to — Cloudnestra CDN backend via vsembed.ru.
 *
 * Chain: vidsrc.to/embed/movie/{id} → iframe to vsembed.ru/embed/movie/{id}/
 * → iframe to cloudnestra.com/rcp/BASE64 → prorcp → m3u8
 */

const cn = require('./cloudnestra');

const BASE = 'https://vidsrc.to';

function embedUrl(tmdbId, type, season, episode) {
  if (type === 'movie') return `${BASE}/embed/movie/${tmdbId}`;
  return `${BASE}/embed/tv/${tmdbId}/${season || 1}/${episode || 1}`;
}

async function scrapeSource({ tmdbId, type, season, episode }) {
  const start = Date.now();
  const embed = embedUrl(tmdbId, type, season, episode);

  try {
    // 1 — Fetch vidsrc.to (simple page with iframe to vsembed.ru)
    const r1 = await cn.fetch(embed, { timeout: 5000 });
    if (!r1.data) throw new Error('No response from vidsrc.to');

    const iframe1 = r1.data.match(/<iframe[^>]+src\s*=\s*["']([^"']+)["']/i);
    if (!iframe1) throw new Error('No iframe found on vidsrc.to');

    let vsembedUrl = iframe1[1];
    if (vsembedUrl.startsWith('//')) vsembedUrl = 'https:' + vsembedUrl;
    if (!vsembedUrl.startsWith('http')) vsembedUrl = new URL(vsembedUrl, embed).href;

    // 2 — Fetch vsembed.ru page (contains cloudnestra iframe + embedded player)
    const r2 = await cn.fetch(vsembedUrl, { referer: embed, timeout: 5000 });
    if (!r2.data) throw new Error('No response from vsembed.ru');

    // 3 — Extract cloudnestra iframe from vsembed page
    const iframe2 = r2.data.match(/<iframe[^>]+src\s*=\s*["']([^"']*cloudnestra[^"']*)["']/i);
    if (!iframe2) throw new Error('No cloudnestra iframe found on vsembed.ru');

    let cnRcpUrl = iframe2[1];
    if (cnRcpUrl.startsWith('//')) cnRcpUrl = 'https:' + cnRcpUrl;

    // 4 — Fetch cloudnestra /rcp/ page
    const r3 = await cn.fetch(cnRcpUrl, { referer: vsembedUrl, timeout: 5000 });

    // 5 — Extract prorcp path
    const prorcpMatch = r3.data.match(/["'](\/prorcp\/[^"']+)["']/);
    if (!prorcpMatch) throw new Error('No prorcp path found (Turnstile blocked)');

    const prorcpFull = `https://cloudnestra.com${prorcpMatch[1]}`;

    // 6 — Fetch prorcp page (contains m3u8 URLs)
    const r4 = await cn.fetch(prorcpFull, { referer: cnRcpUrl, timeout: 5000 });
    const html = r4.data;

    // 7 — Extract m3u8 raw URLs
    const rawUrls = html.match(/https?:\/\/[^\s"'<>`]+\.m3u8[^\s"'<>`]*/g);
    if (!rawUrls || rawUrls.length === 0) throw new Error('No m3u8 URLs in prorcp page');

    // 8 — Resolve {v1}..{v5} placeholders
    const resolved = [...new Set(rawUrls.map(u => cn.resolveVars(u)))];

    // 9 — Fetch each unique m3u8 and parse variants
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

    // 10 — Fallback
    if (allStreams.length === 0) {
      for (const url of resolved) {
        if (!seen.has(url)) { seen.add(url); allStreams.push({ url, type: 'hls', quality: '', resolution: '' }); }
      }
    }

    const subtitles = cn.extractSubtitles(html, prorcpFull);
    const title = cn.extractTitle(html);

    return {
      source: 'vidsrc.to',
      embedUrl: embed,
      status: allStreams.length > 0 ? 'working' : 'embed',
      title,
      streams: allStreams,
      subtitles: subtitles.length > 0 ? subtitles : undefined,
      latency_ms: Date.now() - start,
    };
  } catch (err) {
    return {
      source: 'vidsrc.to',
      embedUrl: embed,
      status: 'embed',
      error: err.message,
      streams: [],
      latency_ms: Date.now() - start,
    };
  }
}

module.exports = { scrapeSource };
