import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  updateDoc,
  deleteDoc,
  where,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { $, escapeHtml, moneyEGP, formatRideDate } from "./utils.js";
import { notify, ensureNotificationPermission } from "./notify.js";

const adminBadge = $("#adminBadge");
const adminStats = $("#adminStats");
const usersList = $("#usersList");
const ridesList = $("#ridesList");
const recentUsersList = $("#recentUsersList");
const recentRidesList = $("#recentRidesList");
const driversOnlineList = $("#driversOnlineList");
const adminsList = $("#adminsList");

const adminSearch = $("#adminSearch");
const adminUserFilter = $("#adminUserFilter");
const adminRideFilter = $("#adminRideFilter");
const logoutBtn = $("#logoutBtn");
const makeAdminBtn = $("#makeAdminBtn");

const tabs = [...document.querySelectorAll(".admin-tab")];
const panes = [...document.querySelectorAll(".admin-pane")];

let currentAdmin = null;
let allUsers = [];
let allRides = [];
let allDriversOnline = [];

logoutBtn?.addEventListener("click", async () => {
  await signOut(auth);
  location.href = "./index.html";
});

tabs.forEach((btn) => {
  btn.addEventListener("click", () => {
    const tab = btn.dataset.tab;
    tabs.forEach((b) => b.classList.toggle("active", b === btn));
    panes.forEach((p) => p.classList.toggle("active", p.id === `pane-${tab}`));
  });
});

adminSearch?.addEventListener("input", rerenderAll);
adminUserFilter?.addEventListener("change", rerenderAll);
adminRideFilter?.addEventListener("change", rerenderAll);

function activeRideStatuses() {
  return ["requested", "offered", "accepted", "arrived"];
}

function roleText(role) {
  if (role === "driver") return "سائق";
  if (role === "passenger") return "راكب";
  if (role === "admin") return "أدمن";
  return role || "-";
}

function renderStats(users, rides, driversOnline) {
  const drivers = users.filter((u) => u.role === "driver");
  const passengers = users.filter((u) => u.role === "passenger");
  const admins = users.filter((u) => u.role === "admin");
  const blocked = users.filter((u) => u.status === "blocked");
  const activeRides = rides.filter((r) => activeRideStatuses().includes(r.status));
  const completed = rides.filter((r) => r.status === "completed");
  const totalRevenue = completed.reduce((sum, r) => sum + Number(r.price || 0), 0);

  adminStats.innerHTML = `
    <div class="admin-stat"><div class="label">إجمالي المستخدمين</div><div class="value">${users.length}</div></div>
    <div class="admin-stat"><div class="label">إجمالي السائقين</div><div class="value">${drivers.length}</div></div>
    <div class="admin-stat"><div class="label">إجمالي الركاب</div><div class="value">${passengers.length}</div></div>
    <div class="admin-stat"><div class="label">إجمالي الأدمنز</div><div class="value">${admins.length}</div></div>
    <div class="admin-stat"><div class="label">الحسابات المحظورة</div><div class="value">${blocked.length}</div></div>
    <div class="admin-stat"><div class="label">الرحلات النشطة</div><div class="value">${activeRides.length}</div></div>
    <div class="admin-stat"><div class="label">الرحلات المكتملة</div><div class="value">${completed.length}</div></div>
    <div class="admin-stat"><div class="label">إجمالي قيمة الرحلات</div><div class="value">${escapeHtml(String(moneyEGP(totalRevenue)))}</div></div>
    <div class="admin-stat"><div class="label">السائقون المتصلون الآن</div><div class="value">${driversOnline.length}</div></div>
  `;
}

function userMatchesSearch(u, q) {
  if (!q) return true;
  const s = `${u.name || ""} ${u.email || ""} ${u.phone || ""} ${u.governorate || ""} ${u.center || ""}`.toLowerCase();
  return s.includes(q);
}

