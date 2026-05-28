# 🎬 MultiSource API

> Aggregate working HLS video streams from multiple sources for any TMDB movie or TV show. Ships as a **CLI** and an **HTTP API server**.

[![CI](https://github.com/thegnsme/multisource-api/actions/workflows/build.yml/badge.svg)](https://github.com/thegnsme/multisource-api/actions/workflows/build.yml)
[![Health Check](https://github.com/thegnsme/multisource-api/actions/workflows/source-health.yml/badge.svg)](https://github.com/thegnsme/multisource-api/actions/workflows/source-health.yml)

---

<!-- HEALTH_CHECK_START -->

> **📊 Source Health Status**
>
> ✅ 🟢 **9** / 46 sources working
>
> 🕐 **Last checked:** 19-May-2026 09:24:41 AM IST
>
> [📋 Full Report →](./SOURCE_HEALTH.md)

<!-- HEALTH_CHECK_END -->

---

## 🚀 Quick Start

### Zero-host mode (no install, no server, just curl + node)

```bash
curl -s https://raw.githubusercontent.com/thegnsme/multisource-api/master/raw-api.js \
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

| Method | Path                   | Description                                         |
| ------ | ---------------------- | --------------------------------------------------- |
| `GET`  | `/api/health`          | 🩺 Server health (uptime, version, memory)          |
| `GET`  | `/api/sources`         | 📋 List all 46 sources with load status             |
| `GET`  | `/api/movie/:tmdbId`   | 🎥 Streams for a movie                              |
| `GET`  | `/api/tv/:tmdbId`      | 📺 Streams for a TV episode (`?season=N&episode=N`) |
| `GET`  | `/api/by-imdb/:imdbId` | 🔍 Auto-detect movie/TV from IMDB ID                |

### Example Response

```json
{
  "success": true,
  "tmdbId": 24428,
  "type": "movie",
  "workingSources": 9,
  "totalSourcesChecked": 46,
  "totalUniqueStreams": 45,
  "elapsed_ms": 12000,
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

| Flag        | Default | Description              |
| ----------- | ------- | ------------------------ |
| `--tmdb`    | —       | TMDB ID (required)       |
| `--type`    | `movie` | `movie` or `tv`          |
| `--season`  | `1`     | Season number (TV only)  |
| `--episode` | `1`     | Episode number (TV only) |

## 🔥 Zero-Host Mode: `raw-api.js`

**No npm install needed. No server. No accounts. Works from a raw GitHub URL.**

`raw-api.js` is a **100% self-contained** version of the API using only Node.js built-in modules (no axios, no express, no npm dependencies).

### Pipe from GitHub (no clone needed)

```bash
curl -s https://raw.githubusercontent.com/thegnsme/multisource-api/master/raw-api.js \
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
const { scrapeAll } = require("./raw-api");
const result = await scrapeAll(24428, "movie");
```

### What's included

`raw-api.js` bundles **11 HTTP-based sources** (cine.su, vaplayer, ezvidapi, vidlink, videasy, vixsrc, vidzee, vidrock, vidnest, flicky, 02movie) — same aggregation logic, same JSON format. The remaining 35 embed sources are excluded (they need a browser engine).

---

## 🗺 Source Map

All **46 sources** currently implemented, with their working status and capabilities.

**Legend:** 🟢 Working · 🔶 Embed (needs browser JS) · ❌ Unavailable

### 🟢 Working Sources (9)

| #   | Source           | Qualities    | Subtitles    | How It Works                             |
| --- | ---------------- | ------------ | ------------ | ---------------------------------------- |
| 1   | **cine.su**      | varies       | ✗            | Direct HLS m3u8 master playlist          |
| 2   | **vaplayer.ru**  | 360p → 1080p | ✗            | JSON API → HLS master playlist           |
| 3   | **ezvidapi.com** | 720p → 1080p | 7-12 langs   | Proxied m3u8 → quality variants          |
| 4   | **vidlink.pro**  | 360p → 1080p | 4-30 langs   | Encrypted API → HLS + captions           |
| 5   | **videasy.net**  | 480p → 4K    | 67-152 langs | Encrypted API → decrypt → sources        |
| 6   | **vixsrc.to**    | varies       | ✗            | API → embed page → stream URLs           |
| 7   | **vidzee.api**   | varies       | ✗            | AES-CBC encrypted API → decrypt links    |
| 8   | **vidnest.api**  | varies       | ✗            | Multi-server custom-base64 encrypted API |
| 9   | **flicky.api**   | varies       | ✗            | Gate proxy → v13/v14/v15 HLS streams     |

### 🔶 Embed Sources — Need Browser JS (37)

These sources return HTML pages but HLS streams are loaded client-side via React, Next.js, or Cloudflare Turnstile. They **work in real browsers** (e.g. SkyStream plugin) but fail in HTTP-only health checks.

| #   | Source            | Why It Fails                                |
| --- | ----------------- | ------------------------------------------- |
| 10  | 02movie.api       | Encrypted API — token verification blocked  |
| 11  | autoembed.co      | Client-side embed loading                   |
| 12  | cinesrc.st        | Next.js RSC — streams loaded client-side    |
| 13  | cloudnestra.com   | Cloudflare Turnstile blocked from server IP |
| 14  | embed.api.stream  | Client-side embed loading                   |
| 15  | embedmaster.link  | Client-side embed loading                   |
| 16  | godriveplayer.com | Client-side embed loading                   |
| 17  | megaembed.com     | Client-side embed loading                   |
| 18  | moviesapi.to      | Client-side embed loading                   |
| 19  | multiembed.mov    | Client-side embed loading                   |
| 20  | nontongo.win      | Client-side embed loading                   |
| 21  | peachify.api      | API returns no streams                      |
| 22  | primesrc.me       | Client-side embed loading                   |
| 23  | rivestream.app    | Client-side embed loading                   |
| 24  | smashystream.com  | Client-side embed loading                   |
| 25  | streammafia.to    | Client-side embed loading                   |
| 26  | twoembed.cc       | Client-side embed loading                   |
| 27  | twoembed.online   | Client-side embed loading                   |
| 28  | vembed.click      | Client-side embed loading                   |
| 29  | vidapi.xyz        | React app — needs headless browser          |
| 30  | vidbinge.to       | Client-side embed loading                   |
| 31  | vidfast.pro       | Client-side embed loading                   |
| 32  | vidlux.online     | Client-side embed loading                   |
| 33  | vidplus.to        | Client-side embed loading                   |
| 34  | vidrock.api       | API returns no streams (encryption issue)   |
| 35  | vidrock.net       | Client-side embed loading                   |
| 36  | vidsrc.embed.su   | Cloudnestra CDN — Turnstile blocked         |
| 37  | vidsrc.fyi        | Cloudnestra CDN via vsembed.ru              |
| 38  | vidsrc.icu        | Cloudnestra CDN — Turnstile blocked         |
| 39  | vidsrc.mov        | Client-side embed loading                   |
| 40  | vidsrc.to         | Cloudnestra CDN via vsembed.ru              |
| 41  | vidsrc.wtf        | Client-side embed loading (slow)            |
| 42  | vidsrcme.su       | Cloudnestra CDN — Turnstile blocked         |
| 43  | vidstorm.ru       | Client-side embed loading                   |
| 44  | vidzee.wtf        | Client-side embed loading                   |
| 45  | vsrc.su           | Cloudnestra CDN — Turnstile blocked         |
| 46  | vsrc.su.embed     | Cloudnestra CDN — Turnstile blocked         |

> **Note on "Embed" sources:** These pages load successfully but the HLS streams are hidden behind client-side JavaScript (React, Next.js, or Cloudflare Turnstile). They will work in environments where a real browser runs the JS — like the SkyStream plugin on your device.

## 🏗 Architecture

```
┌─────────────┐     ┌──────────────┐     ┌──────────────┐
│   api.js     │────▶│  sources/    │────▶│  JSON Output │
│  (CLI)       │     │  index.js    │     │  (stdout)    │
└─────────────┘     │  (aggregator) │     └──────────────┘
                    │               │
┌─────────────┐     │  Runs all 46  │     ┌──────────────┐
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
```

### Adding a New Source

```js
// sources/mysource.js
async function scrapeSource({ tmdbId, type, season, episode }) {
  return {
    source: "mysource.com",
    status: "working",
    streams: [
      {
        url: "https://...master.m3u8",
        quality: "1080p",
        resolution: "1920x1080",
      },
    ],
    subtitles: [{ lang: "en", language: "English", url: "https://...sub.vtt" }],
    latency_ms: Date.now() - start,
  };
}
module.exports = { scrapeSource };
```

## 🧪 Running Tests

```bash
node test.js
```

Tests each of the 46 sources individually across 4 movies + 4 TV shows, then runs the aggregate. Reports per-source, per-TMDB-ID results.

## 📊 Health Check

A GitHub Actions workflow tests all sources against **7 TMDB movies** and:

1. Updates the status box at the top of this README
2. Generates a detailed **[SOURCE_HEALTH.md](./SOURCE_HEALTH.md)** report with per-movie breakdown
3. Commits everything back to the repo

### ⚠️ Fork Notice

> **If this repo is a fork**, GitHub Actions scheduled workflows (`schedule: cron`) are **disabled by default**. To enable automatic health checks on a fork:
>
> 1. Create a GitHub Personal Access Token (PAT) with `repo` scope
> 2. Use an external cron service (e.g. [cron-job.org](https://cron-job.org)) to trigger the workflow via API:
>    ```
>    POST https://api.github.com/repos/YOUR_USER/multisource-api/actions/workflows/source-health.yml/dispatches
>    Headers: Authorization: token ghp_YOUR_TOKEN
>    Body: {"ref": "master"}
>    ```
> 3. Or trigger manually from the [Actions tab](https://github.com/thegnsme/multisource-api/actions/workflows/source-health.yml)

## 🔧 CI

[![CI](https://github.com/thegnsme/multisource-api/actions/workflows/build.yml/badge.svg)](https://github.com/thegnsme/multisource-api/actions/workflows/build.yml)

GitHub Actions runs the full test suite on push across Node 18, 20, and 22.

---

_Made with ❤️ for the streaming community_
