import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  doc, getDoc, updateDoc, setDoc,
  collection, addDoc,
  onSnapshot, query, where, orderBy, limit,
  serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import { $, setText, moneyEGP, escapeHtml } from "./utils.js";
import { createMap, addMarker, routeOSRM, drawRoute, locateOnce, showMyLocation, geocodeEG, geocodeNominatim, bindSearch } from "./map.js";
import { loadEgyptAdmin, fillSelect, renderVehicleGrid } from "./admin_data.js";
import { notify, ensureNotificationPermission } from "./notify.js";
console.log("passenger.js loaded ✅");
let arrivedToastShownFor = null; // علشان ما تكررش الرسالة كل تحديث
let myData = {};
let driverMarker = null;
const meBadge = $("#meBadge");
const logoutBtn = $("#logoutBtn");
const switchRoleBtn = $("#switchRoleBtn");
switchRoleBtn?.addEventListener("click", openSwitchDriverModal);
const btnLocate = $("#btnLocate");
const btnClear = $("#btnClear");
const pGov = $("#pGov"), pCenter = $("#pCenter"), pVehicles = $("#pVehicles");
pickupMyLocBtn?.addEventListener("click", async () => {
  if (!myLocation?.lat || !myLocation?.lon) {
    notify({ title: "الموقع", body: "حدد موقعك أولاً (زر 🎯)" });
    return;
  }

  const lat = myLocation.lat;
  const lon = myLocation.lon;

  // خلي مكان القيام = نفس موقعي الحالي
  pickup = { lat, lon };

  const name = (await reverseNameEG(lat, lon)) || "موقعي الحالي";
pickupText.value = name;
setPickup({ lat, lon, text: name });

  // حدّث الماركر/الخريطة (حسب كودك الحالي: لو عندك pickupMarker استخدمه)
  if (pickupMarker) pickupMarker.setLatLng([lat, lon]);
  else pickupMarker = L.marker([lat, lon]).addTo(map);

  map.setView([lat, lon], 16);

  // لو عندك dropoff جاهز ارسم المسار/حدث السعر
  if (dropoff?.lat && dropoff?.lon) {
    await recalcRouteAndPrice(); // لو عندك دالة مشابهة
  }
});
const pickupText = $("#pickupText");
const dropText = $("#dropText");
const pickupResults = $("#pickupResults");
const dropResults = $("#dropResults");
const pickupPick = $("#pickupPick");
const dropPick = $("#dropPick");
const pickupSearchBtn = $("#pickupSearchBtn");
const dropSearchBtn   = $("#dropSearchBtn");
const pickupMyLoc = $("#pickupMyLoc");

pickupSearchBtn.addEventListener("click", () => manualSearch("pickup"));
dropSearchBtn.addEventListener("click", () => manualSearch("dropoff"));

const priceValue = $("#priceValue");
const distanceValue = $("#distanceValue");
const routeMeta = $("#routeMeta");
const surgeHint = $("#surgeHint");
const priceSlider = $("#priceSlider");
const btnRequest = $("#btnRequest");
const btnCancel = $("#btnCancel");
const rideCard = $("#rideCard");
const rideStatus = $("#rideStatus");

const btnAcceptOffer = $("#btnAcceptOffer");
const btnRejectOffer = $("#btnRejectOffer");
const btnTrack = $("#btnTrack");
const btnComplete = $("#btnComplete");
const btnCall = $("#btnCall");
const btnWhats = $("#btnWhats");

const map = createMap("map", { center: [26.56, 31.70], zoom: 13 });
let myLocation = null; // {lat, lon}
async function reverseNameEG(lat, lon) {
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("format", "json");
  url.searchParams.set("lat", lat);
  url.searchParams.set("lon", lon);
  url.searchParams.set("zoom", "18"); // شارع/حي
  url.searchParams.set("addressdetails", "1");

  const res = await fetch(url.toString(), { headers: { "Accept-Language": "ar" } });
  if (!res.ok) return null;

  const data = await res.json();
  const a = data?.address || {};

  const road = a.road || a.pedestrian || a.neighbourhood || a.suburb || "";
  const area = a.suburb || a.neighbourhood || a.city_district || a.village || "";
  const city = a.city || a.town || a.village || a.county || "";
  const state = a.state || "";

  // اسم مرتب
  const parts = [road || area, city, state].filter(Boolean);
  return parts.join("، ") || data?.display_name || null;
}
navigator.geolocation.getCurrentPosition(
  (pos) => {
    console.log("GPS OK:", pos.coords.latitude, pos.coords.longitude, "acc:", pos.coords.accuracy);
    const lat = pos.coords.latitude;
    const lon = pos.coords.longitude;

    myLocation = { lat, lon };
    console.log("USER LOCATION OK:", myLocation);

    map.setView([lat, lon], 15);
  },
  (err) => {
    console.log("LOCATION ERROR:", err.code, err.message, err);
  },
  {
    enableHighAccuracy: true,
    timeout: 15000,
    maximumAge: 0,
  }
);

// 👇 ضع الكود هنا مباشرة

