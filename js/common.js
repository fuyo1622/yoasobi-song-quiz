// Shared helpers for the quiz (index.html) and the timing editor (editor.html).

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Tiny DOM builder: h('button', {class: 'btn', onclick}, 'text', childNode) */
/** iPhone or iPad (iPadOS says it is a Mac with a touch screen). */
export function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

/** localStorage that never throws (private mode, blocked storage, previews...). */
export const store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  },
};

export const OVERRIDES_KEY = 'yq.overrides.v1';
export const EDITABLE_FIELDS = ['musicStart', 'musicEnd', 'chorus', 'skip', 'verified', 'confidence', 'note'];

/** Fetch data/songs.json (never cached, so edits saved from the editor show up at once). */
export async function loadSongDoc() {
  const res = await fetch('data/songs.json', { cache: 'no-store' });
  if (!res.ok) throw new Error(`Could not load data/songs.json (HTTP ${res.status})`);
  return res.json();
}

/** Songs with the editor's unsaved per-song edits (kept in localStorage) applied on top. */
export function applyOverrides(songs, overrides = store.get(OVERRIDES_KEY, {})) {
  return songs.map((s) => (overrides && overrides[s.id] ? { ...s, ...overrides[s.id] } : s));
}

export async function loadSongs() {
  const doc = await loadSongDoc();
  return applyOverrides(doc.songs);
}

export function clamp(x, lo, hi) {
  return Math.min(hi, Math.max(lo, x));
}

/** 74.28 -> "1:14.3" (digits = decimals shown for seconds) */
export function fmtTime(t, digits = 1) {
  if (!Number.isFinite(t)) return '–';
  const neg = t < 0;
  t = Math.abs(t);
  const m = Math.floor(t / 60);
  let s = (t - m * 60).toFixed(digits);
  if (parseFloat(s) >= 60) return fmtTime((neg ? -1 : 1) * (m + 1) * 60, digits);
  if (s.indexOf('.') === 1 || (digits === 0 && s.length === 1)) s = '0' + s;
  return `${neg ? '-' : ''}${m}:${s}`;
}

/** "1:14.28" | "74.28" -> 74.28 ; returns NaN when unparsable (also for h:mm:ss) */
export function parseTime(text) {
  const str = String(text).trim();
  if (!str) return NaN;
  if (str.includes(':')) {
    const parts = str.split(':');
    if (parts.length !== 2) return NaN;
    const mm = Number(parts[0]), ss = Number(parts[1]);
    return Number.isFinite(mm) && Number.isFinite(ss) ? mm * 60 + ss : NaN;
  }
  return Number(str);
}

export function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function sample(arr, n, rng = Math.random) {
  return shuffle(arr, rng).slice(0, n);
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function youtubeUrl(videoId, t = 0) {
  const s = Math.max(0, Math.floor(t));
  return `https://www.youtube.com/watch?v=${videoId}${s ? `&t=${s}s` : ''}`;
}

// compare without case, punctuation or macrons: "Gekijō" and "Gekijo" count as the same
const norm = (x) => String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** The English title shown under the Japanese one; empty when the title is already English. */
export function englishTitle(song) {
  return song.english && norm(song.english) !== norm(song.title) ? song.english : '';
}

/** Romaji and English line for the timing editor, only when it adds information. */
export function subtitleFor(song) {
  const parts = [];
  if (norm(song.romaji) !== norm(song.title)) parts.push(song.romaji);
  if (song.english && norm(song.english) !== norm(song.romaji) && norm(song.english) !== norm(song.title)) parts.push(song.english);
  return parts.join(' · ');
}

/* ---------- theme ---------- */
const THEME_KEY = 'yq.theme';
export function initTheme(button, label = (light) => (light ? 'Switch to night theme' : 'Switch to light theme')) {
  const saved = store.get(THEME_KEY, null);
  if (saved) document.documentElement.dataset.theme = saved;
  if (!button) return () => {};
  const current = () =>
    document.documentElement.dataset.theme ||
    (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  const paint = () => {
    const light = current() === 'light';
    button.setAttribute('aria-label', label(light));
    button.title = button.getAttribute('aria-label');
    button.innerHTML = light ? ICONS.moon : ICONS.sun;
  };
  button.addEventListener('click', () => {
    const next = current() === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    store.set(THEME_KEY, next);
    paint();
  });
  paint();
  return paint;   // call again after a language change
}

/* ---------- toasts / confirm ---------- */
export function toast(message, kind = '', ms = 3200) {
  let host = $('.toast-host');
  if (!host) {
    host = h('div', { class: 'toast-host', role: 'status', 'aria-live': 'polite' });
    document.body.append(host);
  }
  const t = h('div', { class: `toast ${kind}` }, message);
  host.append(t);
  setTimeout(() => t.remove(), ms);
}

export function confirmDialog(title, text, okLabel = 'OK', cancelLabel = 'Cancel') {
  return new Promise((resolve) => {
    const close = (v) => { back.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(false); } };
    const ok = h('button', { class: 'btn primary', onclick: () => close(true) }, okLabel);
    const back = h('div', { class: 'modal-back', onclick: (e) => { if (e.target === back) close(false); } },
      h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
        h('h3', {}, title),
        h('p', {}, text),
        h('div', { class: 'row' },
          h('button', { class: 'btn ghost', onclick: () => close(false) }, cancelLabel),
          ok)));
    document.body.append(back);
    document.addEventListener('keydown', onKey, true);
    ok.focus();
  });
}

/* ---------- icons (inline SVG, currentColor) ---------- */
const svg = (body, vb = '0 0 24 24') =>
  `<svg viewBox="${vb}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
export const ICONS = {
  moon: svg('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  play: svg('<path d="M7 4.5v15l12.5-7.5z" fill="currentColor" stroke="none"/>'),
  pause: svg('<path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" stroke="none"/>'),
  replay: svg('<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>'),
  next: svg('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  ext: svg('<path d="M14 4h6v6M20 4l-9 9"/><path d="M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/>'),
  edit: svg('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>'),
  chorus: svg('<path d="M9 18V6l11-2v12"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>'),
  shuffle: svg('<path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>'),
  noChorus: svg('<path d="M9 18V6l11-2v12"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/><path d="M3 3l18 18"/>'),
  logo: svg('<path d="M20 14.5A8 8 0 1 1 9.5 4a6.2 6.2 0 0 0 10.5 10.5z" fill="currentColor" stroke="none"/><circle cx="17.5" cy="6.5" r="1.4" fill="currentColor" stroke="none"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  x: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  back: svg('<path d="M19 12H5M11 6l-6 6 6 6"/>'),
  save: svg('<path d="M5 3h11l3 3v15H5z"/><path d="M8 3v6h8V3M8 21v-7h8v7"/>'),
  download: svg('<path d="M12 3v12M6 11l6 6 6-6M4 21h16"/>'),
  globe: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'),
  flag: svg('<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>'),
  eye: svg('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
};
