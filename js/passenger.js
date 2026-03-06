import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  doc, getDoc, updateDoc,
  collection, addDoc,
  onSnapshot, query, where,
  serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import { $, setText, moneyEGP, escapeHtml } from "./utils.js";
import {
  createMap, addMarker, routeOSRM, drawRoute, locateOnce, showMyLocation,
  geocodeNominatim, bindSearch, createCarIcon, moveCarMarkerSmooth,
  createPickupIcon, createDropoffIcon,
} from "./map.js";
import { loadEgyptAdmin, fillSelect, renderVehicleGrid } from "./admin_data.js";
import { notify, ensureNotificationPermission } from "./notify.js";

console.log("passenger.js loaded ✅");

let myData = {};
let admin = null;
let myLocation = null;
let passengerVehicle = "sedan";

let pickup = null;
let dropoff = null;
let pickupMarker = null;
let dropMarker = null;
let currentPickup = null;
let currentRideId = null;
let currentRideDocUnsub = null;
let currentRideListUnsub = null;
let driverTrackUnsub = null;
let liveDriversUnsub = null;
let driverMarker = null;
let driverLastLoc = null;
let arrivedToastShownFor = null;
let ratingValue = 0;
let pickMode = null;
let lastDistanceMeters = null;
let lastDurationSec = null;

const meBadge = $("#meBadge");
const logoutBtn = $("#logoutBtn");
const switchRoleBtn = $("#switchRoleBtn");
const btnLocate = $("#btnLocate");
const btnClear = $("#btnClear");
const pGov = $("#pGov");
const pCenter = $("#pCenter");
const pVehicles = $("#pVehicles");
const pickupMyLoc = $("#pickupMyLoc");
const pickupText = $("#pickupText");
const dropText = $("#dropText");
const pickupResults = $("#pickupResults");
const dropResults = $("#dropResults");
const pickupPick = $("#pickupPick");
const dropPick = $("#dropPick");
const pickupSearchBtn = $("#pickupSearchBtn");
const dropSearchBtn = $("#dropSearchBtn");
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

const rateModal = $("#rateModal");
const rateClose = $("#rateClose");
const starsRoot = $("#stars");
const rateComment = $("#rateComment");
const rateSend = $("#rateSend");
const rateSkip = $("#rateSkip");
const rateHint = $("#rateHint");

const map = createMap("map", { center: [26.56, 31.70], zoom: 13 });
const routeLayerRef = { current: null };
const driverRouteLayerRef = { current: null };

pickupSearchBtn?.addEventListener("click", () => manualSearch("pickup"));
dropSearchBtn?.addEventListener("click", () => manualSearch("dropoff"));

btnClear?.addEventListener("click", () => {
  if (currentRideId) return;
  clearAll();
  setStatus("جاهز");
});

logoutBtn?.addEventListener("click", async () => {
  stopLiveDrivers();
  stopDriverTracking();
  if (currentRideListUnsub) { currentRideListUnsub(); currentRideListUnsub = null; }
  if (currentRideDocUnsub) { currentRideDocUnsub(); currentRideDocUnsub = null; }
  await signOut(auth);
  location.href = "./index.html";
});

function setStatus(text) {
  setText(rideStatus, text);
}

function hideEl(el) {
  if (el) el.style.display = "none";
}

function showEl(el) {
  if (el) el.style.display = "";
}

function resetActionVisibility() {
  showEl(btnAcceptOffer);
  showEl(btnRejectOffer);
  showEl(btnCancel);
  showEl(btnComplete);
  showEl(btnTrack);
  showEl(btnCall);
  showEl(btnWhats);
}

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
    btnCall.onclick = null;
    btnWhats.onclick = null;
    return;
  }
  btnCall.disabled = false;
  btnWhats.disabled = false;
  btnCall.onclick = () => { window.location.href = `tel:${ph}`; };
  btnWhats.onclick = () => { window.open(`https://wa.me/${ph.replace("+", "")}`, "_blank"); };
}

function renderStars(v) {
  ratingValue = v;
  starsRoot?.querySelectorAll(".star").forEach((s) => {
    const sv = Number(s.dataset.v || 0);
    s.classList.toggle("active", sv <= v);
  });
}

function showRatingModal() {
  rateModal?.classList.add("show");
}

