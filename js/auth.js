import { auth, db } from "./firebase.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  doc, setDoc, getDoc, serverTimestamp
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

let driverVehicle = "sedan";

function setRole(next) {
  role = next;
  rolePassenger.classList.toggle("active", role === "passenger");
  roleDriver.classList.toggle("active", role === "driver");
  setText(roleHint, role === "passenger" ? "التسجيل كـ راكب." : "التسجيل كـ سائق.");

  driverExtras.classList.toggle("hidden", role !== "driver");
  passengerExtras.classList.toggle("hidden", role !== "passenger");
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

  const setCenters = (govName, centerSelect) => {
    const g = admin.governorates.find(x => x.name === govName);
    fillSelect(centerSelect, (g?.centers || ["—"]));
  };

  setCenters(pGov.value, pCenter);
  setCenters(dGov.value, dCenter);

  pGov.addEventListener("change", () => setCenters(pGov.value, pCenter));
  dGov.addEventListener("change", () => setCenters(dGov.value, dCenter));

  const vehicles = admin.vehicleTypes;
  const render = () => {
    renderVehicleGrid(pVehicles, vehicles, passengerVehicle, (id) => {
      passengerVehicle = id;
      render();
    });
    renderVehicleGrid(dVehicles, vehicles, driverVehicle, (id) => {
      driverVehicle = id;
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
    await signInWithEmailAndPassword(auth, email, pass);

    const u = auth.currentUser;
    const snap = await getDoc(doc(db, "users", u.uid));
    const r = snap.exists() ? snap.data().role : "passenger";
    await ensureNotificationPermission(true);
    location.href = r === "driver" ? "./driver.html" : "./passenger.html";
  } catch (err) {
    setText(loginHint, friendlyAuthError(err));
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

    const common = { role, name, phone, email, createdAt: serverTimestamp() };

    let profile = {};
    if (role === "passenger") {
      profile = {
        governorate: pGov.value,
        center: pCenter.value,
        vehicleType: passengerVehicle
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
  return "حدث خطأ. حاول مرة أخرى.";
}
