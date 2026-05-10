(function() {

  const TMDB_KEY = "1865f43a0549ca50d341dd9ab8b29f49";
  const TMDB_API = "https://api.themoviedb.org/3";
  const IMG_BASE = "https://image.tmdb.org/t/p/w500";
  const IMG_BG = "https://image.tmdb.org/t/p/w1280";

  const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

  function headers(referer) {
    var h = { "User-Agent": UA, "Accept": "application/json" };
    if (referer) h["Referer"] = referer;
    return h;
  }

  function first(arr) { return arr && arr.length > 0 ? arr[0] : null; }

  // ── TMDB helpers ──────────────────────────────────────────────

  function tmdbUrl(path, params) {
    var p = "api_key=" + TMDB_KEY + "&language=en-US";
    if (params) for (var k in params) p += "&" + k + "=" + encodeURIComponent(params[k]);
    return TMDB_API + path + "?" + p;
  }

  function toItem(m, type) {
    var title = type === "tv" ? (m.name || m.title) : (m.title || m.name);
    var date = type === "tv" ? (m.first_air_date || "") : (m.release_date || "");
    var year = date ? parseInt(date.split("-")[0]) : 0;
    return new MultimediaItem({
      title: title,
      url: JSON.stringify({ tmdbId: m.id, type: type, title: title }),
      posterUrl: m.poster_path ? IMG_BASE + m.poster_path : "",
      bannerUrl: m.backdrop_path ? IMG_BG + m.backdrop_path : "",
      backgroundPosterUrl: m.backdrop_path ? IMG_BG + m.backdrop_path : "",
      type: type,
      year: year,
      score: m.vote_average || 0,
      genres: m.genre_ids ? [] : undefined,
      description: m.overview || "",
    });
  }

  // ── Source implementations ─────────────────────────────────────
  // These use http_get/http_post (sandbox) instead of axios

  function qs(obj) {
    var parts = [];
    for (var k in obj) parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(obj[k]));
    return parts.join("&");
  }

  async function scrapeVaplayer(tmdbId, type, season, episode) {
    try {
      var apiUrl = "https://streamdata.vaplayer.ru/api.php?" + qs({
        tmdb: tmdbId, type: type,
        ...(type === "tv" ? { season: season || 1, episode: episode || 1 } : {})
      });
      var ref = "https://brightpathsignals.com/embed/" + type + "/" + tmdbId;
      var resp = await http_get(apiUrl, { "User-Agent": UA, "Referer": ref, "Accept": "application/json" });
      if (resp.status !== 200) return [];
      var data = JSON.parse(resp.body);
      if (!data.data || !data.data.stream_urls) return [];

      var streams = [];
      for (var si = 0; si < data.data.stream_urls.length; si++) {
        var su = data.data.stream_urls[si];
        try {
          var m3 = await http_get(su, { "User-Agent": UA, "Referer": "https://brightpathsignals.com/" });
          if (m3.body && m3.body.startsWith("#EXTM3U")) {
            if (m3.body.indexOf("#EXT-X-STREAM-INF:") >= 0) {
              var lines = m3.body.split("\n");
              for (var li = 0; li < lines.length; li++) {
                if (lines[li].indexOf("#EXT-X-STREAM-INF:") !== 0) continue;
                var bw = lines[li].match(/BANDWIDTH=(\d+)/);
                var res = lines[li].match(/RESOLUTION=(\d+x\d+)/);
                var nl = lines[li + 1] ? lines[li + 1].trim() : "";
                if (nl && nl.indexOf("#") !== 0) {
                  var vu = nl.indexOf("http") === 0 ? nl : resolveUrl(nl, su);
                  var h = res ? res[1].split("x")[1] : "";
                  var qm = { "360": "360p", "480": "480p", "720": "720p", "1080": "1080p", "2160": "4K" };
                  streams.push({ url: vu, quality: qm[h] || (h ? h + "p" : ""), resolution: res ? res[1] : "" });
                  li++;
                }
              }
            } else {
              streams.push({ url: su, quality: "", resolution: "" });
            }
          } else {
            streams.push({ url: su, quality: "", resolution: "" });
          }
        } catch (_) {
          streams.push({ url: su, quality: "", resolution: "" });
        }
      }
      return streams;
    } catch (_) { return []; }
  }

  async function scrapeEzvidapi(tmdbId, type, season, episode) {
    var providers = ["vidrock", "vidzee"];
    for (var pi = 0; pi < providers.length; pi++) {
      try {
        var apiUrl = type === "movie"
          ? "https://api.ezvidapi.com/movie/" + providers[pi] + "/" + tmdbId
          : "https://api.ezvidapi.com/tv/" + providers[pi] + "/" + tmdbId + "?season=" + (season || 1) + "&episode=" + (episode || 1);
        var resp = await http_get(apiUrl, headers("https://ezvidapi.com/"));
        if (resp.status !== 200) continue;
        var data = JSON.parse(resp.body);
        if (!data.stream_url) continue;

        var m3 = await http_get(data.stream_url, headers("https://ezvidapi.com/"));
        var streams = [];
        if (m3.body && m3.body.startsWith("#EXTM3U") && m3.body.indexOf("#EXT-X-STREAM-INF:") >= 0) {
          var lines = m3.body.split("\n");
          for (var li = 0; li < lines.length; li++) {
            if (lines[li].indexOf("#EXT-X-STREAM-INF:") !== 0) continue;
            var bw = lines[li].match(/BANDWIDTH=(\d+)/);
            var res = lines[li].match(/RESOLUTION=(\d+x\d+)/);
            var nl = lines[li + 1] ? lines[li + 1].trim() : "";
            if (nl && nl.indexOf("#") !== 0) {
              var vu = nl.indexOf("http") === 0 ? nl : resolveUrl(nl, data.stream_url);
              var h = res ? res[1].split("x")[1] : "";
              var qm = { "360": "360p", "480": "480p", "720": "720p", "1080": "1080p", "2160": "4K" };
              streams.push({ url: vu, quality: qm[h] || (h ? h + "p" : ""), resolution: res ? res[1] : "" });
              li++;
            }
          }
        }
        if (streams.length > 0) return streams;
      } catch (_) { continue; }
    }
    return [];
  }

  async function scrapeVidlink(tmdbId, type, season, episode) {
    try {
      var encResp = await http_get("https://enc-dec.app/api/enc-vidlink?text=" + tmdbId, { "User-Agent": UA });
      if (encResp.status !== 200) return [];
      var encData = JSON.parse(encResp.body);
      if (!encData.result) return [];

      var apiUrl = type === "movie"
        ? "https://vidlink.pro/api/b/movie/" + encData.result + "?multiLang=0"
        : "https://vidlink.pro/api/b/tv/" + encData.result + "/" + (season || 1) + "/" + (episode || 1) + "?multiLang=0";
      var sr = await http_get(apiUrl, { "User-Agent": UA, "Referer": "https://vidlink.pro/", "Accept": "application/json" });
      if (sr.status !== 200) return [];
      var sd = JSON.parse(sr.body);
      if (!sd.stream || !sd.stream.playlist) return [];

      var pl = sd.stream.playlist;
      var m3 = await http_get(pl, { "User-Agent": UA, "Referer": "https://vidlink.pro/" });
      var streams = [];
      if (m3.body && m3.body.startsWith("#EXTM3U") && m3.body.indexOf("#EXT-X-STREAM-INF:") >= 0) {
        var lines = m3.body.split("\n");
        for (var li = 0; li < lines.length; li++) {
          if (lines[li].indexOf("#EXT-X-STREAM-INF:") !== 0) continue;
          var bw = lines[li].match(/BANDWIDTH=(\d+)/);
          var res = lines[li].match(/RESOLUTION=(\d+x\d+)/);
          var nl = lines[li + 1] ? lines[li + 1].trim() : "";
          if (nl && nl.indexOf("#") !== 0) {
            var vu = nl.indexOf("http") === 0 ? nl : resolveUrl(nl, pl);
            var h = res ? res[1].split("x")[1] : "";
            var qm = { "360": "360p", "480": "480p", "720": "720p", "1080": "1080p", "2160": "4K" };
            streams.push({ url: vu, quality: qm[h] || (h ? h + "p" : ""), resolution: res ? res[1] : "" });
            li++;
          }
        }
      }
      if (streams.length === 0) streams.push({ url: pl, quality: "", resolution: "" });
      return streams;
    } catch (_) { return []; }
  }

  async function scrapeVideasy(tmdbId, type, season, episode) {
    try {
      var params = { title: "", mediaType: type, year: "", tmdbId: String(tmdbId), imdbId: "" };
      if (type === "tv") { params.season = String(season || 1); params.episode = String(episode || 1); }
      var apiUrl = "https://api.videasy.net/cdn/sources-with-title?" + qs(params);
      var encResp = await http_get(apiUrl, { "User-Agent": UA, "Referer": "https://videasy.net/" });
      if (encResp.status !== 200) return [];
      var encText = encResp.body.trim();
      if (encText.length < 10) return [];

      var decResp = await http_post("https://enc-dec.app/api/dec-videasy",
        { "Content-Type": "application/json", "User-Agent": UA },
        JSON.stringify({ text: encText, id: String(tmdbId) })
      );
      if (decResp.status !== 200) return [];
      var decData = JSON.parse(decResp.body);
      if (!decData.result || !decData.result.sources) return [];

      var streams = [];
      for (var si = 0; si < decData.result.sources.length; si++) {
        var s = decData.result.sources[si];
        var rmap = { "4K": "3840x2160", "1080p": "1920x1080", "720p": "1280x720", "480p": "854x480", "360p": "640x360" };
        streams.push({ url: s.url, quality: s.quality || "", resolution: rmap[s.quality] || "" });
      }
      return streams;
    } catch (_) { return []; }
  }

  function resolveUrl(relative, base) {
    if (relative.indexOf("http") === 0) return relative;
    var m = base.match(/^(https?:\/\/[^\/]+)/);
    if (m) return m[1] + (relative.indexOf("/") === 0 ? relative : "/" + relative);
    return base + (relative.indexOf("/") === 0 ? relative : "/" + relative);
  }

  // ── Plugin functions ──────────────────────────────────────────

  async function getHome(cb) {
    try {
      var homeData = {};

      // Trending Movies
      var tm = await http_get(tmdbUrl("/trending/movie/week"), headers());
      if (tm.status === 200) {
        var td = JSON.parse(tm.body);
        homeData["Trending Movies"] = (td.results || []).map(function(m) { return toItem(m, "movie"); });
      }

      // Trending TV
      var tt = await http_get(tmdbUrl("/trending/tv/week"), headers());
      if (tt.status === 200) {
        var ttd = JSON.parse(tt.body);
        homeData["Trending TV Shows"] = (ttd.results || []).map(function(m) { return toItem(m, "tv"); });
      }

      // Popular Movies
      var pm = await http_get(tmdbUrl("/movie/popular"), headers());
      if (pm.status === 200) {
        var pd = JSON.parse(pm.body);
        homeData["Popular Movies"] = (pd.results || []).map(function(m) { return toItem(m, "movie"); });
      }

      cb({ success: true, data: homeData });
    } catch (e) {
      cb({ success: false, errorCode: "HOME_ERROR", message: e.message });
    }
  }

  async function search(query, cb) {
    try {
      // Search both movies and TV
      var sm = await http_get(tmdbUrl("/search/multi", { query: query }), headers());
      if (sm.status !== 200) { cb({ success: true, data: [] }); return; }
      var sd = JSON.parse(sm.body);
      var items = (sd.results || [])
        .filter(function(r) { return r.media_type === "movie" || r.media_type === "tv"; })
        .map(function(r) { return toItem(r, r.media_type); });
      cb({ success: true, data: items });
    } catch (e) {
      cb({ success: true, data: [] });
    }
  }

  async function load(url, cb) {
    try {
      var payload = JSON.parse(url);
      var tmdbId = payload.tmdbId;
      var type = payload.type || "movie";
      var title = payload.title || "";

      // Fetch TMDB details
      var detailUrl = type === "tv" ? tmdbUrl("/tv/" + tmdbId) : tmdbUrl("/movie/" + tmdbId);
      var dr = await http_get(detailUrl, headers());
      if (dr.status !== 200) { cb({ success: false, errorCode: "NOT_FOUND" }); return; }
      var d = JSON.parse(dr.body);

      var item = new MultimediaItem({
        title: title || d.title || d.name,
        url: url,
        posterUrl: d.poster_path ? IMG_BASE + d.poster_path : "",
        bannerUrl: d.backdrop_path ? IMG_BG + d.backdrop_path : "",
        backgroundPosterUrl: d.backdrop_path ? IMG_BG + d.backdrop_path : "",
        type: type,
        year: d.release_date ? parseInt(d.release_date.split("-")[0]) : (d.first_air_date ? parseInt(d.first_air_date.split("-")[0]) : 0),
        score: d.vote_average || 0,
        description: d.overview || "",
        genres: d.genres ? d.genres.map(function(g) { return g.name; }) : undefined,
      });

      if (type === "movie") {
        item.episodes = [new Episode({
          name: "Full Movie",
          url: JSON.stringify({ tmdbId: tmdbId, type: "movie" }),
          season: 1,
          episode: 1,
        })];
      } else {
        // Fetch seasons/episodes
        var episodes = [];
        try {
          var se = await http_get(tmdbUrl("/tv/" + tmdbId + "/season/" + (payload.season || 1)), headers());
          if (se.status === 200) {
            var sed = JSON.parse(se.body);
            var snum = payload.season || 1;
            (sed.episodes || []).forEach(function(ep) {
              episodes.push(new Episode({
                name: ep.name || "Episode " + ep.episode_number,
                url: JSON.stringify({ tmdbId: tmdbId, type: "tv", season: snum, episode: ep.episode_number }),
                season: snum,
                episode: ep.episode_number,
                posterUrl: ep.still_path ? IMG_BASE + ep.still_path : "",
                description: ep.overview || "",
              }));
            });
          }
        } catch (_) {}
        if (episodes.length === 0) {
          episodes.push(new Episode({
            name: "S" + (payload.season || 1) + "E" + (payload.episode || 1),
            url: url,
            season: payload.season || 1,
            episode: payload.episode || 1,
          }));
        }
        item.episodes = episodes;
      }

      cb({ success: true, data: item });
    } catch (e) {
      cb({ success: false, errorCode: "LOAD_ERROR", message: e.message });
    }
  }

  async function loadStreams(url, cb) {
    try {
      var payload = JSON.parse(url);
      var tmdbId = payload.tmdbId;
      var type = payload.type || "movie";
      var season = payload.season || 1;
      var episode = payload.episode || 1;

      // Run all 4 source scrapers in parallel (manual allSettled for sandbox compat)
      var scrapers = [
        { fn: scrapeVaplayer, name: "vaplayer.ru" },
        { fn: scrapeEzvidapi, name: "ezvidapi.com" },
        { fn: scrapeVidlink, name: "vidlink.pro" },
        { fn: scrapeVideasy, name: "videasy.net" },
      ];
      var results = [];
      for (var ri = 0; ri < scrapers.length; ri++) {
        try {
          var val = await scrapers[ri].fn(tmdbId, type, season, episode);
          results.push({ status: "fulfilled", value: val, name: scrapers[ri].name });
        } catch (_) {
          results.push({ status: "rejected", value: [], name: scrapers[ri].name });
        }
      }

      var seen = {};
      var streams = [];

      for (var ri = 0; ri < results.length; ri++) {
        var r = results[ri];
        if (r.status !== "fulfilled") continue;
        var sourceStreams = r.value || [];
        var sourceName = r.name;
        for (var si = 0; si < sourceStreams.length; si++) {
          var s = sourceStreams[si];
          if (seen[s.url]) continue;
          seen[s.url] = true;
          var q = s.quality ? (s.quality + " - " + sourceName) : sourceName;
          var streamResult = new StreamResult({
            url: s.url,
            source: q,
            quality: parseInt(s.quality) || (s.quality === "4K" ? 2160 : s.quality === "1080p" ? 1080 : s.quality === "720p" ? 720 : s.quality === "480p" ? 480 : s.quality === "360p" ? 360 : 0),
            type: "hls",
          });
          streams.push(streamResult);
        }
      }

      if (streams.length === 0) {
        cb({ success: true, data: [new StreamResult({
          url: "https://vaplayer.ru/embed/" + type + "/" + tmdbId,
          source: "No working sources - try again later",
        })] });
        return;
      }

      cb({ success: true, data: streams });
    } catch (e) {
      cb({ success: true, data: [new StreamResult({
        url: "https://vaplayer.ru/embed/" + (payload.type || "movie") + "/" + payload.tmdbId,
        source: "Error: " + e.message,
      })] });
    }
  }

  globalThis.getHome = getHome;
  globalThis.search = search;
  globalThis.load = load;
  globalThis.loadStreams = loadStreams;

})();