function hideRatingModal() {
  rateModal?.classList.remove("show");
}

function surgeMultiplier() {
  const d = new Date();
  const h = d.getHours();
  const day = d.getDay();
  const isWeekend = day === 5 || day === 6;
  const morning = h >= 7 && h <= 10;
  const evening = h >= 16 && h <= 20;
  let m = 1.0;
  if (morning || evening) m *= 1.25;
  if (isWeekend && h >= 12 && h <= 23) m *= 1.10;
  return m;
}

function computeSuggestedPrice(distanceMeters, durationSec) {
  const km = distanceMeters / 1000;
  const mins = durationSec / 60;
  const raw = (15 + km * 8 + mins * 0.35) * surgeMultiplier();
  return Math.min(3000, Math.max(15, raw));
}

function clampPrice(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 15;
  return Math.min(3000, Math.max(15, Math.round(n / 5) * 5));
}

function updatePriceUI() {
  if (!Number.isFinite(lastDistanceMeters) || !Number.isFinite(lastDurationSec)) return;
  if (!priceSlider.dataset.touched) {
    priceSlider.value = clampPrice(computeSuggestedPrice(lastDistanceMeters, lastDurationSec));
  }
  setText(priceValue, moneyEGP(clampPrice(priceSlider.value)));
  setText(surgeHint, `تحسين تلقائي: ذروة × ${surgeMultiplier().toFixed(2)} • يمكنك تعديل السعر.`);
}

function removeRouteLayer(ref) {
  try {
    if (ref?.current) {
      map.removeLayer(ref.current);
      ref.current = null;
    }
  } catch (_) {}
}

function clearDriverMarker() {
  if (driverMarker) {
    try { map.removeLayer(driverMarker); } catch (_) {}
  }
  driverMarker = null;
  driverLastLoc = null;
}

function stopDriverTracking() {
  if (driverTrackUnsub) driverTrackUnsub();
  driverTrackUnsub = null;
  removeRouteLayer(driverRouteLayerRef);
  clearDriverMarker();
}

function clearAll() {
  pickup = null;
  dropoff = null;
  pickupText.value = "";
  dropText.value = "";
  if (pickupMarker) { try { map.removeLayer(pickupMarker); } catch (_) {} }
  if (dropMarker) { try { map.removeLayer(dropMarker); } catch (_) {} }
  pickupMarker = null;
  dropMarker = null;
  removeRouteLayer(routeLayerRef);
  lastDistanceMeters = null;
  lastDurationSec = null;
  setText(priceValue, "—");
  setText(distanceValue, "—");
  setText(routeMeta, "اختر قيام/وصول لرسم المسار");
}

function cleanupRideState() {
  if (currentRideDocUnsub) {
    currentRideDocUnsub();
    currentRideDocUnsub = null;
  }
  currentRideId = null;
  currentPickup = null;
  arrivedToastShownFor = null;
  stopDriverTracking();
  setDriverContactButtons(null);
  resetActionVisibility();
  hideRatingModal();
}

function rideUiNone() {
  cleanupRideState();
  clearAll(); // ✅ يمسح pickup / dropoff / route
  btnRequest.disabled = false;
  btnCancel.disabled = true;
  btnAcceptOffer.disabled = true;
  btnRejectOffer.disabled = true;
  btnTrack.disabled = true;
  btnComplete.disabled = true;
  hideEl(btnAcceptOffer);
  hideEl(btnRejectOffer);
  hideEl(btnCancel);
  hideEl(btnComplete);
  hideEl(btnTrack);
  hideEl(btnCall);
  hideEl(btnWhats);
  rideCard.innerHTML = `<div class="muted">لا يوجد طلب نشط.</div>`;
  setStatus("جاهز");
}
async function reverseNameEG(lat, lon) {
  try {
    const url = new URL("https://nominatim.openstreetmap.org/reverse");
    url.searchParams.set("format", "json");
    url.searchParams.set("lat", String(lat));
    url.searchParams.set("lon", String(lon));
    url.searchParams.set("zoom", "18");
    url.searchParams.set("addressdetails", "1");
    const res = await fetch(url.toString(), { headers: { "Accept-Language": "ar" } });
    if (!res.ok) return null;
    const data = await res.json();
    const a = data?.address || {};
    const parts = [
      a.road || a.pedestrian || a.neighbourhood || a.suburb || a.city_district || "",
      a.city || a.town || a.village || a.county || "",
      a.state || "",
    ].filter(Boolean);
    return parts.join("، ") || data?.display_name || null;
  } catch (_) {
    return null;
  }
}

