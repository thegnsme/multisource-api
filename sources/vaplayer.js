/**
 * vaplayer.ru → brightpathsignals.com → streamdata.vaplayer.ru/api.php
 * 
 * THE PRIMARY WORKING SOURCE.
 * Uses a JSON API that returns direct m3u8 stream URLs.
 * Supports movies and TV shows with multiple quality variants.
 * 
 * Movie:  https://vaplayer.ru/embed/movie/{tmdb}
 * TV:     https://vaplayer.ru/embed/tv/{tmdb}/{season}/{episode}
 * API:    https://streamdata.vaplayer.ru/api.php?tmdb={id}&type={type}[&season=N&episode=N]
 */
const axios = require('axios');

async function scrapeSource({ tmdbId, type, season, episode }) {
  const start = Date.now();
  
  // Build the streamdata API URL
  let apiUrl = `https://streamdata.vaplayer.ru/api.php?tmdb=${tmdbId}&type=${type}`;
  if (type === 'tv') {
    apiUrl += `&season=${season || 1}&episode=${episode || 1}`;
  }
  
  try {
    const resp = await axios.get(apiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer': `https://brightpathsignals.com/embed/${type}/${tmdbId}`,
        'Accept': 'application/json',
      },
      timeout: 10000,
    });

    const data = resp.data;
    
    if (data.status_code !== '200' || !data.data?.stream_urls?.length) {
      return {
        source: 'vaplayer.ru',
        embedUrl: `https://vaplayer.ru/embed/${type}/${tmdbId}` + (type === 'tv' ? `/${season}/${episode}` : ''),
        status: 'no_streams',
        streams: [],
        latency_ms: Date.now() - start,
      };
    }

    // Convert API response to our stream format
    const meta = data.data;
    const streams = [];
    const qMap = { '360': '360p', '480': '480p', '720': '720p', '1080': '1080p', '2160': '4K' };

    // Fetch all m3u8 playlists in parallel for speed
    const fetchResults = await Promise.allSettled(
      (meta.stream_urls || []).map(async (streamUrl) => {
        const m3u8Resp = await axios.get(streamUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': 'https://brightpathsignals.com/',
          },
          timeout: 8000,
          validateStatus: () => true,
        });

        const parsed = [];
        if (m3u8Resp.data?.startsWith?.('#EXTM3U')) {
          if (m3u8Resp.data.includes('#EXT-X-STREAM-INF')) {
            const lines = m3u8Resp.data.split('\n');
            for (let i = 0; i < lines.length; i++) {
              if (!lines[i].startsWith('#EXT-X-STREAM-INF:')) continue;
              const bw = lines[i].match(/BANDWIDTH=(\d+)/)?.[1];
              const res = lines[i].match(/RESOLUTION=(\d+x\d+)/)?.[1];
              const nl = lines[i + 1]?.trim();
              if (nl && !nl.startsWith('#')) {
                const vu = nl.startsWith('http') ? nl : new URL(nl, streamUrl).href;
                const h = res ? res.split('x')[1] : '';
                parsed.push({ url: vu, type: 'hls', quality: qMap[h] || (h ? h + 'p' : ''), resolution: res || '', bandwidth: bw ? parseInt(bw) : undefined });
                i++;
              }
            }
          } else {
            parsed.push({ url: streamUrl, type: 'hls', quality: '', resolution: '' });
          }
        } else {
          parsed.push({ url: streamUrl, type: 'hls', quality: '', resolution: '' });
        }
        return parsed;
      })
    );

    for (const r of fetchResults) {
      if (r.status === 'fulfilled') {
        for (const s of r.value) streams.push(s);
      }
    }

    // Deduplicate
    const seen = new Set();
    const unique = streams.filter(s => {
      if (seen.has(s.url)) return false;
      seen.add(s.url);
      return true;
    });

    return {
      source: 'vaplayer.ru',
      embedUrl: `https://vaplayer.ru/embed/${type}/${tmdbId}` + (type === 'tv' ? `/${season}/${episode}` : ''),
      status: unique.length > 0 ? 'working' : 'no_streams',
      title: meta.title || undefined,
      streams: unique,
      latency_ms: Date.now() - start,
    };
  } catch (err) {
    return {
      source: 'vaplayer.ru',
      embedUrl: `https://vaplayer.ru/embed/${type}/${tmdbId}` + (type === 'tv' ? `/${season}/${episode}` : ''),
      status: 'error',
      error: err.message,
      streams: [],
      latency_ms: Date.now() - start,
    };
  }
}

module.exports = { scrapeSource };