function rideMatchesSearch(r, q) {
  if (!q) return true;
  const s = `${r.passengerName || ""} ${r.driverName || ""} ${r.pickupText || ""} ${r.dropoffText || ""} ${r.vehicleType || ""} ${r.status || ""}`.toLowerCase();
  return s.includes(q);
}

function getFilteredUsers() {
  const q = String(adminSearch?.value || "").trim().toLowerCase();
  const filter = adminUserFilter?.value || "all";

  let arr = [...allUsers].filter((u) => userMatchesSearch(u, q));

  if (filter === "driver") arr = arr.filter((u) => u.role === "driver");
  if (filter === "passenger") arr = arr.filter((u) => u.role === "passenger");
  if (filter === "admin") arr = arr.filter((u) => u.role === "admin");
  if (filter === "blocked") arr = arr.filter((u) => u.status === "blocked");

  arr.sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ar"));
  return arr;
}

function getFilteredRides() {
  const q = String(adminSearch?.value || "").trim().toLowerCase();
  const filter = adminRideFilter?.value || "all";

  let arr = [...allRides].filter((r) => rideMatchesSearch(r, q));

  if (filter === "active") arr = arr.filter((r) => activeRideStatuses().includes(r.status));
  if (filter === "completed") arr = arr.filter((r) => r.status === "completed");
  if (filter === "canceled") arr = arr.filter((r) => r.status === "canceled");

  arr.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  return arr;
}

function userCard(u) {
  const statusClass = u.status === "blocked" ? "warn" : "ok";
  const isAdmin = u.role === "admin";
  const isCurrentAdmin = currentAdmin && currentAdmin.uid === u.id;

  return `
    <div class="list-item">
      <div class="admin-card-head">
        <b>${escapeHtml(u.name || "بدون اسم")}</b>
        <span class="admin-badge ${statusClass}">${escapeHtml(u.status || "active")}</span>
      </div>

      <div class="admin-meta">
        <div class="admin-mini">النوع: ${escapeHtml(roleText(u.role))}</div>
        <div class="admin-mini">الإيميل: ${escapeHtml(u.email || "-")}</div>
        <div class="admin-mini">الهاتف: ${escapeHtml(u.phone || "-")}</div>
        <div class="admin-mini">المنطقة: ${escapeHtml(u.governorate || "-")} / ${escapeHtml(u.center || "-")}</div>
        <div class="admin-mini">التقييم: ${Number(u.ratingAvg || 0).toFixed(1)} (${Number(u.ratingCount || 0)})</div>
        <div class="admin-mini">المحفظة: ${moneyEGP(Number(u.walletBalance || 0))}</div>
      </div>

      <div class="admin-actions">
        <button class="btn ${u.status === "blocked" ? "success" : "danger"} small" data-action="toggle-user" data-id="${u.id}">
          ${u.status === "blocked" ? "فك الحظر" : "حظر"}
        </button>

        <button class="btn ghost small" data-action="wallet-user" data-id="${u.id}">
          تعديل الرصيد
        </button>

        ${isAdmin && !isCurrentAdmin ? `
          <button class="btn danger small" data-action="remove-admin" data-id="${u.id}">
            إزالة أدمن
          </button>
        ` : ""}

        ${!isAdmin ? `
          <button class="btn success small" data-action="make-admin" data-id="${u.id}">
            ترقية إلى أدمن
          </button>
        ` : ""}
      </div>
    </div>
  `;
}

function rideCard(r) {
  const statusClass =
    r.status === "completed" ? "ok" :
    r.status === "canceled" ? "warn" : "info";

  const canCancel = activeRideStatuses().includes(r.status);

  return `
    <div class="list-item">
      <div class="admin-card-head">
        <b>${escapeHtml(r.passengerName || "راكب")}</b>
        <span class="admin-badge ${statusClass}">${escapeHtml(r.status || "-")}</span>
      </div>

      <div class="admin-meta">
        <div class="admin-mini">السعر: ${moneyEGP(r.price)}</div>
        <div class="admin-mini">المركبة: ${escapeHtml(r.vehicleType || "-")}</div>
        <div class="admin-mini">القيام: ${escapeHtml(r.pickupText || "-")}</div>
        <div class="admin-mini">الوصول: ${escapeHtml(r.dropoffText || "-")}</div>
        <div class="admin-mini">السائق: ${escapeHtml(r.driverName || "-")}</div>
        <div class="admin-mini">التاريخ: ${escapeHtml(formatRideDate(r.createdAt || r.createdAtMs))}</div>
      </div>

      <div class="admin-actions">
        ${canCancel ? `<button class="btn danger small" data-action="cancel-ride" data-id="${r.id}">إلغاء الرحلة</button>` : ""}
      </div>
    </div>
  `;
}

