import { $, escapeHtml } from "./utils.js";

let audioCtx = null;
let requestLoopAudio = null;

export async function ensureNotificationPermission(ask = true) {
  if (!("Notification" in window)) return "unsupported";
  if (Notification.permission === "granted") return "granted";
  if (!ask) return Notification.permission;
  try {
    const res = await Notification.requestPermission();
    return res;
  } catch {
    return Notification.permission;
  }
}

function beep() {
  try{
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.connect(g); g.connect(audioCtx.destination);
    o.type = "sine";
    o.frequency.value = 880;
    g.gain.value = 0.03;
    o.start();
    setTimeout(()=>{ o.stop(); }, 120);
  } catch {}
}

export function playSound(type = "notify") {
  let file = "./assets/sounds/notify.mp3";

  if (type === "request") file = "./assets/sounds/request.mp3";
  else if (type === "success") file = "./assets/sounds/success.mp3";
  else if (type === "offer") file = "./assets/sounds/offer.mp3";
  else if (type === "accepted") file = "./assets/sounds/accepted.mp3";
  else if (type === "arrived") file = "./assets/sounds/arrived.mp3";
  else if (type === "started") file = "./assets/sounds/started.mp3";
  else if (type === "cancel") file = "./assets/sounds/cancel.mp3";
  else if (type === "message") file = "./assets/sounds/message.mp3";

  const audio = new Audio(file);
  audio.volume = 1.0;
  audio.play().catch(() => {});
}

export function startRequestSound() {
  try {
    stopRequestSound();
    requestLoopAudio = new Audio("./assets/sounds/request.mp3");
    requestLoopAudio.loop = true;
    requestLoopAudio.volume = 0.9;
    requestLoopAudio.play().catch(e => console.warn("Request sound failed", e));
  } catch (e) {
    console.warn("startRequestSound failed:", e);
  }
}

export function stopRequestSound() {
  try {
    if (requestLoopAudio) {
      requestLoopAudio.pause();
      requestLoopAudio.currentTime = 0;
      requestLoopAudio = null;
    }
  } catch (e) {
    console.warn("stopRequestSound error:", e);
    requestLoopAudio = null;
  }
}

export function toast(title, message, ms = 3500) {
  const root = document.getElementById("toastRoot");
  if (!root) return;
  const el = document.createElement("div");
  el.className = "toast";
  el.innerHTML = `
    <div>
      <b>${escapeHtml(title)}</b>
      <div class="muted small">${escapeHtml(message)}</div>
    </div>
    <button class="x" aria-label="close">×</button>
  `;
  el.querySelector(".x").onclick = () => el.remove();
  root.appendChild(el);
  setTimeout(() => { if (el.isConnected) el.remove(); }, ms);
}

// ====================== النسخة المحسنة ======================
export async function notify({ 
  title, 
  body, 
  tag = "mashwark", 
  vibrate = true, 
  sound = true,
  icon = "./logo.png"
}) {

  // Toast دايماً (حتى لو التطبيق مفتوح)
  toast(title, body);

  if (sound) {
    if (tag.includes("request") || tag === "new-ride-request") {
      startRequestSound();
    } else {
      playSound("notify");
    }
  }

  if (vibrate && navigator.vibrate) navigator.vibrate([80, 40, 80]);

  // إشعار نظامي (Browser Notification) حتى لو التطبيق مفتوح
  if (!("Notification" in window)) return;

  const perm = await ensureNotificationPermission(false);
  if (perm !== "granted") return;

  try {
    const notification = new Notification(title, {
      body: body,
      icon: icon,
      tag: tag,
      badge: "./logo.png",
      vibrate: [200, 100, 200],
      data: { url: "/driver.html" }
    });

    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  } catch (e) {
    console.warn("System notification failed", e);
  }
}