function setPickup(point) {
  pickup = point;
  pickupText.value = point.text || point.display || "";
  if (pickupMarker) { try { map.removeLayer(pickupMarker); } catch (_) {} }
  pickupMarker = addMarker(map, [point.lat, point.lon], { icon: createPickupIcon() });
  updateRouteIfReady();
}

function setDropoff(point) {
  dropoff = point;
  dropText.value = point.text || point.display || "";
  if (dropMarker) { try { map.removeLayer(dropMarker); } catch (_) {} }
  dropMarker = addMarker(map, [point.lat, point.lon], { icon: createDropoffIcon() });
  updateRouteIfReady();
}

async function manualSearch(type) {
  const isPickup = type === "pickup";
  const inputEl = isPickup ? pickupText : dropText;
  const q = (inputEl.value || "").trim();
  if (!q) {
    alert("اكتب اسم المكان");
    return;
  }

  try {
    const items = await geocodeNominatim(q, 8, myLocation);
    const it = items?.[0];
    if (!it) {
      alert("المكان غير موجود");
      return;
    }
    const obj = { lat: Number(it.lat), lon: Number(it.lon), text: it.text || q };
    if (isPickup) setPickup(obj);
    else setDropoff(obj);
    map.setView([obj.lat, obj.lon], Math.max(map.getZoom(), 15));
  } catch (e) {
    console.error("SEARCH ERROR:", e);
    alert("خطأ في البحث");
  }
}

async function updateRouteIfReady() {
  if (!pickup || !dropoff) return;

  const latDiff = Math.abs(Number(pickup.lat) - Number(dropoff.lat));
  const lonDiff = Math.abs(Number(pickup.lon) - Number(dropoff.lon));
  const nearEnough = latDiff < 0.00035 && lonDiff < 0.00035;

  setStatus("يرسم المسار...");
  try {
    let r;
    if (nearEnough) {
      r = await routeOSRM(
        { lat: pickup.lat, lon: pickup.lon },
        { lat: dropoff.lat, lon: dropoff.lon }
      );
    } else {
      r = await routeOSRM(
        { lat: pickup.lat, lon: pickup.lon },
        { lat: dropoff.lat, lon: dropoff.lon }
      );
    }

    lastDistanceMeters = r.distanceMeters;
    lastDurationSec = r.durationSec;
    drawRoute(map, r.geojson, routeLayerRef);
    const km = (r.distanceMeters / 1000);
    const mins = Math.max(1, Math.round(r.durationSec / 60));
    setText(distanceValue, `${km.toFixed(1)} كم • ${mins} د`);
    setText(routeMeta, nearEnough ? "المسافة قصيرة جداً وتم رسم خط مباشر." : "تم رسم المسار. عدّل السعر ثم أرسل الطلب.");
    setStatus("جاهز");
    updatePriceUI();
  } catch (e) {
    console.error("ROUTE ERROR:", e);
    setStatus("خطأ");
    setText(routeMeta, "تعذر رسم المسار. جرّب نقطتين مختلفتين.");
  }
}

function updateRideActionVisibility(ride) {
  resetActionVisibility();
  if (!ride) {
    rideUiNone();
    return;
  }

  if (ride.status === "requested") {
    hideEl(btnAcceptOffer);
    hideEl(btnRejectOffer);
    hideEl(btnTrack);
    hideEl(btnComplete);
    hideEl(btnCall);
    hideEl(btnWhats);
  } else if (ride.status === "offered") {
    hideEl(btnTrack);
    hideEl(btnComplete);
    hideEl(btnCall);
    hideEl(btnWhats);
  } else if (ride.status === "accepted" || ride.status === "arrived") {
    hideEl(btnAcceptOffer);
    hideEl(btnRejectOffer);
  } else if (ride.status === "completed" || ride.status === "canceled") {
    hideEl(btnAcceptOffer);
    hideEl(btnRejectOffer);
    hideEl(btnCancel);
    hideEl(btnComplete);
    hideEl(btnTrack);
    hideEl(btnCall);
    hideEl(btnWhats);
  }
}

