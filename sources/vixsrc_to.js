/**
 * vixsrc.to — Video source via API + JW Player embed.
 *
 * Chain:
 *   1. vixsrc.to/api/movie|tv/{tmdbId}  →  returns { src: "/embed/{id}?token=..." }
 *   2. Embed page contains:
 *        window.streams = [{name, url: "vixsrc.to/playlist/{id}?ub=1"}, ...]
 *        window.masterPlaylist = { url, params: { token, expires } }
 *   3. Playlist endpoint is anti-bot protected (403 with proper headers needed).
 *      Included for environments where the anti-bot may not trigger.
 */

const axios = require('axios');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function scrapeSource({ tmdbId, type, season, episode }) {
  const start = Date.now();
  const embedUrl = `https://vixsrc.to/embed/${type}/${tmdbId}`;

  try {
    // Step 1: Get the embed path from vixsrc API
    // Movie: /api/movie/{tmdbId}
    // TV:    /api/tv/{tmdbId}/{season}/{episode}
    const apiUrl = type === 'movie'
      ? `https://vixsrc.to/api/movie/${tmdbId}`
      : `https://vixsrc.to/api/tv/${tmdbId}/${season || 1}/${episode || 1}`;

    const apiResp = await axios.get(apiUrl, {
      headers: { 'User-Agent': UA, 'Referer': 'https://vixsrc.to/' },
      timeout: 10000,
    });

    if (!apiResp.data?.src) {
      return { source: 'vixsrc.to', embedUrl, status: 'no_streams', streams: [], latency_ms: Date.now() - start };
    }

    const embedPath = apiResp.data.src;
    const fullEmbedUrl = `https://vixsrc.to${embedPath}`;

    // Step 2: Fetch the embed page
    const embedResp = await axios.get(fullEmbedUrl, {
      headers: { 'User-Agent': UA, 'Referer': 'https://vixsrc.to/' },
      timeout: 15000,
    });

    const html = embedResp.data;

    // Step 3: Extract window.streams and window.masterPlaylist
    const streams = [];
    const seen = new Set();

    // Extract stream URLs from window.streams
    const streamUrls = html.match(/url:\s*'([^']+)'/g);
    if (streamUrls) {
      for (const match of streamUrls) {
        const url = match.match(/'([^']+)'/)?.[1];
        if (url && url.includes('/playlist/') && !seen.has(url)) {
          seen.add(url);
          streams.push({ url, type: 'hls', quality: '', resolution: '' });
        }
      }
    }

    // Try to build playlist URL with auth params from masterPlaylist
    const token = html.match(/'token':\s*'([^']+)'/)?.[1];
    const expires = html.match(/'expires':\s*'([^']+)'/)?.[1];
    const playlistUrlMatch = html.match(/url:\s*'([^']+)'/);
    let playlistUrl = playlistUrlMatch?.[1];

    if (playlistUrl && token && expires && !seen.has(playlistUrl)) {
      const authedUrl = `${playlistUrl}?token=${token}&expires=${expires}`;
      seen.add(playlistUrl);

      // Try fetching the authenticated playlist
      try {
        const plResp = await axios.get(authedUrl, {
          headers: {
            'User-Agent': UA,
            'Referer': fullEmbedUrl,
            'Origin': 'https://vixsrc.to',
            'Accept': 'application/x-mpegURL,application/vnd.apple.mpegurl,*/*',
          },
          timeout: 10000,
          validateStatus: () => true,
        });

        if (plResp.status === 200 && String(plResp.data).startsWith('#EXTM3U')) {
          const m3u8 = String(plResp.data);
          // Parse quality variants
          if (m3u8.includes('#EXT-X-STREAM-INF:')) {
            const lines = m3u8.split('\n');
            for (let i = 0; i < lines.length; i++) {
              if (!lines[i].startsWith('#EXT-X-STREAM-INF:')) continue;
              const bw = lines[i].match(/BANDWIDTH=(\d+)/)?.[1];
              const res = lines[i].match(/RESOLUTION=(\d+x\d+)/)?.[1];
              const nl = lines[i + 1]?.trim();
              if (nl && !nl.startsWith('#')) {
                const vu = nl.startsWith('http') ? nl : new URL(nl, authedUrl).href;
                const h = res ? res.split('x')[1] : '';
                const qMap = { '360': '360p', '480': '480p', '720': '720p', '1080': '1080p', '2160': '4K' };
                if (!seen.has(vu)) {
                  seen.add(vu);
                  streams.push({ url: vu, type: 'hls', quality: qMap[h] || (h ? h + 'p' : ''), resolution: res || '', bandwidth: bw ? parseInt(bw) : undefined });
                }
                i++;
              }
            }
          } else {
            const urls = m3u8.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
            for (const url of urls) {
              const vu = url.startsWith('http') ? url : new URL(url, authedUrl).href;
              if (!seen.has(vu)) { seen.add(vu); streams.push({ url: vu, type: 'hls', quality: '', resolution: '' }); }
            }
          }
        }
      } catch (_) { /* Playlist likely 403 — that's ok */ }
    }

    return {
      source: 'vixsrc.to',
      embedUrl: fullEmbedUrl,
      status: streams.length > 0 ? 'working' : 'embed',
      streams,
      latency_ms: Date.now() - start,
    };
  } catch (err) {
    return {
      source: 'vixsrc.to',
      embedUrl,
      status: 'error',
      error: err.message,
      streams: [],
      latency_ms: Date.now() - start,
    };
  }
}

module.exports = { scrapeSource };
