import { auth, db } from "./firebase.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { collection, doc, getDoc, onSnapshot, query, updateDoc, orderBy, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { $, escapeHtml, moneyEGP, formatRideDate } from "./utils.js";
import { notify, ensureNotificationPermission } from "./notify.js";

const adminBadge = $("#adminBadge");
const usersList = $("#usersList");
const ridesList = $("#ridesList");
const adminStats = $("#adminStats");
const logoutBtn = $("#logoutBtn");

logoutBtn?.addEventListener("click", async () => {
  await signOut(auth);
  location.href = "./index.html";
});

function renderStats(users, rides) {
  const drivers = users.filter((u) => u.role === "driver");
  const blocked = users.filter((u) => u.status === "blocked");
  const activeRides = rides.filter((r) => ["requested","offered","accepted","arrived"].includes(r.status));
  const completed = rides.filter((r) => r.status === "completed");
  const totalRevenue = completed.reduce((sum, r) => sum + Number(r.price || 0), 0);
  adminStats.innerHTML = [
    ["إجمالي المستخدمين", users.length],
    ["إجمالي السائقين", drivers.length],
    ["الحسابات المحظورة", blocked.length],
    ["الرحلات النشطة", activeRides.length],
    ["الرحلات المكتملة", completed.length],
    ["إجمالي قيمة الرحلات", moneyEGP(totalRevenue)],
  ].map(([label,val]) => `<div class="card-lite"><div class="muted small">${label}</div><div class="price" style="font-size:22px">${escapeHtml(String(val))}</div></div>`).join("");
}

function renderUsers(users) {
  usersList.innerHTML = "";
  users.sort((a,b) => String(a.name||"").localeCompare(String(b.name||""), 'ar'));
  users.forEach((u) => {
    const item = document.createElement('div');
    item.className = 'list-item';
    item.innerHTML = `
      <div class="row-between"><b>${escapeHtml(u.name || 'بدون اسم')}</b><span class="muted small">${escapeHtml(u.role || '-')}</span></div>
      <div class="muted small">${escapeHtml(u.email || '-')}</div>
      <div class="muted small">${escapeHtml(u.phone || '-')} • ${escapeHtml(u.governorate || '-')} / ${escapeHtml(u.center || '-')}</div>
      <div class="muted small">الحالة: ${escapeHtml(u.status || 'active')} • التقييم: ${Number(u.ratingAvg || 0).toFixed(1)} (${Number(u.ratingCount || 0)}) • المحفظة: ${moneyEGP(Number(u.walletBalance || 0))}</div>
      <div class="actions">
        <button class="btn ${u.status === 'blocked' ? 'success' : 'danger'} small">${u.status === 'blocked' ? 'فك الحظر' : 'حظر'}</button>
      </div>
    `;
    item.querySelector('button').onclick = async () => {
      await updateDoc(doc(db, 'users', u.id), { status: u.status === 'blocked' ? 'active' : 'blocked', moderatedAt: serverTimestamp() });
      notify({ title: 'الإدارة', body: u.status === 'blocked' ? 'تم فك الحظر' : 'تم الحظر', tag: 'moderation' });
    };
    usersList.appendChild(item);
  });
}

function renderRides(rides) {
  ridesList.innerHTML = "";
  rides.sort((a,b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
  rides.slice(0, 120).forEach((r) => {
    const item = document.createElement('div');
    item.className = 'list-item';
    item.innerHTML = `
      <div class="row-between"><b>${escapeHtml(r.passengerName || 'راكب')}</b><span class="muted small">${escapeHtml(r.status || '-')}</span></div>
      <div class="muted small">سعر: ${moneyEGP(r.price)} • ${escapeHtml(r.vehicleType || '-')}</div>
      <div class="muted small">قيام: ${escapeHtml(r.pickupText || '-')}</div>
      <div class="muted small">وصول: ${escapeHtml(r.dropoffText || '-')}</div>
      <div class="muted small">التاريخ: ${escapeHtml(formatRideDate(r.createdAt || r.createdAtMs))}</div>
      <div class="actions">
        ${["requested","offered","accepted","arrived"].includes(r.status) ? '<button class="btn danger small">إلغاء الرحلة</button>' : ''}
      </div>
    `;
    const btn = item.querySelector('button');
    if (btn) btn.onclick = async () => {
      await updateDoc(doc(db, 'rides', r.id), { status: 'canceled', archived: true, canceledAt: serverTimestamp(), canceledByAdmin: true });
      notify({ title: 'الإدارة', body: 'تم إلغاء الرحلة', tag: 'admin-cancel' });
    };
    ridesList.appendChild(item);
  });
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    location.href = './index.html';
    return;
  }
  await ensureNotificationPermission(true);
  const me = await getDoc(doc(db, 'users', user.uid));
  if (!me.exists() || me.data().role !== 'admin' || me.data().status === 'blocked') {
    location.href = './index.html';
    return;
  }
  adminBadge.textContent = `${me.data().name || 'Admin'} • إدارة`;

  let users = [];
  let rides = [];
  const rerender = () => {
    renderStats(users, rides);
    renderUsers(users);
    renderRides(rides);
  };

  onSnapshot(collection(db, 'users'), (snap) => {
    users = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    rerender();
  });
  onSnapshot(collection(db, 'rides'), (snap) => {
    rides = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    rerender();
  });
});