function onlineDriverCard(d) {
  return `
    <div class="list-item">
      <div class="admin-card-head">
        <b>${escapeHtml(d.name || "سائق")}</b>
        <span class="admin-badge ok">متصل الآن</span>
      </div>
      <div class="admin-meta">
        <div class="admin-mini">المنطقة: ${escapeHtml(d.governorate || "-")} / ${escapeHtml(d.center || "-")}</div>
        <div class="admin-mini">المركبة: ${escapeHtml(d.vehicleType || "-")}</div>
        <div class="admin-mini">الهاتف: ${escapeHtml(d.phone || "-")}</div>
        <div class="admin-mini">آخر تحديث: ${escapeHtml(formatRideDate(d.updatedAt || d.lastSeenAt || d.createdAt))}</div>
      </div>
    </div>
  `;
}

async function handleUsersClick(e) {
  const toggleBtn = e.target.closest('[data-action="toggle-user"]');
  if (toggleBtn) {
    const id = toggleBtn.dataset.id;
    const u = allUsers.find((x) => x.id === id);
    if (!u) return;

    await updateDoc(doc(db, "users", id), {
      status: u.status === "blocked" ? "active" : "blocked",
      moderatedAt: serverTimestamp()
    });

    notify({
      title: "الإدارة",
      body: u.status === "blocked" ? "تم فك الحظر" : "تم الحظر",
      tag: "moderation"
    });
    return;
  }

  const walletBtn = e.target.closest('[data-action="wallet-user"]');
  if (walletBtn) {
    const id = walletBtn.dataset.id;
    const u = allUsers.find((x) => x.id === id);
    if (!u) return;

    const amount = prompt("اكتب الرصيد الجديد", String(Number(u.walletBalance || 0)));
    if (amount === null) return;
    const num = Number(amount);
    if (!Number.isFinite(num) || num < 0) {
      alert("قيمة غير صحيحة");
      return;
    }

    await updateDoc(doc(db, "users", id), {
      walletBalance: num,
      walletUpdatedAt: serverTimestamp()
    });

    notify({
      title: "الإدارة",
      body: "تم تعديل الرصيد",
      tag: "wallet-update"
    });
    return;
  }

  const makeAdminBtnInline = e.target.closest('[data-action="make-admin"]');
  if (makeAdminBtnInline) {
    const id = makeAdminBtnInline.dataset.id;
    await updateDoc(doc(db, "users", id), {
      role: "admin",
      status: "active",
      promotedAt: serverTimestamp()
    });
    notify({
      title: "الإدارة",
      body: "تمت الترقية إلى أدمن",
      tag: "make-admin"
    });
    return;
  }

  const removeAdminBtn = e.target.closest('[data-action="remove-admin"]');
  if (removeAdminBtn) {
    const id = removeAdminBtn.dataset.id;
    await updateDoc(doc(db, "users", id), {
      role: "passenger",
      demotedAt: serverTimestamp()
    });
    notify({
      title: "الإدارة",
      body: "تمت إزالة صلاحية الأدمن",
      tag: "remove-admin"
    });
  }
}

async function handleRidesClick(e) {
  const btn = e.target.closest('[data-action="cancel-ride"]');
  if (!btn) return;
  const id = btn.dataset.id;

  await updateDoc(doc(db, "rides", id), {
    status: "canceled",
    archived: true,
    canceledAt: serverTimestamp(),
    canceledByAdmin: true
  });

  notify({
    title: "الإدارة",
    body: "تم إلغاء الرحلة",
    tag: "admin-cancel"
  });
}

