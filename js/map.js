// map.js — stable map helpers for Meshwarko

let routeLayer = null;
let myLocMarker = null;

const DEFAULT_TIMEOUT_MS = 12000;
const EGYPT_BOUNDS = {
  minLon: 24.7,
  minLat: 21.7,
  maxLon: 36.0,
  maxLat: 31.8,
};

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function ensureStyles() {
  if (document.getElementById("mw-map-styles")) return;
  const s = document.createElement("style");
  s.id = "mw-map-styles";
  s.textContent = `
    .mw-my-loc-wrap{position:relative;width:42px;height:42px;display:flex;align-items:center;justify-content:center}
    .mw-my-loc-pulse{position:absolute;inset:8px;border-radius:999px;background:rgba(59,130,246,.22);animation:mwPulse 1.8s ease-out infinite}
    .mw-my-loc-pin{position:relative;z-index:2;width:42px;height:42px;border-radius:999px;display:flex;align-items:center;justify-content:center;font-size:24px;filter:drop-shadow(0 2px 6px rgba(0,0,0,.35))}
    .mw-car-wrap{width:42px;height:42px;display:flex;align-items:center;justify-content:center;transition:transform .22s linear;will-change:transform}
    .mw-car-body{width:34px;height:34px;border-radius:999px;background:#111827;border:2px solid #facc15;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(0,0,0,.35);font-size:18px}
    .mw-pick-icon,.mw-drop-icon{width:38px;height:38px;border-radius:999px;display:flex;align-items:center;justify-content:center;font-size:20px;filter:drop-shadow(0 2px 6px rgba(0,0,0,.35))}
    .mw-pick-icon{background:#16a34a;color:#fff}
    .mw-drop-icon{background:#dc2626;color:#fff}
    @keyframes mwPulse{0%{transform:scale(.6);opacity:.8}100%{transform:scale(1.65);opacity:0}}
  `;
  document.head.appendChild(s);
}

function myLocationIconHTML() {
  return `
    <div class="mw-my-loc-wrap">
      <div class="mw-my-loc-pulse"></div>
      <div class="mw-my-loc-pin">📍</div>
    </div>
  `;
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>\"]/g, (m) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
  }[m]));
}

function haversineMeters(a, b) {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  const lat1 = Number(a.lat), lon1 = Number(a.lon);
  const lat2 = Number(b.lat), lon2 = Number(b.lon);
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return Number.POSITIVE_INFINITY;

  const toRad = (x) => x * Math.PI / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const p1 = toRad(lat1);
  const p2 = toRad(lat2);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function fetchJson(url, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "Accept-Language": "ar",
      },
      cache: "no-store",
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${res.statusText} ${text.slice(0, 160)}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function normalizeSearchItem(raw, fallbackTitle = "نتيجة") {
  const title =
    raw?.display_name ||
    raw?.text ||
    raw?.title ||
    raw?.name ||
    raw?.properties?.name ||
    raw?.properties?.street ||
    raw?.properties?.city ||
    fallbackTitle;

  const lat = Number(raw?.lat ?? raw?.geometry?.coordinates?.[1]);
  const lon = Number(raw?.lon ?? raw?.lng ?? raw?.geometry?.coordinates?.[0]);

  return {
    lat,
    lon,
    title,
    text: title,
    display: title,
    raw,
  };
}

function bearingDeg(fromLat, fromLon, toLat, toLon) {
  const toRad = (x) => x * Math.PI / 180;
  const toDeg = (x) => x * 180 / Math.PI;
  const p1 = toRad(fromLat), p2 = toRad(toLat);
  const dLon = toRad(toLon - fromLon);
  const y = Math.sin(dLon) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dLon);
  let deg = toDeg(Math.atan2(y, x));
  if (deg < 0) deg += 360;
  return deg;
}

export function createCarIcon(headingDeg = 0) {
  ensureStyles();
  return L.divIcon({
    className: "mw-car-icon",
    html: `<div class="mw-car-wrap" style="transform:rotate(${headingDeg}deg)"><div class="mw-car-body">🚕</div></div>`,
    iconSize: [42, 42],
    iconAnchor: [21, 21],
  });
}

export function createPickupIcon() {
  ensureStyles();
  return L.divIcon({
    className: "mw-pick-div-icon",
    html: `<div class="mw-pick-icon">⬆️</div>`,
    iconSize: [38, 38],
    iconAnchor: [19, 19],
  });
}

export function createDropoffIcon() {
  ensureStyles();
  return L.divIcon({
    className: "mw-drop-div-icon",
    html: `<div class="mw-drop-icon">🏁</div>`,
    iconSize: [38, 38],
    iconAnchor: [19, 19],
  });
}