function getRideStatusLabel(status) {
  switch (status) {
    case "requested": return "جاري البحث";
    case "offered": return "وصل عرض";
    case "accepted": return "السائق في الطريق";
    case "arrived": return "السائق وصل";
    case "completed": return "الرحلة انتهت";
    case "canceled": return "تم الإلغاء";
    default: return status || "-";
  }
}

function renderRideCard(ride, driverProfile) {
  if (!ride) {
    rideCard.innerHTML = `<div class="muted">لا يوجد طلب نشط.</div>`;
    return;
  }

  const lines = [];
  lines.push(`<div class="row-between"><b>الحالة</b><span class="muted">${escapeHtml(getRideStatusLabel(ride.status))}</span></div>`);
  lines.push(`<div class="muted small">قيام: ${escapeHtml(ride.pickupText || "—")}</div>`);
  lines.push(`<div class="muted small">وصول: ${escapeHtml(ride.dropoffText || "—")}</div>`);
  lines.push(`<div class="row-between"><b>السعر الحالي</b><span>${moneyEGP(ride.price)}</span></div>`);
  lines.push(`<div class="muted small">المنطقة: ${escapeHtml(ride.governorate || "-")} / ${escapeHtml(ride.center || "-")} • مركبة: ${escapeHtml(ride.vehicleType || "-")}</div>`);

  if (ride.status === "offered") {
    lines.push(`<div class="divider"></div>`);
    lines.push(`<div class="row-between"><b>عرض السائق</b><span>${moneyEGP(ride.offerPrice)}</span></div>`);
    lines.push(`<div class="muted small">يمكنك قبول العرض أو رفضه.</div>`);
  }

  if (ride.status === "accepted" || ride.status === "arrived" || ride.status === "completed") {
    lines.push(`<div class="divider"></div>`);
    lines.push(`<div><b>السائق</b></div>`);
    lines.push(`<div class="muted small">الاسم: ${escapeHtml(driverProfile?.name || ride.driverName || "-")}</div>`);
    lines.push(`<div class="muted small">الهاتف: ${escapeHtml(driverProfile?.phone || ride.driverPhone || "-")}</div>`);
    lines.push(`<div class="muted small">نوع المركبة: ${escapeHtml(driverProfile?.vehicleType || ride.driverVehicleType || "—")}</div>`);
    if (driverProfile?.vehicleCode || ride.driverVehicleCode) {
      lines.push(`<div class="muted small">كود المركبة: ${escapeHtml(driverProfile?.vehicleCode || ride.driverVehicleCode || "-")}</div>`);
    }
  } else {
    lines.push(`<div class="muted small">بيانات السائق تظهر بعد القبول.</div>`);
  }

  rideCard.innerHTML = lines.join("");
}

async function drawDriverToPickupRoute(driverLat, driverLon, pickupLat, pickupLon) {
  try {
    const start = { lat: Number(driverLat), lon: Number(driverLon) };
    const end = { lat: Number(pickupLat), lon: Number(pickupLon) };
    if (![start.lat, start.lon, end.lat, end.lon].every(Number.isFinite)) return;

    const r = await routeOSRM(start, end);
    drawRoute(map, r.geojson, driverRouteLayerRef);
    const mins = Math.max(1, Math.round((Number(r.durationSec) || 0) / 60));
    const meters = Math.round(Number(r.distanceMeters) || 0);
    const distanceText = meters < 1000 ? `${meters} متر` : `${(meters / 1000).toFixed(1)} كم`;
    setText(distanceValue, `🚗 السائق يبعد ${distanceText} • يصل خلال ${mins} دقيقة`);
    setStatus(rideStatus.textContent === "السائق وصل" ? "السائق وصل" : `السائق سيصل خلال ${mins} دقيقة`);
  } catch (e) {
    console.error("drawDriverToPickupRoute ERROR", e);
  }
}

