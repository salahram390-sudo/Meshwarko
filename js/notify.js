import { $, escapeHtml } from "./utils.js";

let audioCtx = null;
let requestLoopSource = null;
let requestLoopBuffer = null;

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

let requestLoopAudio = null;

async function getAudioBuffer(url) {
  audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();

  if (audioCtx.state === "suspended") {
    try { await audioCtx.resume(); } catch (_) {}
  }

  const res = await fetch(url);
  const arr = await res.arrayBuffer();
  return await audioCtx.decodeAudioData(arr);
}

export async function startRequestSound() {
  try {
    if (requestLoopSource) return;

    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();

    if (audioCtx.state === "suspended") {
      try { await audioCtx.resume(); } catch (_) {}
    }

    if (!requestLoopBuffer) {
      requestLoopBuffer = await getAudioBuffer("./assets/sounds/request.mp3");
    }

    const source = audioCtx.createBufferSource();
    const gain = audioCtx.createGain();

    source.buffer = requestLoopBuffer;
    source.loop = true;

    gain.gain.value = 1.0;

    source.connect(gain);
    gain.connect(audioCtx.destination);

    source.start(0);
    requestLoopSource = source;
  } catch (e) {
    console.warn("startRequestSound failed:", e);
  }
}

export function stopRequestSound() {
  if (!requestLoopAudio) return;
  requestLoopAudio.pause();
  requestLoopAudio.currentTime = 0;
  requestLoopAudio = null;
} //اخر تشغيل الصوت

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
    new Notification(title, { body, tag });
  } catch {}
}
