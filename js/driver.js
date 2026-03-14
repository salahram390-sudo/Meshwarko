import { auth, db } from "./firebase.js";
console.log("driver.js loaded ✅");
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  doc, getDoc, updateDoc, setDoc, deleteDoc, addDoc,
  collection, onSnapshot, query, where, orderBy,
  serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import { $, setText, moneyEGP, escapeHtml, haversineMeters, isRideExpired, isActiveRideStatus, normalizeArabicDigits, getRideFreshMaxAgeMs, formatRideDate } from "./utils.js";
import {
  createMap, addMarker, routeOSRM, drawRoute, locateOnce, showMyLocation,
  createCarIcon, moveCarMarkerSmooth, createPickupIcon, createDropoffIcon,
} from "./map.js";
import { loadEgyptAdmin } from "./admin_data.js";
import { notify, ensureNotificationPermission } from "./notify.js";

const meBadge = $("#meBadge");
const logoutBtn = $("#logoutBtn");
const switchRoleBtn = $("#switchRoleBtn");
const editProfileBtn = $("#editProfileBtn");
const btnLocate = $("#btnLocate");
const btnClear = $("#btnClear");
const btnRefresh = $("#btnRefresh");
const ridesList = $("#ridesList");
const selectedRideEl = $("#selectedRide");
const offerInput = $("#offerInput");
const btnSendOffer = $("#btnSendOffer");
const btnAccept = $("#btnAccept");
const btnComplete = $("#btnComplete");
const btnCancel = $("#btnCancel");
const btnTrackToggle = $("#btnTrackToggle");
const btnArrived = $("#btnArrived");
const driverStatus = $("#driverStatus");
const subText = $("#subText");
const driverWalletStats = $("#driverWalletStats");
const driverStartRideBtn = $("#driverStartRideBtn");
const driverHistoryList = $("#driverHistoryList");
const driverHistoryBtn = $("#driverHistoryBtn");
const driverHistoryCount = $("#driverHistoryCount");
const driverHistoryModal = $("#driverHistoryModal");
const driverHistoryClose = $("#driverHistoryClose");
const driverHistoryBackdrop = $("#driverHistoryBackdrop");
const btnChatDriver = $("#btnChatDriver");
const chatModalDriver = $("#chatModalDriver");
const chatBackdropDriver = $("#chatBackdropDriver");
const chatCloseDriver = $("#chatCloseDriver");
const chatMessagesDriver = $("#chatMessagesDriver");
const chatInputDriver = $("#chatInputDriver");
const chatSendDriver = $("#chatSendDriver");

const map = createMap("map", { center: [26.56, 31.70], zoom: 13 });
const routeLayerRef = { current: null };

let admin = null;
let myUser = null;
let myLocation = null;
let selectedRideId = null;
let selectedRideData = null;
let pickupMarker = null;
let dropMarker = null;
let liveDriverMarker = null;
let geoWatchId = null;
let trackingRideId = null;
let trackingEnabled = false;
let ridesUnsub = null;
let acceptedRideUnsub = null;
let heartbeatInterval = null;
let ownDriverPosDocRef = null;
let chatUnsubDriver = null;
const MAX_VISIBLE_RIDE_DISTANCE_M = 8000;

function setDriverStatus(t) { setText(driverStatus, t); }

function setTrackBtn() {
  if (!btnTrackToggle) return;
  btnTrackToggle.textContent = trackingEnabled ? "إيقاف التتبع" : "ابدأ التتبع";
}

function clampPrice(v) {
  const n = Number(normalizeArabicDigits(v));
  if (!Number.isFinite(n)) return null;
  return Math.min(3000, Math.max(15, Math.round(n / 5) * 5));
}
function renderDriverWallet() {
  if (!driverWalletStats || !myUser) return;
  driverWalletStats.innerHTML = `
    <div class="card-lite"><div class="muted small">الرصيد</div><div class="price" style="font-size:22px">${moneyEGP(myUser.walletBalance || 0)}</div></div>
    <div class="card-lite"><div class="muted small">إجمالي الأرباح</div><div class="price" style="font-size:22px">${moneyEGP(myUser.totalEarnings || 0)}</div></div>
    <div class="card-lite"><div class="muted small">الرحلات المكتملة</div><div class="price" style="font-size:22px">${escapeHtml(String(myUser.completedTrips || 0))}</div></div>
    <div class="card-lite"><div class="muted small">التقييم</div><div class="price" style="font-size:22px">${Number(myUser.ratingAvg || 0).toFixed(1)}</div></div>
  `;
}

function openDriverHistoryModal() {
  if (!driverHistoryModal) return;
  driverHistoryModal.classList.remove("hidden");
}

function closeDriverHistoryModal() {
  if (!driverHistoryModal) return;
  driverHistoryModal.classList.add("hidden");
}

