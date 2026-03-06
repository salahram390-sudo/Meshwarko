// map.js (clean + hardened for GitHub Pages / mobile)
// Leaflet helpers + OSRM routing + Geocoding + bindSearch

let myLocMarker = null;

const DEFAULT_TIMEOUT_MS = 12000;

// ---------------------- Map ----------------------

export function createMap(el, opts = {}) {
  const {
    center = [26.8206, 30.8025], // Egypt
    zoom = 6,
    maxZoom = 19,
  } = opts;

  const map = L.map(el, { zoomControl: true }).setView(center, zoom);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom,
    attribution: "&copy; OpenStreetMap",
  }).addTo(map);

  // expose (optional)
  window.__mapRef = map;

  return map;
}

export function addMarker(map, latlng, opts = {}) {
  return L.marker(latlng, opts).addTo(map);
}

/**
 * drawRoute(map, geojson, layerRef?, fit=true)
 * - geojson: Feature OR LineString OR FeatureCollection
 * - layerRef: { current: L.Layer|null } (optional)
 */
export function drawRoute(map, geojson, layerRef = null, fit = true) {
  // remove old
  try {
    if (layerRef?.current) {
      map.removeLayer(layerRef.current);
      layerRef.current = null;
    }
  } catch (_) {}

  const feature =
    geojson?.type === "Feature" || geojson?.type === "FeatureCollection"
      ? geojson
      : { type: "Feature", geometry: geojson, properties: {} };

  const layer = L.geoJSON(feature, { style: { weight: 5, opacity: 0.9 } }).addTo(map);

  if (layerRef) layerRef.current = layer;

  if (fit) {
    try {
      map.fitBounds(layer.getBounds(), { padding: [30, 30] });
    } catch (_) {}
  }

  return layer;
}

export function locateOnce(map, onLoc, onErr) {
  map.locate({ setView: false, watch: false, enableHighAccuracy: true, maxZoom: 18 });

  const ok = (e) => {
    map.off("locationfound", ok);
    map.off("locationerror", bad);
    onLoc?.({ lat: e.latitude, lon: e.longitude, accuracy: e.accuracy });
  };

  const bad = (e) => {
    map.off("locationfound", ok);
    map.off("locationerror", bad);
    onErr?.(e);
  };

  map.on("locationfound", ok);
  map.on("locationerror", bad);
}

export function showMyLocation(map, loc, opts = {}) {
  const { pan = true } = opts;
  const latlng = [loc.lat, loc.lon];

  if (!myLocMarker) {
    myLocMarker = L.circleMarker(latlng, {
      radius: 8,
      weight: 2,
      opacity: 1,
      fillOpacity: 0.9,
    }).addTo(map);
  } else {
    myLocMarker.setLatLng(latlng);
  }

  if (pan) {
    try {
      map.setView(latlng, Math.max(map.getZoom(), 15));
    } catch (_) {}
  }

  return myLocMarker;
}

// ---------------------- Networking ----------------------

async function fetchJson(url, opts = {}) {
  const timeoutMs = Number(opts.timeoutMs || DEFAULT_TIMEOUT_MS);
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        ...(opts.headers || {}),
      },
      signal: controller.signal,
      cache: "no-store",
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${res.statusText} — ${txt.slice(0, 120)}`);
    }

    return await res.json();
  } catch (e) {
    const msg = e?.message || String(e);
    throw new Error(`FETCH_ERROR: ${msg} @ ${url}`);
  } finally {
    clearTimeout(t);
  }
}

// ---------------------- Routing (OSRM) ----------------------

export async function routeOSRM(from, to) {
  // from/to: {lat, lon}
  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${from.lon},${from.lat};${to.lon},${to.lat}` +
    `?overview=full&geometries=geojson&steps=false`;

  const j = await fetchJson(url, { timeoutMs: 15000 });
  const route = j?.routes?.[0];
  if (!route?.geometry) throw new Error("OSRM route missing geometry");

  return {
    geojson: route.geometry,          // ✅ LineString (geojson)
    distanceMeters: route.distance,   // meters
    durationSec: route.duration,      // seconds
  };
}

// ---------------------- Geocoding ----------------------

// helper: parse args so it supports both:
// geocodeNominatim(q, 8)
// geocodeNominatim(q, lat, lon)
// geocodeNominatim(q, lat, lon, 8)
function parseGeoArgs(limitOrLat, lon, limit) {
  let latBias = null;
  let lonBias = null;
  let lim = 8;

  // geocodeNominatim(q, 8)
  if (typeof lon === "undefined" && typeof limit === "undefined") {
    const n = Number(limitOrLat);
    if (Number.isFinite(n)) lim = n;
    return { latBias, lonBias, lim };
  }

  // geocodeNominatim(q, lat, lon)
  const latN = Number(limitOrLat);
  const lonN = Number(lon);
  if (Number.isFinite(latN) && Number.isFinite(lonN)) {
    latBias = latN;
    lonBias = lonN;
  }

  // limit optional
  const limN = Number(limit);
  if (Number.isFinite(limN)) lim = limN;

  return { latBias, lonBias, lim };
}

function clampLimit(n) {
  let lim = Number(n);
  if (!Number.isFinite(lim)) lim = 8;
  lim = Math.max(1, Math.min(20, Math.round(lim)));
  return lim;
}

