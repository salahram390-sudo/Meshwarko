import { debounce } from "./utils.js";

export function createMap(mapElId, options = {}) {
  const map = L.map(mapElId, { zoomControl: true, preferCanvas: true })
    .setView(options.center ?? [26.56, 31.70], options.zoom ?? 13);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 20,
  attribution: "&copy; OpenStreetMap",
}).addTo(map);

  return map;
}

export function addMarker(map, latlng, opts = {}) {
  const m = L.marker(latlng, { draggable: !!opts.draggable }).addTo(map);
  return m;
}

export async function geocodeNominatim(query) {
  const q = (query || "").trim();
  if (!q) return [];
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "6");
  url.searchParams.set("q", q);

  const res = await fetch(url.toString(), { headers: { "Accept-Language": "ar" } });
  if (!res.ok) return [];
  const data = await res.json();
  return (data || []).map(x => ({
    display: x.display_name,
    lat: Number(x.lat),
    lon: Number(x.lon),
  })).filter(x => Number.isFinite(x.lat) && Number.isFinite(x.lon));
}

export function bindSearch(inputEl, resultsEl, onPick) {
  const render = (items) => {
    resultsEl.innerHTML = "";
    if (!items.length) {
      resultsEl.classList.add("hidden");
      return;
    }
    for (const it of items) {
      const div = document.createElement("div");
      div.className = "search-item";
      div.textContent = it.display;
      div.onclick = () => {
        resultsEl.classList.add("hidden");
        resultsEl.innerHTML = "";
        onPick(it);
      };
      resultsEl.appendChild(div);
    }
    resultsEl.classList.remove("hidden");
  };

  const doSearch = debounce(async () => {
    const items = await geocodeNominatim(inputEl.value);
    render(items);
  }, 350);

  inputEl.addEventListener("input", doSearch);
  // اختيار أول نتيجة بالـ Enter
  inputEl.addEventListener("keydown", async (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const items = await geocodeNominatim(inputEl.value);
    if (items && items[0]) {
      resultsEl.classList.add("hidden");
      resultsEl.innerHTML = "";
      onPick(items[0]);
    }
  });
  inputEl.addEventListener("blur", () => setTimeout(() => resultsEl.classList.add("hidden"), 200));
}

export async function routeOSRM(p1, p2) {
  const url = new URL(`https://router.project-osrm.org/route/v1/driving/${p1.lon},${p1.lat};${p2.lon},${p2.lat}`);
  url.searchParams.set("overview", "full");
  url.searchParams.set("geometries", "geojson");

  const res = await fetch(url.toString());
  if (!res.ok) throw new Error("فشل رسم المسار");
  const data = await res.json();
  if (!data.routes || !data.routes[0]) throw new Error("لا يوجد مسار");

  const r = data.routes[0];
  return { distanceMeters: r.distance, durationSec: r.duration, geojson: r.geometry };
}

export function drawRoute(map, geojson, layerRef) {
  if (layerRef.current) {
    map.removeLayer(layerRef.current);
    layerRef.current = null;
  }
  const layer = L.geoJSON(geojson, { style: { weight: 5, opacity: 0.9 } }).addTo(map);
  layerRef.current = layer;

  const latlngs = [];
  layer.eachLayer(l => {
    if (l.getLatLngs) for (const pt of l.getLatLngs()) latlngs.push(pt);
  });
  if (latlngs.length) map.fitBounds(L.latLngBounds(latlngs).pad(0.15));
}

let myLocMarker = null;
export function showMyLocation(map, loc) {
  if (!loc) return;

  const latlng = [loc.lat, loc.lon];

  if (!myLocMarker) {
    myLocMarker = L.circleMarker(latlng, {
      radius: 8,
      color: "#2e7df6",
      fillColor: "#2e7df6",
      fillOpacity: 0.9
    }).addTo(map);
  } else {
    myLocMarker.setLatLng(latlng);
  }
}
export function locateOnce(map, onLocated) {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition((pos) => {
    const lat = pos.coords.latitude;
    const lon = pos.coords.longitude;
    map.setView([lat, lon], 15);
    onLocated?.({ lat, lon });
  }, () => {}, { enableHighAccuracy: true, timeout: 8000 });
}