function openDriverChatModal() {
  if (!chatModalDriver) return;
  chatModalDriver.classList.remove("hidden");
}

function closeDriverChatModal() {
  if (!chatModalDriver) return;
  chatModalDriver.classList.add("hidden");
}

function renderDriverChatMessages(rows = []) {
  if (!chatMessagesDriver) return;

  if (!rows.length) {
    chatMessagesDriver.innerHTML = `<div class="chat-empty">لا توجد رسائل بعد.</div>`;
    return;
  }

  chatMessagesDriver.innerHTML = "";
  const myUid = auth.currentUser?.uid || null;

  rows.forEach((msg) => {
    const mine = msg.senderId === myUid;
    const item = document.createElement("div");
    item.className = `chat-msg ${mine ? "mine" : "other"}`;
    item.innerHTML = `
      <div>${escapeHtml(msg.text || "")}</div>
      <span class="chat-meta">${escapeHtml(msg.senderName || "")}</span>
    `;
    chatMessagesDriver.appendChild(item);
  });

  chatMessagesDriver.scrollTop = chatMessagesDriver.scrollHeight;
}

function watchDriverChat(rideId) {
  if (chatUnsubDriver) {
    chatUnsubDriver();
    chatUnsubDriver = null;
  }

  if (!rideId) {
    renderDriverChatMessages([]);
    return;
  }

  const q = query(
    collection(db, "rides", rideId, "messages"),
    orderBy("createdAt", "asc")
  );

  chatUnsubDriver = onSnapshot(q, (snap) => {
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderDriverChatMessages(rows);
  });
}

async function sendDriverChatMessage() {
  const text = String(chatInputDriver?.value || "").trim();
  if (!text || !selectedRideId || !myUser) return;

  try {
    await addDoc(collection(db, "rides", selectedRideId, "messages"), {
      text,
      senderId: myUser.uid,
      senderRole: "driver",
      senderName: myUser.name || "السائق",
      createdAt: serverTimestamp(),
    });

    chatInputDriver.value = "";
  } catch (e) {
    console.error("sendDriverChatMessage error", e);
    notify({ title: "تعذر الإرسال", body: "فشل إرسال الرسالة.", tag: "chat-send-failed" });
  }
}

function renderDriverHistory(rides) {
  if (!driverHistoryList) return;

  const rows = [...(rides || [])].sort((a, b) => {
    const aTime = a?.completedAt?.toMillis?.() || a?.createdAt?.toMillis?.() || a?.createdAtMs || 0;
    const bTime = b?.completedAt?.toMillis?.() || b?.createdAt?.toMillis?.() || b?.createdAtMs || 0;
    return bTime - aTime;
  });

  if (driverHistoryCount) {
    driverHistoryCount.textContent = String(rows.length);
  }

  driverHistoryList.innerHTML = "";

  if (!rows.length) {
    driverHistoryList.innerHTML = `<div class="muted small">لا يوجد سجل رحلات بعد.</div>`;
    return;
  }

  rows.slice(0, 20).forEach((r) => {
    const item = document.createElement("div");
    item.className = "list-item history-item";
    item.innerHTML = `
      <div class="row-between">
        <b>${moneyEGP(r.price || 0)}</b>
        <span class="muted small">${escapeHtml(formatRideDate(r.completedAt || r.createdAt || r.createdAtMs))}</span>
      </div>

      <div class="muted small">الراكب: ${escapeHtml(r.passengerName || "-")} • ${escapeHtml(r.passengerPhone || "-")}</div>
      <div class="muted small">قيام: ${escapeHtml(r.pickupText || "-")}</div>
      <div class="muted small">وصول: ${escapeHtml(r.dropoffText || "-")}</div>
      <div class="muted small">الحالة: ${escapeHtml(r.status || "-")}</div>
      <div class="muted small">تقييم الراكب لك: ${r.passengerRating ? `⭐ ${r.passengerRating}` : "—"}</div>
    `;
    driverHistoryList.appendChild(item);
  });
}

function isRideVisibleForDriver(ride) {
  if (!ride || !isActiveRideStatus(ride.status) || ride.archived === true) return false;
  if (isRideExpired(ride, getRideFreshMaxAgeMs(ride.status))) return false;

  const myUid = auth.currentUser?.uid || null;
  if (ride.driverId && ride.driverId !== myUid) return false;
  if (myUser?.vehicleType && ride.vehicleType && myUser.vehicleType !== ride.vehicleType) return false;

  if (ride.status === "requested" && ride.driverId == null) {
    const nearestId = ride.nearestDriverId || null;
    const nearestIds = Array.isArray(ride.nearestDriverIds) ? ride.nearestDriverIds : [];
    if (nearestIds.length) return nearestIds.includes(myUid);
    if (nearestId) return nearestId === myUid;

    const distanceToMe = getRideDistanceToMe(ride);
    if (Number.isFinite(distanceToMe) && distanceToMe > MAX_VISIBLE_RIDE_DISTANCE_M) return false;
  }

  return true;
}