pickupMyLoc?.addEventListener("click", async () => {
  if (!myLocation?.lat || !myLocation?.lon) {
    alert("اضغط زر تحديد الموقع أولاً");
    return;
  }

  const lat = Number(myLocation.lat);
  const lon = Number(myLocation.lon);

  const placeName = (await reverseNameEG(lat, lon)) || "موقعي الحالي";

  setPickup({ lat, lon, text: placeName });

  pickupText.value = placeName;

  if (!pickupMarker) {
    pickupMarker = addMarker(map, [lat, lon], { draggable: true });
  } else {
    pickupMarker.setLatLng([lat, lon]);
  }

  map.setView([lat, lon], 16);
});

// ثم يكمل الكود الطبيعي
let driverTrackUnsub = null;
// ============ UBER STYLE DRIVERS ============

const driverMarkers = new Map(); // uid -> { marker, last }

function carIconHTML() {
  // SVG عربية بسيطة
  return `
    <div class="car-marker">
      <svg viewBox="0 0 24 24" fill="none">
        <path d="M5 13.5V11.2c0-.6.2-1.2.6-1.6l1.4-1.7c.4-.5 1-.8 1.7-.8h6.6c.7 0 1.3.3 1.7.8l1.4 1.7c.4.4.6 1 .6 1.6v2.3"
              stroke="rgba(255,215,0,.95)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M7 13.5h10" stroke="rgba(255,215,0,.95)" stroke-width="2" stroke-linecap="round"/>
        <circle cx="8" cy="15.8" r="1.6" fill="rgba(255,215,0,.95)"/>
        <circle cx="16" cy="15.8" r="1.6" fill="rgba(255,215,0,.95)"/>
      </svg>
    </div>
  `;
}

