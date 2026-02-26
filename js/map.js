let userLat = null;
let userLon = null;
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

function normGov(s) {
  return (s || "")
    .toString()
    .replace(/محافظة\s*/g, "")
    .replace(/Governorate/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export async function geocodeNominatim(query, userLat, userLon) {
  query = (query || "").trim();
  if (!query) return [];

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "json");
  url.searchParams.set("q", query);
  url.searchParams.set("countrycodes", "eg");
  url.searchParams.set("limit", "20");
  url.searchParams.set("addressdetails", "1"); // ✅ مهم

  const res = await fetch(url.toString(), { headers: { "Accept-Language": "ar" } });
  if (!res.ok) return [];

  const data = await res.json();

  let results = (data || []).map(x => ({
    display: x.display_name,
    lat: Number(x.lat),
    lon: Number(x.lon),
    gov:
  x?.address?.state ||
  x?.address?.governorate ||
  x?.address?.county ||
  x?.address?.region ||
  null
  })).filter(x => Number.isFinite(x.lat) && Number.isFinite(x.lon));

  // ✅ فلترة نفس المحافظة
  if (userGov) {
    const ug = normGov(userGov);
    const filtered = results.filter(r => normGov(r.gov) === ug);

    // لو مفيش ولا نتيجة في نفس المحافظة: نرجّع النتائج الأصلية (اختياري)
    if (filtered.length) results = filtered;
  }

  // (اختياري) ترتيب أقرب داخل نفس المحافظة
  if (userLat && userLon) {
    results.sort((a, b) =>
      haversine(userLat, userLon, a.lat, a.lon) - haversine(userLat, userLon, b.lat, b.lon)
    );
  }

  return results;
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = x => x * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat/2) ** 2 +
    Math.cos(toRad(lat1)) *
    Math.cos(toRad(lat2)) *
    Math.sin(dLon/2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export async function geocodeEG(query){
  const url =
    "https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=eg&q=" +
    encodeURIComponent(query);

  const res = await fetch(url, { headers: { "Accept-Language": "ar" }});
  const data = await res.json();
  if (!data?.length) return null;
  return { lat: +data[0].lat, lon: +data[0].lon, display: data[0].display_name };
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
    const items = await geocodeNominatim(inputEl.value, userLat, userLon);
    render(items);
  }, 350);

  inputEl.addEventListener("input", doSearch);
  // اختيار أول نتيجة بالـ Enter
  inputEl.addEventListener("keydown", async (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const items = await geocodeNominatim(inputEl.value, userLat, userLon);
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
   const myLocIcon = L.divIcon({
  className: "gps-marker",
  html: "<div class='gps-dot'></div>",
  iconSize: [30, 30],
  iconAnchor: [15, 15]
});

if (!myLocMarker) {
  myLocMarker = L.marker(latlng, { icon: myLocIcon }).addTo(map);
} else {
  myLocMarker.setLatLng(latlng);
}
    
  } else {
    myLocMarker.setLatLng(latlng);
  }
}
let userGov = null;

async function reverseGov(lat, lon) {
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("format", "json");
  url.searchParams.set("lat", lat);
  url.searchParams.set("lon", lon);
  url.searchParams.set("zoom", "10"); // مستوى محافظة
  url.searchParams.set("addressdetails", "1");

  const res = await fetch(url.toString(), { headers: { "Accept-Language": "ar" } });
  if (!res.ok) return null;

  const data = await res.json();
  const a = data?.address || {};
  return a.state || a.county || null; // غالباً state = المحافظة في مصر
}

export function locateOnce(map, onLocated) {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(async (pos) => {
    const lat = pos.coords.latitude;
    const lon = pos.coords.longitude;

    userLat = lat;
    userLon = lon;

    userGov = await reverseGov(lat, lon);   // ✅ هنا بنحفظ المحافظة

    map.setView([lat, lon], 15);
    onLocated?.({ lat, lon });
  }, () => {}, { enableHighAccuracy: true, timeout: 8000 });
}