export function updateMarkerHeading(marker, headingDeg = 0) {
  const el = marker?.getElement?.();
  const wrap = el?.querySelector?.(".mw-car-wrap");
  if (wrap) wrap.style.transform = `rotate(${headingDeg}deg)`;
}

export function animateMarkerTo(marker, from, to, ms = 900) {
  if (!marker || !from || !to) return;
  const start = performance.now();
  function step(now) {
    const p = Math.min(1, (now - start) / ms);
    const lat = from.lat + (to.lat - from.lat) * p;
    const lon = from.lon + (to.lon - from.lon) * p;
    marker.setLatLng([lat, lon]);
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

export function moveCarMarkerSmooth(marker, from, to, ms = 900) {
  if (!from || !to || !marker) return;
  const heading = bearingDeg(from.lat, from.lon, to.lat, to.lon);
  updateMarkerHeading(marker, heading);
  animateMarkerTo(marker, from, to, ms);
}

export function createMap(el, opts = {}) {
  const center = opts.center || [26.8206, 30.8025];
  const zoom = opts.zoom ?? 6;
  const maxZoom = opts.maxZoom ?? 19;
  const map = L.map(el, { zoomControl: true }).setView(center, zoom);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom,
    attribution: "&copy; OpenStreetMap",
  }).addTo(map);
  window.__mapRef = map;
  return map;
}

export function addMarker(map, latlng, opts = {}) {
  return L.marker(latlng, opts).addTo(map);
}

export function drawRoute(map, geojsonLine, routeRefOrFit = true) {
  let fit = true;
  let routeRef = null;

  if (typeof routeRefOrFit === "boolean") fit = routeRefOrFit;
  else if (routeRefOrFit && typeof routeRefOrFit === "object") routeRef = routeRefOrFit;

  const previous = routeRef?.current || routeLayer;
  if (previous) {
    try { map.removeLayer(previous); } catch (_) {}
  }

  const feature = geojsonLine?.type === "Feature"
    ? geojsonLine
    : { type: "Feature", geometry: geojsonLine, properties: {} };

  const layer = L.geoJSON(feature, {
    style: { weight: 5, opacity: 0.9 },
  }).addTo(map);

  if (routeRef) routeRef.current = layer;
  routeLayer = layer;

  if (fit) {
    try { map.fitBounds(layer.getBounds(), { padding: [30, 30] }); } catch (_) {}
  }

  return layer;
}

export async function routeOSRM(from, to) {
  const straightMeters = haversineMeters(from, to);
  if (Number.isFinite(straightMeters) && straightMeters < 60) {
    const geojson = {
      type: "LineString",
      coordinates: [
        [Number(from.lon), Number(from.lat)],
        [Number(to.lon), Number(to.lat)],
      ],
    };
    return {
      geojson,
      line: geojson,
      distanceMeters: straightMeters,
      durationSec: Math.max(10, straightMeters / 3),
      isFallbackStraightLine: true,
    };
  }

  const url =
    "https://router.project-osrm.org/route/v1/driving/" +
    `${from.lon},${from.lat};${to.lon},${to.lat}` +
    "?overview=full&geometries=geojson&steps=false";

  const j = await fetchJson(url, { timeoutMs: 15000 });
  const route = j?.routes?.[0];
  if (!route?.geometry) throw new Error("OSRM route missing geometry");

  return {
    geojson: route.geometry,
    line: route.geometry,
    distanceMeters: Number(route.distance || 0),
    durationSec: Number(route.duration || 0),
    isFallbackStraightLine: false,
  };
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
  ensureStyles();
  const pan = !!opts.pan;
  const latlng = [Number(loc.lat), Number(loc.lon)];

  if (!myLocMarker) {
    myLocMarker = L.marker(latlng, {
      icon: L.divIcon({
        className: "mw-my-loc-icon",
        html: myLocationIconHTML(),
        iconSize: [42, 42],
        iconAnchor: [21, 21],
      }),
      zIndexOffset: 1000,
    }).addTo(map);
  } else {
    myLocMarker.setLatLng(latlng);
  }

  if (pan) {
    try { map.setView(latlng, Math.max(map.getZoom(), 15)); } catch (_) {}
  }

  return myLocMarker;
}

