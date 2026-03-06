// map.js — cleaned and hardened for Meshwarko
// Supports:
// - createMap / addMarker / drawRoute / routeOSRM
// - locateOnce / showMyLocation
// - geocodeNominatim / geocodeEG / bindSearch

let routeLayer = null;
let myLocMarker = null;
let myLocPulse = null;

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

function esc(str) {
  return String(str ?? "").replace(/[&<>\"]/g, (m) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
  }[m]));
}

function haversineMeters(a, b) {
  if (!a?.lat || !a?.lon || !b?.lat || !b?.lon) return Number.POSITIVE_INFINITY;
  const toRad = (x) => x * Math.PI / 180;
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLon / 2);
  const h = s1 * s1 + Math.cos(lat1) * Math.cos(lat2) * s2 * s2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

async function fetchJson(url, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'ar',
      },
      signal: controller.signal,
      cache: 'no-store',
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status} ${res.statusText} — ${txt.slice(0, 160)}`);
    }

    return await res.json();
  } catch (e) {
    const msg = e?.message || String(e);
    throw new Error(`FETCH_ERROR: ${msg}`);
  } finally {
    clearTimeout(t);
  }
}

function normalizeItem(raw, fallbackTitle = 'نتيجة') {
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
    title,
    text: title,
    display: title,
    lat,
    lon,
    raw,
  };
}


function bearingDeg(fromLat, fromLon, toLat, toLon) {
  const toRad = (x) => x * Math.PI / 180;
  const toDeg = (x) => x * 180 / Math.PI;
  const φ1 = toRad(fromLat), φ2 = toRad(toLat);
  const Δλ = toRad(toLon - fromLon);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  let θ = toDeg(Math.atan2(y, x));
  if (θ < 0) θ += 360;
  return θ;
}

function myLocationIconHTML() {
  return `
    <div class="mw-my-loc-wrap">
      <div class="mw-my-loc-pulse"></div>
      <div class="mw-my-loc-pin">📍</div>
    </div>
  `;
}

function ensureSharedMapStyles() {
  if (document.getElementById('mw-map-shared-styles')) return;
  const style = document.createElement('style');
  style.id = 'mw-map-shared-styles';
  style.textContent = `
    .mw-my-loc-wrap{position:relative;width:42px;height:42px;display:flex;align-items:center;justify-content:center;}
    .mw-my-loc-pulse{position:absolute;inset:8px;border-radius:999px;background:rgba(59,130,246,.22);animation:mwPulse 1.8s ease-out infinite;}
    .mw-my-loc-pin{position:relative;z-index:2;width:42px;height:42px;border-radius:999px;display:flex;align-items:center;justify-content:center;font-size:24px;filter:drop-shadow(0 2px 6px rgba(0,0,0,.35));}
    .mw-car-wrap{width:40px;height:40px;display:flex;align-items:center;justify-content:center;transition:transform .25s linear;will-change:transform;}
    .mw-car-body{width:34px;height:34px;border-radius:999px;background:#111827;border:2px solid #facc15;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(0,0,0,.35);font-size:18px;}
    @keyframes mwPulse{0%{transform:scale(.6);opacity:.8}100%{transform:scale(1.65);opacity:0}}
  `;
  document.head.appendChild(style);
}

export function createCarIcon(headingDeg = 0) {
  ensureSharedMapStyles();
  return L.divIcon({
    className: 'mw-car-icon',
    html: `<div class="mw-car-wrap" style="transform:rotate(${headingDeg}deg)"><div class="mw-car-body">🚕</div></div>`,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  });
}

export function updateMarkerHeading(marker, headingDeg = 0) {
  const el = marker?.getElement?.();
  const body = el?.querySelector?.('.mw-car-wrap');
  if (body) body.style.transform = `rotate(${headingDeg}deg)`;
}

export function animateMarkerTo(marker, from, to, ms = 900) {
  if (!marker || !from || !to) return;
  const start = performance.now();
  function step(t) {
    const p = Math.min(1, (t - start) / ms);
    const lat = from.lat + (to.lat - from.lat) * p;
    const lon = from.lon + (to.lon - from.lon) * p;
    marker.setLatLng([lat, lon]);
    if (p < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

export function moveCarMarkerSmooth(marker, from, to, ms = 900) {
  const heading = bearingDeg(from.lat, from.lon, to.lat, to.lon);
  updateMarkerHeading(marker, heading);
  animateMarkerTo(marker, from, to, ms);
}

export function createMap(el, opts = {}) {
  const {
    center = [26.8206, 30.8025],
    zoom = 6,
    maxZoom = 19,
  } = opts;

  const map = L.map(el, { zoomControl: true }).setView(center, zoom);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom,
    attribution: '&copy; OpenStreetMap',
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

  if (typeof routeRefOrFit === 'boolean') {
    fit = routeRefOrFit;
  } else if (routeRefOrFit && typeof routeRefOrFit === 'object') {
    routeRef = routeRefOrFit;
    fit = true;
  }

  const prev = routeRef?.current || routeLayer;
  if (prev) {
    try { map.removeLayer(prev); } catch (_) {}
  }

  const feature = geojsonLine?.type === 'Feature'
    ? geojsonLine
    : { type: 'Feature', geometry: geojsonLine, properties: {} };

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
  const url =
    'https://router.project-osrm.org/route/v1/driving/' +
    `${from.lon},${from.lat};${to.lon},${to.lat}` +
    '?overview=full&geometries=geojson&steps=false';

  const j = await fetchJson(url, { timeoutMs: 15000 });
  const route = j?.routes?.[0];
  if (!route?.geometry) throw new Error('OSRM route missing geometry');

  return {
    geojson: route.geometry,
    line: route.geometry,
    distanceMeters: Number(route.distance || 0),
    durationSec: Number(route.duration || 0),
  };
}

export function locateOnce(map, onLoc, onErr) {
  map.locate({ setView: false, watch: false, enableHighAccuracy: true, maxZoom: 18 });

  const ok = (e) => {
    map.off('locationfound', ok);
    map.off('locationerror', bad);
    onLoc?.({ lat: e.latitude, lon: e.longitude, accuracy: e.accuracy });
  };

  const bad = (e) => {
    map.off('locationfound', ok);
    map.off('locationerror', bad);
    onErr?.(e);
  };

  map.on('locationfound', ok);
  map.on('locationerror', bad);
}

export function showMyLocation(map, loc, opts = {}) {
  ensureSharedMapStyles();
  const { pan = false } = opts;
  const latlng = [loc.lat, loc.lon];

  if (!myLocMarker) {
    myLocMarker = L.marker(latlng, {
      icon: L.divIcon({
        className: 'mw-my-loc-icon',
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
  q = String(q || '').trim();
  if (!q) return [];

  let lim = Number(limit);
  if (!Number.isFinite(lim)) lim = 8;
  lim = clamp(Math.round(lim), 1, 20);

  const countryCode = String(options.countryCode || 'eg').toLowerCase();
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('limit', String(lim));
  url.searchParams.set('accept-language', 'ar');
  url.searchParams.set('countrycodes', countryCode);
  url.searchParams.set('q', q);

  if (biasLocation?.lat && biasLocation?.lon) {
    const dLon = 1.2;
    const dLat = 1.0;
    const left = biasLocation.lon - dLon;
    const top = biasLocation.lat + dLat;
    const right = biasLocation.lon + dLon;
    const bottom = biasLocation.lat - dLat;
    url.searchParams.set('viewbox', `${left},${top},${right},${bottom}`);
    url.searchParams.set('bounded', '0');
  } else {
    url.searchParams.set('viewbox', `${EGYPT_BOUNDS.minLon},${EGYPT_BOUNDS.maxLat},${EGYPT_BOUNDS.maxLon},${EGYPT_BOUNDS.minLat}`);
    url.searchParams.set('bounded', '0');
  }

  try {
    const data = await fetchJson(url.toString());
    const items = (Array.isArray(data) ? data : [])
      .map((x) => normalizeItem(x, q))
      .filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lon));

    if (!items.length) return [];

    if (biasLocation?.lat && biasLocation?.lon) {
      items.sort((a, b) => haversineMeters(biasLocation, a) - haversineMeters(biasLocation, b));
    }

    return items;
  } catch (_) {
    // Photon fallback
    const p = new URL('https://photon.komoot.io/api/');
    p.searchParams.set('limit', String(lim));
    p.searchParams.set('q', q);
    if (biasLocation?.lat && biasLocation?.lon) {
      p.searchParams.set('lat', String(biasLocation.lat));
      p.searchParams.set('lon', String(biasLocation.lon));
    }

    const j = await fetchJson(p.toString());
    const feats = j?.features || [];
    const items = feats
      .map((f) => normalizeItem(f, q))
      .filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lon));

    if (biasLocation?.lat && biasLocation?.lon) {
      items.sort((a, b) => haversineMeters(biasLocation, a) - haversineMeters(biasLocation, b));
    }

    return items;
  }
}

export async function geocodeEG(q, limit = 8, biasLocation = null) {
  return geocodeNominatim(q, limit, biasLocation, { countryCode: 'eg' });
}

export function bindSearch(inputEl, resultsEl, onPick, opts = {}) {
  let lastReq = 0;
  let t = null;
  const limit = opts.limit ?? 6;
  const useEgypt = opts.useEgypt ?? true;
  const getBiasLocation = typeof opts.getBiasLocation === 'function' ? opts.getBiasLocation : () => null;
  const countryCode = opts.countryCode || 'eg';

  async function runSearch() {
    const q = String(inputEl?.value || '').trim();
    if (!q) {
      if (resultsEl) resultsEl.innerHTML = '';
      return;
    }

    const reqId = ++lastReq;
    try {
      const bias = getBiasLocation();
      const items = useEgypt
        ? await geocodeEG(q, limit, bias)
        : await geocodeNominatim(q, limit, bias, { countryCode });

      if (reqId !== lastReq || !resultsEl) return;
      resultsEl.innerHTML = '';

      items.forEach((it) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'search-item';
        row.innerHTML = `<div>${esc(it.text || it.title)}</div>`;
        row.onclick = () => {
          resultsEl.innerHTML = '';
          if (inputEl) inputEl.value = it.text || it.title || '';
          onPick?.(it);
        };
        resultsEl.appendChild(row);
      });
    } catch (e) {
      if (reqId !== lastReq) return;
      console.error('SEARCH ERROR:', e);
      if (resultsEl) resultsEl.innerHTML = '';
    }
  }

  const onInput = () => {
    clearTimeout(t);
    t = setTimeout(runSearch, 350);
  };

  inputEl?.addEventListener('input', onInput);
  inputEl?.addEventListener('change', runSearch);

  return () => {
    clearTimeout(t);
    inputEl?.removeEventListener('input', onInput);
    inputEl?.removeEventListener('change', runSearch);
  };
}
