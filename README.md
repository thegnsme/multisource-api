# 🎬 MultiSource API

> Aggregate working HLS video streams from multiple sources for any TMDB movie or TV show. Ships as a **CLI** and an **HTTP API server**.

[![CI](https://github.com/sunriseve/multisource-api/actions/workflows/build.yml/badge.svg)](https://github.com/sunriseve/multisource-api/actions/workflows/build.yml)
[![Health Check](https://github.com/sunriseve/multisource-api/actions/workflows/source-health.yml/badge.svg)](https://github.com/sunriseve/multisource-api/actions/workflows/source-health.yml)

---

<!-- HEALTH_CHECK_START -->
> **📊 Source Health Status**
>
> ✅ 🟢 **8** / 43 sources working
>
> 🕐 **Last checked:** 14-May-2026 10:37:57 PM IST
>
> [📋 Full Report →](./SOURCE_HEALTH.md)
<!-- HEALTH_CHECK_END -->

---

## 🚀 Quick Start

### Zero-host mode (no install, no server, just curl + node)

```bash
curl -s https://raw.githubusercontent.com/sunriseve/multisource-api/main/raw-api.js \
  | node - --tmdb=24428
```

### Full mode (with npm dependencies)

```bash
npm install
node api.js --tmdb=24428               # Movie
node api.js --tmdb=1399 --type=tv --season=1 --episode=1  # TV
```

### Single source (debug/testing)

```bash
node sources/vaplayer.js --tmdb=24428
```

Pipe through `jq` for pretty output:

```bash
node raw-api.js --tmdb=24428 | jq '.sources[] | select(.status=="working") | {source, streamCount: (.streams|length)}'
```

## 🌐 HTTP API Server

```bash
npm start
```

Then open your browser or curl:

```
curl http://localhost:3000/api/movie/24428
curl "http://localhost:3000/api/tv/1396?season=1&episode=1"
```

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | 🩺 Server health (uptime, version, memory) |
| `GET` | `/api/sources` | 📋 List all 14 sources with load status |
| `GET` | `/api/movie/:tmdbId` | 🎥 Streams for a movie |
| `GET` | `/api/tv/:tmdbId` | 📺 Streams for a TV episode (`?season=N&episode=N`) |

### Example Response

```json
{
  "success": true,
  "tmdbId": 24428,
  "type": "movie",
  "workingSources": 5,
  "totalSourcesChecked": 14,
  "totalUniqueStreams": 20,
  "elapsed_ms": 3424,
  "sources": [
    {
      "source": "videasy.net",
      "status": "working",
      "streams": [
        { "url": "https://...master.m3u8", "quality": "1080p", "resolution": "1920x1080", "bandwidth": 8000000 }
      ],
      "subtitles": [
        { "lang": "en", "language": "English", "url": "https://...sub.vtt" }
      ]
    }
  ]
}
```

## 💻 CLI Usage

```
node api.js --tmdb=<TMDB_ID> [--type=movie|tv] [--season=N] [--episode=N]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--tmdb` | — | TMDB ID (required) |
| `--type` | `movie` | `movie` or `tv` |
| `--season` | `1` | Season number (TV only) |
| `--episode` | `1` | Episode number (TV only) |

## 🔥 Zero-Host Mode: `raw-api.js`

**No npm install needed. No server. No accounts. Works from a raw GitHub URL.**

`raw-api.js` is a **100% self-contained** version of the API using only Node.js built-in modules (no axios, no express, no npm dependencies).

### Pipe from GitHub (no clone needed)

```bash
curl -s https://raw.githubusercontent.com/sunriseve/multisource-api/main/raw-api.js \
  | node - --tmdb=24428
```

### Run locally (after clone)

```bash
node raw-api.js --tmdb=24428
node raw-api.js --tmdb=1399 --type=tv --season=1 --episode=1
```

### Run a single source directly

Every source file in `sources/` is also a standalone CLI:

```bash
node sources/vaplayer.js --tmdb=24428
node sources/vidlink_pro.js --tmdb=24428
```

### Import as a module

```js
const { scrapeAll } = require('./raw-api');
const result = await scrapeAll(24428, 'movie');
```

### What's included

`raw-api.js` bundles the 5 working HTTP-based sources (vaplayer, ezvidapi, vidlink, videasy, vixsrc) — same aggregation logic, same JSON format. The other 9 embed sources are excluded (they need a browser engine).

---

## 🗺 Source Map

All 14 sources currently implemented, with their working status and capabilities.

**Legend:** 🟢 Working · 🔶 Embed (needs browser JS) · ❌ Unavailable

| # | Source | Status | Qualities | Subtitles | How It Works |
|---|--------|--------|-----------|-----------|--------------|
| 1 | **vaplayer.ru** | 🟢 | 360p → 1080p | ✗ | JSON API → HLS master playlist |
| 2 | **ezvidapi.com** | 🟢 | 720p → 1080p | 7-12 langs | Proxied m3u8 → quality variants |
| 3 | **vidlink.pro** | 🟢 | 360p → 1080p | 4-30 langs | Encrypted API → HLS + captions |
| 4 | **videasy.net** | 🟢 | 480p → 4K | 67-152 langs | Encrypted API → decrypt → sources |
| 5 | **vixsrc.to** | 🟢 | varies | ✗ | API → embed page → stream URLs |
| 6 | cinesrc.st | 🔶 | — | — | Next.js RSC — streams loaded client-side |
| 7 | cloudnestra.com | 🔶 | — | — | Cloudflare Turnstile blocked from server IP |
| 8 | vidsrc-embed.su | 🔶 | — | — | Cloudnestra CDN — Turnstile blocked |
| 9 | vidsrc.fyi | 🔶 | — | — | Cloudnestra CDN via vsembed.ru |
| 10 | vidsrc.icu | 🔶 | — | — | Cloudnestra CDN — Turnstile blocked |
| 11 | vidsrc.to | 🔶 | — | — | Cloudnestra CDN via vsembed.ru |
| 12 | vidsrcme.su | 🔶 | — | — | Cloudnestra CDN — Turnstile blocked |
| 13 | vsrc.su | 🔶 | — | — | Cloudnestra CDN — Turnstile blocked |
| 14 | vidapi.xyz | 🔶 | — | — | React app — needs headless browser |

> **Note on "Embed" sources:** These pages load successfully but the HLS streams are hidden behind client-side JavaScript (React, Next.js, or Cloudflare Turnstile). They will work in environments where a real browser runs the JS — like the SkyStream plugin on your device.

## 🏗 Architecture

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│   api.js     │────▶│  sources/    │────▶│  JSON Output │
│  (CLI)       │     │  index.js    │     │  (stdout)    │
└─────────────┘     │  (aggregator) │     └──────────────┘
                    │               │
┌─────────────┐     │  Runs all 14  │     ┌──────────────┐
│  server.js   │────▶│  sources in   │────▶│  JSON API    │
│  (Express)   │     │  parallel     │     │  (HTTP)      │
└─────────────┘     └──────────────┘     └──────────────┘

┌──────────────┐
│  raw-api.js   │────▶ JSON Output (stdout / pipe)
│  (standalone) │      Zero deps. No npm install needed.
│  Built-in     │      curl raw URL | node - --tmdb=24428
│  http/https   │
└──────────────┘

Each source is a standalone file in `sources/` exporting `{ scrapeSource() }`. The aggregator auto-discovers them — **no registration needed**.

### Adding a New Source

```js
// sources/mysource.js
async function scrapeSource({ tmdbId, type, season, episode }) {
  return {
    source: 'mysource.com',
    status: 'working',
    streams: [
      { url: 'https://...master.m3u8', quality: '1080p', resolution: '1920x1080' }
    ],
    subtitles: [
      { lang: 'en', language: 'English', url: 'https://...sub.vtt' }
    ],
    latency_ms: Date.now() - start,
  };
}
module.exports = { scrapeSource };
```

## 🧪 Running Tests

```bash
node test.js
```

Tests each of the 14 sources individually across 4 movies + 4 TV shows, then runs the aggregate. Reports per-source, per-TMDB-ID results.

## 📊 Health Check

A GitHub Actions workflow runs **every 8 hours** (`0 */8 * * *`) and:

1. Tests all 15 sources against **7 TMDB movies**
2. Updates the status box at the top of this README
3. Generates a detailed **[SOURCE_HEALTH.md](./SOURCE_HEALTH.md)** report with per-movie breakdown
4. Commits everything back to the repo

You can also trigger it manually from the [Actions tab](https://github.com/sunriseve/multisource-api/actions/workflows/source-health.yml).

## 🔧 CI

[![CI](https://github.com/sunriseve/multisource-api/actions/workflows/build.yml/badge.svg)](https://github.com/sunriseve/multisource-api/actions/workflows/build.yml)

GitHub Actions runs the full test suite on push across Node 18, 20, and 22.

---

_Made with ❤️ for the streaming community_
