const axios = require('axios');
const https = require('https');

// Axios v1.x needs IPv4 forced in some environments
const httpsAgent = new https.Agent({ family: 4, keepAlive: true, rejectUnauthorized: false });

async function fetchUrl(url, opts = {}) {
  const { referer, timeout = 8000, retries = 0 } = opts;
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    ...(referer ? { 'Referer': referer } : {}),
  };
  for (let i = 0; i <= retries; i++) {
    try {
      const resp = await axios.get(url, { headers, timeout, maxRedirects: 5, validateStatus: () => true, httpsAgent });
      return { html: typeof resp.data === 'string' ? resp.data : JSON.stringify(resp.data), status: resp.status };
    } catch (e) {
      if (i === retries) return { html: null, status: 0, error: e.message };
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  return { html: null, status: 0, error: 'max retries' };
}

module.exports = { fetchUrl };
