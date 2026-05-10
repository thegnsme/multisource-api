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
      timeout: 15000,
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

    for (const streamUrl of meta.stream_urls) {
      // Try to fetch the m3u8 to get variant info
      try {
        const m3u8Resp = await axios.get(streamUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': 'https://brightpathsignals.com/',
          },
          timeout: 10000,
          validateStatus: () => true,
        });

        if (m3u8Resp.data?.startsWith?.('#EXTM3U')) {
          const m3u8 = m3u8Resp.data;
          
          if (m3u8.includes('#EXT-X-STREAM-INF')) {
            // Master playlist — extract each variant
            const lines = m3u8.split('\n');
            for (let i = 0; i < lines.length; i++) {
              if (!lines[i].startsWith('#EXT-X-STREAM-INF:')) continue;
              
              const bw = lines[i].match(/BANDWIDTH=(\d+)/)?.[1];
              const res = lines[i].match(/RESOLUTION=(\d+x\d+)/)?.[1];
              const nl = lines[i + 1]?.trim();
              
              if (nl && !nl.startsWith('#')) {
                let vu = nl;
                if (!vu.startsWith('http')) {
                  vu = new URL(vu, streamUrl).href;
                }
                const h = res ? res.split('x')[1] : '';
                const qMap = { '360': '360p', '480': '480p', '720': '720p', '1080': '1080p', '2160': '4K' };
                
                streams.push({
                  url: vu,
                  type: 'hls',
                  quality: qMap[h] || (h ? h + 'p' : ''),
                  resolution: res || '',
                  bandwidth: bw ? parseInt(bw) : undefined,
                });
                i++;
              }
            }
          } else {
            // Media playlist (single quality)
            streams.push({ url: streamUrl, type: 'hls', quality: '', resolution: '' });
          }
        } else {
          streams.push({ url: streamUrl, type: 'hls', quality: '', resolution: '' });
        }
      } catch {
        streams.push({ url: streamUrl, type: 'hls', quality: '', resolution: '' });
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