function getRideDistanceToMe(ride) {
  const myUid = auth.currentUser?.uid || null;
  const nearestRows = Array.isArray(ride?.nearestDrivers) ? ride.nearestDrivers : [];
  const match = nearestRows.find((row) => row?.uid === myUid);
  const cachedDistance = Number(match?.distanceToPickupM);
  if (Number.isFinite(cachedDistance)) return cachedDistance;

  if (!myLocation || !ride?.pickup) return Infinity;
  return haversineMeters(myLocation, { lat: ride.pickup.lat, lon: ride.pickup.lon });
}

function syncOfferBtn() {
  const v = Number((offerInput.value || "").trim());
  btnSendOffer.disabled = !selectedRideId || !Number.isFinite(v) || v <= 0;
}

offerInput.addEventListener("input", syncOfferBtn);

if (driverHistoryBtn) {
  driverHistoryBtn.addEventListener("click", openDriverHistoryModal);
  driverHistoryBtn.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openDriverHistoryModal();
    }
  });
}

if (driverHistoryClose) {
  driverHistoryClose.addEventListener("click", closeDriverHistoryModal);
}

if (driverHistoryBackdrop) {
  driverHistoryBackdrop.addEventListener("click", closeDriverHistoryModal);
}

if (btnChatDriver) {
  btnChatDriver.addEventListener("click", () => {
    if (!selectedRideId) return;
    openDriverChatModal();
    watchDriverChat(selectedRideId);
  });
}

if (chatCloseDriver) {
  chatCloseDriver.addEventListener("click", closeDriverChatModal);
}

if (chatBackdropDriver) {
  chatBackdropDriver.addEventListener("click", closeDriverChatModal);
}

if (chatSendDriver) {
  chatSendDriver.addEventListener("click", sendDriverChatMessage);
}

if (chatInputDriver) {
  chatInputDriver.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      sendDriverChatMessage();
    }
  });
}

function clearRouteAndMarkers() {
  try {
    if (routeLayerRef.current) {
      map.removeLayer(routeLayerRef.current);
      routeLayerRef.current = null;
    }
  } catch (_) {}
  if (pickupMarker) { try { map.removeLayer(pickupMarker); } catch (_) {} }
  if (dropMarker) { try { map.removeLayer(dropMarker); } catch (_) {} }
  pickupMarker = null;
  dropMarker = null;
}

function resetSelectedRideUi(message = "لم يتم تحديد طلب.") {
  if (acceptedRideUnsub) {
    acceptedRideUnsub();
    acceptedRideUnsub = null;
  }

  selectedRideId = null;
  selectedRideData = null;
  selectedRideEl.innerHTML = `<div class="muted">${escapeHtml(message)}</div>`;
  clearRouteAndMarkers();
  btnSendOffer.disabled = true;
  btnAccept.disabled = true;
  btnTrackToggle.disabled = true;
  btnCancel.disabled = true;
  btnArrived.disabled = true;
  btnComplete.disabled = true;
  driverStartRideBtn.disabled = true;
  offerInput.value = "";
  stopLiveTracking();
}

function updateOwnDriverMarker(lat, lon, pan = false) {
  const next = { lat: Number(lat), lon: Number(lon) };
  if (![next.lat, next.lon].every(Number.isFinite)) return;

  liveDriverMarker = showMyLocation(map, next, { pan });
}

async function pushDriverOnline() {
  const u = auth.currentUser;
  if (!u || !myUser || !myLocation || !ownDriverPosDocRef) return;
  try {
    await setDoc(ownDriverPosDocRef, {
      uid: u.uid,
      name: myUser.name || "",
      governorate: myUser.governorate || "",
      center: myUser.center || "",
      vehicleType: myUser.vehicleType || "",
      lat: myLocation.lat,
      lon: myLocation.lon,
      lastSeenMs: Date.now(),
      updatedAt: serverTimestamp(),
    }, { merge: true });
  } catch (e) {
    console.error("pushDriverOnline error", e);
  }
}

async function cleanupDriverOnline() {
  try {
    if (ownDriverPosDocRef) await deleteDoc(ownDriverPosDocRef);
  } catch (e) {
    console.warn("cleanupDriverOnline failed", e);
  }
}

function startDriverHeartbeat() {
  if (heartbeatInterval) return;
  heartbeatInterval = setInterval(pushDriverOnline, 2000);
}

function stopDriverHeartbeat() {
  if (heartbeatInterval) clearInterval(heartbeatInterval);
  heartbeatInterval = null;
}

