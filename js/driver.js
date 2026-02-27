import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  doc, getDoc, updateDoc, setDoc,
  collection, onSnapshot, query, where, orderBy, limit,
  serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import { $, setText, moneyEGP, escapeHtml } from "./utils.js";
import { createMap, addMarker, routeOSRM, drawRoute, locateOnce, showMyLocation } from "./map.js";
import { loadEgyptAdmin, fillSelect, renderVehicleGrid } from "./admin_data.js";
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
function syncOfferBtn(){
  const v = Number((offerInput.value || "").trim());
  btnSendOffer.disabled = !selectedRideId || !Number.isFinite(v) || v <= 0;
}
offerInput.addEventListener("input", syncOfferBtn);
const driverStatus = $("#driverStatus");
const subText = $("#subText");

const map = createMap("map", { center: [26.56, 31.70], zoom: 13 });
const routeLayerRef = { current: null };

let admin = null;
let myUser = null;
let myLocation = null;

let selectedRideId = null;
let selectedRideData = null;

let pickupMarker = null;
let dropMarker = null;

let geoWatchId = null;
let trackingRideId = null;
let trackingEnabled = false;

function setDriverStatus(t){ setText(driverStatus, t); }

logoutBtn.addEventListener("click", async () => {
  stopLiveTracking();
  await signOut(auth);
  location.href = "./index.html";
});

switchRoleBtn.addEventListener("click", () => { location.href = "./passenger.html"; });

btnLocate.addEventListener("click", () => { locateOnce(map, (loc) => { myLocation = loc; }); });

btnClear.addEventListener("click", () => {
  stopLiveTracking();
  selectedRideId = null; selectedRideData = null;
  btnSendOffer.disabled = true; btnAccept.disabled = true; btnComplete.disabled = true; btnCancel.disabled = true;
  selectedRideEl.innerHTML = `<div class="muted">لم يتم تحديد طلب.</div>`;
  if (pickupMarker) map.removeLayer(pickupMarker), pickupMarker = null;
  if (dropMarker) map.removeLayer(dropMarker), dropMarker = null;
  if (routeLayerRef.current) map.removeLayer(routeLayerRef.current), routeLayerRef.current = null;
});

btnTrackToggle?.addEventListener("click", async () => {
  if (!selectedRideId) return;
  if (!trackingEnabled) {
    notify({ title: "التتبع", body: "ابدأ تتبع الموقع…", tag: "track-on" });
    startLiveTracking(selectedRideId);
  } else {
    notify({ title: "التتبع", body: "تم إيقاف التتبع.", tag: "track-off" });
    stopLiveTracking();
  }
});
setTrackBtn();

btnRefresh.addEventListener("click", () => {
  subText.textContent = "تم التحديث.";
  setTimeout(() => subText.textContent = "اختر طلب ثم اقبل أو اقترح سعر", 900);
});


function startLiveTracking(rideId) {
  if (!navigator.geolocation) return;
  stopLiveTracking();
  trackingRideId = rideId;
  trackingEnabled = true;
  setTrackBtn();
  geoWatchId = navigator.geolocation.watchPosition(async (pos) => {
    if (!trackingRideId) return;
    const lat = pos.coords.latitude;
    const lon = pos.coords.longitude;
    myLocation = { lat, lon };
    try{
      await updateDoc(doc(db, "rides", trackingRideId), {
        driverLoc: { lat, lon },
        driverLocUpdatedAt: serverTimestamp(),
      });
    } catch {}
  }, () => {}, { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 });
}

function stopLiveTracking() {
  if (geoWatchId != null) {
    navigator.geolocation.clearWatch(geoWatchId);
    geoWatchId = null;
  }
  trackingRideId = null;
  trackingEnabled = false;
  setTrackBtn();
}


function setTrackBtn() {
  if (!btnTrackToggle) return;
  btnTrackToggle.textContent = trackingEnabled ? "إيقاف التتبع" : "ابدأ التتبع";
}



