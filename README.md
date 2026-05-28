# 🎬 MultiSource API

Aggregate HLS video streams from multiple sources for any TMDB movie or TV show.

[![CI](https://github.com/thegnsme/multisource-api/actions/workflows/build.yml/badge.svg)](https://github.com/thegnsme/multisource-api/actions/workflows/build.yml)
[![Health Check](https://github.com/thegnsme/multisource-api/actions/workflows/source-health.yml/badge.svg)](https://github.com/thegnsme/multisource-api/actions/workflows/source-health.yml)

<!-- HEALTH_CHECK_START -->

> **📊 Source Health Status**
>
> ⏳ Waiting for first health check run...
>
> [📋 Full Report →](./SOURCE_HEALTH.md)

<!-- HEALTH_CHECK_END -->

## How It Works

```
sources/           ← DROP A FILE HERE, IT JUST WORKS
  index.js         ← auto-discovers all .js files
  vaplayer.js      ← each file = one source
  cine_su.js
  ...

api.js             → CLI
server.js          → HTTP API
```

**Add a source** → create `sources/mysource.js` → done.  
**Remove a source** → delete the file → done.  
**Fix a source** → edit the file → done.

You never touch `api.js`, `server.js`, or any other file.

## Quick Start

```bash
# CLI
npm install
node api.js --tmdb=24428

# HTTP Server
npm start
curl http://localhost:3000/api/movie/24428

# Test all sources
node test.js
```

## CLI

```bash
node api.js --tmdb=24428                          # Movie
node api.js --tmdb=1399 --type=tv --season=1 --episode=1  # TV
node api.js --imdb=tt0848228                      # Auto-detect via IMDB
```

## HTTP API

| Endpoint                                 | Description          |
| ---------------------------------------- | -------------------- |
| `GET /api/health`                        | Server health        |
| `GET /api/sources`                       | List all sources     |
| `GET /api/movie/:tmdbId`                 | Movie streams        |
| `GET /api/tv/:tmdbId?season=1&episode=1` | TV streams           |
| `GET /api/by-imdb/:imdbId`               | Auto-detect movie/TV |

### Response Format

```json
{
  "success": true,
  "tmdbId": 24428,
  "type": "movie",
  "workingSources": 9,
  "totalSources": 46,
  "totalStreams": 45,
  "elapsed_ms": 12000,
  "sources": [
    {
      "source": "vaplayer.ru",
      "status": "working",
      "streams": [
        {
          "url": "https://...master.m3u8",
          "type": "hls",
          "quality": "1080p",
          "resolution": "1920x1080"
        }
      ]
    }
  ]
}
```

## Adding a Source

Copy the template:

```bash
cp sources/_template.js sources/mysource.js
```

Edit `sources/mysource.js`:

```js
const axios = require("axios");

async function scrapeSource({ tmdbId, type, season, episode }) {
  const start = Date.now();

  try {
    const resp = await axios.get(`https://api.mysource.com/${tmdbId}`, {
      timeout: 10000,
    });

    const streams = resp.data.streams.map((s) => ({
      url: s.url,
      type: "hls",
      quality: s.quality || "",
      resolution: s.resolution || "",
    }));

    return {
      source: "mysource.com",
      status: streams.length > 0 ? "working" : "no_streams",
      streams,
      latency_ms: Date.now() - start,
    };
  } catch (err) {
    return {
      source: "mysource.com",
      status: "error",
      error: err.message,
      streams: [],
      latency_ms: Date.now() - start,
    };
  }
}

module.exports = { scrapeSource };
```

That's it. Auto-discovered on next run.

### Source Contract

Your `scrapeSource()` function receives:

```js
{
  (tmdbId, type, season, episode);
}
```

Must return:

```js
{
  source: 'mysource.com',     // display name
  status: 'working' | 'no_streams' | 'embed' | 'error',
  streams: [{ url, type, quality, resolution }],
  latency_ms: Number,
}
```

Optional: `embedUrl`, `subtitles`, `error`, `title`.

### Testing a Single Source

```bash
node sources/vaplayer.js --tmdb=24428
```

## Health Check

The GitHub Actions workflow tests all sources and updates `SOURCE_HEALTH.md`.

**Fork notice:** Scheduled workflows are disabled on forks. Use manual trigger or external cron:

```bash
export GITHUB_TOKEN=ghp_your_token
./scripts/trigger-health-check.sh
```

## Project Structure

```
├── sources/              # ← ONLY FOLDER YOU EDIT
│   ├── index.js          #   auto-discovery engine
│   ├── _template.js      #   copy this to add a source
│   ├── vaplayer.js       #   each source = one file
│   ├── cine_su.js
│   └── ...
├── utils/                # shared helpers (don't edit unless adding a new helper)
│   ├── fetcher.js
│   ├── embedScraper.js
│   └── tmdb-lookup.js
├── api.js                # CLI (don't edit)
├── server.js             # HTTP API (don't edit)
├── test.js               # test suite (don't edit)
└── scripts/
    └── source-health.js  # health check (don't edit)
```