function startLiveTracking(rideId) {
  if (!navigator.geolocation) return;
  stopLiveTracking();
  trackingRideId = rideId;
  trackingEnabled = true;
  setTrackBtn();

  const pushRideLoc = async (lat, lon) => {
    try {
      await updateDoc(doc(db, "rides", trackingRideId), {
        driverLoc: { lat, lon },
        driverLocUpdatedAt: serverTimestamp(),
      });
    } catch (e) {
      console.warn("update driverLoc failed", e);
    }
  };

  geoWatchId = navigator.geolocation.watchPosition(async (pos) => {
    const lat = pos.coords.latitude;
    const lon = pos.coords.longitude;
    myLocation = { lat, lon };
    updateOwnDriverMarker(lat, lon, false);
    await pushDriverOnline();
    if (trackingRideId) await pushRideLoc(lat, lon);
  }, () => {}, { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 });
}

function stopLiveTracking() {
  if (geoWatchId != null) navigator.geolocation.clearWatch(geoWatchId);
  geoWatchId = null;
  trackingRideId = null;
  trackingEnabled = false;
  setTrackBtn();
}

async function initAdmin() {
  admin = await loadEgyptAdmin();
}

function watchPassengerEndRequest(rideId) {

  if (!rideId) {
    console.warn("watchPassengerEndRequest skipped: rideId missing");
    return;
  }

  if (acceptedRideUnsub) {
    acceptedRideUnsub();
    acceptedRideUnsub = null;
  }

  acceptedRideUnsub = onSnapshot(doc(db, "rides", rideId), (snap) => {

    if (!snap.exists()) return;

    const ride = snap.data();
    selectedRideData = { ...ride, id: rideId };

    refreshSelectedRideButtons(selectedRideData);

    if ((ride.status === "accepted" || ride.status === "arrived" || ride.status === "started") && ride.passengerEndRequested === true) {
  btnComplete.disabled = false;
}

    if (ride.status === "completed" || ride.status === "canceled") {

      if (acceptedRideUnsub) {
        acceptedRideUnsub();
        acceptedRideUnsub = null;
      }

      resetSelectedRideUi(
        ride.status === "completed"
          ? "تم إنهاء الرحلة"
          : "تم إلغاء الرحلة"
      );
    }

  });

}

async function drawRideRoute(ride) {
  try {
    const p = ride.pickup || {};
    const d = ride.dropoff || {};
    const start = { lat: Number(p.lat), lon: Number(p.lon) };
    const end = { lat: Number(d.lat), lon: Number(d.lon) };
    if (![start.lat, start.lon, end.lat, end.lon].every(Number.isFinite)) return;
    const r = await routeOSRM(start, end);
    drawRoute(map, r.geojson, routeLayerRef);
  } catch (e) {
    console.error("ROUTE ERROR:", e);
  }
}

function refreshSelectedRideButtons(ride) {
  const myUid = auth.currentUser?.uid || null;
  const mine = ride?.driverId === myUid;
  const status = String(ride?.status || "");
  const canOffer = status === "requested" && !ride?.driverId;
  const canAccept =
    (status === "requested" && !ride?.driverId) ||
    (status === "offered" && (!ride?.driverId || mine)) ||
    (status === "accepted" && mine);
  const canTrack = mine && (status === "accepted" || status === "arrived" || status === "started");
const canArrive = mine && status === "accepted";
const canStart = mine && status === "arrived";
const canComplete = mine && (status === "started" || ride?.passengerEndRequested === true);
const canCancel = mine && (status === "accepted" || status === "arrived" || status === "started" || status === "offered");
  const canChat = mine && (status === "accepted" || status === "arrived" || status === "started");
  driverStartRideBtn.disabled = !canStart;
  btnSendOffer.disabled = !canOffer;
  btnAccept.disabled = !canAccept;
  btnTrackToggle.disabled = !canTrack;
  btnCancel.disabled = !canCancel;
  btnArrived.disabled = !canArrive;
  btnComplete.disabled = !canComplete;

  if (!canTrack) {
    trackingEnabled = false;
    setTrackBtn();
  }
}

async function selectRide(id, ride) {
  selectedRideId = id;
  selectedRideData = ride;
  syncOfferBtn();
  refreshSelectedRideButtons(ride);

  if (pickupMarker) { try { map.removeLayer(pickupMarker); } catch (_) {} }
  if (dropMarker) { try { map.removeLayer(dropMarker); } catch (_) {} }
  if (ride?.pickup?.lat != null && ride?.pickup?.lon != null) pickupMarker = addMarker(map, [ride.pickup.lat, ride.pickup.lon], { icon: createPickupIcon() });
  if (ride?.dropoff?.lat != null && ride?.dropoff?.lon != null) dropMarker = addMarker(map, [ride.dropoff.lat, ride.dropoff.lon], { icon: createDropoffIcon() });

  const distanceToMe = getRideDistanceToMe(ride);
  selectedRideEl.innerHTML = `
    <div class="row-between"><b>السعر</b><span>${moneyEGP(ride.price)}</span></div>
    ${ride.offerPrice ? `<div class="row-between"><b>عرض حالي</b><span>${moneyEGP(ride.offerPrice)}</span></div>` : ""}
    <div class="muted small">المنطقة: ${escapeHtml(ride.governorate || "-")} / ${escapeHtml(ride.center || "-")} • مركبة: ${escapeHtml(ride.vehicleType || "-")}</div>
    <div class="muted small">قيام: ${escapeHtml(ride.pickupText || "—")}</div>
    <div class="muted small">وصول: ${escapeHtml(ride.dropoffText || "—")}</div>
    <div class="muted small">${Number.isFinite(distanceToMe) ? `يبعد عنك ${(distanceToMe / 1000).toFixed(1)} كم` : ""}</div>
    <div class="muted small">بيانات الراكب تظهر بعد القبول.</div>
  `;

  await drawRideRoute(ride);
}

