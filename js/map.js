let userLat = null;
let userLon = null;
let userGov = null;
let userCenter = null; // new
import { debounce } from "./utils.js";

export function createMap(mapElId, options = {}) {
  const map = L.map(mapElId, { zoomControl: true, preferCanvas: true })
    .setView(options.center ?? [26.56, 31.70], options.zoom ?? 13);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '© OpenStreetMap'
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

export async function geocodeNominatim(query, userLat, userLon, userGov, userCenter) {
  query = (query || "").trim();
  if (!query) return [];

  const lat = Number(userLat);
  const lon = Number(userLon);
  const hasUserLoc = Number.isFinite(lat) && Number.isFinite(lon);

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "json");
  url.searchParams.set("q", query);
  url.searchParams.set("countrycodes", "eg");
  url.searchParams.set("limit", "20");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("dedupe", "1");

  // ✅ اجبره يدوّر حوالين المستخدم
  if (hasUserLoc) {
    // حوالي 15 كم كبداية (ممكن تزودها)
    const radiusKm = 15;

    // تحويل km لدرجات (تقريب مناسب)
    const dLat = radiusKm / 111; // 1 درجة لات ≈ 111 كم
    const dLon = radiusKm / (111 * Math.cos((lat * Math.PI) / 180));

    const left = lon - dLon;
    const right = lon + dLon;
    const top = lat + dLat;
    const bottom = lat - dLat;

    url.searchParams.set("viewbox", `${left},${top},${right},${bottom}`);
    url.searchParams.set("bounded", "1");
  }

  // مهم: Nominatim بيحب User-Agent محترم + (يفضل email/Referer لو تقدر)
  const res = await fetch(url.toString(), {
    headers: {
      "Accept-Language": "ar",
      // "User-Agent": "Meshwark/1.0 (yourdomain.com)", // لو تقدر في السيرفر
    },
  });

  if (!res.ok) return [];

  let data = await res.json();

  // ✅ fallback: لو bounded=1 رجّع صفر نتائج، جرّب تاني بدون bounded أو كبّر الراديوس
  if (hasUserLoc && (!data || data.length === 0)) {
    const url2 = new URL(url.toString());
    url2.searchParams.delete("bounded");
    url2.searchParams.delete("viewbox");

    const res2 = await fetch(url2.toString(), { headers: { "Accept-Language": "ar" } });
    if (res2.ok) data = await res2.json();
  }

  let results = (data || [])
    .map((x) => ({
      display: x.display_name,
      lat: Number(x.lat),
      lon: Number(x.lon),
      gov:
        x?.address?.state ||
        x?.address?.governorate ||
        x?.address?.county ||
        x?.address?.region ||
        null,
      center:
        x?.address?.city ||
        x?.address?.town ||
        x?.address?.village ||
        x?.address?.suburb ||
        x?.address?.hamlet ||
        null,
    }))
    .filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lon));

  // (اختياري) فلترة المحافظة/المركز بتاعتك زي ما كنت عامل
  if (userCenter) {
    const uc = normGov(userCenter);
    const byCenter = results.filter((r) => normGov(r.center) === uc);
    if (byCenter.length) results = byCenter;
    else if (userGov) {
      const ug = normGov(userGov);
      const byGov = results.filter((r) => normGov(r.gov) === ug);
      if (byGov.length) results = byGov;
    }
  } else if (userGov) {
    const ug = normGov(userGov);
    const byGov = results.filter((r) => normGov(r.gov) === ug);
    if (byGov.length) results = byGov;
  }

  // ✅ ترتيب بالمسافة (بعد ما ضمنّا إن النتائج قريبة أصلاً)
  if (hasUserLoc) {
    results.sort((a, b) => haversine(lat, lon, a.lat, a.lon) - haversine(lat, lon, b.lat, b.lon));
  }

  return results;
}

function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;

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
    console.log("USER LOCATION:", userLat, userLon);
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
    userCenter = await reverseCenter(lat, lon);
    map.setView([lat, lon], 15);
    onLocated?.({ lat, lon });
  }, () => {}, { enableHighAccuracy: true, timeout: 8000 });
}
async function reverseCenter(lat, lon) {
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("format", "json");
  url.searchParams.set("lat", lat);
  url.searchParams.set("lon", lon);
  url.searchParams.set("zoom", "10");
  url.searchParams.set("addressdetails", "1");

  const res = await fetch(url.toString(), {
    headers: { "Accept-Language": "ar" }
  });

  if (!res.ok) return null;

  const data = await res.json();
  const a = data?.address || {};

  return a.state || a.county || a.region || null;
}
