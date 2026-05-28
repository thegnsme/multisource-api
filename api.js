#!/usr/bin/env node
/**
 * CLI — query any source for a movie or TV show.
 *
 * Usage:
 *   node api.js --tmdb=24428
 *   node api.js --tmdb=1399 --type=tv --season=1 --episode=1
 *   node api.js --imdb=tt0848228
 */

const { aggregateAll } = require("./sources");
const { imdbToTmdb } = require("./utils/tmdb-lookup");

async function main() {
	const args = {};
	process.argv.slice(2).forEach((a) => {
		const [k, v] = a.replace(/^--/, "").split("=");
		args[k] = v || true;
	});

	let tmdbId = args.tmdb || args.id;
	let type = args.type || "movie";
	const season = args.season || 1;
	const episode = args.episode || 1;

	// IMDB → TMDB conversion
	if (args.imdb) {
		const lookup = await imdbToTmdb(args.imdb);
		tmdbId = lookup.tmdbId;
		type = lookup.type;
	}

	if (!tmdbId) {
		console.log(
			JSON.stringify(
				{
					error: "Usage: node api.js --tmdb=24428",
					examples: {
						movie: "node api.js --tmdb=24428",
						tv: "node api.js --tmdb=1399 --type=tv --season=1 --episode=1",
						imdb: "node api.js --imdb=tt0848228",
					},
				},
				null,
				2,
			),
		);
		process.exit(1);
	}

	const result = await aggregateAll(tmdbId, type, season, episode);
	console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
	console.log(JSON.stringify({ error: err.message }, null, 2));
	process.exit(1);
});
