import { auth, db, initFirebaseMessaging } from "./firebase.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut,
  sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  doc, setDoc, getDoc, updateDoc, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import { $, setText } from "./utils.js";
import { loadEgyptAdmin, fillSelect, renderVehicleGrid } from "./admin_data.js";
import { ensureNotificationPermission } from "./notify.js";

const tabLogin = $("#tabLogin");
const tabRegister = $("#tabRegister");
const loginForm = $("#loginForm");
const registerForm = $("#registerForm");
const loginHint = $("#loginHint");
const regHint = $("#regHint");
const btnLogout = $("#btnLogout");

const rolePassenger = $("#rolePassenger");
const roleDriver = $("#roleDriver");
const roleHint = $("#roleHint");
const adminEntryBtn = $("#adminEntryBtn");

const passengerExtras = $("#passengerExtras");
const driverExtras = $("#driverExtras");
const passengerExtrasLogin = $("#passengerExtrasLogin");
const driverExtrasLogin = $("#driverExtrasLogin");

let role = "passenger";
let admin = null;

const pGov = $("#pGov");
const pCenter = $("#pCenter");

const pGovLogin = $("#pGovLogin");
const pCenterLogin = $("#pCenterLogin");

const dGov = $("#dGov");
const dCenter = $("#dCenter");
const dVehicles = $("#dVehicles");
const dAddress = $("#dAddress");
const dVehicleCode = $("#dVehicleCode");

const dGovLogin = $("#dGovLogin");
const dCenterLogin = $("#dCenterLogin");
const dAddressLogin = $("#dAddressLogin");
const dVehicleCodeLogin = $("#dVehicleCodeLogin");
const dVehiclesLogin = $("#dVehiclesLogin");

let driverVehicleLogin = "sedan";
let driverVehicle = "sedan";

function setRole(next) {
  role = next;

  rolePassenger.classList.toggle("active", role === "passenger");
  roleDriver.classList.toggle("active", role === "driver");

  setText(
    roleHint,
    role === "passenger" ? "التسجيل كـ راكب." : "التسجيل كـ سائق."
  );

  passengerExtras?.classList.toggle("hidden", role !== "passenger");
  driverExtras?.classList.toggle("hidden", role !== "driver");

  passengerExtrasLogin?.classList.toggle("hidden", role !== "passenger");
  driverExtrasLogin?.classList.toggle("hidden", role !== "driver");
}

function showTab(tab) {
  const isLogin = tab === "login";
  tabLogin?.classList.toggle("active", isLogin);
  tabRegister?.classList.toggle("active", !isLogin);
  loginForm?.classList.toggle("hidden", !isLogin);
  registerForm?.classList.toggle("hidden", isLogin);
  setText(loginHint, "");
  setText(regHint, "");
}

rolePassenger?.addEventListener("click", () => setRole("passenger"));
roleDriver?.addEventListener("click", () => setRole("driver"));

tabLogin?.addEventListener("click", () => showTab("login"));
tabRegister?.addEventListener("click", () => showTab("register"));

setRole("passenger");
showTab("login");

async function initAdmin() {
  admin = await loadEgyptAdmin();

  const govs = admin.governorates.map((g) => g.name);

  fillSelect(pGov, govs);
  fillSelect(pGovLogin, govs);
  fillSelect(dGov, govs);
  fillSelect(dGovLogin, govs);

  const setCenters = (govName, centerSelect) => {
    const g = admin.governorates.find((x) => x.name === govName);
    fillSelect(centerSelect, g?.centers || ["—"]);
  };

  setCenters(pGov?.value, pCenter);
  setCenters(pGovLogin?.value, pCenterLogin);
  setCenters(dGov?.value, dCenter);
  setCenters(dGovLogin?.value, dCenterLogin);

  pGov?.addEventListener("change", () => setCenters(pGov.value, pCenter));
  pGovLogin?.addEventListener("change", () => setCenters(pGovLogin.value, pCenterLogin));
  dGov?.addEventListener("change", () => setCenters(dGov.value, dCenter));
  dGovLogin?.addEventListener("change", () => setCenters(dGovLogin.value, dCenterLogin));

  const vehicles = admin.vehicleTypes;

  const render = () => {
    renderVehicleGrid(dVehicles, vehicles, driverVehicle, (id) => {
      driverVehicle = id;
      render();
    });

    renderVehicleGrid(dVehiclesLogin, vehicles, driverVehicleLogin, (id) => {
      driverVehicleLogin = id;
      render();
    });
  };

  render();
}

loginForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  setText(loginHint, "جارٍ تسجيل الدخول...");

  try {
    const email = $("#loginEmail")?.value.trim();
    const pass = $("#loginPass")?.value;

    if (!email || !pass) {
      setText(loginHint, "أدخل الإيميل وكلمة المرور.");
      return;
    }

    if (role === "passenger") {
      const gov = pGovLogin?.value.trim();
      const center = pCenterLogin?.value.trim();

      if (!gov || !center) {
        alert("اكمل المحافظة والمركز قبل الدخول");
        return;
      }
    }

    if (role === "driver") {
      const gov = dGovLogin?.value.trim();
      const center = dCenterLogin?.value.trim();
      const vehicleCode = dVehicleCodeLogin?.value.trim();

      if (!gov || !center || !driverVehicleLogin || !vehicleCode) {
        alert("اكمل بيانات السائق قبل الدخول");
        return;
      }
    }

    const cred = await
    signInWithEmailAndPassword(auth, email, pass);
    console.log("LOGIN UID:", cred.user.uid);

    const u = auth.currentUser;
    if (!u) {
      setText(loginHint, "تعذر إكمال تسجيل الدخول.");
      return;
    }

    const snap = await getDoc(doc(db, "users", u.uid));

    if (!snap.exists()) {
      alert("الحساب تم حذفه، يرجى إنشاء حساب جديد");
      await signOut(auth);
      return;
    }

    if (role === "passenger") {
      const gov = pGovLogin?.value.trim();
      const center = pCenterLogin?.value.trim();

      await updateDoc(doc(db, "users", u.uid), {
        governorate: gov,
        center,
        updatedAt: serverTimestamp(),
      });
    }

    if (role === "driver") {
      const gov = dGovLogin?.value.trim();
      const center = dCenterLogin?.value.trim();
      const address = dAddressLogin?.value.trim();
      const vehicleCode = dVehicleCodeLogin?.value.trim();

      await updateDoc(doc(db, "users", u.uid), {
        governorate: gov,
        center,
        vehicleType: driverVehicleLogin,
        address,
        vehicleCode,
        updatedAt: serverTimestamp(),
      });
    }

    const profile = snap.data();
    const r = profile?.role || "passenger";

    if (profile?.status === "blocked") {
      await signOut(auth);
      setText(loginHint, "هذا الحساب محظور من الإدارة.");
      return;
    }

location.href = r === "admin"
  ? "./admin.html"
  : r === "driver"
    ? "./driver.html"
    : "./passenger.html";

  } catch (err) {
    console.log("LOGIN ERROR:", err.code, err.message, err);
    setText(loginHint, "خطأ: " + (err.code || "unknown"));
  }
});

registerForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  setText(regHint, "جارٍ إنشاء الحساب...");

  try {
    const name = $("#regName")?.value.trim();
    const phone = $("#regPhone")?.value.trim();
    const email = $("#regEmail")?.value.trim();
    const pass = $("#regPass")?.value;

    if (!name || !phone || !email || !pass) {
      setText(regHint, "أكمل جميع البيانات المطلوبة.");
      return;
    }

    const cred = await createUserWithEmailAndPassword(auth, email, pass);

    const common = {
      uid: cred.user.uid,
      role,
      name,
      phone,
      email,
      createdAt: serverTimestamp(),
      status: "active",
      walletBalance: 0,
      totalEarnings: 0,
      completedTrips: 0,
      ratingAvg: 0,
      ratingCount: 0
    };

    let profile = {};
    if (role === "passenger") {
      profile = {
        governorate: pGov?.value || "",
        center: pCenter?.value || "",
      };
    } else {
      profile = {
        governorate: dGov?.value || "",
        center: dCenter?.value || "",
        vehicleType: driverVehicle,
        address: (dAddress?.value || "").trim(),
        vehicleCode: (dVehicleCode?.value || "").trim()
      };
    }

    await setDoc(doc(db, "users", cred.user.uid), { ...common, ...profile });
    
location.href = role === "driver" ? "./driver.html" : "./passenger.html";
  } catch (err) {
    setText(regHint, friendlyAuthError(err));
  }
});

btnLogout?.addEventListener("click", async () => {
  await signOut(auth);
});

onAuthStateChanged(auth, async (user) => {
  if (user) {
    btnLogout?.classList.remove("hidden");

    try {
      const snap = await getDoc(doc(db, "users", user.uid));
      const profile = snap.exists() ? snap.data() : null;
      try {
        await ensureNotificationPermission(true);
        await initFirebaseMessaging(user.uid);
      } catch (err) {
        console.warn("FCM init warning:", err?.message || err);
      }
      const isAdmin = !!profile && profile.role === "admin" && profile.status !== "blocked";
      adminEntryBtn?.classList.toggle("hidden", !isAdmin);
    } catch (err) {
      adminEntryBtn?.classList.add("hidden");
    }
  } else {
    btnLogout?.classList.add("hidden");
    adminEntryBtn?.classList.add("hidden");
  }
});

initAdmin().catch(() => {});

function friendlyAuthError(err) {
  const code = err?.code || "";
  if (code.includes("auth/invalid-email")) return "الإيميل غير صحيح.";
  if (code.includes("auth/wrong-password")) return "كلمة المرور غير صحيحة.";
  if (code.includes("auth/user-not-found")) return "لا يوجد حساب بهذا الإيميل.";
  if (code.includes("auth/email-already-in-use")) return "الإيميل مستخدم بالفعل.";
  if (code.includes("auth/weak-password")) return "الباسورد ضعيف (6 أحرف على الأقل).";
  if (code.includes("permission-denied") || code.includes("insufficient-permission")) return "صلاحيات Firestore تمنع العملية. عدّل Rules ثم أعد المحاولة.";
  return "حدث خطأ. حاول مرة أخرى.";
}

console.log("AUTH LOADED OK");

window.addEventListener("error", (e) => {
  alert(`JS Error: ${e.message}\n${e.filename}:${e.lineno}:${e.colno}`);
});

const resetBtn = document.getElementById("resetPasswordBtn");

resetBtn?.addEventListener("click", async () => {
  const email = prompt("اكتب الايميل بتاعك");
  if (!email) return;

  try {
    await sendPasswordResetEmail(auth, email);
    alert("تم ارسال رابط تغيير الباسورد على ايميلك");
  } catch (err) {
    alert("خطأ: " + err.message);
  }
});