function normalizeDigits(v){
  return String(v || "").replace(/[٠-٩]/g, d => "0123456789"["٠١٢٣٤٥٦٧٨٩".indexOf(d)]);
}
function clampPrice(v){
  const n = Number(normalizeDigits(v));
  if (!Number.isFinite(n)) return null;
  const clamped = Math.min(3000, Math.max(15, Math.round(n/5)*5));
  return clamped;
}

async function initAdmin() {
  admin = await loadEgyptAdmin();
}

function watchRidesForDriver() {
  // Match passenger's governorate+center+vehicleType (optional by vehicleType)
  const now = Timestamp.fromMillis(Date.now());
  const qR = query(
    collection(db, "rides"),
    where("status", "in", ["requested", "offered"]),
    where("governorate", "==", myUser.governorate || ""),
    where("center", "==", myUser.center || ""),
    where("expiresAt", ">", now),
    orderBy("expiresAt", "asc"),
    limit(30)
  );

  onSnapshot(qR, (snap) => {
    console.log("watchRidesForDriver: got snapshot, docs:", snap.docs.length);
  ridesList.innerHTML = "";
  let shown = 0;

  if (snap.empty) {
    console.log("snapshot empty");
    ridesList.innerHTML = `<div class="muted small">لا توجد طلبات متاحة الآن في منطقتك.</div>`;
    return;
  }

  snap.docs.forEach((d) => {
    const r = d.data();
    console.log("ride doc:", d.id, r);
    // filter by vehicle type: if driver has vehicleType, only show matching
if (myUser.vehicleType && r.vehicleType && myUser.vehicleType !== r.vehicleType) return;

shown++;

const item = document.createElement("div");
item.className = "list-item" + (selectedRideId === d.id ? " active" : "");
item.innerHTML = `
  <div class="row-between">
    <b>طلب</b>
    <span class="muted small">${moneyEGP(r.price)}</span>
  </div>
  <div class="muted small">مركبة: ${escapeHtml(r.vehicleType || "-")}</div>
  <div class="muted small">قيام: ${escapeHtml(r.pickupText || "-")}</div>
  <div class="muted small">وصول: ${escapeHtml(r.dropoffText || "-")}</div>
`;
item.onclick = () => selectRide(d.id, r);
ridesList.appendChild(item);
  });

  console.log("shown after loop:", shown);
  if (shown === 0) {
    ridesList.innerHTML = `<div class="muted small">لا توجد طلبات مناسبة لنوع مركبتك الآن.</div>`;
  }
});
}
async function selectRide(id, ride) {
  selectedRideId = id;
  selectedRideData = ride;
  syncOfferBtn();
  btnSendOffer.disabled = false;
  btnAccept.disabled = false;
  btnTrackToggle.disabled = true;
  btnComplete.disabled = true;
  btnCancel.disabled = true;
  trackingEnabled = false;
  setTrackBtn();

  if (pickupMarker) map.removeLayer(pickupMarker);
  if (dropMarker) map.removeLayer(dropMarker);
  pickupMarker = addMarker(map, [ride.pickup.lat, ride.pickup.lon]);
  dropMarker = addMarker(map, [ride.dropoff.lat, ride.dropoff.lon]);

  selectedRideEl.innerHTML = `
    <div class="row-between"><b>السعر</b><span>${moneyEGP(ride.price)}</span></div>
    ${ride.offerPrice ? `<div class="row-between"><b>عرض حالي</b><span>${moneyEGP(ride.offerPrice)}</span></div>` : ""}
    <div class="muted small">المنطقة: ${escapeHtml(ride.governorate)} / ${escapeHtml(ride.center)} • مركبة: ${escapeHtml(ride.vehicleType)}</div>
    <div class="muted small">قيام: ${escapeHtml(ride.pickupText || "—")}</div>
    <div class="muted small">وصول: ${escapeHtml(ride.dropoffText || "—")}</div>
    <div class="muted small">بيانات الراكب تظهر بعد القبول.</div>
  `;

  try {
    const r = await routeOSRM(
      { lat: ride.pickup.lat, lon: ride.pickup.lon },
      { lat: ride.dropoff.lat, lon: ride.dropoff.lon }
    );
    drawRoute(map, r.geojson, routeLayerRef);
  } catch {}
}

