import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  doc, getDoc, updateDoc,
  collection, addDoc, getDocs,
  onSnapshot, query, where, orderBy,
  serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import { $, setText, moneyEGP, escapeHtml, haversineMeters, isRideExpired, getRideFreshMaxAgeMs, formatRideDate } from "./utils.js";
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
let completedToastShownFor = null;
let ratingValue = 0;
let pickMode = null;
let lastDistanceMeters = null;
let lastDurationSec = null;
let rideWatcherToken = 0;
let rideSearchTimer = null;
let chatUnsubPassenger = null;
const REQUEST_EXPIRE_MS = 3 * 60 * 1000;
const ACTIVE_RIDE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const DRIVER_ONLINE_MAX_AGE_MS = 2 * 60 * 1000;
const NEARBY_DRIVER_RADIUS_M = 8000;

const meBadge = $("#meBadge");
const logoutBtn = $("#logoutBtn");
const switchRoleBtn = $("#switchRoleBtn");
const menuBtnPassenger = $("#menuBtnPassenger");
const drawerBackdropPassenger = $("#drawerBackdropPassenger");
const sideDrawerPassenger = $("#sideDrawerPassenger");
const drawerClosePassenger = $("#drawerClosePassenger");

const drawerAccountPassenger = $("#drawerAccountPassenger");
const drawerTripsPassenger = $("#drawerTripsPassenger");
const drawerWalletPassenger = $("#drawerWalletPassenger");
const drawerSupportPassenger = $("#drawerSupportPassenger");
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
const btnChatPassenger = $("#btnChatPassenger");
const chatModalPassenger = $("#chatModalPassenger");
const chatBackdropPassenger = $("#chatBackdropPassenger");
const chatClosePassenger = $("#chatClosePassenger");
const chatMessagesPassenger = $("#chatMessagesPassenger");
const chatInputPassenger = $("#chatInputPassenger");
const chatSendPassenger = $("#chatSendPassenger");
const rateModal = $("#rateModal");
const rateClose = $("#rateClose");
const starsRoot = $("#stars");
const rateComment = $("#rateComment");
const rateSend = $("#rateSend");
const rateSkip = $("#rateSkip");
const rateHint = $("#rateHint");
const passengerStats = $("#passengerStats");
const passengerHistoryList = $("#passengerHistoryList");
const passengerTripsModal = $("#passengerTripsModal");
const passengerTripsClose = $("#passengerTripsClose");
const passengerTripsBackdrop = $("#passengerTripsBackdrop");

const map = createMap("map", { center: [26.56, 31.70], zoom: 13 });
const routeLayerRef = { current: null };
const driverRouteLayerRef = { current: null };

function setStatus(text) {
  setText(rideStatus, text);
}

function hideEl(el) {
  if (el) el.style.display = "none";
}

function showEl(el) {
  if (el) el.style.display = "";
}

function openPassengerDrawer() {
  drawerBackdropPassenger?.classList.remove("hidden");
  sideDrawerPassenger?.classList.add("open");
  sideDrawerPassenger?.setAttribute("aria-hidden", "false");
}

function closePassengerDrawer() {
  sideDrawerPassenger?.classList.remove("open");
  sideDrawerPassenger?.setAttribute("aria-hidden", "true");
  setTimeout(() => {
    drawerBackdropPassenger?.classList.add("hidden");
  }, 280);
}

function clearSearchResults(container) {
  if (!container) return;
  container.innerHTML = "";
  container.classList.add("hidden");
}

function showSearchResults(container) {
  if (!container) return;
  container.classList.remove("hidden");
}

function clearAllSearchResults() {
  clearSearchResults(pickupResults);
  clearSearchResults(dropResults);
}

function setupSearchResultsAutoHide(inputEl, resultsEl) {
  if (!inputEl || !resultsEl) return;

  inputEl.addEventListener("input", () => {
    const hasText = (inputEl.value || "").trim().length > 0;
    if (!hasText) {
      clearSearchResults(resultsEl);
      return;
    }
    showSearchResults(resultsEl);
  });

  inputEl.addEventListener("blur", () => {
    window.setTimeout(() => {
      if (!resultsEl.matches(":hover")) clearSearchResults(resultsEl);
    }, 180);
  });
}

