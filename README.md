# MultiSource API

Aggregate working HLS video streams from multiple sources for any TMDB movie or TV show. CLI-only, outputs JSON to stdout.

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

## Usage

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

## Working Sources (4)

| Source | Quality | Subtitles | Method |
|--------|---------|-----------|--------|
| vaplayer.ru | 360p, 720p, 1080p | ✗ | JSON API → HLS master playlist |
| ezvidapi.com | 720p, 1080p | 7-12 langs | Proxied m3u8 → quality variants |
| vidlink.pro | 360p, 720p, 1080p | 4-30 langs | Encrypted API → HLS + captions |
| videasy.net | 480p, 720p, 1080p, 4K | 67-152 langs | Encrypted API → decrypt → sources |

## Architecture

Each source is a standalone file in `sources/` exporting `{ scrapeSource({tmdbId, type, season, episode}) }`. The aggregator (`sources/index.js`) runs all sources in parallel via `Promise.allSettled`, deduplicates streams by URL, and returns a unified JSON response.

## CI

GitHub Actions runs the test suite on push (Node 18/20/22 matrix).
