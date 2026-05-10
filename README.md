# 🎬 MultiSource API

> Aggregate working HLS video streams from multiple sources for any TMDB movie or TV show. Ships as a **CLI** and an **HTTP API server**.

[![CI](https://github.com/sunriseve/multisource-api/actions/workflows/build.yml/badge.svg)](https://github.com/sunriseve/multisource-api/actions/workflows/build.yml)
[![Health Check](https://github.com/sunriseve/multisource-api/actions/workflows/source-health.yml/badge.svg)](https://github.com/sunriseve/multisource-api/actions/workflows/source-health.yml)

---

<!-- HEALTH_CHECK_START -->
📊 **Last Health Check:** 2026-05-10 06:36:06 UTC — ✅ 🟢 8/15 sources working
<!-- HEALTH_CHECK_END -->

---

## 🚀 Quick Start

```bash
npm install
node api.js --tmdb=24428               # Movie
node api.js --tmdb=1399 --type=tv --season=1 --episode=1  # TV
```

Pipe through `jq` for pretty output:

```bash
node api.js --tmdb=24428 | jq '.sources[] | select(.status=="working") | {source, streamCount: (.streams|length)}'
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
| `GET` | `/api/sources` | 📋 List all 15 sources with load status |
| `GET` | `/api/movie/:tmdbId` | 🎥 Streams for a movie |
| `GET` | `/api/tv/:tmdbId` | 📺 Streams for a TV episode (`?season=N&episode=N`) |

### Example Response

```json
{
  "success": true,
  "tmdbId": 24428,
  "type": "movie",
  "workingSources": 5,
  "totalSourcesChecked": 15,
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

## ✅ Source Status

See the full **[Source Health Report](./SOURCE_HEALTH.md)** — auto-generated every 8 hours with per-source, per-movie results.

| Status | Meaning |
|--------|---------|
| 🟢 **Working** | Returns real HLS streams via HTTP API |
| 🔶 **Embed** | Page loads but streams need browser JavaScript |
| ❌ **Unavailable** | Dead source — no video content |

### Current Working Sources

| Source | Qualities | Subtitles | How It Works |
|--------|-----------|-----------|--------------|
| **vaplayer.ru** | 360p → 1080p | ✗ | JSON API → HLS master playlist |
| **ezvidapi.com** | 720p → 1080p | 7-12 langs | Proxied m3u8 → quality variants |
| **vidlink.pro** | 360p → 1080p | 4-30 langs | Encrypted API → HLS + captions |
| **videasy.net** | 480p → 4K | 67-152 langs | Encrypted API → decrypt → sources |
| **vixsrc.to** | varies | ✗ | API → embed page → stream URLs |

## 🏗 Architecture

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│   api.js     │────▶│  sources/    │────▶│  JSON Output │
│  (CLI)       │     │  index.js    │     │  (stdout)    │
└─────────────┘     │  (aggregator) │     └──────────────┘
                    │               │
┌─────────────┐     │  Runs all 15  │     ┌──────────────┐
│  server.js   │────▶│  sources in   │────▶│  JSON API    │
│  (Express)   │     │  parallel     │     │  (HTTP)      │
└─────────────┘     └──────────────┘     └──────────────┘
```

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

Tests each of the 15 sources individually across 4 movies + 4 TV shows, then runs the aggregate. Reports per-source, per-TMDB-ID results.

## 📊 Health Check

A GitHub Actions workflow runs **every 8 hours** (`0 */8 * * *`) and:

1. Tests all 15 sources against **7 TMDB movies**
2. Generates a detailed **[SOURCE_HEALTH.md](./SOURCE_HEALTH.md)** report
3. Commits the updated report back to the repo

You can also trigger it manually from the [Actions tab](https://github.com/sunriseve/multisource-api/actions/workflows/source-health.yml).

## 🔧 CI

[![CI](https://github.com/sunriseve/multisource-api/actions/workflows/build.yml/badge.svg)](https://github.com/sunriseve/multisource-api/actions/workflows/build.yml)

GitHub Actions runs the full test suite on push across Node 18, 20, and 22.

---

_Made with ❤️ for the streaming community_