function startDriverTracking(driverId) {
  stopDriverTracking();
  const ref = doc(db, "driversOnline", driverId);
  driverTrackUnsub = onSnapshot(ref, async (snap) => {
    if (!snap.exists()) return;
    const d = snap.data();
    const lat = Number(d.lat);
    const lon = Number(d.lon ?? d.lng);
    if (![lat, lon].every(Number.isFinite)) return;

    const pos = [lat, lon];
    if (!driverMarker) {
      driverMarker = L.marker(pos, { icon: createCarIcon(0) }).addTo(map);
    } else if (driverLastLoc) {
      moveCarMarkerSmooth(driverMarker, driverLastLoc, { lat, lon }, 900);
    } else {
      driverMarker.setLatLng(pos);
    }

    driverLastLoc = { lat, lon };
    if (!currentPickup && pickup) currentPickup = { lat: pickup.lat, lon: pickup.lon };
    if (currentPickup) await drawDriverToPickupRoute(lat, lon, currentPickup.lat, currentPickup.lon);
  });
}

function stopLiveDrivers() {
  if (liveDriversUnsub) liveDriversUnsub();
  liveDriversUnsub = null;
  driverMarkers.forEach((obj) => {
    try { obj.marker.remove(); } catch (_) {}
  });
  driverMarkers.clear();
}

const driverMarkers = new Map();

function startLiveDriversLayer({ governorate, center }) {
  stopLiveDrivers();
  const q = query(collection(db, "driversOnline"), where("governorate", "==", governorate), where("center", "==", center));
  liveDriversUnsub = onSnapshot(q, (snap) => {
    const seen = new Set();
    snap.forEach((row) => {
      const d = row.data();
      const uid = row.id;
      const lat = Number(d.lat);
      const lon = Number(d.lon ?? d.lng);
      const lastSeenMs = Number(d.lastSeenMs || 0);
      if (![lat, lon].every(Number.isFinite)) return;
      if (Date.now() - lastSeenMs > 2 * 60 * 1000) return;
      seen.add(uid);
      const prev = driverMarkers.get(uid);
      if (!prev) {
        const marker = L.marker([lat, lon], { icon: createCarIcon(0) }).addTo(map);
        driverMarkers.set(uid, { marker, last: { lat, lon } });
      } else {
        moveCarMarkerSmooth(prev.marker, prev.last, { lat, lon }, 900);
        prev.last = { lat, lon };
      }
    });
    for (const [uid, obj] of driverMarkers.entries()) {
      if (!seen.has(uid)) {
        try { obj.marker.remove(); } catch (_) {}
        driverMarkers.delete(uid);
      }
    }
  });
}

async function initAdmin() {
  admin = await loadEgyptAdmin();
  const govs = admin.governorates.map((g) => g.name);
  fillSelect(pGov, govs);

  const setCenters = (govName) => {
    const g = admin.governorates.find((x) => x.name === govName);
    fillSelect(pCenter, g?.centers || ["—"]);
  };

  setCenters(pGov.value);
  pGov.addEventListener("change", () => {
    setCenters(pGov.value);
    if (pGov.value && pCenter.value) startLiveDriversLayer({ governorate: pGov.value, center: pCenter.value });
  });
  pCenter.addEventListener("change", () => {
    if (pGov.value && pCenter.value) startLiveDriversLayer({ governorate: pGov.value, center: pCenter.value });
  });

  const vehicles = admin.vehicleTypes;
  const render = () => {
    renderVehicleGrid(pVehicles, vehicles, passengerVehicle, (id) => {
      passengerVehicle = id;
      render();
    });
  };
  render();

  if (pGov.value && pCenter.value) startLiveDriversLayer({ governorate: pGov.value, center: pCenter.value });
}

function watchCurrentRide(userId) {
  if (currentRideListUnsub) currentRideListUnsub();
  currentRideListUnsub = onSnapshot(query(collection(db, "rides"), where("passengerId", "==", userId)), (snap) => {
    const docs = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .filter((r) => ["requested", "offered", "accepted", "arrived"].includes(r.status) && r.archived !== true)
      .sort((a, b) => {
        const at = a.createdAt?.toMillis?.() || 0;
        const bt = b.createdAt?.toMillis?.() || 0;
        return bt - at;
      });

    const ride = docs[0] || null;

    if (!ride) {
      if (currentRideDocUnsub) { currentRideDocUnsub(); currentRideDocUnsub = null; }
      rideUiNone();
      return;
    }

    if (currentRideId === ride.id && currentRideDocUnsub) return;
    currentRideId = ride.id;
    if (currentRideDocUnsub) currentRideDocUnsub();
    currentRideDocUnsub = onSnapshot(doc(db, "rides", currentRideId), handleRideSnapshot);
  });
}

