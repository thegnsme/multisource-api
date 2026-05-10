# MultiSource API

Aggregate working HLS video streams from multiple sources for any TMDB movie or TV show. Ships as a **CLI** and an **HTTP API server**.

## Quick Start

```bash
npm install
node api.js --tmdb=24428               # Movie
node api.js --tmdb=1399 --type=tv --season=1 --episode=1  # TV
```

Pipe through `jq` for pretty output:
```bash
node api.js --tmdb=24428 | jq '.sources[] | select(.status=="working") | {source, streamCount: (.streams|length), subtitles: (.subtitles|length)}'
```

## HTTP API Server

```bash
npm start
```

Then make requests:

```
curl http://localhost:3000/api/movie/24428
curl "http://localhost:3000/api/tv/1396?season=1&episode=1"
```

### API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Health check (uptime, version, memory) |
| `GET` | `/api/sources` | List all 15 sources with load status |
| `GET` | `/api/movie/:tmdbId` | Get streams for a movie |
| `GET` | `/api/tv/:tmdbId` | Get streams for a TV episode (query: `season`, `episode`) |

### Response Format

```json
{
  "success": true,
  "tmdbId": 24428,
  "type": "movie",
  "sources": [
    {
      "source": "videasy.net",
      "status": "working",
      "streams": [
        {
          "url": "https://...master.m3u8",
          "quality": "1080p",
          "resolution": "1920x1080",
          "bandwidth": 8000000
        }
      ],
      "subtitles": [
        {
          "lang": "en",
          "language": "English",
          "url": "https://...sub.vtt"
        }
      ],
      "latency_ms": 3146
    }
  ],
  "workingSources": 5,
  "totalSourcesChecked": 15,
  "totalUniqueStreams": 20,
  "elapsed_ms": 3424,
  "timestamp": "2026-05-10T..."
}
```

## CLI Usage

```
node api.js --tmdb=<TMDB_ID> [--type=movie|tv] [--season=N] [--episode=N]
```

- `--tmdb` — TMDB ID (required)
- `--type` — `movie` (default) or `tv`
- `--season` — season number (default: 1, only for tv)
- `--episode` — episode number (default: 1, only for tv)

## Running Tests

```bash
node test.js
```

Tests each of the 15 sources individually across 4 movies + 4 TV shows, then runs the aggregate. Reports per-source, per-TMDB-ID results.

## Source Status

| # | Source | Status | Method / Reason |
|---|--------|--------|----------------|
| 1 | **vaplayer.ru** | ✅ Working | JSON API → HLS master playlist (360p-1080p) |
| 2 | **ezvidapi.com** | ✅ Working | Proxied API → m3u8 with quality variants + 7-12 subtitles |
| 3 | **vidlink.pro** | ✅ Working | enc-dec.app encrypt → vidlink.pro API → HLS + captions |
| 4 | **videasy.net** | ✅ Working | videasy API + enc-dec.app decrypt → 4K/1080p/720p/480p + 67-152 subtitles |
| 5 | **vixsrc.to** | ✅ Working | API → embed page with `window.streams` URLs (movies only; TV format supported) |
| 6 | cinesrc.st | 🔶 Embed | Next.js RSC — streams loaded client-side via JS |
| 7 | cloudnestra.com | 🔶 Embed | Cloudflare Turnstile blocked from server IP |
| 8 | vidsrc-embed.su | 🔶 Embed | Cloudnestra CDN — Turnstile blocked |
| 9 | vidsrc.fyi | 🔶 Embed | Cloudnestra CDN via vsembed.ru — Turnstile blocked |
| 10 | vidsrc.icu | 🔶 Embed | Cloudnestra CDN — Turnstile blocked |
| 11 | vidsrc.to | 🔶 Embed | Cloudnestra CDN via vsembed.ru — Turnstile blocked |
| 12 | vidsrcme.su | 🔶 Embed | Cloudnestra CDN — Turnstile blocked |
| 13 | vsrc.su | 🔶 Embed | Cloudnestra CDN — Turnstile blocked |
| 14 | vidapi.xyz | 🔶 Embed | React app — needs headless browser |
| 15 | vidsrc.rip | ❌ Dead | Redirects to ad network (bulsis.net) |

### Legend
- ✅ **Working** — Returns real HLS streams
- 🔶 **Embed** — Page loads, but streams require JS execution (embed URL provided)
- ❌ **Dead** — No video content available

## Architecture

Each source is a standalone file in `sources/` exporting `{ scrapeSource({tmdbId, type, season, episode}) }`. The aggregator (`sources/index.js`) runs all 15 sources in parallel with a 30s per-source timeout, deduplicates streams by URL, and returns a unified JSON response.

### Adding a new source

1. Create `sources/yoursource.js` following the pattern:
   ```js
   async function scrapeSource({ tmdbId, type, season, episode }) {
     // Your scraping logic
     return {
       source: 'yoursource.com',
       status: 'working',
       streams: [{ url: 'https://...master.m3u8', quality: '1080p', resolution: '1920x1080' }],
       subtitles: [{ lang: 'en', language: 'English', url: 'https://...sub.vtt' }],
       latency_ms: Date.now() - start,
     };
   }
   module.exports = { scrapeSource };
   ```
2. The aggregator auto-discovers it — no registration needed

## Cloudnestra Note

The 6 cloudnestra-chain sources (vidsrc.icu, vidsrc.to, vidsrc.fyi, vidsrcme.su, vsrc.su, vidsrc-embed.su) all use the same CDN backend at `cloudnestra.com`. From this server's IP, Cloudflare Turnstile blocks direct access. The scraper code is correct and will return HLS streams from IPs not flagged by Cloudflare. These sources fail fast (<3s) when blocked.

## CI

GitHub Actions runs the full test suite (15 sources × 8 TMDB IDs + aggregate) on push across Node 18/20/22.