usersList?.addEventListener("click", handleUsersClick);
recentUsersList?.addEventListener("click", handleUsersClick);
adminsList?.addEventListener("click", handleUsersClick);
ridesList?.addEventListener("click", handleRidesClick);
recentRidesList?.addEventListener("click", handleRidesClick);

makeAdminBtn?.addEventListener("click", async () => {
  const email = prompt("اكتب إيميل الشخص");
  if (!email) return;

  const q = query(collection(db, "users"), where("email", "==", email.trim()));
  const snap = await getDocs(q);

  if (snap.empty) {
    alert("المستخدم غير موجود");
    return;
  }

  const target = snap.docs[0];
  await updateDoc(doc(db, "users", target.id), {
    role: "admin",
    status: "active",
    promotedAt: serverTimestamp()
  });

  notify({
    title: "الإدارة",
    body: "تمت إضافة أدمن جديد",
    tag: "make-admin"
  });
});

function renderUsers(users) {
  if (!users.length) {
    usersList.innerHTML = `<div class="admin-empty">لا يوجد مستخدمون مطابقون.</div>`;
    return;
  }
  usersList.innerHTML = users.map(userCard).join("");
}

function renderRides(rides) {
  const limited = rides.slice(0, 120);
  if (!limited.length) {
    ridesList.innerHTML = `<div class="admin-empty">لا توجد رحلات مطابقة.</div>`;
    return;
  }
  ridesList.innerHTML = limited.map(rideCard).join("");
}

function renderOverview(users, rides) {
  const recentUsers = [...users].slice(0, 6);
  const recentRides = [...rides].slice(0, 6);

  recentUsersList.innerHTML = recentUsers.length
    ? recentUsers.map(userCard).join("")
    : `<div class="admin-empty">لا يوجد مستخدمون.</div>`;

  recentRidesList.innerHTML = recentRides.length
    ? recentRides.map(rideCard).join("")
    : `<div class="admin-empty">لا توجد رحلات.</div>`;
}

function renderOnline(driversOnline) {
  const arr = [...driversOnline].sort((a, b) => (b.updatedAt?.seconds || 0) - (a.updatedAt?.seconds || 0));
  driversOnlineList.innerHTML = arr.length
    ? arr.map(onlineDriverCard).join("")
    : `<div class="admin-empty">لا يوجد سائقون متصلون الآن.</div>`;
}

function renderAdmins(users) {
  const admins = users.filter((u) => u.role === "admin");
  adminsList.innerHTML = admins.length
    ? admins.map(userCard).join("")
    : `<div class="admin-empty">لا يوجد أدمنز.</div>`;
}

function rerenderAll() {
  const filteredUsers = getFilteredUsers();
  const filteredRides = getFilteredRides();

  renderStats(allUsers, allRides, allDriversOnline);
  renderUsers(filteredUsers);
  renderRides(filteredRides);
  renderOverview(filteredUsers, filteredRides);
  renderOnline(allDriversOnline);
  renderAdmins(allUsers);
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    location.href = "./index.html";
    return;
  }

  await ensureNotificationPermission(true);

  const me = await getDoc(doc(db, "users", user.uid));
  if (!me.exists() || me.data().role !== "admin" || me.data().status === "blocked") {
    location.href = "./index.html";
    return;
  }

  currentAdmin = { uid: user.uid, ...me.data() };
  adminBadge.textContent = `${me.data().name || "Admin"} • إدارة`;

  onSnapshot(collection(db, "users"), (snap) => {
    allUsers = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    rerenderAll();
  });

  onSnapshot(collection(db, "rides"), (snap) => {
    allRides = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    rerenderAll();
  });

  onSnapshot(collection(db, "driversOnline"), (snap) => {
    allDriversOnline = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    rerenderAll();
  });
});