async function showAcceptedDetails(rideId) {
  const rideSnap = await getDoc(doc(db, "rides", rideId));
  if (!rideSnap.exists()) return;
  const ride = rideSnap.data();
  const passengerName = ride.passengerName || "";
const passengerPhone = ride.passengerPhone || "";
const passengerGovernorate = ride.governorate || "";
const passengerCenter = ride.center || "";

  const lines = [];
  lines.push(`<div class="row-between"><b>الحالة</b><span class="muted">accepted</span></div>`);
  lines.push(`<div class="row-between"><b>السعر النهائي</b><span>${moneyEGP(ride.price)}</span></div>`);
  lines.push(`<div class="muted small">قيام: ${escapeHtml(ride.pickupText || "—")}</div>`);
  lines.push(`<div class="muted small">وصول: ${escapeHtml(ride.dropoffText || "—")}</div>`);
  lines.push(`<div class="divider"></div>`);
lines.push(`<div><b>الراكب</b></div>`);
lines.push(`<div class="muted small">الاسم: ${escapeHtml(passengerName || "-")}</div>`);
lines.push(`<div class="muted small">الهاتف: ${escapeHtml(passengerPhone || "-")}</div>`);
lines.push(`<div class="muted small">المنطقة: ${escapeHtml(passengerGovernorate || "-")} / ${escapeHtml(passengerCenter || "-")}</div>`);
  
  selectedRideEl.innerHTML = lines.join("");
}

btnSendOffer.addEventListener("click", async () => {
  if (!selectedRideId || !myUser) return;

  const offer = clampPrice(offerInput.value);
  if (!offer) {
    notify({ title: "سعر غير صحيح", body: "اكتب سعر بين 15 و 3000 بخطوة 5.", tag: "bad-offer" });
    return;
  }

  setDriverStatus("يرسل عرض...");
  try {
    await updateDoc(doc(db, "rides", selectedRideId), {
  status: "offered",
  driverId: myUser.uid,
  offerPrice: offer,
  driverName: myUser.name || "",
  driverPhone: myUser.phone || "",
  driverVehicleType: myUser.vehicleType || "",
  driverVehicleCode: myUser.vehicleCode || "",
  offeredAt: serverTimestamp(),
});

    // متقفلهاش للأبد — خليه يقفل لحظياً بس
    btnSendOffer.disabled = true;
    setTimeout(() => { btnSendOffer.disabled = false; }, 800);

    btnAccept.disabled = false;
    btnCancel.disabled = true;

    notify({ title: "تم إرسال العرض", body: `عرض سعر: ${offer} ج`, tag: "offer-sent" });
    setDriverStatus("بانتظار رد الراكب");
  } catch {
    setDriverStatus("خطأ");
  }
});

btnAccept.addEventListener("click", async () => {
  if (!selectedRideId || !myUser) return;
  setDriverStatus("يقبل...");
  try {
    console.log("DRIVER selectedRideId =", selectedRideId);
    await updateDoc(doc(db, "rides", selectedRideId), {
  status: "accepted",
  driverId: myUser.uid,
  driverName: myUser.name || "",
  driverPhone: myUser.phone || "",
  driverVehicleType: myUser.vehicleType || "",
  driverVehicleCode: myUser.vehicleCode || "",
  acceptedAt: serverTimestamp(),
});

    btnAccept.disabled = true;
    btnSendOffer.disabled = true;
    btnComplete.disabled = false;
    btnCancel.disabled = false;
    btnArrived.disabled = false;
    
    btnTrackToggle.disabled = false;
    trackingEnabled = false;
    setTrackBtn();
    await showAcceptedDetails(selectedRideId);
    notify({ title: "تم قبول الطلب", body: "الآن يمكنك إنهاء الرحلة بعد الوصول.", tag: "ride-accepted" });
    setDriverStatus("على الطريق");
    } catch (e) {
  console.error("DRIVER ACCEPT ERROR:", e);
  alert("ACCEPT ERROR: " + (e?.message || e));
  setDriverStatus("خطأ");
}
});

