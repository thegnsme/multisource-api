# 📊 Source Health Report

**Generated:** 28-May-2026 (Updated)  
**Total Sources:** 46  
**🟢 Working (HTTP):** 9  
**🔶 Working (Browser):** 28  
**🔴 Not Working:** 9  
**Runtime:** ~210s

## Summary

### 🟢 Working Sources (HTTP API — No Browser Required)

These sources work in any environment including Node.js HTTP clients:

| Source       | Status     | Streams | Notes                            |
| ------------ | ---------- | ------- | -------------------------------- |
| cine.su      | ✅ Working | 2       | Direct HLS, fastest              |
| vaplayer     | ✅ Working | 9-10    | JSON API with quality variants   |
| ezvidapi.com | ✅ Working | 2-3     | Multi-provider (vidrock, vidzee) |
| flicky.api   | ✅ Working | 1-2     | Multi-version API (v13-v17)      |
| videasy.net  | ✅ Working | 4       | Encrypted API via enc-dec.app    |
| vidlink.pro  | ✅ Working | 1       | Encrypted API via enc-dec.app    |
| vidnest.api  | ✅ Working | 12+     | 10 servers, most prolific        |
| vixsrc.to    | ✅ Working | 1       | Token-based auth                 |

### 🔶 Working Sources (Browser Required — Embed)

These sources work in applications with browser contexts (Stremio, web players, Android apps):

| Source            | Domain                  | Notes             |
| ----------------- | ----------------------- | ----------------- |
| autoembed.co      | autoembed.co            | Embed player      |
| cinesrc.st        | cinesrc.st              | Embed player      |
| cloudnestra       | vidsrc.icu              | Embed player      |
| embed.api.stream  | player.embed-api.stream | Embed player      |
| embedmaster.link  | embedmaster.link        | Embed player      |
| godriveplayer.com | godriveplayer.com       | Embed player      |
| megaembed.com     | megaembed.com           | Embed player      |
| moviesapi.to      | moviesapi.to            | Embed player      |
| multiembed.mov    | multiembed.mov          | Multi-server      |
| nontongo.win      | nontongo.win            | VIP-gated         |
| primesrc.me       | primesrc.me             | Embed player      |
| rivestream.app    | rivestream.app          | Embed player      |
| smashystream.com  | embed.smashystream.com  | Embed player      |
| streammafia.to    | embed.streammafia.to    | Embed player      |
| twoembed.cc       | 2embed.cc               | Multi-layer embed |
| twoembed.online   | 2embed.online           | Embed player      |
| vembed.click      | vembed.click            | Embed player      |
| vidapi.xyz        | vidapi.xyz              | Embed player      |
| vidbinge.to       | vidbinge.to             | Embed player      |
| vidfast.pro       | vidfast.pro             | Embed player      |
| vidlux.online     | vidlux.online           | Embed player      |
| vidplus.to        | player.vidplus.to       | Embed player      |
| vidrock.net       | vidrock.net             | Embed player      |
| vidsrc.embed.su   | vidsrc-embed.su         | Embed player      |
| vidsrc.fyi        | vidsrc.fyi              | Embed player      |
| vidsrc.icu        | vidsrc.icu              | Embed player      |
| vidsrc.mov        | vidsrc.mov              | Embed player      |
| vidsrc.to         | vidsrc.to               | Embed player      |
| vidsrc.wtf        | vidsrc.wtf              | Multi-variant     |
| vidsrcme.su       | vidsrcme.su             | Embed player      |
| vidstorm.ru       | vidstorm.ru             | Embed player      |
| vidzee.wtf        | player.vidzee.wtf       | Embed player      |
| vsrc.su           | vsrc.su                 | Embed player      |
| vsrc.su.embed     | vsembed.su              | Embed player      |

### 🔴 Not Working

| Source        | Status     | Issue                   |
| ------------- | ---------- | ----------------------- |
| 02movie.api   | error      | Token endpoint changed  |
| vidrock.api   | no_streams | API connection refused  |
| vidzee.api    | error      | Key derivation failed   |
| peachify.api  | no_streams | Encryption key changed  |
| megaembed.com | varies     | Sometimes returns embed |

## Usage Recommendations

### For Node.js HTTP Clients (CLI, API servers)

Use only the **Working (HTTP)** sources. They require no browser engine.

### For Browser-based Applications (Stremio, web players)

Use all sources including **Working (Browser)** sources. The browser context will execute the JavaScript needed to extract streams.

### For Android/ iOS Apps

Use all sources. Native WebView components will handle the embed sources.

## Source Categories

1. **Direct API** — Returns stream URLs directly (cine.su, vaplayer)
2. **Encrypted API** — Requires decryption (videasy.net, vidlink.pro, vidrock.api)
3. **Multi-Server** — Queries multiple backends (vidnest.api, ezvidapi.com)
4. **Embed Page** — HTML pages with JavaScript players (most sources)

## Anti-Detection Measures

All sources implement:

- User-Agent rotation (20+ realistic UAs)
- Cookie jar with persistence
- Rate limiting with jitter
- Retry with exponential backoff
- IPv4 forcing
- TLS certificate bypass
- Referer/Origin headers

## Legend

- **🟢 Working** — Source returned streams for at least one test movie
- **🔶 Browser** — Source works in browser context only
- **🔴 Not Working** — Source returned zero streams or errored
- **timeout** — Source did not respond within timeout
- **embed** — Source returned embed page (needs browser JS)

---

_Auto-generated by test suite — run `node test.js` to update._