/**
 * geocodeEG(q, lat?, lon?, limit=8)
 * - Egypt-focused: countrycodes=eg
 */
export async function geocodeEG(q, lat, lon, limit = 8) {
  return geocodeNominatim(q, lat, lon, limit, { countrycodes: "eg" });
}

/**
 * geocodeNominatim(q, lat?, lon?, limit=8)
 * Works with:
 * - geocodeNominatim(q, 8)
 * - geocodeNominatim(q, lat, lon)
 * - geocodeNominatim(q, lat, lon, 8)
 */
export async function geocodeNominatim(q, limitOrLat = 8, lon, limit, extra = null) {
  q = (q || "").trim();
  if (!q) return [];

  const { latBias, lonBias, lim } = parseGeoArgs(limitOrLat, lon, limit);
  const L = clampLimit(lim);

  // 1) Nominatim
  try {
    const u = new URL("https://nominatim.openstreetmap.org/search");
    u.searchParams.set("format", "jsonv2");
    u.searchParams.set("addressdetails", "1");
    u.searchParams.set("limit", String(L));
    u.searchParams.set("q", q);

    // bias near user (not perfect but helps)
    if (Number.isFinite(latBias) && Number.isFinite(lonBias)) {
      // make a small viewbox around user to prefer near results
      const d = 0.35; // ~ 35km-45km depending
      const left = lonBias - d;
      const right = lonBias + d;
      const top = latBias + d;
      const bottom = latBias - d;
      u.searchParams.set("viewbox", `${left},${top},${right},${bottom}`);
      u.searchParams.set("bounded", "0"); // prefer near but allow others
    }

    if (extra?.countrycodes) u.searchParams.set("countrycodes", extra.countrycodes);

    const data = await fetchJson(u.toString(), {
      timeoutMs: 12000,
      headers: { "Accept-Language": "ar" },
    });

    if (Array.isArray(data) && data.length) {
      return data
        .map((x) => ({
          lat: Number(x.lat),
          lon: Number(x.lon),
          title: x.display_name || q,
          text: x.display_name || q,
          raw: x,
        }))
        .filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lon));
    }
  } catch (_) {
    // fallback
  }

  // 2) Photon fallback
  try {
    const u = new URL("https://photon.komoot.io/api/");
    u.searchParams.set("limit", String(L));
    u.searchParams.set("q", q);

    if (Number.isFinite(latBias) && Number.isFinite(lonBias)) {
      u.searchParams.set("lat", String(latBias));
      u.searchParams.set("lon", String(lonBias));
    }

    const j = await fetchJson(u.toString(), { timeoutMs: 12000 });
    const feats = j?.features || [];
    if (feats.length) {
      return feats
        .map((f) => {
          const c = f?.geometry?.coordinates;
          const lon2 = Number(c?.[0]);
          const lat2 = Number(c?.[1]);
          const props = f?.properties || {};
          const name =
            props.name ||
            props.street ||
            props.city ||
            props.state ||
            props.country ||
            q;

          return { lat: lat2, lon: lon2, title: name, text: name, raw: f };
        })
        .filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lon));
    }
  } catch (_) {}

  return [];
}

// ---------------------- bindSearch ----------------------

/**
 * bindSearch(inputEl, resultsEl, onPick, opts?)
 * - shows dropdown results and calls onPick(item)
 * item contains: {lat, lon, title/text, raw}
 */
export function bindSearch(inputEl, resultsEl, onPick, opts = {}) {
  const limit = clampLimit(opts.limit ?? 8);
  const useEgypt = opts.useEgypt ?? false;
  const getBias = opts.getBias; // () => ({lat, lon}) optional

  let lastReq = 0;

  async function runSearch() {
    const q = (inputEl?.value || "").trim();
    if (!q) {
      if (resultsEl) resultsEl.innerHTML = "";
      return;
    }

    const bias = typeof getBias === "function" ? getBias() : null;
    const lat = bias?.lat;
    const lon = bias?.lon;

    const reqId = ++lastReq;

    try {
      const items = useEgypt
        ? await geocodeEG(q, lat, lon, limit)
        : await geocodeNominatim(q, lat, lon, limit);

      if (reqId !== lastReq) return;

      if (!resultsEl) return;
      resultsEl.innerHTML = "";

      items.forEach((it) => {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "search-item";
        row.textContent = it.title || it.text || q;

        row.onclick = () => {
          resultsEl.innerHTML = "";
          inputEl.value = it.title || it.text || q;
          onPick?.(it);
        };

        resultsEl.appendChild(row);
      });
    } catch (e) {
      if (reqId !== lastReq) return;
      console.error("SEARCH ERROR:", e);
      if (resultsEl) resultsEl.innerHTML = "";
    }
  }

  let t = null;
  const onInput = () => {
    clearTimeout(t);
    t = setTimeout(runSearch, 350);
  };

  inputEl?.addEventListener("input", onInput);
  inputEl?.addEventListener("change", runSearch);

  // return unbind
  return () => {
    clearTimeout(t);
    inputEl?.removeEventListener("input", onInput);
    inputEl?.removeEventListener("change", runSearch);
  };
}