async function showAcceptedDetails(rideId) {
  const rideSnap = await getDoc(doc(db, "rides", rideId));
  if (!rideSnap.exists()) return;
  const ride = rideSnap.data();
  await drawRideRoute(ride);

  selectedRideEl.innerHTML = `
    <div class="row-between"><b>الحالة</b><span class="muted">${escapeHtml(ride.status || "accepted")}</span></div>
    <div class="row-between"><b>السعر النهائي</b><span>${moneyEGP(ride.price)}</span></div>
    <div class="muted small">قيام: ${escapeHtml(ride.pickupText || "—")}</div>
    <div class="muted small">وصول: ${escapeHtml(ride.dropoffText || "—")}</div>
    <div class="divider"></div>
    <div><b>الراكب</b></div>
    <div class="muted small">الاسم: ${escapeHtml(ride.passengerName || "-")}</div>
    <div class="muted small">الهاتف: ${escapeHtml(ride.passengerPhone || "-")}</div>
    <div class="muted small">المنطقة: ${escapeHtml(ride.governorate || "-")} / ${escapeHtml(ride.center || "-")}</div>
  `;
}

function watchRidesForDriver() {
  if (ridesUnsub) {
    ridesUnsub();
    ridesUnsub = null;
  }

  if (!myUser?.governorate || !myUser?.center || !auth.currentUser?.uid) return;

  const driverUid = auth.currentUser.uid;

  const qOpen = query(
  collection(db, "rides"),
  where("status", "==", "requested"),
  where("driverId", "==", null),
  where("archived", "==", false),
  where("governorate", "==", myUser.governorate),
  where("center", "==", myUser.center)
);

  const qMine = query(
    collection(db, "rides"),
    where("driverId", "==", driverUid)
  );

  let openRows = [];
  let mineRows = [];

  const renderMerged = () => {
    const mergedMap = new Map();

    [...openRows, ...mineRows].forEach((r) => {
      if (isRideVisibleForDriver(r)) {
        mergedMap.set(r.id, r);
      }
    });

    const rides = Array.from(mergedMap.values()).sort((a, b) => {
      const aMine = a.driverId === driverUid ? 1 : 0;
      const bMine = b.driverId === driverUid ? 1 : 0;
      if (aMine !== bMine) return bMine - aMine;
      const da = getRideDistanceToMe(a);
      const db = getRideDistanceToMe(b);
      if (Number.isFinite(da) || Number.isFinite(db)) return da - db;
      return (b.createdAt?.toMillis?.() || b.createdAtMs || 0) - (a.createdAt?.toMillis?.() || a.createdAtMs || 0);
    });

    ridesList.innerHTML = "";

    renderDriverHistory(mineRows.filter((r) => r.status === "completed"));
    if (!rides.length) {
      ridesList.innerHTML = `<div class="muted small">لا توجد طلبات متاحة الآن في منطقتك.</div>`;
      return;
    }

    const preferredRide =
      rides.find((r) => r.driverId === driverUid && (r.status === "accepted" || r.status === "arrived")) ||
      rides.find((r) => r.id === selectedRideId) ||
      rides[0];

    if (preferredRide && preferredRide.id !== selectedRideId) {
      selectRide(preferredRide.id, preferredRide).catch((e) => console.warn("auto-select ride failed", e));
    }

    rides.forEach((r) => {
      const item = document.createElement("div");
      item.className = "list-item" + (selectedRideId === r.id ? " active" : "");
      item.innerHTML = `
        <div class="row-between">
          <b>${r.driverId === driverUid ? "طلبي الحالي" : "طلب"}</b>
          <span class="muted small">${moneyEGP(r.offerPrice || r.price)}</span>
        </div>
        <div class="muted small">مركبة: ${escapeHtml(r.vehicleType || "-")}</div>
        <div class="muted small">قيام: ${escapeHtml(r.pickupText || "-")}</div>
        <div class="muted small">وصول: ${escapeHtml(r.dropoffText || "-")}</div>
        <div class="muted small">${Number.isFinite(getRideDistanceToMe(r)) ? `يبعد عنك ${(getRideDistanceToMe(r)/1000).toFixed(1)} كم` : ""}</div>
      `;
      item.onclick = () => selectRide(r.id, r);
      ridesList.appendChild(item);
    });
  };

  const unsubOpen = onSnapshot(
    qOpen,
    (snap) => {
      openRows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderMerged();
    },
    (err) => {
      console.error("qOpen snapshot error:", err);
      const isPermission = String(err?.code || err?.message || "").includes("permission");
      ridesList.innerHTML = `<div class="muted small">${isPermission ? "Firestore Rules تمنع قراءة الطلبات." : "تعذر تحميل الطلبات المفتوحة."}</div>`;
    }
  );

  const unsubMine = onSnapshot(
    qMine,
    (snap) => {
      mineRows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      renderMerged();
    },
    (err) => {
      console.error("qMine snapshot error:", err);
    }
  );

  ridesUnsub = () => {
    try { unsubOpen(); } catch (_) {}
    try { unsubMine(); } catch (_) {}
  };
}

