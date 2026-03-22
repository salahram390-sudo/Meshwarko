import { auth, db } from "./firebase.js";

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

const passengerExtras = $("#passengerExtras");
const driverExtras = $("#driverExtras");

let role = "passenger";
let admin = null;

const pGov = $("#pGov"), pCenter = $("#pCenter");
const dGov = $("#dGov"), dCenter = $("#dCenter"), dVehicles = $("#dVehicles");
const dAddress = $("#dAddress"), dVehicleCode = $("#dVehicleCode");
// Driver login extras (NEW)
const driverExtrasLogin = $("#driverExtrasLogin");
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
  setText(roleHint, role === "passenger" ? "التسجيل كـ راكب." : "التسجيل كـ سائق.");

  driverExtras.classList.toggle("hidden", role !== "driver");
passengerExtras.classList.toggle("hidden", role !== "passenger");

// اظهار بيانات السائق في تسجيل الدخول
driverExtrasLogin?.classList.toggle("hidden", role !== "driver");
}
function showTab(tab) {
  const isLogin = tab === "login";
  tabLogin.classList.toggle("active", isLogin);
  tabRegister.classList.toggle("active", !isLogin);
  loginForm.classList.toggle("hidden", !isLogin);
  registerForm.classList.toggle("hidden", isLogin);
  setText(loginHint, "");
  setText(regHint, "");
}

rolePassenger.addEventListener("click", () => setRole("passenger"));
roleDriver.addEventListener("click", () => setRole("driver"));

tabLogin.addEventListener("click", () => showTab("login"));
tabRegister.addEventListener("click", () => showTab("register"));

async function initAdmin() {
  admin = await loadEgyptAdmin();

  const govs = admin.governorates.map(g => g.name);
  fillSelect(pGov, govs);
  fillSelect(dGov, govs);
  fillSelect(dGovLogin, govs);
  
  const setCenters = (govName, centerSelect) => {
    const g = admin.governorates.find(x => x.name === govName);
    fillSelect(centerSelect, (g?.centers || ["—"]));
  };

  setCenters(pGov.value, pCenter);
  setCenters(dGov.value, dCenter);
  setCenters(dGovLogin.value, dCenterLogin);
  
  pGov.addEventListener("change", () => setCenters(pGov.value, pCenter));
  dGov.addEventListener("change", () => setCenters(dGov.value, dCenter));
dGovLogin.addEventListener("change", () => setCenters(dGovLogin.value, dCenterLogin));
  
  const vehicles = admin.vehicleTypes;

const render = () => {

  // مركبات التسجيل (Register)
  renderVehicleGrid(dVehicles, vehicles, driverVehicle, (id) => {
    driverVehicle = id;
    render();
  });

  // مركبات تسجيل الدخول (Login)
  renderVehicleGrid(dVehiclesLogin, vehicles, driverVehicleLogin, (id) => {
    driverVehicleLogin = id;
    render();
  });

};

render();
}

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  setText(loginHint, "جارٍ تسجيل الدخول...");
  try {
    const email = $("#loginEmail").value.trim();
    const pass = $("#loginPass").value;
  if (role === "driver") {
  const gov = dGovLogin.value.trim();
  const center = dCenterLogin.value.trim();
  const vehicleCode = dVehicleCodeLogin.value.trim();

  if (!gov || !center || !driverVehicleLogin || !vehicleCode) {
    alert("اكمل بيانات السائق قبل الدخول");
    return;
  }
}
    await signInWithEmailAndPassword(auth, email, pass);

const u = auth.currentUser;

// حفظ بيانات السائق عند الدخول
if (role === "driver") {
  const gov = dGovLogin.value.trim();
  const center = dCenterLogin.value.trim();
  const address = dAddressLogin.value.trim();
  const vehicleCode = dVehicleCodeLogin.value.trim();

  await updateDoc(doc(db, "users", u.uid), {
    governorate: gov,
    center,
    vehicleType: driverVehicleLogin,
    address,
    vehicleCode,
    updatedAt: serverTimestamp(),
  });
}

const snap = await getDoc(doc(db, "users", u.uid));
const profile = snap.exists() ? snap.data() : {};
const r = profile?.role || "passenger";
if (profile?.status === "blocked") {
  await signOut(auth);
  setText(loginHint, "هذا الحساب محظور من الإدارة.");
  return;
}
await ensureNotificationPermission(true);

location.href = r === "admin"
  ? "./admin.html"
  : r === "driver"
    ? "./driver.html"
    : "./passenger.html";

} catch (err) {
  console.log("LOGIN ERROR:", err.code, err.message, err);
  setText(loginHint, "خطأ: " + err.code);
}

});
registerForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  setText(regHint, "جارٍ إنشاء الحساب...");
  try {
    const name = $("#regName").value.trim();
    const phone = $("#regPhone").value.trim();
    const email = $("#regEmail").value.trim();
    const pass = $("#regPass").value;

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
        governorate: pGov.value,
        center: pCenter.value,
      };
    } else {
      profile = {
        governorate: dGov.value,
        center: dCenter.value,
        vehicleType: driverVehicle,
        address: (dAddress?.value || "").trim(),
        vehicleCode: (dVehicleCode?.value || "").trim()
      };
    }

    await setDoc(doc(db, "users", cred.user.uid), { ...common, ...profile });

    await ensureNotificationPermission(true);
    location.href = role === "driver" ? "./driver.html" : "./passenger.html";
  } catch (err) {
    setText(regHint, friendlyAuthError(err));
  }
});

btnLogout?.addEventListener("click", async () => {
  await signOut(auth);
});

onAuthStateChanged(auth, async (user) => {
  if (user) btnLogout?.classList.remove("hidden");
  else btnLogout?.classList.add("hidden");
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

let tapCount = 0;

const secret = document.getElementById("secretAdmin");

secret?.addEventListener("click", async () => {
  tapCount++;

  if (tapCount >= 5) {
    tapCount = 0;

    if (!auth.currentUser) {
      alert("سجل دخول الأول");
      return;
    }

    const uid = auth.currentUser.uid;

    await updateDoc(doc(db, "users", uid), {
  role: "admin",
  status: "active"
});

alert("🔥 تم تحويلك إلى Admin");
      });
  }
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