async function handleRideSnapshot(rideSnap) {
  if (!rideSnap.exists()) {
    rideUiNone();
    return;
  }
  const ride = rideSnap.data();
  if (ride.archived === true && ride.status !== "completed") {
    rideUiNone();
    return;
  }
  currentRideId = rideSnap.id;
  currentPickup = ride.pickup?.lat && ride.pickup?.lon ? { lat: Number(ride.pickup.lat), lon: Number(ride.pickup.lon) } : null;

  updateRideActionVisibility(ride);
  btnRequest.disabled = true;
  btnCancel.disabled = !(ride.status === "requested" || ride.status === "offered");
  btnAcceptOffer.disabled = ride.status !== "offered";
  btnRejectOffer.disabled = ride.status !== "offered";
  btnTrack.disabled = !(ride.status === "accepted" || ride.status === "arrived");
  btnComplete.disabled = !(ride.status === "accepted" || ride.status === "arrived");
  btnCall.disabled = !(ride.status === "accepted" || ride.status === "arrived");
  btnWhats.disabled = !(ride.status === "accepted" || ride.status === "arrived");

  if (ride.status === "requested") {
    setText(routeMeta, "جاري البحث عن سائق...");
    setStatus("جاري البحث");
    stopDriverTracking();
  } else if (ride.status === "offered") {
    setText(routeMeta, "وصل عرض سعر من السائق. اختر قبول أو رفض.");
    setStatus("وصل عرض");
    stopDriverTracking();
  } else if (ride.status === "accepted") {
    setText(routeMeta, "السائق في الطريق إليك...");
    setStatus("السائق في الطريق");
    if (ride.driverId) startDriverTracking(ride.driverId);
  } else if (ride.status === "arrived") {
    setText(routeMeta, "السائق وصل لمكان القيام ✅");
    setStatus("السائق وصل");
    if (ride.driverId) startDriverTracking(ride.driverId);
  } else if (ride.status === "completed") {
    setText(routeMeta, "الرحلة انتهت ✅");
    setStatus("الرحلة انتهت");

    stopDriverTracking();

    if (!ride.passengerRating) {
      renderStars(0);
      setText(rateHint, "");
      showRatingModal();
    } else {
      if (currentRideDocUnsub) {
        currentRideDocUnsub();
        currentRideDocUnsub = null;
      }
      rideUiNone();
      return;
    }
  } else if (ride.status === "canceled") {
    setText(routeMeta, "تم إلغاء الطلب.");
    setStatus("تم الإلغاء");

    stopDriverTracking();

    if (currentRideDocUnsub) {
      currentRideDocUnsub();
      currentRideDocUnsub = null;
    }
    rideUiNone();
    return;
  }
  if (ride.arrivedAtPickup === true && arrivedToastShownFor !== currentRideId) {
    arrivedToastShownFor = currentRideId;
    notify({ title: "السائق وصل", body: "السائق وصل لمكان القيام ✅", tag: "driver-arrived" });
  }

  const driverProfile = (ride.status === "accepted" || ride.status === "arrived" || ride.status === "completed")
    ? {
        name: ride.driverName || "",
        phone: ride.driverPhone || "",
        vehicleType: ride.driverVehicleType || ride.vehicleType || "",
        vehicleCode: ride.driverVehicleCode || "",
      }
    : null;

  renderRideCard(ride, driverProfile);
  if (driverProfile) setDriverContactButtons(driverProfile.phone);
  else setDriverContactButtons(null);

}

bindSearch(pickupText, pickupResults, (it) => {
  setPickup({ lat: Number(it.lat), lon: Number(it.lon), text: it.display || it.text || "" });
}, { getBiasLocation: () => myLocation });

bindSearch(dropText, dropResults, (it) => {
  setDropoff({ lat: Number(it.lat), lon: Number(it.lon), text: it.display || it.text || "" });
}, { getBiasLocation: () => myLocation });