logoutBtn.addEventListener("click", async () => {
  stopLiveTracking();
  stopDriverHeartbeat();
  await cleanupDriverOnline();
  await signOut(auth);
  location.href = "./index.html";
});

switchRoleBtn.addEventListener("click", () => { location.href = "./passenger.html"; });

btnLocate.addEventListener("click", () => {
  locateOnce(map, (loc) => {
    myLocation = loc;
    updateOwnDriverMarker(loc.lat, loc.lon, true);
    pushDriverOnline();
  });
});

btnClear.addEventListener("click", () => {
  resetSelectedRideUi("لم يتم تحديد طلب.");
});

btnRefresh.addEventListener("click", () => {
  subText.textContent = "تم التحديث.";
  setTimeout(() => { subText.textContent = "اختر طلب ثم اقبل أو اقترح سعر"; }, 900);
});

btnTrackToggle?.addEventListener("click", () => {
  if (!selectedRideId) return;
  if (!trackingEnabled) {
    notify({ title: "التتبع", body: "بدأ تتبع الموقع.", tag: "track-on" });
    startLiveTracking(selectedRideId);
  } else {
    notify({ title: "التتبع", body: "تم إيقاف التتبع.", tag: "track-off" });
    stopLiveTracking();
  }
});
setTrackBtn();

btnSendOffer.addEventListener("click", async () => {
  if (!selectedRideId || !myUser) return;
  const offer = clampPrice(offerInput.value);
  if (!offer) {
    notify({ title: "سعر غير صحيح", body: "اكتب سعر بين 15 و 3000 بخطوة 5.", tag: "bad-offer" });
    return;
  }

  setDriverStatus("يرسل عرض...");
  try {
    const rideRef = doc(db, "rides", selectedRideId);
    const rideSnap = await getDoc(rideRef);
    if (!rideSnap.exists()) throw new Error("الطلب غير موجود");
    const liveRide = rideSnap.data();
    if (!isRideVisibleForDriver(liveRide) || liveRide.status !== "requested") throw new Error("الطلب لم يعد متاحاً");

    await updateDoc(rideRef, {
      status: "offered",
      driverId: myUser.uid,
      offerPrice: offer,
      driverName: myUser.name || "",
      driverPhone: myUser.phone || "",
      driverVehicleType: myUser.vehicleType || "",
      driverVehicleCode: myUser.vehicleCode || "",
      offeredAt: serverTimestamp(),
    });
    btnSendOffer.disabled = true;
    setTimeout(syncOfferBtn, 800);
    notify({ title: "تم إرسال العرض", body: `عرض سعر: ${offer} ج`, tag: "offer-sent" });
    setDriverStatus("بانتظار رد الراكب");
  } catch (e) {
    console.error(e);
    setDriverStatus("خطأ");
  }
});

