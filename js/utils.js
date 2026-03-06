export const $ = (sel, root = document) => root.querySelector(sel);

export function setText(el, text) {
  if (!el) return;
  el.textContent = text ?? "";
}

export function moneyEGP(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${Math.round(n)} ج`;
}

export function debounce(fn, wait = 350) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

export function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function nowTs() {
  return Date.now();
}

export function timestampToMillis(ts) {
  if (!ts) return 0;
  if (typeof ts === "number" && Number.isFinite(ts)) return ts;
  if (typeof ts?.toMillis === "function") {
    try {
      return ts.toMillis();
    } catch (_) {
      return 0;
    }
  }
  if (ts instanceof Date) return ts.getTime();
  return 0;
}

export function isRideExpired(ride, maxAgeMs = 15 * 60 * 1000, now = Date.now()) {
  const expiresAt = timestampToMillis(ride?.expiresAt);
  if (expiresAt) return expiresAt <= now;
  const createdAt = timestampToMillis(ride?.createdAt);
  if (!createdAt) return false;
  return now - createdAt > maxAgeMs;
}

export function isActiveRideStatus(status) {
  return ["requested", "offered", "accepted", "arrived"].includes(status);
}

export function normalizeArabicDigits(value) {
  return String(value ?? "").replace(/[٠-٩]/g, (d) => "0123456789"["٠١٢٣٤٥٦٧٨٩".indexOf(d)]);
}

export function haversineMeters(a, b) {
  const lat1 = Number(a?.lat);
  const lon1 = Number(a?.lon);
  const lat2 = Number(b?.lat);
  const lon2 = Number(b?.lon);
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite)) return Infinity;

  const R = 6371000;
  const toRad = (v) => (v * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const s1 = Math.sin(dLat / 2);
  const s2 = Math.sin(dLon / 2);
  const aa = s1 * s1 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * s2 * s2;
  const c = 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
  return R * c;
}
