// map.js (fixed & hardened for GitHub Pages / mobile browsers)
// Leaflet helpers + routing + geocoding (Nominatim with fallback)

let routeLayer = null;
let myLocMarker = null;

export function createMap(el, opts = {}) {
  const {
    center = [26.8206, 30.8025], // Egypt
    zoom = 6,
    maxZoom = 19
  } = opts;

  const map = L.map(el, { zoomControl: true }).setView(center, zoom);

  // OSM tiles
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom,
    attribution: '&copy; OpenStreetMap'
  }).addTo(map);

  return map;
}

export function addMarker(map, latlng, opts = {}) {
  const m = L.marker(latlng, opts).addTo(map);
  return m;
}

export function drawRoute(map, geojsonLine, fit = true) {
  // geojsonLine: { type:"LineString", coordinates:[[lon,lat],...] } OR GeoJSON Feature
  if (routeLayer) {
    map.removeLayer(routeLayer);
    routeLayer = null;
  }

  const feature = geojsonLine.type === "Feature"
    ? geojsonLine
    : { type: "Feature", geometry: geojsonLine, properties: {} };

  routeLayer = L.geoJSON(feature, {
    style: { weight: 5, opacity: 0.9 }
  }).addTo(map);

  if (fit) {
    try {
      map.fitBounds(routeLayer.getBounds(), { padding: [30, 30] });
    } catch (_) {}
  }

  return routeLayer;
}

export async function routeOSRM(from, to) {
  // from/to: {lat, lon}
  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${from.lon},${from.lat};${to.lon},${to.lat}` +
    `?overview=full&geometries=geojson&steps=false`;

  const r = await fetch(url, { method: "GET" });
  if (!r.ok) throw new Error("OSRM route failed");
  const j = await r.json();
  const route = j?.routes?.[0];
  if (!route?.geometry) throw new Error("OSRM route missing geometry");

  return {
    line: route.geometry,              // GeoJSON LineString
    distanceMeters: route.distance,    // meters
    durationSec: route.duration        // seconds
  };
}

export function locateOnce(map, onLoc, onErr) {
  // Uses Leaflet locate
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

  // simple circle marker to avoid any broken html/icon strings
  if (!myLocMarker) {
    myLocMarker = L.circleMarker(latlng, {
      radius: 8,
      weight: 2,
      opacity: 1,
      fillOpacity: 0.9
    }).addTo(map);
  } else {
    myLocMarker.setLatLng(latlng);
  }

  if (pan) {
    try { map.setView(latlng, Math.max(map.getZoom(), 15)); } catch (_) {}
  }

  return myLocMarker;
}

// ---------------------- Geocoding ----------------------

function withTimeout(ms = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, done: () => clearTimeout(t) };
}

async function fetchJson(url) {
  const { signal, done } = withTimeout(9000);
  try {
    const r = await fetch(url, { method: "GET", signal, headers: { "Accept": "application/json" } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    done();
  }
}

function normItem(it) {
  // normalize to { title, lat, lon, raw }
  const title =
    it.display_name ||
    it.name ||
    it?.properties?.name ||
    it?.properties?.street ||
    "نتيجة";

  const lat = Number(it.lat ?? it?.geometry?.coordinates?.[1]);
  const lon = Number(it.lon ?? it?.geometry?.coordinates?.[0]);

  return { title, lat, lon, raw: it };
}

export async function geocodeNominatim(q, limit = 5) {
  const query = String(q || "").trim();
  if (!query) return [];

  // 1) Nominatim
  const url1 =
    `https://nominatim.openstreetmap.org/search?` +
    `format=jsonv2&addressdetails=1&limit=${limit}&q=${encodeURIComponent(query)}`;

  try {
    const j = await fetchJson(url1);
    if (Array.isArray(j)) return j.map(normItem).filter(x => Number.isFinite(x.lat) && Number.isFinite(x.lon));
  } catch (e) {
    // fall through to fallback
  }

  // 2) Fallback: Photon (Komoot) – usually CORS-friendly
  const url2 =
    `https://photon.komoot.io/api/?limit=${limit}&q=${encodeURIComponent(query)}`;

  const j2 = await fetchJson(url2);
  const feats = j2?.features || [];
  return feats.map(normItem).filter(x => Number.isFinite(x.lat) && Number.isFinite(x.lon));
}

export async function geocodeEG(q, limit = 5) {
  const query = String(q || "").trim();
  if (!query) return [];

  // Try Nominatim narrowed to Egypt first
  const url1 =
    `https://nominatim.openstreetmap.org/search?` +
    `format=jsonv2&addressdetails=1&limit=${limit}` +
    `&countrycodes=eg&q=${encodeURIComponent(query)}`;

  try {
    const j = await fetchJson(url1);
    if (Array.isArray(j)) return j.map(normItem).filter(x => Number.isFinite(x.lat) && Number.isFinite(x.lon));
  } catch (_) {}

  // Fallback to photon with Egypt bias (not perfect but helps)
  const url2 =
    `https://photon.komoot.io/api/?limit=${limit}` +
    `&q=${encodeURIComponent(query + " مصر")}`;

  const j2 = await fetchJson(url2);
  const feats = j2?.features || [];
  return feats.map(normItem).filter(x => Number.isFinite(x.lat) && Number.isFinite(x.lon));
}

export function bindSearch(inputEl, resultsEl, onPick, opts = {}) {
  const { minChars = 3, limit = 6, useEgypt = true } = opts;

  let lastReq = 0;

  async function runSearch() {
    const q = (inputEl?.value || "").trim();
    if (q.length < minChars) {
      if (resultsEl) resultsEl.innerHTML = "";
      return;
    }

    const reqId = ++lastReq;
    try {
      const items = useEgypt ? await geocodeEG(q, limit) : await geocodeNominatim(q, limit);
      if (reqId !== lastReq) return;

      if (!resultsEl) return;
      resultsEl.innerHTML = "";

      items.forEach((it) => {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "search-item";
        row.textContent = it.title;
        row.onclick = () => {
          resultsEl.innerHTML = "";
          inputEl.value = it.title;
          onPick?.(it);
        };
        resultsEl.appendChild(row);
      });
    } catch (e) {
      if (reqId !== lastReq) return;
      console.error("SEARCH ERROR:", e);
      if (resultsEl) resultsEl.innerHTML = "";
      // let caller show toast if needed
      throw e;
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