btnAccept.addEventListener("click", async () => {
  if (!selectedRideId || !myUser) return;
  setDriverStatus("يقبل...");
  try {
    const rideRef = doc(db, "rides", selectedRideId);
    const rideSnap = await getDoc(rideRef);
    if (!rideSnap.exists()) throw new Error("الطلب غير موجود");
    const liveRide = rideSnap.data();
    const status = String(liveRide?.status || "");
    const mine = liveRide?.driverId === myUser.uid;

    if (isRideExpired(liveRide) || liveRide.archived === true) throw new Error("الطلب منتهي");
    if (liveRide.driverId && liveRide.driverId !== myUser.uid) throw new Error("تم التقاط الطلب بواسطة سائق آخر");

    if (status === "accepted" && mine) {
      selectedRideData = { ...liveRide, id: selectedRideId };
      refreshSelectedRideButtons(selectedRideData);
      await showAcceptedDetails(selectedRideId);
      if (selectedRideId) {
  watchPassengerEndRequest(selectedRideId);
}
      notify({ title: "الرحلة مقبولة بالفعل", body: "الطلب مسجل باسمك بالفعل.", tag: "ride-already-accepted" });
      setDriverStatus("على الطريق");
      return;
    }

    if (!["requested", "offered"].includes(status)) {
      throw new Error(`لا يمكن قبول الطلب الآن لأن حالته الحالية هي: ${status || "غير معروفة"}`);
    }

    await updateDoc(rideRef, {
      status: "accepted",
      driverId: myUser.uid,
      driverName: myUser.name || "",
      driverPhone: myUser.phone || "",
      driverVehicleType: myUser.vehicleType || "",
      driverVehicleCode: myUser.vehicleCode || "",
      price: liveRide.offerPrice || liveRide.price || 0,
      acceptedAt: serverTimestamp(),
      expiresAt: null,
      expiresAtMs: null,
    });

    selectedRideData = {
      ...liveRide,
      id: selectedRideId,
      status: "accepted",
      driverId: myUser.uid,
      driverName: myUser.name || "",
      driverPhone: myUser.phone || "",
      driverVehicleType: myUser.vehicleType || "",
      driverVehicleCode: myUser.vehicleCode || "",
      price: liveRide.offerPrice || liveRide.price || 0,
      expiresAt: null,
      expiresAtMs: null,
    };
    refreshSelectedRideButtons(selectedRideData);
    await showAcceptedDetails(selectedRideId);

if (selectedRideId) {
  startLiveTracking(selectedRideId);
  watchPassengerEndRequest(selectedRideId);
}
    notify({ title: "تم قبول الطلب", body: "الآن يمكنك بدء التتبع والتوجه للراكب.", tag: "ride-accepted" });
    setDriverStatus("على الطريق");
  } catch (e) {
    console.error("DRIVER ACCEPT ERROR:", e);
    alert("ACCEPT ERROR: " + (e?.message || e));
    setDriverStatus("خطأ");
  }
});

btnArrived.addEventListener("click", async () => {
  if (!selectedRideId) return;
  setDriverStatus("وصل لموقع الراكب");
  try {
    await updateDoc(doc(db, "rides", selectedRideId), {
      status: "arrived",
      arrivedAtPickup: true,
      arrivedAt: serverTimestamp(),
    });
    btnArrived.disabled = true;
    notify({ title: "وصلت", body: "تم إشعار الراكب أنك وصلت", tag: "arrived" });
  } catch (e) {
    console.error(e);
    setDriverStatus("خطأ");
  }
});

if (driverStartRideBtn) {
  driverStartRideBtn.addEventListener("click", async () => {
    if (!selectedRideId) return;

    setDriverStatus("بدء الرحلة...");
    try {
      await updateDoc(doc(db, "rides", selectedRideId), {
        status: "started",
        startedAt: serverTimestamp(),
      });

      if (selectedRideData) {
        selectedRideData = {
          ...selectedRideData,
          status: "started",
          startedAt: Timestamp.now(),
        };
        refreshSelectedRideButtons(selectedRideData);
      }

      notify({
        title: "بدأت الرحلة",
        body: "تم بدء الرحلة مع الراكب.",
        tag: "ride-started"
      });

      setDriverStatus("الرحلة بدأت");
    } catch (err) {
      console.error(err);
      setDriverStatus("خطأ");
    }
  });
}

btnComplete.addEventListener("click", async () => {
  if (!selectedRideId) return;
  setDriverStatus("ينهي...");
  try {
    const rideRef = doc(db, "rides", selectedRideId);
    const rideSnap = await getDoc(rideRef);
    const ride = rideSnap.exists() ? rideSnap.data() : null;
    await updateDoc(rideRef, {
      status: "completed",
      completedAt: serverTimestamp(),
      archived: true,
    });

    if (ride && myUser) {
      const price = Number(ride.price || 0);
      const walletBalance = Number(myUser.walletBalance || 0) + price;
      const totalEarnings = Number(myUser.totalEarnings || 0) + price;
      const completedTrips = Number(myUser.completedTrips || 0) + 1;
      await updateDoc(doc(db, "users", myUser.uid), { walletBalance, totalEarnings, completedTrips, updatedAt: serverTimestamp() }).catch(() => {});
      myUser = { ...myUser, walletBalance, totalEarnings, completedTrips };
      renderDriverWallet();

      const passengerRate = Number(prompt("قيّم الراكب من 1 إلى 5 (اختياري)", "5") || 0);
      if (passengerRate >= 1 && passengerRate <= 5 && ride.passengerId) {
        await updateDoc(rideRef, { driverRating: passengerRate, driverRatedAt: serverTimestamp() }).catch(() => {});
        const passengerRef = doc(db, "users", ride.passengerId);
        const passengerSnap = await getDoc(passengerRef);
        if (passengerSnap.exists()) {
          const pData = passengerSnap.data();
          const prevCount = Number(pData.ratingCount || 0);
          const prevAvg = Number(pData.ratingAvg || 0);
          const nextCount = prevCount + 1;
          const nextAvg = ((prevAvg * prevCount) + passengerRate) / nextCount;
          await updateDoc(passengerRef, { ratingCount: nextCount, ratingAvg: Number(nextAvg.toFixed(2)), updatedAt: serverTimestamp() }).catch(() => {});
        }
      }
    }
    stopLiveTracking();
    btnComplete.disabled = true;
    btnCancel.disabled = true;
    btnTrackToggle.disabled = true;
    btnArrived.disabled = true;
    resetSelectedRideUi("تم إنهاء الرحلة.");
    notify({ title: "تم إنهاء الرحلة", body: "شكراً لك.", tag: "ride-complete" });
    setDriverStatus("مكتمل");
  } catch (e) {
    console.error(e);
    setDriverStatus("خطأ");
  }
});

