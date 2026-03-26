import { $, escapeHtml } from "./utils.js";

let audioCtx = null;

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

function playSound(type = "notify") {
  let soundFile = "assets/sounds/notify.mp3";

  if (type === "request") {
    soundFile = "assets/sounds/request.mp3";
  }

  if (type === "success") {
    soundFile = "assets/sounds/success.mp3";
  }

  const audio = new Audio(soundFile);
  audio.volume = 1.0;
  audio.play().catch(() => {});
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

  setTimeout(() => {
    if (el.isConnected) el.remove();
  }, ms);
}

export async function notify({ title, body, tag = "mashwark", vibrate = true, sound = true, systemWhenHidden = true }) {
  toast(title, body);
  if (sound) beep();
  if (vibrate && navigator.vibrate) navigator.vibrate([80, 40, 80]);

  if (!("Notification" in window)) return;
  if (systemWhenHidden && document.visibilityState !== "hidden") return;

  const perm = await ensureNotificationPermission(false);
  if (perm !== "granted") return;

  try {
    new Notification(title, { body, tag, silent: true });
  } catch {}
}
