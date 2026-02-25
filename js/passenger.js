import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  doc, getDoc, updateDoc, setDoc,
  collection, addDoc,
  onSnapshot, query, where, orderBy, limit,
  serverTimestamp, Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import { $, setText, moneyEGP, escapeHtml } from "./utils.js";
import { createMap, addMarker, routeOSRM, drawRoute, locateOnce, showMyLocation, geocodeEG } from "./map.js";
import { loadEgyptAdmin, fillSelect, renderVehicleGrid } from "./admin_data.js";
import { notify, ensureNotificationPermission } from "./notify.js";

const meBadge = $("#meBadge");
const logoutBtn = $("#logoutBtn");
const switchRoleBtn = $("#switchRoleBtn");
switchRoleBtn?.addEventListener("click", openSwitchDriverModal);
const btnLocate = $("#btnLocate");
const btnClear = $("#btnClear");

const pGov = $("#pGov"), pCenter = $("#pCenter"), pVehicles = $("#pVehicles");

const pickupText = $("#pickupText");
const dropText = $("#dropText");
const pickupResults = $("#pickupResults");
const dropResults = $("#dropResults");
const pickupPick = $("#pickupPick");
const dropPick = $("#dropPick");

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
pickupText.addEventListener("input", async () => {
  const q = pickupText.value.trim();
  if (q.length < 3) {
    pickupResults.classList.add("hidden");
    pickupResults.innerHTML = "";
    return;
  }

  const r = await geocodeEG(q);
  if (!r) {
    pickupResults.classList.add("hidden");
    return;
  }

  pickupResults.innerHTML = `<div class="result-item">${r.display}</div>`;
  pickupResults.classList.remove("hidden");

  pickupResults.onclick = () => {
    setPickup({ lat: r.lat, lon: r.lon, text: r.display });
    map.setView([r.lat, r.lon], 16);
    pickupText.value = r.display;
    pickupResults.classList.add("hidden");
  };
});
dropText.addEventListener("input", async () => {
  const q = dropText.value.trim();
  if (q.length < 3) {
    dropResults.classList.add("hidden");
    dropResults.innerHTML = "";
    return;
  }

  const r = await geocodeEG(q);
  if (!r) {
    dropResults.classList.add("hidden");
    return;
  }

  dropResults.innerHTML = `<div class="result-item">${r.display}</div>`;
  dropResults.classList.remove("hidden");

  dropResults.onclick = () => {
    setDropoff({ lat: r.lat, lon: r.lon, text: r.display });
    map.setView([r.lat, r.lon], 16);
    dropText.value = r.display;
    dropResults.classList.add("hidden");
  };
});
const routeLayerRef = { current: null };

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
let driverMarker = null;

let currentRideId = null;
let unsubRideWatcher = null;

let lastDistanceMeters = null;
let lastDurationSec = null;

let myLocation = null; // {lat, lon}

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

bindSearch(pickupText, pickupResults, (it) => setPickup({ lat: it.lat, lon: it.lon, text: it.display }));
bindSearch(dropText, dropResults, (it) => setDropoff({ lat: it.lat, lon: it.lon, text: it.display }));

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

  if (ride.status === "accepted" && ride.driverId && driverProfile) {
    lines.push(`<div class="divider"></div>`);
    lines.push(`<div><b>السائق</b></div>`);
    lines.push(`<div class="muted small">الاسم: ${escapeHtml(driverProfile.name || "—")}</div>`);
    lines.push(`<div class="muted small">الهاتف: ${escapeHtml(driverProfile.phone || "—")}</div>`);
    if (driverProfile.vehicleCode) lines.push(`<div class="muted small">كود المركبة: ${escapeHtml(driverProfile.vehicleCode)}</div>`);
    lines.push(`<div class="muted small">نوع المركبة: ${escapeHtml(driverProfile.vehicleType || "—")}</div>`);
  } else if (ride.status !== "accepted") {
    lines.push(`<div class="muted small">بيانات السائق تظهر بعد القبول.</div>`);
  }

  rideCard.innerHTML = lines.join("");
}

onAuthStateChanged(auth, async (user) => {
  if (!user) { location.href = "./index.html"; return; }
  await ensureNotificationPermission(true);

  const me = await getDoc(doc(db, "users", user.uid));
  const myData = me.exists() ? me.data() : {};
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
      if (unsubRideWatcher) { unsubRideWatcher(); unsubRideWatcher = null; }
      rideUiNone();
      return;
    }

    const docSnap = snap.docs[0];
    currentRideId = docSnap.id;

    if (unsubRideWatcher) unsubRideWatcher();
    unsubRideWatcher = onSnapshot(doc(db, "rides", currentRideId), async (rideSnap) => {
      if (!rideSnap.exists()) return;
      const ride = rideSnap.data();

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

    await addDoc(collection(db, "rides"), {
      passengerId: user.uid,
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

      passengerLoc: myLocation ? { lat: myLocation.lat, lon: myLocation.lon } : null,
    });

    setText(routeMeta, "تم إرسال الطلب. في انتظار سائق...");
    setStatus("قيد الانتظار");
    notify({ title: "تم إرسال الطلب", body: "جارٍ البحث عن سائق...", tag: "ride-sent" });
  } catch {
    setStatus("خطأ");
    setText(routeMeta, "تعذر إرسال الطلب. جرّب مرة أخرى.");
  }
});

btnCancel.addEventListener("click", async () => {
  if (!currentRideId) return;
  setStatus("يلغي...");
  try {
    await updateDoc(doc(db, "rides", currentRideId), { status: "canceled", canceledAt: serverTimestamp() });
    setStatus("ملغي");
  } catch { setStatus("خطأ"); }
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