btnCancel.addEventListener("click", async () => {
  if (!selectedRideId) return;
  setDriverStatus("يلغي...");
  try {
    await updateDoc(doc(db, "rides", selectedRideId), {
      status: "canceled",
      canceledAt: serverTimestamp(),
      archived: true,
    });
    stopLiveTracking();
    btnComplete.disabled = true;
    btnCancel.disabled = true;
    btnTrackToggle.disabled = true;
    btnArrived.disabled = true;
    resetSelectedRideUi("تم إلغاء الرحلة.");
    notify({ title: "تم إلغاء الطلب", body: "تم الإلغاء.", tag: "ride-cancel" });
    setDriverStatus("ملغي");
  } catch (e) {
    console.error(e);
    setDriverStatus("خطأ");
  }
});

editProfileBtn.addEventListener("click", async () => {
  if (!admin || !myUser) return;
  const gov = prompt("المحافظة", myUser.governorate || "");
  if (!gov) return;
  const g = admin.governorates.find((x) => x.name === gov) || admin.governorates[0];
  const center = prompt("المركز/الحي", myUser.center || (g?.centers?.[0] || ""));
  const vType = prompt("نوع المركبة", myUser.vehicleType || "sedan");
  const address = prompt("العنوان", myUser.address || "");
  const vehicleCode = prompt("كود المركبة", myUser.vehicleCode || "");
  const phone = prompt("رقم الهاتف", myUser.phone || "");

  setDriverStatus("يحفظ...");
  try {
    await updateDoc(doc(db, "users", myUser.uid), {
      phone: phone || "",
      governorate: gov,
      center: center || "",
      vehicleType: vType || "sedan",
      address: address || "",
      vehicleCode: vehicleCode || "",
      updatedAt: serverTimestamp(),
    });
    myUser = { ...myUser, governorate: gov, center, vehicleType: vType, address, vehicleCode, phone };
    notify({ title: "تم تحديث البيانات", body: "تم حفظ بيانات السائق.", tag: "profile-updated" });
    setDriverStatus("متصل");
    location.reload();
  } catch (e) {
    console.error(e);
    setDriverStatus("خطأ");
  }
});

onAuthStateChanged(auth, async (user) => {
  if (!user) { location.href = "./index.html"; return; }
  await ensureNotificationPermission(true);
  await initAdmin().catch(() => {});

  const me = await getDoc(doc(db, "users", user.uid));
  if (!me.exists() || me.data().role !== "driver") {
    location.href = "./passenger.html";
    return;
  }

  myUser = { uid: user.uid, ...me.data() };
  if (myUser.role === "admin") { location.href = "./admin.html"; return; }
  if (myUser.status === "blocked") { await signOut(auth); alert("هذا الحساب محظور من الإدارة."); location.href = "./index.html"; return; }
  ownDriverPosDocRef = doc(db, "driversOnline", user.uid);
  setText(meBadge, `${myUser.name || "سائق"} • ${escapeHtml(myUser.governorate || "")}/${escapeHtml(myUser.center || "")}`);
  renderDriverWallet();
  setDriverStatus("متصل");

  locateOnce(map, async (loc) => {
    myLocation = loc;
    updateOwnDriverMarker(loc.lat, loc.lon, true);
    await pushDriverOnline();
    startDriverHeartbeat();
  });

  watchRidesForDriver();
});

window.addEventListener("beforeunload", () => {
  stopLiveTracking();
  stopDriverHeartbeat();
  cleanupDriverOnline();
});

window.addEventListener("error", (e) => {
  alert(`JS ERROR: ${e.message}\n${e.filename}:${e.lineno}:${e.colno}`);
});
window.addEventListener("unhandledrejection", (e) => {
  alert(`PROMISE ERROR: ${e.reason?.message || e.reason}`);
});