export async function geocodeNominatim(q, limit = 8, biasLocation = null, options = {}) {
  q = String(q || "").trim();
  if (!q) return [];

  let lim = Number(limit);
  if (!Number.isFinite(lim)) lim = 8;
  lim = clamp(Math.round(lim), 1, 20);

  const countryCode = String(options.countryCode || "eg").toLowerCase();

  // 1) لو عندي موقع المستخدم: ابحث في صندوق صغير حوله فقط
  if (biasLocation?.lat && biasLocation?.lon) {
    const localUrl = new URL("https://nominatim.openstreetmap.org/search");
    localUrl.searchParams.set("format", "jsonv2");
    localUrl.searchParams.set("addressdetails", "1");
    localUrl.searchParams.set("limit", String(lim));
    localUrl.searchParams.set("accept-language", "ar");
    localUrl.searchParams.set("countrycodes", countryCode);
    localUrl.searchParams.set("q", q);

    const dLon = 0.35;
    const dLat = 0.25;

    localUrl.searchParams.set(
      "viewbox",
      `${biasLocation.lon - dLon},${biasLocation.lat + dLat},${biasLocation.lon + dLon},${biasLocation.lat - dLat}`
    );
    localUrl.searchParams.set("bounded", "1");

    try {
      const localData = await fetchJson(localUrl.toString());
      const localItems = (Array.isArray(localData) ? localData : [])
        .map((x) => normalizeSearchItem(x, q))
        .filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lon));

      if (localItems.length) {
        localItems.sort(
          (a, b) => haversineMeters(biasLocation, a) - haversineMeters(biasLocation, b)
        );
        return localItems;
      }
    } catch (_) {}
  }

  // 2) fallback داخل مصر كلها
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", String(lim));
  url.searchParams.set("accept-language", "ar");
  url.searchParams.set("countrycodes", countryCode);
  url.searchParams.set("q", q);
  url.searchParams.set(
    "viewbox",
    `${EGYPT_BOUNDS.minLon},${EGYPT_BOUNDS.maxLat},${EGYPT_BOUNDS.maxLon},${EGYPT_BOUNDS.minLat}`
  );
  url.searchParams.set("bounded", "1");

  try {
    const data = await fetchJson(url.toString());
    const items = (Array.isArray(data) ? data : [])
      .map((x) => normalizeSearchItem(x, q))
      .filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lon));

    if (biasLocation?.lat && biasLocation?.lon) {
      items.sort(
        (a, b) => haversineMeters(biasLocation, a) - haversineMeters(biasLocation, b)
      );
    }

    return items;
  } catch (_) {
    return [];
  }
}

export async function geocodeEG(q, limit = 8, biasLocation = null) {
  return geocodeNominatim(q, limit, biasLocation, { countryCode: "eg" });
}

export function bindSearch(inputEl, resultsEl, onPick, opts = {}) {
  let lastReq = 0;
  let timer = null;
  const limit = opts.limit ?? 6;
  const useEgypt = opts.useEgypt ?? true;
  const getBiasLocation = typeof opts.getBiasLocation === "function" ? opts.getBiasLocation : () => null;
  const countryCode = opts.countryCode || "eg";

  async function runSearch() {
    const q = String(inputEl?.value || "").trim();
    if (!q) {
      if (resultsEl) resultsEl.innerHTML = "";
      resultsEl?.classList?.add("hidden");
      return;
    }

    const reqId = ++lastReq;
    try {
      const bias = getBiasLocation();
      const items = useEgypt
        ? await geocodeEG(q, limit, bias)
        : await geocodeNominatim(q, limit, bias, { countryCode });

      if (reqId !== lastReq || !resultsEl) return;
      resultsEl.innerHTML = "";
      resultsEl.classList.toggle("hidden", items.length === 0);

      items.forEach((it) => {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "search-item";
        row.innerHTML = `<div>${escapeHtml(it.text || it.title)}</div>`;
        row.onclick = () => {
          resultsEl.innerHTML = "";
          resultsEl.classList.add("hidden");
          if (inputEl) inputEl.value = it.text || it.title || "";
          onPick?.(it);
        };
        resultsEl.appendChild(row);
      });
    } catch (e) {
      if (reqId !== lastReq) return;
      console.error("SEARCH ERROR:", e);
      if (resultsEl) {
        resultsEl.innerHTML = "";
        resultsEl.classList.add("hidden");
      }
    }
  }

  const onInput = () => {
    clearTimeout(timer);
    timer = setTimeout(runSearch, 350);
  };

  inputEl?.addEventListener("input", onInput);
  inputEl?.addEventListener("change", runSearch);

  return () => {
    clearTimeout(timer);
    inputEl?.removeEventListener("input", onInput);
    inputEl?.removeEventListener("change", runSearch);
  };
}
