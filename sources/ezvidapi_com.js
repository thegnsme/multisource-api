/**
 * ezvidapi.com — Multi-provider streaming API with proxy m3u8 and subtitles.
 *
 * API Chain:
 *   1. GET https://api.ezvidapi.com/movie/{provider}/{tmdbId}
 *   2. Response: { provider, stream_url (proxy m3u8), subtitles[], stream_type }
 *   3. Fetch proxy m3u8 → parse base64-encoded upstream URLs
 *   4. Extract quality variants from upstream m3u8
 *
 * Providers: vidrock, vidzee (auto-failover)
 * Subtitles: 40+ languages (Arabic, Chinese, English, French, Spanish, etc.)
 * Proxy: Routes through api.ezvidapi.com/proxy/master/{base64}
 *
 * Status: working (HTTP API, no browser needed)
 */

const { smartFetch, parseM3U8, QUALITY_MAP } = require("../utils/antidetect");

const API_BASE = "https://api.ezvidapi.com";
const PROVIDERS = ["vidrock", "vidzee"];

async function scrapeSource({ tmdbId, type, season, episode }) {
	const start = Date.now();
	const isTv = type === "tv";
	const embedUrl =
		`https://ezvidapi.com/embed/${type}/${tmdbId}` +
		(isTv ? `?season=${season || 1}&episode=${episode || 1}` : "");

	const streams = [];
	const seen = new Set();
	const subtitles = [];

	for (const provider of PROVIDERS) {
		try {
			// Build API URL
			const apiUrl = isTv
				? `${API_BASE}/tv/${provider}/${tmdbId}?season=${season || 1}&episode=${episode || 1}`
				: `${API_BASE}/movie/${provider}/${tmdbId}`;

			const resp = await smartFetch(apiUrl, {
				referer: "https://ezvidapi.com/",
				timeout: 15000,
				extraHeaders: {
					Origin: "https://ezvidapi.com",
				},
			});

			if (resp.status !== 200 || !resp.data) continue;

			// Parse JSON response
			let data;
			try {
				data = JSON.parse(resp.data);
			} catch {
				continue;
			}

			// Extract stream URL (proxy m3u8)
			if (data.stream_url && !seen.has(data.stream_url)) {
				seen.add(data.stream_url);

				// Fetch the proxy m3u8 to get the actual stream
				try {
					const m3u8Resp = await smartFetch(data.stream_url, {
						referer: "https://ezvidapi.com/",
						timeout: 10000,
						rateLimit: false,
					});

					if (m3u8Resp.status === 200 && m3u8Resp.data) {
						const m3u8 = m3u8Resp.data;

						if (m3u8.startsWith("#EXTM3U")) {
							// Parse the m3u8 for quality variants
							const variants = parseM3U8(m3u8, data.stream_url);
							for (const v of variants) {
								if (!seen.has(v.url)) {
									seen.add(v.url);
									streams.push({
										url: v.url,
										type: "hls",
										quality: v.quality,
										resolution: v.resolution,
										bandwidth: v.bandwidth,
										server: `ezvidapi (${provider})`,
									});
								}
							}
						} else {
							// Not a valid m3u8 — the proxy URL itself might be playable
							streams.push({
								url: data.stream_url,
								type: "hls",
								quality: "",
								resolution: "",
								server: `ezvidapi (${provider})`,
							});
						}
					}
				} catch {
					// If m3u8 fetch fails, add the proxy URL directly
					streams.push({
						url: data.stream_url,
						type: "hls",
						quality: "",
						resolution: "",
						server: `ezvidapi (${provider})`,
					});
				}
			}

			// Extract subtitles
			if (Array.isArray(data.subtitles)) {
				for (const sub of data.subtitles) {
					if (sub.url && sub.url.startsWith("http")) {
						const subKey = `${sub.language || sub.label}`;
						if (!subtitles.find((s) => s.lang === subKey)) {
							subtitles.push({
								url: sub.url,
								lang: sub.language || sub.label || "unknown",
								type: "vtt",
								default: sub.default || false,
							});
						}
					}
				}
			}

			// If we found streams, no need to try other providers
			if (streams.length > 0) break;
		} catch (e) {
			continue;
		}
	}

	return {
		source: "ezvidapi.com",
		embedUrl,
		status: streams.length > 0 ? "working" : "no_streams",
		streams,
		subtitles: subtitles.length > 0 ? subtitles : undefined,
		latency_ms: Date.now() - start,
	};
}

module.exports = { scrapeSource };

// ── Standalone CLI ──
if (require.main === module || module.id === "[stdin]") {
	(async () => {
		const args = {};
		process.argv.slice(2).forEach((a) => {
			const [k, v] = a.replace(/^--/, "").split("=");
			args[k] = v || true;
		});
		const result = await scrapeSource({
			tmdbId: parseInt(args.tmdb || args.id || "24428"),
			type: args.type || "movie",
			season: parseInt(args.season || "1"),
			episode: parseInt(args.episode || "1"),
		});
		console.log(JSON.stringify(result, null, 2));
	})();
}