function makeCarMarker(lat, lon, headingDeg = 0) {
  const icon = L.divIcon({
    className: "",
    html: carIconHTML(),
    iconSize: [34, 34],
    iconAnchor: [17, 17],
  });

  const m = L.marker([lat, lon], { icon }).addTo(window.__mapRef || map);

  // rotate
  const el = m.getElement();
  if (el) {
    const inner = el.querySelector(".car-marker");
    if (inner) inner.style.transform = `rotate(${headingDeg}deg)`;
  }
  return m;
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

// حركة ناعمة (Smooth move)
function animateMarker(marker, from, to, ms = 900) {
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

function setMarkerHeading(marker, deg) {
  const el = marker.getElement();
  if (!el) return;
  const inner = el.querySelector(".car-marker");
  if (!inner) return;
  inner.style.transform = `rotate(${deg}deg)`;
}

function startLiveDriversLayer({ governorate, center }) {
  // فلترة حسب نفس المحافظة/المركز + اونلاين آخر دقيقتين
  const cut = Date.now() - (2 * 60 * 1000);

  let q = query(
    collection(db, "driversOnline"),
    where("governorate", "==", governorate),
    where("center", "==", center),
    where("lastSeenMs", ">", cut),
  );

  return onSnapshot(q, (snap) => {
    const seen = new Set();

    snap.forEach((doc) => {
      const d = doc.data();
      const uid = doc.id;
      if (!d?.lat || !d?.lon) return;

      seen.add(uid);

      const prev = driverMarkers.get(uid);
      if (!prev) {
        const m = makeCarMarker(d.lat, d.lon, 0);
        driverMarkers.set(uid, { marker: m, last: { lat: d.lat, lon: d.lon } });
      } else {
        const from = prev.last;
        const to = { lat: d.lat, lon: d.lon };
        const deg = bearingDeg(from.lat, from.lon, to.lat, to.lon);
        setMarkerHeading(prev.marker, deg);
        animateMarker(prev.marker, from, to, 900);
        prev.last = to;
      }
    });

    // امسح اللي مش موجودين دلوقتي
    for (const [uid, obj] of driverMarkers.entries()) {
      if (!seen.has(uid)) {
        obj.marker.remove();
        driverMarkers.delete(uid);
      }
    }
  });
}
const routeLayerRef = { current: null };
async function manualSearch(type) {
  const isPickup = type === "pickup";
  const inputEl = isPickup ? pickupText : dropText;
  const q = (inputEl.value || "").trim();

  if (!q) {
    alert("اكتب اسم المكان");
    return;
  }

  try {
    const items = await geocodeNominatim(q, myLocation?.lat, myLocation?.lon);
const it = items?.[0];
    if (!it) {
      alert("المكان غير موجود");
      return;
    }

    const obj = {
      lat: Number(it.lat),
      lon: Number(it.lon),
      text: it.text || q
    };

    if (isPickup) {
      setPickup(obj);
    } else {
      setDropoff(obj);
    }

  } catch (e) {
    console.error("SEARCH ERROR:", e);
    alert("خطأ في البحث");
  }
}
// Rating modal
const rateModal = $("#rateModal");
const rateClose = $("#rateClose");
const starsRoot = $("#stars");
const rateComment = $("#rateComment");
const rateSend = $("#rateSend");
const rateSkip = $("#rateSkip");
const rateHint = $("#rateHint");
let ratingValue = 0;

let admin = null;
let passengerVehicle = "sedan";

let pickup = null;
let dropoff = null;
let pickupMarker = null;
let dropMarker = null;

let currentPickup = null; // { lat, lon }
let currentRideId = null;
let unsubRideWatcher = null;

function watchRide(rideId) {

  if (unsubRideWatcher) unsubRideWatcher();

  const ref = doc(db, "rides", rideId);

  unsubRideWatcher = onSnapshot(ref, (snap) => {

    if (!snap.exists()) return;

    const ride = snap.data();

    console.log("RIDE UPDATE:", ride.status);

    if (ride.status === "accepted") {

      setStatus("السائق في الطريق إليك");

      btnAcceptOffer.style.display = "none";
      btnRejectOffer.style.display = "none";

      if (ride.driverId) {
        startDriverTracking(ride.driverId);
      }

    }

    if (ride.status === "arrived") {
      setStatus("السائق وصل");
    }

    if (ride.status === "completed") {
      setStatus("تم إنهاء الرحلة");
    }

  });

}

let lastDistanceMeters = null;
let lastDurationSec = null;

function setStatus(text) { setText(rideStatus, text); }


function normalizePhoneEG(phone) {
  const p = String(phone || "").replace(/\s|\-|\(|\)/g, "");
  if (!p) return "";
  if (p.startsWith("+")) return p;
  if (p.startsWith("00")) return "+" + p.slice(2);
  if (p.startsWith("0")) return "+20" + p.slice(1);
  if (p.startsWith("20")) return "+" + p;
  return "+20" + p;
}

function setDriverContactButtons(driverPhone) {
  const ph = normalizePhoneEG(driverPhone);
  if (!ph) {
    btnCall.disabled = true;
    btnWhats.disabled = true;
    return;
  }
  btnCall.disabled = false;
  btnWhats.disabled = false;

  btnCall.onclick = () => window.location.href = `tel:${ph}`;
  const wa = ph.replace("+", "");
  btnWhats.onclick = () => window.open(`https://wa.me/${wa}`, "_blank");
}

function showRatingModal() {
  if (!rateModal) return;
  rateModal.classList.add("show");
}

function hideRatingModal() {
  if (!rateModal) return;
  rateModal.classList.remove("show");
}

function renderStars(v) {
  ratingValue = v;
  if (!starsRoot) return;
  starsRoot.querySelectorAll(".star").forEach((s) => {
    const sv = Number(s.dataset.v || 0);
    s.classList.toggle("active", sv <= v);
  });
}


function surgeMultiplier() {
  const d = new Date();
  const h = d.getHours();
  const day = d.getDay(); // 0 Sun
  const isWeekend = (day === 5 || day === 6);
  const morning = (h >= 7 && h <= 10);
  const evening = (h >= 16 && h <= 20);
  let m = 1.0;
  if (morning || evening) m *= 1.25;
  if (isWeekend && (h >= 12 && h <= 23)) m *= 1.10;
  return m;
}

function computeSuggestedPrice(distanceMeters, durationSec) {
  const km = distanceMeters / 1000;
  const mins = durationSec / 60;

  const base = 15;
  const perKm = 8.0;
  const perMin = 0.35;

  const surge = surgeMultiplier();
  const raw = (base + km * perKm + mins * perMin) * surge;
  return Math.min(3000, Math.max(15, raw));
}

function clampPrice(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 15;
  return Math.min(3000, Math.max(15, Math.round(n / 5) * 5));
}

function updatePriceUI() {
  if (!Number.isFinite(lastDistanceMeters) || !Number.isFinite(lastDurationSec)) return;
  const suggested = computeSuggestedPrice(lastDistanceMeters, lastDurationSec);
  const chosen = clampPrice(priceSlider.value);
  const surge = surgeMultiplier();

  // Make slider auto-follow suggested unless user moved it a lot
  if (!priceSlider.dataset.touched) {
    priceSlider.value = clampPrice(suggested);
  }

  setText(priceValue, moneyEGP(clampPrice(priceSlider.value)));
  setText(surgeHint, `تحسين تلقائي: ذروة × ${surge.toFixed(2)} • يمكنك تعديل السعر.`);
}

function clearAll() {
  pickup = null; dropoff = null;
  pickupText.value = ""; dropText.value = "";
  if (pickupMarker) map.removeLayer(pickupMarker), pickupMarker = null;
  if (dropMarker) map.removeLayer(dropMarker), dropMarker = null;
  if (routeLayerRef.current) map.removeLayer(routeLayerRef.current), routeLayerRef.current = null;
  lastDistanceMeters = null; lastDurationSec = null;
  setText(priceValue, "—");
  setText(distanceValue, "—");
  setText(routeMeta, "اختر قيام/وصول لرسم المسار");
}

async function updateRouteIfReady() {
  if (!pickup || !dropoff) return;
  setStatus("يرسم المسار...");
  try {
    const r = await routeOSRM({ lat: pickup.lat, lon: pickup.lon }, { lat: dropoff.lat, lon: dropoff.lon });
    lastDistanceMeters = r.distanceMeters;
    lastDurationSec = r.durationSec;

    drawRoute(map, r.geojson, routeLayerRef);

    const km = (r.distanceMeters / 1000);
    const mins = Math.round(r.durationSec / 60);
    setText(distanceValue, `${km.toFixed(1)} كم • ${mins} د`);
    setText(routeMeta, "تم رسم المسار. عدّل السعر ثم أرسل الطلب.");
    setStatus("جاهز");
    updatePriceUI();
  } catch {
    setStatus("خطأ");
    setText(routeMeta, "تعذر رسم المسار. جرّب نقطتين مختلفتين.");
  }
}

function setPickup(point) {
  pickup = point;
  pickupText.value = point.text || point.display || "";
  if (pickupMarker) map.removeLayer(pickupMarker);
  pickupMarker = addMarker(map, [point.lat, point.lon]);
  updateRouteIfReady();
}

function setDropoff(point) {
  dropoff = point;
  dropText.value = point.text || point.display || "";
  if (dropMarker) map.removeLayer(dropMarker);
  dropMarker = addMarker(map, [point.lat, point.lon]);
  updateRouteIfReady();
}

bindSearch(pickupText, pickupResults, (it) =>
  setPickup({ lat: Number(it.lat), lon: Number(it.lon), text: it.display || it.text || "" })
);

bindSearch(dropText, dropResults, (it) =>
  setDropoff({ lat: Number(it.lat), lon: Number(it.lon), text: it.display || it.text || "" })
);

priceSlider.addEventListener("input", () => {
  priceSlider.dataset.touched = "1";
  updatePriceUI();
});

btnClear.addEventListener("click", clearAll);

btnLocate.addEventListener("click", () => {
  locateOnce(map, (loc) => { myLocation = loc; });
});

let pickMode = null;
function enablePickFromMap(mode) { pickMode = mode; setStatus(mode === "pickup" ? "اختر القيام من الخريطة" : "اختر الوصول من الخريطة"); }
pickupPick.addEventListener("click", () => enablePickFromMap("pickup"));
dropPick.addEventListener("click", () => enablePickFromMap("dropoff"));

map.on("click", (e) => {
  if (!pickMode) return;
  const point = { lat: e.latlng.lat, lon: e.latlng.lng, text: `(${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)})` };
  if (pickMode === "pickup") setPickup(point);
  else setDropoff(point);
  pickMode = null;
});

logoutBtn.addEventListener("click", async () => {
  await signOut(auth);
  location.href = "./index.html";
});

let driverRouteLayerRef = { current: null };
  let liveUnsub = null;
  
  function startDriverTracking(driverId) {

  if (driverTrackUnsub) driverTrackUnsub();

  const ref = doc(db, "driversOnline", driverId);

  driverTrackUnsub = onSnapshot(ref, async (snap) => {

    if (!snap.exists()) return;

    const d = snap.data();

    // ✅ لأن عندك لخبطة بين lon / lng في المشروع
    const lat = Number(d.lat);
    const lon = Number(d.lon ?? d.lng);

    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

    const pos = [lat, lon];

    if (!driverMarker) {
      driverMarker = L.marker(pos).addTo(map);
    } else {
      driverMarker.setLatLng(pos);
    }

if (currentPickup) {
  drawDriverToPickupRoute(lat, lon, currentPickup.lat, currentPickup.lon);
}

  });

}

async function initAdmin() {
  admin = await loadEgyptAdmin();
  const govs = admin.governorates.map(g => g.name);
  fillSelect(pGov, govs);

  const setCenters = (govName) => {
    const g = admin.governorates.find(x => x.name === govName);
    fillSelect(pCenter, (g?.centers || ["—"]));
  };
  setCenters(pGov.value);
  pGov.addEventListener("change", () => setCenters(pGov.value));

  const vehicles = admin.vehicleTypes;
  const render = () => {
    renderVehicleGrid(pVehicles, vehicles, passengerVehicle, (id) => {
      passengerVehicle = id;
      render();
    });
  };
  render();

async function reverseNameEG(lat, lon) {
  try {
    const url = new URL("https://nominatim.openstreetmap.org/reverse");
    url.searchParams.set("format", "json");
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lon));
    url.searchParams.set("zoom", "18");
    url.searchParams.set("addressdetails", "1");

    const res = await fetch(url.toString(), {
      headers: {
        "Accept": "application/json",
        "Accept-Language": "ar"
      }
    });

    if (!res.ok) return null;

    const data = await res.json();
    const a = data?.address || {};
    const road = a.road || a.pedestrian || a.footway || a.neighbourhood || a.suburb || "";
    const city = a.city || a.town || a.village || a.county || "";
    const state = a.state || "";
    const parts = [road, city, state].filter(Boolean);
    return parts.join("، ") || data?.display_name || null;
  } catch (e) {
    console.warn("reverseNameEG fetch failed:", e);
    return null; // ✅ مهم: ما تعملش throw
  }
}
  
async function drawDriverToPickupRoute(driverLat, driverLon, pickupLat, pickupLon) {
  try {
    const start = { lat: Number(driverLat), lon: Number(driverLon) };
    const end   = { lat: Number(pickupLat), lon: Number(pickupLon) };

    if (!Number.isFinite(start.lat) || !Number.isFinite(start.lon) ||
        !Number.isFinite(end.lat)   || !Number.isFinite(end.lon)) {
      console.warn("ETA/ROUTE invalid coords", { start, end });
      return;
    }

    // امسح مسار قديم
    try {
      if (driverRouteLayerRef?.current) {
        map.removeLayer(driverRouteLayerRef.current);
        driverRouteLayerRef.current = null;
      }
    } catch (_) {}

    const r = await routeOSRM(start, end); // لازم ترجع { geojson, durationSec, distanceMeters } زي عندك
    if (!r?.geojson) {
      console.warn("No geojson from OSRM", r);
      return;
    }

    drawRoute(map, r.geojson, driverRouteLayerRef);

    // ETA
    const mins = Math.max(1, Math.round((Number(r.durationSec) || 0) / 60));
    // غيّر ده حسب مكان عرضك (مثلاً routeMeta أو status)
    setText(routeMeta, `وقت وصول السائق: حوالي ${mins} دقيقة`);
  } catch (e) {
    console.error("drawDriverToPickupRoute ERROR", e);
  }
}
  
function startLive() {
  if (liveUnsub) liveUnsub(); // يقفل الاشتراك القديم
  liveUnsub = startLiveDriversLayer({
    governorate: pGov.value,
    center: pCenter.value
  });
}

startLive();
pGov.addEventListener("change", startLive);
pCenter.addEventListener("change", startLive);
}