priceSlider.addEventListener("input", () => {
  priceSlider.dataset.touched = "1";
  updatePriceUI();
});

btnLocate.addEventListener("click", () => {
  locateOnce(map, (loc) => {
    myLocation = loc;
    showMyLocation(map, loc, { pan: true });
  });
});

pickupMyLoc?.addEventListener("click", async () => {
  if (!myLocation?.lat || !myLocation?.lon) {
    notify({ title: "الموقع", body: "حدد موقعك أولاً (زر 🎯)" });
    return;
  }
  const lat = Number(myLocation.lat);
  const lon = Number(myLocation.lon);
  const name = (await reverseNameEG(lat, lon)) || "موقعي الحالي";
  setPickup({ lat, lon, text: name });
  map.setView([lat, lon], 16);
});

pickupPick.addEventListener("click", () => {
  pickMode = "pickup";
  setStatus("اختر القيام من الخريطة");
});

dropPick.addEventListener("click", () => {
  pickMode = "dropoff";
  setStatus("اختر الوصول من الخريطة");
});

map.on("click", (e) => {
  if (!pickMode) return;
  const point = {
    lat: e.latlng.lat,
    lon: e.latlng.lng,
    text: `(${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)})`,
  };
  if (pickMode === "pickup") setPickup(point);
  else setDropoff(point);
  pickMode = null;
});

btnRequest.addEventListener("click", async () => {
  const user = auth.currentUser;
  if (!user) return;

  if (!pickup || !dropoff || !Number.isFinite(lastDistanceMeters) || !Number.isFinite(lastDurationSec)) {
    setStatus("ناقص");
    setText(routeMeta, "لازم تحدد قيام/وصول ويتعمل مسار أولاً.");
    return;
  }

  // منع أكثر من طلب مفتوح لنفس الراكب على الواجهة
  if (currentRideId) {
    notify({ title: "يوجد طلب نشط", body: "أنهِ الطلب الحالي أو ألغِه أولاً.", tag: "ride-exists" });
    return;
  }

  const price = clampPrice(priceSlider.value);
  const expiresAt = Timestamp.fromMillis(Date.now() + 15 * 60 * 1000);
  setStatus("يرسل...");

  try {
    await updateDoc(doc(db, "users", user.uid), {
      governorate: pGov.value,
      center: pCenter.value,
      vehicleType: passengerVehicle,
      updatedAt: serverTimestamp(),
    }).catch(() => {});

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
      archived: false,
      passengerLoc: myLocation ? { lat: myLocation.lat, lon: myLocation.lon } : null,
    });

    currentRideId = rideRef.id;
    setText(routeMeta, "تم إرسال الطلب. جاري البحث عن سائق...");
    setStatus("جاري البحث");
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
    rideUiNone();
    return;
  }

  setStatus("جاري الإلغاء...");
  try {
    await updateDoc(doc(db, "rides", currentRideId), {
      status: "canceled",
      canceledAt: serverTimestamp(),
      archived: true,
    });
    cleanupRideState();
    rideUiNone();
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

    if (ride.pickup?.lat && ride.pickup?.lon) {
      currentPickup = { lat: Number(ride.pickup.lat), lon: Number(ride.pickup.lon) };
    }
    if (ride.driverId) startDriverTracking(ride.driverId);

    notify({ title: "تم قبول عرض السائق", body: `السعر النهائي: ${Math.round(ride.offerPrice)} ج`, tag: "offer-accepted" });
  } catch (e) {
    console.error(e);
    setStatus("خطأ");
  }
});

btnRejectOffer.addEventListener("click", async () => {
  if (!currentRideId) return;
  setStatus("يرفض...");
  try {
    await updateDoc(doc(db, "rides", currentRideId), {
      status: "requested",
      driverId: null,
      offerPrice: null,
      offeredAt: null,
      driverName: null,
      driverPhone: null,
      driverVehicleType: null,
      driverVehicleCode: null,
    });
    notify({ title: "تم رفض العرض", body: "عاد الطلب لقائمة الطلبات.", tag: "offer-rejected" });
  } catch {
    setStatus("خطأ");
  }
});

btnTrack.addEventListener("click", () => {
  if (driverMarker) {
    try { map.panTo(driverMarker.getLatLng()); } catch (_) {}
  }
});