btnComplete.addEventListener("click", async () => {
  if (!selectedRideId) return;
  setDriverStatus("ينهي...");
  try {
    await updateDoc(doc(db, "rides", selectedRideId), { status: "completed", completedAt: serverTimestamp() });
    stopLiveTracking();
    setDriverStatus("مكتمل");
    btnComplete.disabled = true;
    btnCancel.disabled = true;
    btnTrackToggle.disabled = true;
    selectedRideId = null;
    selectedRideData = null;
    selectedRideEl.innerHTML = `<div class="muted">تم إنهاء الرحلة.</div>`;
    notify({ title: "تم إنهاء الرحلة", body: "شكراً لك.", tag: "ride-complete" });
  } catch { setDriverStatus("خطأ"); }
});

btnCancel.addEventListener("click", async () => {
  if (!selectedRideId) return;
  setDriverStatus("يلغي...");
  try {
    await updateDoc(doc(db, "rides", selectedRideId), { status: "canceled", canceledAt: serverTimestamp() });
    stopLiveTracking();
    setDriverStatus("ملغي");
    btnComplete.disabled = true;
    btnCancel.disabled = true;
    btnTrackToggle.disabled = true;
    notify({ title: "تم إلغاء الطلب", body: "تم الإلغاء.", tag: "ride-cancel" });
  } catch { setDriverStatus("خطأ"); }
});

// Profile edit: quick prompt-based for mobile
editProfileBtn.addEventListener("click", async () => {
  if (!admin || !myUser) return;

  const gov = prompt("المحافظة", myUser.governorate || "");
  if (!gov) return;
  const g = admin.governorates.find(x => x.name === gov) || admin.governorates[0];
  const center = prompt("المركز/الحي", myUser.center || (g?.centers?.[0] || ""));
  const vType = prompt("نوع المركبة (tuktuk/sedan/tricycle/truck/microbus/tmanya/delivery_bike)", myUser.vehicleType || "sedan");
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
    myUser = { ...myUser, governorate: gov, center, vehicleType: vType, address, vehicleCode };
    myUser = { ...myUser, governorate: gov, center, vehicleType: vType, address, vehicleCode, phone };
    notify({ title: "تم تحديث البيانات", body: "تم حفظ بيانات السائق.", tag: "profile-updated" });
    setDriverStatus("متصل");
    // Restart watcher by reloading (simple & robust)
    location.reload();
  } catch {
    setDriverStatus("خطأ");
  }
});

onAuthStateChanged(auth, async (user) => {
  if (!user) { location.href = "./index.html"; return; }
  await ensureNotificationPermission(true);

  await initAdmin().catch(()=>{});

  console.log("AUTH UID =", user.uid);

const meRef = doc(db, "users", user.uid);
const me = await getDoc(meRef);

console.log("ME exists =", me.exists());
console.log("ME data =", me.data());
console.log("ME role =", me.data()?.role);
  if (!me.exists() || me.data().role !== "driver") {
    location.href = "./passenger.html";
    return;
  }
  myUser = { uid: user.uid, ...me.data() };
  setText(meBadge, `${myUser.name || "سائق"} • ${escapeHtml(myUser.governorate || "")}/${escapeHtml(myUser.center || "")}`);
  setDriverStatus("متصل");

  locateOnce(map, (loc) => {
  myLocation = loc;
  showMyLocation(map, loc);
});
let liveTimer = null;

function startLiveDriverLocation() {
  if (liveTimer) return;

  const u = auth.currentUser;
  if (!u || !myUser) return;

  const ref = doc(db, "driversOnline", u.uid);

  const push = () => {
    if (!navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(async (pos) => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;

      await setDoc(ref, {
        uid: u.uid,
        name: myUser.name || "",
        governorate: myUser.governorate || "",
        center: myUser.center || "",
        vehicleType: myUser.vehicleType || "",
        lat,
        lon,
        lastSeenMs: Date.now(),
        updatedAt: serverTimestamp()
      }, { merge: true });
    });
  };

  push();
  liveTimer = setInterval(push, 4000);
}
  startLiveDriverLocation();
  // watch available rides
  watchRidesForDriver();
});