function rideUiNone() {
  btnCancel.disabled = true;
  btnRequest.disabled = false;
  btnAcceptOffer.disabled = true;
  btnRejectOffer.disabled = true;
  btnTrack.disabled = true;
  btnComplete.disabled = true;
  btnCall.disabled = true;
  btnWhats.disabled = true;
  rideCard.innerHTML = `<div class="muted">لا يوجد طلب نشط.</div>`;
  setStatus("جاهز");
}

function renderRideCard(ride, driverProfile) {
  const lines = [];
  lines.push(`<div class="row-between"><b>الحالة</b><span class="muted">${escapeHtml(ride.status)}</span></div>`);
  lines.push(`<div class="muted small">قيام: ${escapeHtml(ride.pickupText || "—")}</div>`);
  lines.push(`<div class="muted small">وصول: ${escapeHtml(ride.dropoffText || "—")}</div>`);
  lines.push(`<div class="row-between"><b>السعر الحالي</b><span>${moneyEGP(ride.price)}</span></div>`);
  lines.push(`<div class="muted small">المنطقة: ${escapeHtml(ride.governorate)} / ${escapeHtml(ride.center)} • مركبة: ${escapeHtml(ride.vehicleType)}</div>`);

  if (ride.status === "offered") {
    lines.push(`<div class="divider"></div>`);
    lines.push(`<div class="row-between"><b>عرض السائق</b><span>${moneyEGP(ride.offerPrice)}</span></div>`);
    lines.push(`<div class="muted small">يمكنك قبول العرض أو رفضه.</div>`);
  }

  // داخل renderRideCard(ride, driverProfile)

if (ride.status === "accepted") {
  lines.push(`<div class="divider"></div>`);
  lines.push(`<div><b>السائق</b></div>`);
  lines.push(`<div class="muted small">الاسم: ${escapeHtml(driverProfile?.name || ride.driverName || "-")}</div>`);
  lines.push(`<div class="muted small">الهاتف: ${escapeHtml(driverProfile?.phone || ride.driverPhone || "-")}</div>`);
  lines.push(`<div class="muted small">نوع المركبة: ${escapeHtml(ride.driverVehicleType || "—")}</div>`);
  if (ride.driverVehicleCode) {
    lines.push(`<div class="muted small">كود المركبة: ${escapeHtml(ride.driverVehicleCode)}</div>`);
  }
} else {
  lines.push(`<div class="muted small">بيانات السائق تظهر بعد القبول.</div>`);
}

  rideCard.innerHTML = lines.join("");
}

