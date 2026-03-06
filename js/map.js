// map.js (fixed & hardened for GitHub Pages / mobile browsers)
// Leaflet helpers + routing + geocoding (Nominatim with fallback)

let routeLayer = null;
let myLocMarker = null;

const DEFAULT_TIMEOUT_MS = 12000; // network timeout for fetches (ms)


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
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });

    // If CORS blocks, fetch() throws before this line.
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${res.statusText} — ${txt.slice(0, 120)}`);
    }

    return await res.json();
  } catch (e) {
    // Normalize browser/network errors (e.g., "Failed to fetch")
    const msg = (e && (e.message || e.toString())) ? (e.message || e.toString()) : "Unknown fetch error";
    throw new Error(`FETCH_ERROR: ${msg} @ ${url}`);
  } finally {
    clearTimeout(t);
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


export async function geocodeNominatim(q, limit = 8) {
  q = (q || "").trim();
  if (!q) return [];

  // ✅ اجبار limit يبقى رقم صحيح (حتى لو اتبعت lat/lon بالغلط)
  let lim = Number(limit);
  if (!Number.isFinite(lim)) lim = 8;
  lim = Math.max(1, Math.min(20, Math.round(lim)));

  // 1) Nominatim
  try {
    const url = "https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1"
      + `&limit=${encodeURIComponent(lim)}&q=${encodeURIComponent(q)}`;

    const data = await fetchJson(url, { timeoutMs: 12000 });
    if (Array.isArray(data) && data.length) {
      return data.map(x => ({
        lat: Number(x.lat),
        lon: Number(x.lon),
        text: x.display_name || q
      })).filter(x => Number.isFinite(x.lat) && Number.isFinite(x.lon));
    }
  } catch (e) {
    // كمل على Photon
  }

  // 2) Photon (fallback)
  try {
    const url = `https://photon.komoot.io/api/?limit=${encodeURIComponent(lim)}&q=${encodeURIComponent(q)}`;
    const j = await fetchJson(url, { timeoutMs: 12000 });
    const feats = j?.features || [];
    if (feats.length) {
      return feats.map(f => {
        const c = f?.geometry?.coordinates;
        const lon = Number(c?.[0]);
        const lat = Number(c?.[1]);
        const props = f?.properties || {};
        const name = props.name || props.street || props.city || props.state || q;
        return { lat, lon, text: name };
      }).filter(x => Number.isFinite(x.lat) && Number.isFinite(x.lon));
    }
  } catch (e) {
    // مفيش فوايد
  }

  return [];
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
