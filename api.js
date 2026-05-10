#!/usr/bin/env node
/**
 * Video Sources Aggregator API
 *
 * Usage:
 *   node api.js --tmdb=24428 --type=movie
 *   node api.js --tmdb=1399 --type=tv --season=1 --episode=1
 *   node api.js --tmdb=1226863
 *   node api.js --tmdb=1396 --type=tv --season=1 --episode=1
 *
 * Outputs JSON to stdout. Pipe through jq for pretty output.
 */
const { aggregateAll } = require('./sources');

async function main() {
  const args = {};
  process.argv.slice(2).forEach(a => {
    const [k, v] = a.replace(/^--/, '').split('=');
    args[k] = v || true;
  });

  const tmdbId = args.tmdb || args.id;
  const type = args.type || 'movie';
  const season = args.season || 1;
  const episode = args.episode || 1;

  if (!tmdbId) {
    console.log(JSON.stringify({
      success: false,
      error: 'Usage: node api.js --tmdb=24428 [--type=movie|tv] [--season=N] [--episode=N]',
      endpoints: {
        movie: 'node api.js --tmdb=24428',
        tv: 'node api.js --tmdb=1399 --type=tv --season=1 --episode=1',
      },
    }, null, 2));
    process.exit(1);
  }

  const result = await aggregateAll(tmdbId, type, season, episode);
  console.log(JSON.stringify(result, null, 2));
}

main().catch(err => {
  console.log(JSON.stringify({ success: false, error: err.message }, null, 2));
  process.exit(1);
});