onAuthStateChanged(auth, async (user) => {
  if (!user) { location.href = "./index.html"; return; }
  await ensureNotificationPermission(true);

  const me = await getDoc(doc(db, "users", user.uid));
  myData = me.exists() ? me.data() : {};
// if (myData.role !== "passenger") { location.href = "./driver.html"; return; }

  setText(meBadge, `${myData.name || "مستخدم"} • راكب`);

  // init selects from profile
  await initAdmin().catch(()=>{});
  if (myData.governorate) pGov.value = myData.governorate;
  pGov.dispatchEvent(new Event("change"));
  if (myData.center) pCenter.value = myData.center;
  if (myData.vehicleType) passengerVehicle = myData.vehicleType;

  // auto-locate
  locateOnce(map, (loc) => {
  myLocation = loc;
  showMyLocation(map, loc);
});

  // watch active ride (requested/offered/accepted)
  const ridesQ = query(
    collection(db, "rides"),
    where("passengerId", "==", user.uid),
    where("status", "in", ["requested", "offered", "accepted"]),
    orderBy("createdAt", "desc"),
    limit(1)
  );

  onSnapshot(ridesQ, (snap) => {
    if (snap.empty) {
  currentRideId = null;
  arrivedToastShownFor = null;

  if (unsubRideWatcher) { 
    unsubRideWatcher(); 
    unsubRideWatcher = null; 
  }

  rideUiNone();
  return;
}

    const docSnap = snap.docs[0];
    currentRideId = docSnap.id;
watchRide(currentRideId);
    if (unsubRideWatcher) unsubRideWatcher();
    unsubRideWatcher = onSnapshot(doc(db, "rides", currentRideId), async (rideSnap) => {
      if (!rideSnap.exists()) return;
      const ride = rideSnap.data();
      // ✅ حدّث رسالة أعلى الكارت حسب حالة الرحلة (routeMeta)
if (ride.status === "requested") {
  setText(routeMeta, "تم إرسال الطلب.. في انتظار سائق...");
} else if (ride.status === "offered") {
  setText(routeMeta, "وصل عرض سعر من السائق. اختر قبول أو رفض.");
} else if (ride.status === "accepted") {
  setText(routeMeta, "تم القبول ✅ السائق في الطريق إليك...");
  // startDriverTracking(ride.driverId) عندك أصلاً بيتنده بعد شوية تحت
  // وهو اللي هيحط ETA ويحدّث routeMeta تلقائيًا
} else if (ride.status === "completed") {
  setText(routeMeta, "تم إنهاء الرحلة ✅");
} else if (ride.status === "canceled") {
  setText(routeMeta, "تم إلغاء الطلب.");
}
      // ============ DRIVER ARRIVED ============
if (ride?.arrivedAtPickup === true) {
  // اعرضها مرة واحدة لكل رحلة
  if (arrivedToastShownFor !== currentRideId) {
    arrivedToastShownFor = currentRideId;

    notify({
      title: "السائق وصل",
      body: "السائق وصل لمكان القيام ✅",
      tag: "driver-arrived"
    });
  }
}
      console.log("PASSENGER currentRideId =", currentRideId);
      console.log("PASSENGER status =", ride.status);
      // auto-expire UI
      const expired = ride.expiresAt && ride.expiresAt.toMillis && ride.expiresAt.toMillis() < Date.now();

      btnCancel.disabled = !(ride.status === "requested" || ride.status === "offered");
      btnRequest.disabled = true;

      btnAcceptOffer.disabled = ride.status !== "offered";
      btnRejectOffer.disabled = ride.status !== "offered";

      btnTrack.disabled = ride.status !== "accepted";
      btnComplete.disabled = ride.status !== "accepted";
      btnCall.disabled = ride.status !== "accepted";
      btnWhats.disabled = ride.status !== "accepted";

      let driverProfile = null;
      if (ride.status === "accepted" && ride.driverId) {
        const dSnap = await getDoc(doc(db, "users", ride.driverId));
        driverProfile = dSnap.exists() ? dSnap.data() : null;
      }
      // ✅ فعّل ETA + تتبع السائق من driversOnline (OSRM)
if (ride.status === "accepted" && ride.driverId) {
  // ثبّت مكان القيام عشان ETA يعرف يرسُم للسائق لحد القيام
  if (ride.pickup?.lat && ride.pickup?.lon) {
    currentPickup = { lat: Number(ride.pickup.lat), lon: Number(ride.pickup.lon) };
  }

  // شغّل التتبع اللي جوّه بيحسب ETA ويعرضه في routeMeta
  startDriverTracking(ride.driverId);
}

      renderRideCard(ride, driverProfile);

      if (ride.status === "accepted" && driverProfile) {
        setDriverContactButtons(driverProfile.phone);
      } else {
        setDriverContactButtons(null);
      }


      // Live tracking (driver marker)
      if (ride.status === "accepted" && ride.driverLoc && ride.driverLoc.lat && ride.driverLoc.lon) {
        const ll = [ride.driverLoc.lat, ride.driverLoc.lon];
        if (!driverMarker) {
          driverMarker = L.marker(ll).addTo(map);
        } else {
          driverMarker.setLatLng(ll);
        }
      } else if (driverMarker) {
        // hide when no tracking
        map.removeLayer(driverMarker);
        driverMarker = null;
      }



      // Rating on completion (passenger)
      if (ride.status === "completed" && !ride.passengerRating) {
        renderStars(0);
        setText(rateHint, ""); 
        showRatingModal();
        rateSend.onclick = async () => {
          if (!ratingValue) { setText(rateHint, "اختر عدد نجوم أولاً."); return; }
          setText(rateHint, "جارٍ الإرسال...");
          try{
            await updateDoc(doc(db, "rides", currentRideId), {
              passengerRating: ratingValue,
              passengerComment: (rateComment?.value || "").trim(),
              ratedAt: serverTimestamp(),
            });
            hideRatingModal();
            notify({ title: "تم إرسال التقييم", body: "شكراً لمشاركتك رأيك.", tag: "rated" });
          } catch {
            setText(rateHint, "تعذر إرسال التقييم. جرّب مرة أخرى.");
          }
        };
      }

      if (expired && (ride.status === "requested" || ride.status === "offered")) {
        setStatus("منتهي");
        notify({ title: "الطلب انتهى", body: "تم إخفاء الطلب بعد 15 دقيقة. أرسل طلبًا جديدًا.", tag: "ride-expired" });
      } else {
        // بعد: const ride = rideSnap.data();

if (ride?.pickup?.lat && ride?.pickup?.lon) {
  currentPickup = {
    lat: Number(ride.pickup.lat),
    lon: Number(ride.pickup.lon),
  };
}

if (ride.status === "requested") {
  setText(routeMeta, "تم إرسال الطلب.. في انتظار سائق...");
}

if (ride.status === "offered") {
  setText(routeMeta, "وصل عرض سعر من السائق. اختر قبول أو رفض.");
}

if (ride.status === "accepted") {
  setText(routeMeta, "تم القبول ✅ السائق في الطريق إليك...");
  if (ride.driverId) startDriverTracking(ride.driverId); // لتشغيل ETA وتتبع السائق
}

if (ride.status === "completed") {
  setText(routeMeta, "تم إنهاء الرحلة ✅");
}

if (ride.status === "canceled") {
  setText(routeMeta, "تم إلغاء الطلب.");
}
        setStatus(ride.status === "accepted" ? "مقبول" : (ride.status === "offered" ? "عرض سعر" : "قيد الانتظار"));
      }
    });
  });
});

