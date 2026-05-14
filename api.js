#!/usr/bin/env node
/**
 * Video Sources Aggregator API
 *
 * Usage:
 *   node api.js --tmdb=24428
 *   node api.js --imdb=tt0848228
 *   node api.js --tmdb=1399 --type=tv --season=1 --episode=1
 *
 * Outputs JSON to stdout. Pipe through jq for pretty output.
 */
const { aggregateAll } = require('./sources');
const { imdbToTmdb } = require('./utils/tmdb-lookup');

async function main() {
  const args = {};
  process.argv.slice(2).forEach(a => {
    const [k, v] = a.replace(/^--/, '').split('=');
    args[k] = v || true;
  });

  let tmdbId = args.tmdb || args.id;
  let type = args.type || 'movie';
  const season = args.season || 1;
  const episode = args.episode || 1;

  // IMDB ID support — convert tt... to TMDB ID
  if (args.imdb) {
    try {
      const lookup = await imdbToTmdb(args.imdb);
      tmdbId = lookup.tmdbId;
      type = lookup.type; // auto-detect movie vs TV
    } catch (e) {
      console.log(JSON.stringify({ success: false, error: `IMDB lookup failed: ${e.message}` }, null, 2));
      process.exit(1);
    }
  }

  if (!tmdbId) {
    console.log(JSON.stringify({
      success: false,
      error: 'Usage: node api.js --tmdb=24428 OR node api.js --imdb=tt0848228',
      examples: {
        movie_tmdb: 'node api.js --tmdb=24428',
        movie_imdb: 'node api.js --imdb=tt0848228',
        tv_tmdb: 'node api.js --tmdb=1399 --type=tv --season=1 --episode=1',
        tv_imdb: 'node api.js --imdb=tt0903747 --season=1 --episode=1',
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
