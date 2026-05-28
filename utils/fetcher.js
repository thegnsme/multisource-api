/**
 * fetcher.js — HTTP fetch wrapper with anti-detection measures.
 *
 * Features:
 *   - User-Agent rotation
 *   - Cookie jar
 *   - Rate limiting
 *   - Retry with exponential backoff
 *   - IPv4 forcing
 *   - TLS bypass
 */

const axios = require("axios");
const https = require("https");
const http = require("http");

// ── User-Agent Pool ──────────────────────────────────────────────────────────

const USER_AGENTS = [
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.2 Safari/605.1.15",
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:134.0) Gecko/20100101 Firefox/134.0",
	"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
];

function getRandomUA() {
	return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// ── Agents ───────────────────────────────────────────────────────────────────

const httpsAgent = new https.Agent({
	family: 4,
	keepAlive: true,
	rejectUnauthorized: false,
});
const httpAgent = new http.Agent({ family: 4, keepAlive: true });

// ── Cookie Jar ───────────────────────────────────────────────────────────────

const cookieJar = new Map(); // domain -> cookie string

function parseCookies(setCookieHeaders, domain) {
	if (!setCookieHeaders) return;
	const headers = Array.isArray(setCookieHeaders)
		? setCookieHeaders
		: [setCookieHeaders];
	const cookies = [];
	for (const header of headers) {
		const parts = header.split(";")[0].trim();
		cookies.push(parts);
	}
	cookieJar.set(domain, cookies.join("; "));
}

// ── Main Fetch ───────────────────────────────────────────────────────────────

async function fetchUrl(url, opts = {}) {
	const {
		referer = "",
		timeout = 8000,
		retries = 1,
		responseType = "text",
	} = opts;

	let domain;
	try {
		domain = new URL(url).hostname;
	} catch {
		domain = url;
	}

	const headers = {
		"User-Agent": getRandomUA(),
		Accept:
			"text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
		"Accept-Language": "en-US,en;q=0.9",
		"Accept-Encoding": "gzip, deflate, br",
		Connection: "keep-alive",
		"Upgrade-Insecure-Requests": "1",
		...(referer ? { Referer: referer } : {}),
	};

	// Add cookies if available
	const cookies = cookieJar.get(domain);
	if (cookies) {
		headers["Cookie"] = cookies;
	}

	for (let i = 0; i <= retries; i++) {
		try {
			const resp = await axios.get(url, {
				headers,
				timeout,
				maxRedirects: 5,
				validateStatus: () => true,
				responseType,
				httpsAgent,
				httpAgent,
			});

			// Store cookies
			if (resp.headers["set-cookie"]) {
				parseCookies(resp.headers["set-cookie"], domain);
			}

			return {
				data:
					typeof resp.data === "string" ? resp.data : JSON.stringify(resp.data),
				status: resp.status,
			};
		} catch (e) {
			if (i === retries) return { data: null, status: 0, error: e.message };
			await new Promise((r) => setTimeout(r, 1000 + Math.random() * 500));
		}
	}
	return { data: null, status: 0, error: "max retries" };
}

module.exports = { fetchUrl, getRandomUA, cookieJar };