btnRequest.addEventListener("click", async () => {
  const user = auth.currentUser;
  if (!user) return;

  if (!pickup || !dropoff || !Number.isFinite(lastDistanceMeters) || !Number.isFinite(lastDurationSec)) {
    setStatus("ناقص");
    setText(routeMeta, "لازم تحدد قيام/وصول ويتعمل مسار أولاً.");
    return;
  }

  const price = clampPrice(priceSlider.value);
  const expiresAt = Timestamp.fromMillis(Date.now() + 15 * 60 * 1000);

  setStatus("يرسل...");
  try {
    // persist passenger selection to profile
    await updateDoc(doc(db, "users", user.uid), {
      governorate: pGov.value,
      center: pCenter.value,
      vehicleType: passengerVehicle,
      updatedAt: serverTimestamp(),
    }).catch(()=>{});
    console.log("pickup", pickup);
console.log("dropoff", dropoff);
    const rideRef = await addDoc(collection(db, "rides"), {

  passengerId: user.uid,
  passengerName: myData.name || "",
  passengerPhone: myData.phone || "",
  driverId: null,
  status: "requested",
  createdAt: serverTimestamp(),
  expiresAt,

  governorate: pGov.value,
  center: pCenter.value,
  vehicleType: passengerVehicle,

  pickup: { lat: pickup.lat, lon: pickup.lon },
dropoff: { lat: dropoff.lat, lon: dropoff.lon },
      
  pickupText: pickupText.value.trim(),
  dropoffText: dropText.value.trim(),

  distanceMeters: lastDistanceMeters,
  durationSec: lastDurationSec,
  price,

  passengerLoc: myLocation
  ? { lat: myLocation.lat, lon: myLocation.lon }
  : null

});
currentRideId = rideRef.id;

    setText(routeMeta, "تم إرسال الطلب. في انتظار سائق...");
    setStatus("قيد الانتظار");
    notify({ title: "تم إرسال الطلب", body: "جارٍ البحث عن سائق...", tag: "ride-sent" });
  } catch (e) {
    console.error("ADD DOC ERROR:", e);
alert("FIRESTORE ERROR: " + (e?.message || e));
    setStatus("خطأ");
    setText(routeMeta, "تعذر إرسال الطلب. جرّب مرة أخرى.");
  }
});

