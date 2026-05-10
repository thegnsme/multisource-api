/**
 * Sources Aggregator — loads all source modules, runs them in parallel,
 * and aggregates results into a single JSON response.
 */
const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const sourceFiles = fs.readdirSync(DIR)
  .filter(f => f.endsWith('.js') && !['index.js'].includes(f))
  .sort();

const sources = [];
for (const file of sourceFiles) {
  try {
    const mod = require(path.join(DIR, file));
    if (typeof mod.scrapeSource === 'function') {
      sources.push({ name: file.replace(/\.js$/, '').replace(/_/g, '.'), scrape: mod.scrapeSource });
    }
  } catch (e) {
    // skip
  }
}

async function aggregateAll(tmdbId, type = 'movie', season = 1, episode = 1) {
  const params = { tmdbId: parseInt(tmdbId), type, season: parseInt(season), episode: parseInt(episode) };

  // Run all sources in parallel — keep each result paired with its source name
  const tasks = sources.map(src => ({
    name: src.name,
    promise: src.scrape(params).catch(err => ({
      source: src.name,
      status: 'error',
      error: err.message,
      streams: [],
    })),
  }));

  const settled = await Promise.allSettled(tasks.map(t => t.promise));

  const sourcesOut = [];
  let working = 0;

  for (let i = 0; i < settled.length; i++) {
    const r = settled[i];
    const srcName = tasks[i].name;
    if (r.status === 'fulfilled') {
      const val = r.value;
      // Preserve the source's own name if set, otherwise use file-based name
      if (!val.source || val.source === 'unknown') val.source = srcName;
      sourcesOut.push(val);
      if (val.status === 'working' && val.streams?.length > 0) working++;
    } else {
      sourcesOut.push({ source: srcName, status: 'error', error: r.reason?.message, streams: [] });
    }
  }

  // Count unique streams
  const allStreams = sourcesOut.flatMap(s => s.streams || []);
  const uniqueUrls = new Set();
  allStreams.forEach(s => uniqueUrls.add(s.url));

  return {
    success: true,
    tmdbId: parseInt(tmdbId),
    type,
    ...(type === 'tv' ? { season: parseInt(season), episode: parseInt(episode) } : {}),
    sources: sourcesOut,
    workingSources: working,
    totalSourcesChecked: sources.length,
    totalUniqueStreams: uniqueUrls.size,
    timestamp: new Date().toISOString(),
  };
}

module.exports = { aggregateAll, sourceCount: sources.length };
