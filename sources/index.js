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
  const globalStart = Date.now();
  const SOURCE_TIMEOUT = 30000; // 30s max per source

  // Run all sources in parallel with a global timeout per source
  const tasks = sources.map(src => ({
    name: src.name,
    promisePromise: src.scrape(params).catch(err => ({
      source: src.name,
      status: 'error',
      error: err.message,
      streams: [],
      latency_ms: Date.now() - globalStart,
    })),
  }));

  // Wrap each promise with a timeout
  const wrapped = tasks.map(t => {
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Source timeout')), SOURCE_TIMEOUT)
    );
    return Promise.race([t.promisePromise, timeoutPromise]).catch(err => ({
      source: t.name,
      status: 'error',
      error: err.message || 'Source timeout',
      streams: [],
      latency_ms: Date.now() - globalStart,
    }));
  });

  const settled = await Promise.allSettled(wrapped.map((p, i) => p.then(v => ({ index: i, value: v }))));

  const sourcesOut = [];
  let working = 0;

  for (let i = 0; i < settled.length; i++) {
    const r = settled[i];
    const srcName = tasks[i].name;
    if (r.status === 'fulfilled') {
      const val = r.value.value;
      if (!val.source || val.source === 'unknown') val.source = srcName;
      sourcesOut.push(val);
      if (val.status === 'working' && val.streams?.length > 0) working++;
    } else {
      sourcesOut.push({ source: srcName, status: 'error', error: r.reason?.message || 'Promise failed', streams: [], latency_ms: Date.now() - globalStart });
    }
  }

  // Count unique streams
  const allStreams = sourcesOut.flatMap(s => s.streams || []);
  const uniqueUrls = new Set();
  allStreams.forEach(s => uniqueUrls.add(s.url));

  // Sort sources: working first, then embed, then error
  sourcesOut.sort((a, b) => {
    const order = { working: 0, no_streams: 1, embed: 2, unavailable: 2, error: 3 };
    return (order[a.status] || 4) - (order[b.status] || 4);
  });

  return {
    success: true,
    tmdbId: parseInt(tmdbId),
    type,
    ...(type === 'tv' ? { season: parseInt(season), episode: parseInt(episode) } : {}),
    sources: sourcesOut,
    workingSources: working,
    totalSourcesChecked: sources.length,
    totalUniqueStreams: uniqueUrls.size,
    elapsed_ms: Date.now() - globalStart,
    timestamp: new Date().toISOString(),
  };
}

module.exports = { aggregateAll, sourceCount: sources.length };
