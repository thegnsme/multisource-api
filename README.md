# 🎬 MultiSource API — v4.0

**Zero-dependency, serverless API** that aggregates HLS video streams from multiple sources for any TMDB movie or TV show. Sources are managed **exclusively** in the `sources/` directory — **nothing is hardcoded** in the codebase.

[![CI](https://github.com/thegnsme/multisource-api/actions/workflows/build.yml/badge.svg)](https://github.com/thegnsme/multisource-api/actions/workflows/build.yml)

<!-- HEALTH_CHECK_START -->

> **📊 Source Health Status**
>
> ✅ 🟢 **9** / 46 sources working
>
> 🕐 **Last checked:** 28-May-2026 11:35:30 PM IST
>
> [📋 Full Report →](./SOURCE_HEALTH.md)

<!-- HEALTH_CHECK_END -->

---

## 🚀 Features

- **🔌 Serverless** — Pipe directly from GitHub raw URL, no hosting needed
- **📁 Source-only management** — Add/remove/edit sources in `sources/`, never touch other files
- **🎯 Zero dependencies** — Only Node.js built-in modules (`https`, `crypto`, `http`, `url`, `fs`)
- **🎨 Multiple formats** — Supports CloudStream, SkyStream, Nuvio, Stremio, and more
- **⚡ Parallel execution** — All sources run concurrently with per-source timeout
- **🛡️ Error resilient** — One failing source never breaks others
- **🌐 Built-in HTTP server** — No Express needed, runs on Node.js built-in `http` module

---

## 📋 Quick Start

### Pipe from GitHub (no install, no hosting)

```bash
# Set your repo info (change to your own fork)
export GITHUB_USER=thegnsme
export GITHUB_REPO=multisource-api

# Pipe and run
curl -sL "https://raw.githubusercontent.com/$GITHUB_USER/$GITHUB_REPO/master/raw-api.js" \
  | node - --tmdb=24428
```

### Local clone

```bash
git clone https://github.com/thegnsme/multisource-api.git
cd multisource-api
node raw-api.js --tmdb=24428
node raw-api.js --server    # Start HTTP server on port 3000
```

---

## 📖 Usage

### CLI

```bash
# Movie by TMDB ID
node raw-api.js --tmdb=24428

# TV show by TMDB ID
node raw-api.js --tmdb=1399 --type=tv --season=1 --episode=1

# By IMDB ID (auto-detects movie/TV)
node raw-api.js --imdb=tt0848228

# Specific output format
node raw-api.js --tmdb=24428 --format=compact
node raw-api.js --tmdb=24428 --format=cloudstream
node raw-api.js --tmdb=24428 --format=skystream
node raw-api.js --tmdb=24428 --format=nuvio
node raw-api.js --tmdb=24428 --format=stremio

# Start HTTP server
node raw-api.js --server --port=8080

# Remote source loading (when piped)
curl -sL https://raw.githubusercontent.com/USER/REPO/master/raw-api.js \
  | node - --tmdb=24428 --github-user=USER --github-repo=REPO
```

### HTTP API

| Endpoint                   | Description                              |
| -------------------------- | ---------------------------------------- |
| `GET /api/health`          | Server health check                      |
| `GET /api/sources`         | List all loaded sources                  |
| `GET /api/formats`         | List available output formats            |
| `GET /api/movie/:tmdbId`   | Movie streams (`?format=`)               |
| `GET /api/tv/:tmdbId`      | TV streams (`?season=&episode=&format=`) |
| `GET /api/by-imdb/:imdbId` | Auto-detect movie/TV (`?format=`)        |

### Import as Module

```javascript
const { scrapeAll, listFormats } = require("./raw-api");

const result = await scrapeAll(24428, "movie", 1, 1, { format: "cloudstream" });
console.log(result);

console.log("Available formats:", listFormats());
```

---

## 📁 Project Structure

```
multisource-api/
├── raw-api.js              # ← The serverless API engine (do NOT edit)
├── sources/                # ← ONLY DIRECTORY YOU EDIT
│   ├── index.js            #   Auto-discovery engine
│   ├── _template.js        #   Copy to add a new source
│   ├── cine_su.js          #   Each file = one video source
│   ├── vaplayer.js
│   └── ...                 # 40+ sources
├── scripts/
│   └── source-health.js    # Health check runner
├── test.js                 # Test suite
├── package.json
└── README.md
```

---

## ➕ Adding a Source

**Step 1:** Copy the template:

```bash
cp sources/_template.js sources/mysource.js
```

**Step 2:** Edit `sources/mysource.js` — implement the `scrapeSource()` function:

```javascript
async function scrapeSource({ tmdbId, type, season, episode }) {
  const start = Date.now();
  // Your scraping logic here
  return {
    source: "mysource.com",
    embedUrl: `https://mysource.com/embed/${type}/${tmdbId}`,
    status: "working", // "working" | "no_streams" | "embed" | "error"
    streams: [
      { url: "...", type: "hls", quality: "1080p", resolution: "1920x1080" },
    ],
    latency_ms: Date.now() - start,
  };
}
module.exports = { scrapeSource };
```

**Step 3:** Done. Auto-discovered on next run. No other files to edit.

### Source Contract

| Field        | Type     | Required | Description                               |
| ------------ | -------- | -------- | ----------------------------------------- | ------------ | ------- | ------- |
| `source`     | `string` | ✅       | Display name (auto-derived from filename) |
| `embedUrl`   | `string` | ✅       | Link to embed/player page                 |
| `status`     | `string` | ✅       | `working`                                 | `no_streams` | `embed` | `error` |
| `streams`    | `Array`  | ✅       | `[{ url, type, quality, resolution }]`    |
| `latency_ms` | `number` | ✅       | `Date.now() - start`                      |
| `subtitles`  | `Array`  | ❌       | `[{ url, lang, type }]`                   |
| `error`      | `string` | ❌       | Error message if status is `error`        |
| `title`      | `string` | ❌       | Movie/show title if known                 |

---

## 🌐 Output Formats

| Format           | Use Case                                                              | Example                |
| ---------------- | --------------------------------------------------------------------- | ---------------------- |
| `full` (default) | Detailed JSON with all metadata                                       | Standard consumption   |
| `compact`        | Simplified stream array                                               | Lightweight clients    |
| `cloudstream`    | [CloudStream 3](https://cloudstream.miraheze.org/) extension format   | Android streaming apps |
| `skystream`      | [SkyStream](https://github.com/akashdh11/skystream) plugin format     | Cross-platform apps    |
| `nuvio`          | [Nuvio](https://github.com/yoruix/nuvio-providers) provider format    | Nuvio streaming app    |
| `stremio`        | [Stremio](https://stremio.github.io/stremio-addon-sdk/) add-on format | Stremio add-ons        |

---

## 🔧 Environment Variables

| Variable        | Purpose                                    | Default                 |
| --------------- | ------------------------------------------ | ----------------------- |
| `GITHUB_USER`   | GitHub username for remote source loading  | (required in pipe mode) |
| `GITHUB_REPO`   | GitHub repo name for remote source loading | (required in pipe mode) |
| `GITHUB_BRANCH` | Branch for remote source loading           | `master`                |
| `TMDB_API_KEY`  | TMDB API key                               | Public demo key         |
| `PORT`          | HTTP server port                           | `3000`                  |

---

## 🏗️ How It Works

1. **`raw-api.js`** is a generic engine with zero hardcoded sources
2. When run **locally**, it auto-discovers all `.js` files in `sources/`
3. When **piped**, it fetches sources dynamically from your GitHub repo
4. All sources run in **parallel** with a 30-second timeout
5. Results are **deduplicated**, **sorted** by status (working → embed → error)
6. Output is **formatted** for your target platform

---

## 📊 Health Check

```bash
# Run health check (quick)
node scripts/source-health.js --quick

# Full health check
node scripts/source-health.js

# Generate JSON report
node scripts/source-health.js --output=json

# Update SOURCE_HEALTH.md
node scripts/source-health.js --update-readme
```

---

## 🧪 Testing

```bash
# Full test suite
node test.js

# Quick smoke test
node test.js --quick

# Test specific source
node test.js --source=vaplayer

# Test format adapters only
node test.js --format
```

---

## 📄 License

MIT