btnCancel.addEventListener("click", async () => {
  if (!currentRideId) {
    setStatus("جاهز");
    setText(routeMeta, "اختر قيام/وصول لرسم المسار");
    renderRideCard(null, null);
    setDriverContactButtons(null);

    if (driverMarker) {
      map.removeLayer(driverMarker);
      driverMarker = null;
    }
    return;
  }

  setStatus("...جاري الإلغاء");
  const rideId = currentRideId; // احفظه قبل ما نصفر

  try {
    await updateDoc(doc(db, "rides", rideId), {
      status: "canceled",
      canceledAt: serverTimestamp(),
    });

    // ✅ صفّر الطلب فورًا عشان الرسالة تختفي
    currentRideId = null;

    // ✅ Reset UI فورًا
    setStatus("جاهز");
    setText(routeMeta, "اختر قيام/وصول لرسم المسار");
    renderRideCard(null, null);
    setDriverContactButtons(null);

    // ✅ شيل ماركر السائق لو موجود
    if (driverMarker) {
      map.removeLayer(driverMarker);
      driverMarker = null;
    }

    notify({ title: "تم إلغاء الطلب", body: "تم إلغاء الطلب بنجاح", tag: "ride-canceled" });
  } catch (e) {
    console.error("CANCEL ERROR:", e);
    setStatus("خطأ");
  }
});