btnComplete.addEventListener("click", async () => {
  if (!currentRideId) return;
  setStatus("يرسل طلب إنهاء...");
  try {
    await updateDoc(doc(db, "rides", currentRideId), {
      passengerEndRequested: true,
      passengerEndRequestedAt: serverTimestamp(),
    });
    notify({ title: "تم", body: "تم إرسال طلب إنهاء الرحلة للسائق.", tag: "end-requested" });
    setStatus("تم إرسال طلب إنهاء ✅");
  } catch (e) {
    console.error(e);
    setStatus("خطأ");
  }
});

rateSend?.addEventListener("click", async () => {
  if (!currentRideId) return;

  if (!ratingValue) {
    setText(rateHint, "اختر عدد نجوم أولاً.");
    return;
  }

  setText(rateHint, "جارٍ الإرسال...");

  try {
    await updateDoc(doc(db, "rides", currentRideId), {
      passengerRating: ratingValue,
      passengerComment: (rateComment?.value || "").trim(),
      ratedAt: serverTimestamp(),
      archived: true,
    });

    hideRatingModal();

    if (currentRideDocUnsub) {
      currentRideDocUnsub();
      currentRideDocUnsub = null;
    }

    cleanupRideState();
    rideUiNone();

    notify({
      title: "تم إرسال التقييم",
      body: "شكراً لمشاركتك رأيك.",
      tag: "rated"
    });
  } catch (e) {
    console.error("RATE ERROR:", e);
    setText(rateHint, "تعذر إرسال التقييم. جرّب مرة أخرى.");
  }
});

rateClose?.addEventListener("click", hideRatingModal);
rateSkip?.addEventListener("click", hideRatingModal);
rateModal?.addEventListener("click", (e) => {
  if (e.target === rateModal) hideRatingModal();
});
starsRoot?.addEventListener("click", (e) => {
  const t = e.target;
  if (!t || !t.classList.contains("star")) return;
  renderStars(Number(t.dataset.v || 0));
});

let sdSelectedVehicle = null;

async function openSwitchDriverModal() {
  const modal = $("#switchDriverModal");
  const hint = $("#switchDriverHint");
  hint.textContent = "";

  const adm = await loadEgyptAdmin();
  fillSelect($("#sdGov"), adm.governorates.map((g) => g.name));

  const setCenters = () => {
    const g = adm.governorates.find((x) => x.name === $("#sdGov").value);
    fillSelect($("#sdCenter"), g?.centers || ["-"]);
  };
  setCenters();
  $("#sdGov").addEventListener("change", setCenters);

  sdSelectedVehicle = adm.vehicleTypes?.[0]?.id || null;
  const render = () => {
    renderVehicleGrid($("#sdVehicles"), adm.vehicleTypes, sdSelectedVehicle, (id) => {
      sdSelectedVehicle = id;
      render();
    });
  };
  render();
  modal.classList.remove("hidden");
}

function closeSwitchDriverModal() {
  $("#switchDriverModal")?.classList.add("hidden");
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

  if (!gov || !center) { hint.textContent = "اختر المحافظة والمركز."; return; }
  if (!vehicleType) { hint.textContent = "اختر نوع المركبة."; return; }
  if (!vehicleCode) { hint.textContent = "اكتب كود المركبة."; return; }

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
  } catch (e) {
    console.error("SWITCH DRIVER ERROR:", e);
    hint.textContent = e?.message || "حدث خطأ أثناء التحويل";
  }
});

onAuthStateChanged(auth, async (user) => {
  if (!user) { location.href = "./index.html"; return; }
  await ensureNotificationPermission(true);

  const me = await getDoc(doc(db, "users", user.uid));
  myData = me.exists() ? me.data() : {};
  setText(meBadge, `${myData.name || "مستخدم"} • راكب`);

  await initAdmin().catch(() => {});
  if (myData.governorate) pGov.value = myData.governorate;
  pGov.dispatchEvent(new Event("change"));
  if (myData.center) pCenter.value = myData.center;
  if (myData.vehicleType) passengerVehicle = myData.vehicleType;

  locateOnce(map, (loc) => {
    myLocation = loc;
    showMyLocation(map, loc, { pan: true });
  });

  watchCurrentRide(user.uid);
});