function resetActionVisibility() {
  showEl(btnAcceptOffer);
  showEl(btnRejectOffer);
  showEl(btnCancel);
  showEl(btnComplete);
  showEl(btnTrack);
  showEl(btnCall);
  showEl(btnWhats);
  showEl(btnChatPassenger);
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
function buildPricingSummary(distanceMeters, durationSec, manualPrice) {
  const km = Number(distanceMeters || 0) / 1000;
  const mins = Number(durationSec || 0) / 60;
  const surge = Number(surgeMultiplier().toFixed(2));
  const baseFare = 15;
  const perKm = 8;
  const perMin = 0.35;
  const estimated = Math.round((baseFare + km * perKm + mins * perMin) * surge);
  return {
    baseFare,
    perKm,
    perMin,
    surge,
    distanceKm: Number(km.toFixed(2)),
    durationMin: Number(mins.toFixed(1)),
    estimatedPrice: estimated,
    finalPrice: clampPrice(manualPrice),
  };
}

function renderPassengerHistory(rides) {
  if (!passengerHistoryList || !passengerStats) return;
  const completed = rides.filter((r) => r.status === "completed");
  const total = completed.reduce((sum, r) => sum + Number(r.price || 0), 0);
  passengerStats.textContent = `رحلات مكتملة: ${completed.length} • إجمالي المدفوع: ${moneyEGP(total)}`;
  passengerHistoryList.innerHTML = "";
  if (!completed.length) {
    passengerHistoryList.innerHTML = `<div class="muted small">لا يوجد سجل رحلات بعد.</div>`;
    return;
  }
  completed.slice(0, 10).forEach((r) => {
    const item = document.createElement("div");
    item.className = "list-item";
    item.innerHTML = `
      <div class="row-between"><b>${moneyEGP(r.price)}</b><span class="muted small">${escapeHtml(formatRideDate(r.completedAt || r.createdAt || r.createdAtMs))}</span></div>
      <div class="muted small">قيام: ${escapeHtml(r.pickupText || "-")}</div>
      <div class="muted small">وصول: ${escapeHtml(r.dropoffText || "-")}</div>
      <div class="muted small">السائق: ${escapeHtml(r.driverName || "-")} • تقييمك: ${r.passengerRating ? `⭐ ${r.passengerRating}` : "—"}</div>
    `;
    passengerHistoryList.appendChild(item);
  });
}
function openPassengerChatModal() {
  if (!chatModalPassenger) return;
  chatModalPassenger.classList.remove("hidden");
}

function closePassengerChatModal() {
  if (!chatModalPassenger) return;
  chatModalPassenger.classList.add("hidden");
}

function openPassengerTripsModal() {
  if (!passengerTripsModal) return;
  passengerTripsModal.classList.remove("hidden");
}

function closePassengerTripsModal() {
  if (!passengerTripsModal) return;
  passengerTripsModal.classList.add("hidden");
}
let lastMsgCount = 0;

function renderPassengerChatMessages(rows = []) {
  if (!chatMessagesPassenger) return;

  if (!rows.length) {
    chatMessagesPassenger.innerHTML = `<div class="chat-empty">لا توجد رسائل بعد.</div>`;
    return;
  }

  chatMessagesPassenger.innerHTML = "";
  const myUid = auth.currentUser?.uid || null;

  rows.forEach((msg) => {
    const mine = msg.senderId === myUid;
    const item = document.createElement("div");
    item.className = `chat-msg ${mine ? "mine" : "other"}`;
    const time = msg.createdAt?.toDate?.()
  ? msg.createdAt.toDate().toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" })
  : "";

item.innerHTML = `
  <div class="chat-text">${escapeHtml(msg.text || "")}</div>
  <div class="chat-meta">
    <span class="chat-name">${escapeHtml(msg.senderName || "")}</span>
    <span class="chat-time">
${time} ${mine ? (msg.read ? "✔✔" : "✔") : ""}
</span>
  </div>
`;
    chatMessagesPassenger.appendChild(item);
  });

  chatMessagesPassenger.scrollTop = chatMessagesPassenger.scrollHeight;
}

function watchPassengerChat(rideId) {
  if (chatUnsubPassenger) {
    chatUnsubPassenger();
    chatUnsubPassenger = null;
  }

  if (!rideId) {
    renderPassengerChatMessages([]);
    return;
  }

  const q = query(
    collection(db, "rides", rideId, "messages"),
    orderBy("createdAt", "asc")
  );

  chatUnsubPassenger = onSnapshot(q, (snap) => {
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (rows.length > lastMsgCount) {
  const lastMsg = rows[rows.length - 1];
  if (lastMsg && lastMsg.senderId !== auth.currentUser?.uid) {
    const audio = new Audio("./assets/msg.mp3");
    audio.play().catch(() => {});
  }
}

lastMsgCount = rows.length;
    snap.docs.forEach(async (docSnap) => {
  const msg = docSnap.data();
  if (msg.senderRole === "driver" && msg.read !== true) {
    await updateDoc(doc(db, "rides", rideId, "messages", docSnap.id), {
      read: true
    });
  }
});
    renderPassengerChatMessages(rows);
  });
}

async function sendPassengerChatMessage() {
  const text = String(chatInputPassenger?.value || "").trim();
  if (!text || !currentRideId || !myData?.uid) return;

  try {
  await addDoc(collection(db, "rides", currentRideId, "messages"), {
  text,
  senderId: myData.uid,
  senderRole: "passenger",
  senderName: myData.name || "الراكب",
  createdAt: serverTimestamp(),
  typing: false,
  read: false
});

    chatInputPassenger.value = "";
  } catch (e) {
    console.error("sendPassengerChatMessage error", e);
    notify({ title: "تعذر الإرسال", body: "فشل إرسال الرسالة.", tag: "chat-send-failed" });
  }
}
function clearRideSearchTimer() {
  if (rideSearchTimer) {
    clearInterval(rideSearchTimer);
    rideSearchTimer = null;
  }
}

function formatSearchElapsed(seconds) {
  const s = Math.max(0, Number(seconds || 0));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function rideCreatedAtMs(ride) {
  return Number(
    ride?.createdAtMs ||
    ride?.clientCreatedAtMs ||
    ride?.createdAt?.toMillis?.() ||
    Date.now()
  );
}

function renderSearchingRideCard(ride) {
  clearRideSearchTimer();

  const startedAt = rideCreatedAtMs(ride);

  const render = () => {
    const elapsedSec = Math.floor((Date.now() - startedAt) / 1000);

    const nearbyStored =
      Array.isArray(ride?.nearestDrivers) ? ride.nearestDrivers.length :
      Array.isArray(ride?.nearestDriverIds) ? ride.nearestDriverIds.length : 0;

    const nearbyNow = Math.max(driverMarkers.size, nearbyStored);
    const offersCount = Number(ride?.offersCount || 0);
    const viewersCount = Number(ride?.driverViews || 0);
    const priceText = moneyEGP(ride?.price || 0);

    rideCard.innerHTML = `
      <div class="searching-ride-card">
        <div class="searching-head">
          <div class="searching-radar">
            <div class="searching-radar-center"></div>
          </div>
          <div>
            <div class="searching-title">جارٍ البحث عن سائقين قريبين...</div>
            <div class="searching-sub">
              يتم الآن إرسال طلبك داخل المنطقة المختارة ومتابعة السائقين المتاحين لحظة بلحظة.
            </div>
          </div>
        </div>

        <div class="searching-stats">
          <div class="search-stat">
            <span class="n">${nearbyNow}</span>
            <span class="t">قريبين الآن</span>
          </div>
          <div class="search-stat">
            <span class="n">${offersCount}</span>
            <span class="t">عروض</span>
          </div>
          <div class="search-stat">
            <span class="n">${viewersCount}</span>
            <span class="t">شاهدوا الطلب</span>
          </div>
          <div class="search-stat">
            <span class="n">${formatSearchElapsed(elapsedSec)}</span>
            <span class="t">الوقت</span>
          </div>
        </div>

        <div class="searching-progress"><span></span></div>

        <div class="searching-summary">
          <div class="searching-row">
            <span class="muted">من</span>
            <b>${escapeHtml(ride?.pickupText || "—")}</b>
          </div>
          <div class="searching-row">
            <span class="muted">إلى</span>
            <b>${escapeHtml(ride?.dropoffText || "—")}</b>
          </div>
          <div class="searching-row">
            <span class="muted">السعر الحالي</span>
            <b>${priceText}</b>
          </div>
        </div>

        <div class="searching-note">يمكنك تعديل السعر أو إلغاء الطلب قبل قبول أي سائق.</div>
      </div>
    `;
  };

  render();
  rideSearchTimer = setInterval(render, 1000);
}
function canUseDriverOnlineRow(d) {
  const lat = Number(d?.lat);
  const lon = Number(d?.lon ?? d?.lng);
  const lastSeenMs = Number(d?.lastSeenMs || 0);
  if (![lat, lon].every(Number.isFinite)) return false;
  if (!lastSeenMs) return false;
  return Date.now() - lastSeenMs <= DRIVER_ONLINE_MAX_AGE_MS;
}

async function findNearestDriversMeta({ governorate, center, vehicleType, pickupPoint, limit = 8 }) {
  try {
    const snap = await getDocs(query(
      collection(db, "driversOnline"),
      where("governorate", "==", governorate),
      where("center", "==", center)
    ));

    const rows = snap.docs
      .map((d) => ({ uid: d.id, ...d.data() }))
      .filter((d) => canUseDriverOnlineRow(d))
      .filter((d) => !vehicleType || !d.vehicleType || d.vehicleType === vehicleType)
      .map((d) => ({
        uid: d.uid,
        distanceToPickupM: Math.round(haversineMeters({ lat: d.lat, lon: d.lon }, pickupPoint)),
        vehicleType: d.vehicleType || null,
        lastSeenMs: Number(d.lastSeenMs || 0),
      }))
      .filter((d) => Number.isFinite(d.distanceToPickupM))
      .sort((a, b) => a.distanceToPickupM - b.distanceToPickupM)
      .filter((d, index) => index < limit && d.distanceToPickupM <= NEARBY_DRIVER_RADIUS_M);

    return {
      nearestDriverId: rows[0]?.uid || null,
      nearestDriverIds: rows.map((d) => d.uid),
      nearestDrivers: rows,
    };
  } catch (e) {
    console.warn("findNearestDriversMeta failed", e);
    return { nearestDriverId: null, nearestDriverIds: [], nearestDrivers: [] };
  }
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
  clearRideSearchTimer();
  currentRideId = null;
  currentPickup = null;
  arrivedToastShownFor = null;
  completedToastShownFor = null;
  stopDriverTracking();
  setDriverContactButtons(null);
  resetActionVisibility();

  if (btnChatPassenger) btnChatPassenger.disabled = true;
  if (chatUnsubPassenger) {
    chatUnsubPassenger();
    chatUnsubPassenger = null;
  }
  closePassengerChatModal();
  if (chatMessagesPassenger) chatMessagesPassenger.innerHTML = "";
  if (chatInputPassenger) chatInputPassenger.value = "";
}

function finalizePassengerRideCleanup() {
  try {
    closePassengerDrawer();
    closePassengerChatModal();
    hideRatingModal();
    hardResetPassengerUI();
  } catch (e) {
    console.error("Passenger cleanup error:", e);
  }
}

function hardResetPassengerUI() {
  clearRideSearchTimer();
  if (currentRideDocUnsub) {
    currentRideDocUnsub();
    currentRideDocUnsub = null;
  }

  currentRideId = null;
  currentPickup = null;
  arrivedToastShownFor = null;
  completedToastShownFor = null;

  stopDriverTracking();
  stopLiveDrivers();

  if (btnChatPassenger) btnChatPassenger.disabled = true;
if (chatUnsubPassenger) {
  chatUnsubPassenger();
  chatUnsubPassenger = null;
}
closePassengerChatModal();
if (chatMessagesPassenger) chatMessagesPassenger.innerHTML = "";
if (chatInputPassenger) chatInputPassenger.value = "";

  if (pickupMarker) {
    try { map.removeLayer(pickupMarker); } catch (_) {}
    pickupMarker = null;
  }

  if (dropMarker) {
    try { map.removeLayer(dropMarker); } catch (_) {}
    dropMarker = null;
  }

  removeRouteLayer(routeLayerRef);
  removeRouteLayer(driverRouteLayerRef);

  pickup = null;
  dropoff = null;
  lastDistanceMeters = null;
  lastDurationSec = null;

  if (pickupText) pickupText.value = "";
  if (dropText) dropText.value = "";

  setDriverContactButtons(null);

  rideCard.innerHTML = `<div class="muted">لا يوجد طلب نشط.</div>`;
  setText(routeMeta, "اختر قيام/وصول لرسم المسار");
  setText(distanceValue, "—");
  setText(priceValue, "—");
  setStatus("جاهز");
  ratingValue = 0;
if (rateComment) rateComment.value = "";
setText(rateHint, "");

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
  hideEl(btnChatPassenger);
}

function rideUiNone() {
  clearRideSearchTimer();
  hardResetPassengerUI();

  cleanupRideState();
  clearAll();

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
  hideEl(btnChatPassenger);

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
  clearSearchResults(pickupResults);
  if (pickupMarker) { try { map.removeLayer(pickupMarker); } catch (_) {} }
  pickupMarker = addMarker(map, [point.lat, point.lon], { icon: createPickupIcon() });
  updateRouteIfReady();
}

function setDropoff(point) {
  dropoff = point;
  dropText.value = point.text || point.display || "";
  clearSearchResults(dropResults);
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

  if (!myLocation?.lat || !myLocation?.lon) {
    notify({ title: "الموقع", body: "حدد موقعك أولاً (زر 🎯)" });
    return;
  }

  try {
    clearSearchResults(isPickup ? pickupResults : dropResults);
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
    hideEl(btnChatPassenger);
  } else if (ride.status === "offered") {
    hideEl(btnTrack);
    hideEl(btnComplete);
    hideEl(btnCall);
    hideEl(btnWhats);
    hideEl(btnChatPassenger);
  } else if (ride.status === "accepted" || ride.status === "arrived" || ride.status === "started") {
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
    hideEl(btnChatPassenger);
  }
}

function getRideStatusLabel(status) {
  switch (status) {
    case "requested": return "جاري البحث";
    case "offered": return "وصل عرض";
    case "accepted": return "السائق في الطريق";
    case "arrived": return "السائق وصل";
    case "started": return "الرحلة بدأت";
    case "completed": return "الرحلة انتهت";
    case "canceled": return "تم الإلغاء";
    default: return status || "-";
  }
}

function renderRideCard(ride, driverProfile) {
  clearRideSearchTimer();

  if (!ride) {
    rideCard.innerHTML = `<div class="muted">لا يوجد طلب نشط.</div>`;
    return;
  }

  if (ride.status === "requested") {
    renderSearchingRideCard(ride);
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

  if (ride.status === "accepted" || ride.status === "arrived" || ride.status === "started" || ride.status === "completed") {
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

if (r.isFallbackStraightLine) {
  setText(distanceValue, `🚗 السائق يبعد ${distanceText}`);
  setStatus(rideStatus.textContent === "السائق وصل" ? "السائق وصل" : "جارٍ تتبع السائق");
} else {
  setText(distanceValue, `🚗 السائق يبعد ${distanceText} • يصل خلال ${mins} دقيقة`);
  setStatus(rideStatus.textContent === "السائق وصل" ? "السائق وصل" : `السائق سيصل خلال ${mins} دقيقة`);
}
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
  liveDriversUnsub = onSnapshot(
  q,
  (snap) => {
    const seen = new Set();
    snap.forEach((row) => {
      const d = row.data();
      const uid = row.id;
      const lat = Number(d.lat);
      const lon = Number(d.lon ?? d.lng);
      const lastSeenMs = Number(d.lastSeenMs || 0);
      if (![lat, lon].every(Number.isFinite)) return;
      if (Date.now() - lastSeenMs > DRIVER_ONLINE_MAX_AGE_MS) return;
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
  },
  (err) => {
    console.error("PASSENGER liveDrivers ERROR:", err);
  }
);
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
  if (currentRideListUnsub) {
    currentRideListUnsub();
    currentRideListUnsub = null;
  }
  if (currentRideDocUnsub) {
    currentRideDocUnsub();
    currentRideDocUnsub = null;
  }

  const token = ++rideWatcherToken;
  currentRideId = null;

  currentRideListUnsub = onSnapshot(
    query(collection(db, "rides"), where("passengerId", "==", userId)),
    (snap) => {
      if (token !== rideWatcherToken) return;

      const now = Date.now();
      const docs = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((r) => {
  const activeOrFinished = ["requested", "offered", "accepted", "arrived", "started", "completed", "canceled"].includes(r.status);
  const allowArchivedFinished = r.status === "completed" || r.status === "canceled";

  return (
  r.passengerId === userId &&
  activeOrFinished &&
  (allowArchivedFinished || r.archived !== true) &&
  (allowArchivedFinished || !isRideExpired(r, getRideFreshMaxAgeMs(r.status) || ACTIVE_RIDE_MAX_AGE_MS, now))
);
})
        .sort((a, b) => {
          const at = a.createdAt?.toMillis?.() || 0;
          const bt = b.createdAt?.toMillis?.() || 0;
          return bt - at;
        });

      const ride = docs[0] || null;
      if (!ride) {
        hardResetPassengerUI();
        return;
      }

      if (currentRideId === ride.id && currentRideDocUnsub) return;

      if (currentRideDocUnsub) {
        currentRideDocUnsub();
        currentRideDocUnsub = null;
      }

      currentRideId = ride.id;
      currentRideDocUnsub = onSnapshot(
        doc(db, "rides", currentRideId),
        (rideSnap) => {
          if (token !== rideWatcherToken) return;
          handleRideSnapshot(rideSnap);
        }
      );
    },
    (err) => {
      console.error("watchCurrentRide error:", err);
      hardResetPassengerUI();
    }
  );
}

async function handleRideSnapshot(rideSnap) {
  if (!rideSnap.exists()) {
    hardResetPassengerUI();
    return;
  }

  if (!currentRideId || rideSnap.id !== currentRideId) return;

  const ride = rideSnap.data();
  const authUid = auth.currentUser?.uid || null;

  if (!authUid || ride.passengerId !== authUid) {
    if (currentRideDocUnsub) {
      currentRideDocUnsub();
      currentRideDocUnsub = null;
    }
    hardResetPassengerUI();
    return;
  }

  if (ride.archived === true || ride.status === "completed" || ride.status === "canceled") {
  if (ride.status === "completed") {
    if (completedToastShownFor !== rideSnap.id) {
      completedToastShownFor = rideSnap.id;

      notify({
        title: "تمت الرحلة بنجاح 🎉",
        body: "تم الوصول لمكان الوصول وإنهاء الرحلة بنجاح ✅",
        tag: "ride-completed"
      });
    }

    stopDriverTracking();
    removeRouteLayer(routeLayerRef);
    removeRouteLayer(driverRouteLayerRef);
    setText(distanceValue, "");
    setText(routeMeta, "");
    setStatus("تم الوصول");

    currentRideId = rideSnap.id;

    if (!ride.passengerRating) {
      renderStars(0);
      setText(rateHint, "");
      showRatingModal();
      return;
    }

    finalizePassengerRideCleanup();
    return;
  }

  if (currentRideDocUnsub) {
    currentRideDocUnsub();
    currentRideDocUnsub = null;
  }

  removeRouteLayer(routeLayerRef);
  removeRouteLayer(driverRouteLayerRef);
  setText(distanceValue, "");
  setText(routeMeta, "");
  stopDriverTracking();

  hardResetPassengerUI();
  return;
}

  currentRideId = rideSnap.id;
  currentPickup = ride.pickup?.lat && ride.pickup?.lon
    ? { lat: Number(ride.pickup.lat), lon: Number(ride.pickup.lon) }
    : null;

  updateRideActionVisibility(ride);
  btnRequest.disabled = true;
  btnCancel.disabled = !(ride.status === "requested" || ride.status === "offered");
  btnAcceptOffer.disabled = ride.status !== "offered";
  btnRejectOffer.disabled = ride.status !== "offered";
  btnTrack.disabled = !(ride.status === "accepted" || ride.status === "arrived" || ride.status === "started");
btnComplete.disabled = !(ride.status === "accepted" || ride.status === "arrived" || ride.status === "started");
btnCall.disabled = !(ride.status === "accepted" || ride.status === "arrived" || ride.status === "started");
btnWhats.disabled = !(ride.status === "accepted" || ride.status === "arrived" || ride.status === "started");
if (btnChatPassenger) btnChatPassenger.disabled = !(ride.status === "accepted" || ride.status === "arrived" || ride.status === "started");

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
} else if (ride.status === "started") {
  setText(routeMeta, "بدأت الرحلة ✅");
  setStatus("الرحلة بدأت");
  if (ride.driverId) startDriverTracking(ride.driverId);
}

  if (ride.arrivedAtPickup === true && arrivedToastShownFor !== currentRideId) {
    arrivedToastShownFor = currentRideId;
    notify({ title: "السائق وصل", body: "السائق وصل لمكان القيام ✅", tag: "driver-arrived" });
  }

  const driverProfile = (ride.status === "accepted" || ride.status === "arrived" || ride.status === "started")
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

pickupSearchBtn.addEventListener("click", () => manualSearch("pickup"));
dropSearchBtn.addEventListener("click", () => manualSearch("dropoff"));

bindSearch(pickupText, pickupResults, (it) => {
  setPickup({ lat: Number(it.lat), lon: Number(it.lon), text: it.display || it.text || "" });
}, { getBiasLocation: () => myLocation });

bindSearch(dropText, dropResults, (it) => {
  setDropoff({ lat: Number(it.lat), lon: Number(it.lon), text: it.display || it.text || "" });
}, { getBiasLocation: () => myLocation });

setupSearchResultsAutoHide(pickupText, pickupResults);
setupSearchResultsAutoHide(dropText, dropResults);

document.addEventListener("click", (event) => {
  const target = event.target;
  const insidePickup = pickupText?.contains(target) || pickupResults?.contains(target) || pickupSearchBtn?.contains(target) || pickupPick?.contains(target) || pickupMyLoc?.contains(target);
  const insideDrop = dropText?.contains(target) || dropResults?.contains(target) || dropSearchBtn?.contains(target) || dropPick?.contains(target);

  if (!insidePickup) clearSearchResults(pickupResults);
  if (!insideDrop) clearSearchResults(dropResults);
});

menuBtnPassenger?.addEventListener("click", openPassengerDrawer);
drawerClosePassenger?.addEventListener("click", closePassengerDrawer);
drawerBackdropPassenger?.addEventListener("click", closePassengerDrawer);

priceSlider.addEventListener("input", () => {
  priceSlider.dataset.touched = "1";
  updatePriceUI();
});

btnClear.addEventListener("click", clearAll);

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

map.on("click", async (e) => {
  if (!pickMode) return;
  const lat = e.latlng.lat;
  const lon = e.latlng.lng;
  const label = (await reverseNameEG(lat, lon)) || `(${lat.toFixed(5)}, ${lon.toFixed(5)})`;
  const point = { lat, lon, text: label };
  if (pickMode === "pickup") setPickup(point);
  else setDropoff(point);
  pickMode = null;
});

drawerAccountPassenger?.addEventListener("click", () => {
  closePassengerDrawer();
  window.scrollTo({ top: 0, behavior: "smooth" });
});

drawerTripsPassenger?.addEventListener("click", () => {
  closePassengerDrawer();
  openPassengerTripsModal();
});

drawerWalletPassenger?.addEventListener("click", () => {
  closePassengerDrawer();
  passengerStats?.scrollIntoView({ behavior: "smooth", block: "start" });
});

drawerSupportPassenger?.addEventListener("click", () => {
  closePassengerDrawer();
  notify({
    title: "الدعم",
    body: "تواصل معنا عبر واتساب السائق أو أضف وسيلة دعم مخصصة لاحقًا.",
    tag: "support-info"
  });
});

switchRoleBtn?.addEventListener("click", () => {
  closePassengerDrawer();
  openSwitchDriverModal();
});

logoutBtn?.addEventListener("click", async () => {
  closePassengerDrawer();
  stopLiveDrivers();
  stopDriverTracking();
  await signOut(auth);
  location.href = "./index.html";
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
  const createdAtMs = Date.now();
  const expiresAtMs = createdAtMs + REQUEST_EXPIRE_MS;
  const expiresAt = Timestamp.fromMillis(expiresAtMs);
  setStatus("يرسل...");

  try {
    await updateDoc(doc(db, "users", user.uid), {
      governorate: pGov.value,
      center: pCenter.value,
      vehicleType: passengerVehicle,
      updatedAt: serverTimestamp(),
    }).catch(() => {});

    const nearestMeta = await findNearestDriversMeta({
      governorate: pGov.value,
      center: pCenter.value,
      vehicleType: passengerVehicle,
      pickupPoint: pickup,
      limit: 8,
    });

    const rideRef = await addDoc(collection(db, "rides"), {
      passengerId: user.uid,
      passengerName: myData.name || "",
      passengerPhone: myData.phone || "",
      driverId: null,
      status: "requested",
      createdAt: serverTimestamp(),
      createdAtMs,
      clientCreatedAtMs: createdAtMs,
      expiresAt,
      expiresAtMs,
      governorate: pGov.value,
      center: pCenter.value,
      vehicleType: passengerVehicle,
      pickup: { lat: pickup.lat, lon: pickup.lon },
      dropoff: { lat: dropoff.lat, lon: dropoff.lon },
      pickupText: pickupText.value.trim(),
      dropoffText: dropText.value.trim(),
      distanceMeters: lastDistanceMeters,
      durationSec: lastDurationSec,
      pricing: buildPricingSummary(lastDistanceMeters, lastDurationSec, price),
      price,
      archived: false,
      passengerLoc: myLocation ? { lat: myLocation.lat, lon: myLocation.lon } : null,
      nearestDriverId: nearestMeta.nearestDriverId || null,
      nearestDriverIds: nearestMeta.nearestDriverIds || [],
      nearestDrivers: nearestMeta.nearestDrivers || [],
    });

    currentRideId = rideRef.id;
    setText(routeMeta, "تم إرسال الطلب. جاري البحث عن سائق...");
    setStatus("جاري البحث");
    notify({ title: "تم إرسال الطلب", body: "جارٍ البحث عن سائق...", tag: "ride-sent" });
  } catch (e) {
    console.error("ADD DOC ERROR:", e);
    const msg = String(e?.message || e || "");
    if (msg.includes("Missing or insufficient permissions") || msg.includes("permission-denied")) {
      alert("Firestore Rules تمنع إنشاء الطلب. فعّل القراءة والكتابة للمستخدم المسجل دخول مؤقتاً ثم أعد المحاولة.");
    } else {
      alert("FIRESTORE ERROR: " + msg);
    }
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
    const refreshedCreatedAtMs = Date.now();
    const refreshedExpiresAtMs = refreshedCreatedAtMs + REQUEST_EXPIRE_MS;
    const nearestMeta = await findNearestDriversMeta({
      governorate: pGov.value,
      center: pCenter.value,
      vehicleType: passengerVehicle,
      pickupPoint: pickup,
      limit: 8,
    });
    await updateDoc(doc(db, "rides", currentRideId), {
      status: "requested",
      driverId: null,
      offerPrice: null,
      offeredAt: null,
      driverName: null,
      driverPhone: null,
      driverVehicleType: null,
      driverVehicleCode: null,
      createdAtMs: refreshedCreatedAtMs,
      expiresAt: Timestamp.fromMillis(refreshedExpiresAtMs),
      expiresAtMs: refreshedExpiresAtMs,
      nearestDriverId: nearestMeta.nearestDriverId || null,
      nearestDriverIds: nearestMeta.nearestDriverIds || [],
      nearestDrivers: nearestMeta.nearestDrivers || [],
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

if (btnChatPassenger) {
  btnChatPassenger.addEventListener("click", () => {
    if (!currentRideId) return;
    openPassengerChatModal();
    watchPassengerChat(currentRideId);
  });
}

if (chatClosePassenger) {
  chatClosePassenger.addEventListener("click", closePassengerChatModal);
}

if (chatBackdropPassenger) {
  chatBackdropPassenger.addEventListener("click", closePassengerChatModal);
}

if (passengerTripsClose) {
  passengerTripsClose.addEventListener("click", closePassengerTripsModal);
}

if (passengerTripsBackdrop) {
  passengerTripsBackdrop.addEventListener("click", closePassengerTripsModal);
}

if (chatSendPassenger) {
  chatSendPassenger.addEventListener("click", sendPassengerChatMessage);
}

if (chatInputPassenger) {
  chatInputPassenger.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      sendPassengerChatMessage();
    }
  });

  chatInputPassenger.addEventListener("input", async () => {
    if (!currentRideId) return;
    try {
      await updateDoc(doc(db, "rides", currentRideId), {
        passengerTyping: true
      });
    } catch (_) {}
  });
}

rateSend?.addEventListener("click", async () => {
  if (!currentRideId) return;

  if (!ratingValue) {
    setText(rateHint, "اختر عدد نجوم أولاً.");
    return;
  }

  setText(rateHint, "جارٍ الإرسال...");

  try {
    const rideRef = doc(db, "rides", currentRideId);
    const rideSnap = await getDoc(rideRef);
    const ride = rideSnap.exists() ? rideSnap.data() : null;

    await updateDoc(rideRef, {
      passengerRating: ratingValue,
      passengerComment: (rateComment?.value || "").trim(),
      ratedAt: serverTimestamp(),
      archived: true,
    });

    if (ride?.driverId) {
      const driverRef = doc(db, "users", ride.driverId);
      const driverSnap = await getDoc(driverRef);
      if (driverSnap.exists()) {
        const d = driverSnap.data();
        const prevCount = Number(d.ratingCount || 0);
        const prevAvg = Number(d.ratingAvg || 0);
        const nextCount = prevCount + 1;
        const nextAvg = ((prevAvg * prevCount) + ratingValue) / nextCount;
        await updateDoc(driverRef, { ratingCount: nextCount, ratingAvg: Number(nextAvg.toFixed(2)), updatedAt: serverTimestamp() }).catch(() => {});
      }
    }

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

rateClose?.addEventListener("click", () => {
  hideRatingModal();
  finalizePassengerRideCleanup();
});
rateSkip?.addEventListener("click", () => {
  hideRatingModal();
  finalizePassengerRideCleanup();
});

rateModal?.addEventListener("click", (e) => {
  if (e.target === rateModal) {
    hideRatingModal();
    finalizePassengerRideCleanup();
  }
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
  uid: u.uid,
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
  if (myData.role === "admin") { location.href = "./admin.html"; return; }
  if (myData.status === "blocked") { await signOut(auth); alert("هذا الحساب محظور من الإدارة."); location.href = "./index.html"; return; }
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