btnAcceptOffer.addEventListener("click", async () => {
  if (!currentRideId) return;
  setStatus("يقبل العرض...");
  try {
    // accept offer: turn to accepted, keep driverId and offerPrice as final price
    const rideRef = doc(db, "rides", currentRideId);
    const rideSnap = await getDoc(rideRef);
    if (!rideSnap.exists()) return;
    const ride = rideSnap.data();
    if (ride.status !== "offered") return;

    await updateDoc(rideRef, {
      status: "accepted",
      price: ride.offerPrice,
      acceptedAt: serverTimestamp(),
    });

    // جلب بيانات الرحلة بعد القبول
const rideAfter = await getDoc(rideRef);
const rideData = rideAfter.data();

if (rideData?.pickup?.lat && rideData?.pickup?.lon) {
  currentPickup = {
    lat: Number(rideData.pickup.lat),
    lon: Number(rideData.pickup.lon)
  };
}

if (rideData?.driverId) {
  startDriverTracking(rideData.driverId);
}
    
    notify({ title: "تم قبول عرض السائق", body: `السعر النهائي: ${Math.round(ride.offerPrice)} ج`, tag: "offer-accepted" });
  } catch { setStatus("خطأ"); }
});

btnRejectOffer.addEventListener("click", async () => {
  if (!currentRideId) return;
  setStatus("يرفض...");
  try {
    await updateDoc(doc(db, "rides", currentRideId), { status: "requested", offerPrice: null, offeredAt: null });
    notify({ title: "تم رفض العرض", body: "عاد الطلب لقائمة الطلبات.", tag: "offer-rejected" });
  } catch { setStatus("خطأ"); }
});

btnTrack.addEventListener("click", async () => {
  notify({ title: "تتبع الرحلة", body: "سيتم إضافة تتبع لحظي لموقع السائق في تحديث قادم (مُجهّز بالبنية).", tag: "track" });
});

btnComplete.addEventListener("click", async () => {
  if (!currentRideId) return;
  setStatus("ينهي...");
  try {
    await updateDoc(doc(db, "rides", currentRideId), { status: "completed", completedAt: serverTimestamp() });
    notify({ title: "تم إنهاء الرحلة", body: "شكراً لاستخدام مشوارك.", tag: "ride-done" });
  } catch { setStatus("خطأ"); }
});


// Rating UI bindings
rateClose?.addEventListener("click", hideRatingModal);
rateSkip?.addEventListener("click", hideRatingModal);
rateModal?.addEventListener("click", (e) => { if (e.target === rateModal) hideRatingModal(); });
starsRoot?.addEventListener("click", (e) => {
  const t = e.target;
  if (!t || !t.classList.contains("star")) return;
  renderStars(Number(t.dataset.v || 0));
});

// ===== Switch to Driver Modal =====
let sdSelectedVehicle = null;


async function openSwitchDriverModal() {
  const modal = $("#switchDriverModal");
  const hint = $("#switchDriverHint");
  hint.textContent = "";

  // fill gov/center + vehicles using same admin data if available
  const admin = await loadEgyptAdmin(); // موجودة غالبًا عندك في passenger.js أو utils
  const govs = admin.governorates.map(g => g.name);

  fillSelect($("#sdGov"), govs);
  const setCenters = () => {
    const g = admin.governorates.find(x => x.name === $("#sdGov").value);
    fillSelect($("#sdCenter"), (g?.centers || ["-"]));
  };
  setCenters();
  $("#sdGov").addEventListener("change", setCenters);

  // vehicles grid
  sdSelectedVehicle = admin.vehicleTypes?.[0]?.id || null;
  const render = () => {
    renderVehicleGrid($("#sdVehicles"), admin.vehicleTypes, sdSelectedVehicle, (id) => {
      sdSelectedVehicle = id;
      render();
    });
  };
  render();

  // show modal
  modal.classList.remove("hidden");
}

function closeSwitchDriverModal() {
  $("#switchDriverModal").classList.add("hidden");
}

$("#switchDriverClose")?.addEventListener("click", closeSwitchDriverModal);
$("#switchDriverCancel")?.addEventListener("click", closeSwitchDriverModal);
$("#switchDriverBackdrop")?.addEventListener("click", closeSwitchDriverModal);

$("#switchDriverSave")?.addEventListener("click", async () => {


  const hint = $("#switchDriverHint");
  hint.textContent = "جارٍ التحويل...";
  
  const gov = $("#sdGov").value;
  const center = $("#sdCenter").value;
  const vehicleType = sdSelectedVehicle;
  const vehicleCode = ($("#sdVehicleCode").value || "").trim();
  const address = ($("#sdAddress").value || "").trim();

  if (!gov || gov === "-" || !center || center === "-") {
    hint.textContent = "اختر المحافظة والمركز.";
    return;
  }
  if (!vehicleType) {
    hint.textContent = "اختر نوع المركبة.";
    return;
  }
  if (!vehicleCode) {
    hint.textContent = "اكتب كود المركبة.";
    return;
  }

  try {
    const u = auth.currentUser;
    if (!u) throw new Error("لا يوجد مستخدم مسجل.");

    await updateDoc(doc(db, "users", u.uid), {
      role: "driver",
      governorate: gov,
      center,
      vehicleType,
      vehicleCode,
      address,
      updatedAt: serverTimestamp(),
    });
location.href = "./driver.html?ts=" + Date.now();
return;
  } catch (e) {
  console.error("SWITCH DRIVER ERROR:", e);
  hint.textContent = (e?.message || "حدث خطأ أثناء التحويل");
}
});
