/* 한나 릴스 스튜디오 — mobile reels editor */
const REF_W = 390;
const DEFAULT_PHOTO_DUR = 2.5;
const KEY = 'hanna-reels-v1';

const FONTS = [
  { id: 'ssuround', name: '카페24 써라운드', css: "'Cafe24Ssurround', sans-serif" },
  { id: 'pretendard', name: '프리텐다드', css: "'Pretendard Variable', Pretendard, sans-serif" },
  { id: 'cookie', name: '쿠키런', css: "'CookieRun', sans-serif" },
  { id: 'peace', name: '평창평화체', css: "'PyeongChangPeace', sans-serif" },
  { id: 'jua', name: '주아', css: "'Jua', sans-serif" },
  { id: 'dohyeon', name: '도현', css: "'Do Hyeon', sans-serif" },
  { id: 'black', name: '검은고딕', css: "'Black Han Sans', sans-serif" },
  { id: 'pen', name: '나눔손글씨', css: "'Nanum Pen Script', cursive" },
  { id: 'gowun', name: '고운돋움', css: "'Gowun Dodum', sans-serif" },
  { id: 'gaegu', name: '개구', css: "'Gaegu', sans-serif" },
];

const PRESETS = {
  stroke: { name: '이중획', color: '#FFFFFF', stroke: '#2B1D16', bg: null, radius: 0 },
  box:    { name: '직각박스', color: '#FFFFFF', stroke: '#000000', bg: '#1D1712', alpha: 1, radius: 0.1 },
  round:  { name: '둥근박스', color: '#FFFFFF', stroke: '#3E2B21', bg: '#3E2B21', alpha: 0.94, radius: 0.55 },
  glow:   { name: '글로우', color: '#FFFFFF', stroke: null, bg: null, radius: 0, glow: '#FFD166' },
  yellow: { name: '노랑포인트', color: '#231710', stroke: null, bg: '#FFD84D', alpha: 1, radius: 0.22 },
  pastel: { name: '파스텔', color: '#5B4636', stroke: null, bg: '#FDE2E4', alpha: 1, radius: 999 },
};

const STICKERS = ['✨','💕','❤️','🎀','🌸','🎵','🎶','⭐','🌟','🐻','🐰','🍓','🍒','☁️','🌷','📷','🎬','🫧','💫','🦋','🍰','🧸','💌','🎈'];

const DEFAULT_STYLE = {
  font: 'ssuround', size: 34, preset: 'stroke',
  color: '#FFFFFF', stroke: '#2B1D16', strokeW: 3, bg: '#3E2B21', bold: true,
};

const state = {
  clips: [],
  subtitles: [],
  stickers: [],
  bgm: null,
  settings: { fillMode: 'cover', originalVolume: 1, bgmVolume: 0.35 },
  defaultStyle: { ...DEFAULT_STYLE },
  sel: { type: null, id: null },
  playhead: 0,
  playing: false,
  tab: 'clip',
};

const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const uid = () => Math.random().toString(36).slice(2, 9);
const fmt = (n) => (Math.round(n * 10) / 10).toFixed(1);
const fontCss = (id) => (FONTS.find((f) => f.id === id) || FONTS[0]).css;

let stageScale = 1;
const audio = { ctx: null, master: null, origGain: null, bgmGain: null, sources: new WeakMap(), dest: null, destOn: false };
let bgmSource = null;
let rafId = null;
let lastTs = 0;
let activeClipId = null;
let saveTimer = null;
const ovEls = new Map();
const visibleOv = new Set();
let lastExport = null;

/* ------------------------------------------------------------------ */
/* time helpers                                                       */
/* ------------------------------------------------------------------ */
function totalDuration() { return state.clips.reduce((s, c) => s + clipDur(c), 0); }
function clipDur(c) {
  if (c.type === 'video') return Math.max(0.1, (c.trimEnd - c.trimStart) / (c.speed || 1));
  return Math.max(0.2, c.duration || DEFAULT_PHOTO_DUR);
}
function clipStartTime(clip) {
  let t = 0;
  for (const c of state.clips) { if (c === clip) return t; t += clipDur(c); }
  return 0;
}
function clipAt(t) {
  let acc = 0;
  for (const c of state.clips) {
    const d = clipDur(c);
    if (t < acc + d - 1e-6) return c;
    acc += d;
  }
  return state.clips[state.clips.length - 1] || null;
}
function currentClip() { return clipAt(Math.min(state.playhead, Math.max(0, totalDuration() - 1e-3))); }
function findSub(id) { return state.subtitles.find((s) => s.id === id); }
function findSticker(id) { return state.stickers.find((s) => s.id === id); }
function subAt(t) { return state.subtitles.find((s) => t >= s.start && t <= s.end) || null; }
function targetSub() {
  if (state.sel.type === 'sub') { const s = findSub(state.sel.id); if (s) return s; }
  return subAt(state.playhead) || (state.subtitles.length === 1 ? state.subtitles[0] : null);
}
function toast(msg, ms = 1900) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  t.style.animation = 'none';
  void t.offsetWidth;
  t.style.animation = '';
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, ms);
}

/* ------------------------------------------------------------------ */
/* persistence                                                        */
/* ------------------------------------------------------------------ */
function markSaving() {
  const s = $('saveState');
  s.classList.add('saving');
  s.querySelector('span').textContent = '저장 중…';
}
function scheduleSave() {
  markSaving();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveLocal, 500);
}
function saveLocal() {
  const s = $('saveState');
  try {
    localStorage.setItem(KEY, JSON.stringify({
      v: 1,
      subtitles: state.subtitles,
      stickers: state.stickers,
      settings: state.settings,
      defaultStyle: state.defaultStyle,
      savedAt: Date.now(),
    }));
    const d = new Date();
    s.classList.remove('saving');
    s.querySelector('span').textContent = `자동 저장됨 · ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch (e) {
    s.classList.remove('saving');
    s.querySelector('span').textContent = '자동 저장 실패';
  }
}
function loadLocal() {
  try {
    const raw = localStorage.getItem(KEY);
    const s = $('saveState');
    if (!raw) { s.querySelector('span').textContent = '자동 저장됨'; return; }
    const data = JSON.parse(raw);
    if (Array.isArray(data.subtitles)) state.subtitles = data.subtitles;
    if (Array.isArray(data.stickers)) state.stickers = data.stickers;
    if (data.settings) Object.assign(state.settings, data.settings);
    if (data.defaultStyle) Object.assign(state.defaultStyle, data.defaultStyle);
    const d = data.savedAt ? new Date(data.savedAt) : new Date();
    s.querySelector('span').textContent = `자동 저장됨 · ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    if (state.subtitles.length || state.stickers.length) {
      setTimeout(() => toast('자막·스티커 설정을 불러왔어요. 사진·영상을 다시 추가해 주세요.', 2600), 800);
    }
  } catch (e) { /* ignore */ }
}

/* ------------------------------------------------------------------ */
/* media                                                              */
/* ------------------------------------------------------------------ */
function ensureMediaEl(clip) {
  if (clip.el) return clip.el;
  let node;
  if (clip.type === 'video') {
    node = document.createElement('video');
    node.playsInline = true;
    node.setAttribute('playsinline', '');
    node.preload = 'auto';
    node.src = clip.src;
    node.muted = true;
    node.loop = false;
  } else {
    node = new Image();
    node.src = clip.src;
    node.decoding = 'async';
  }
  node.className = 'media-el';
  node.draggable = false;
  clip.el = node;
  $('mediaLayer').appendChild(node);
  return node;
}

function waitCanPlay(v) {
  if (v.readyState >= 2) return Promise.resolve();
  return new Promise((r) => {
    let done = false;
    const fin = () => { if (done) return; done = true; r(); };
    v.addEventListener('canplay', fin, { once: true });
    v.addEventListener('loadeddata', fin, { once: true });
    setTimeout(fin, 2500);
  });
}

function loadMeta(clip) {
  return new Promise((resolve) => {
    const node = ensureMediaEl(clip);
    const finish = () => {
      clip.naturalW = clip.type === 'video' ? node.videoWidth : node.naturalWidth;
      clip.naturalH = clip.type === 'video' ? node.videoHeight : node.naturalHeight;
      resolve();
    };
    if (clip.type === 'video') {
      const onMeta = () => {
        clip.videoDuration = node.duration || 0;
        clip.trimStart = 0;
        clip.trimEnd = clip.videoDuration;
        node.removeEventListener('loadedmetadata', onMeta);
        finish();
      };
      node.addEventListener('loadedmetadata', onMeta);
      node.addEventListener('error', finish);
      if (node.readyState >= 1 && node.duration) onMeta();
      else node.load();
    } else if (node.complete) finish();
    else { node.onload = finish; node.onerror = finish; }
  });
}

async function makeThumb(clip) {
  try {
    if (clip.type === 'image') { clip.thumb = clip.src; return; }
    const v = clip.el;
    await waitCanPlay(v);
    const target = Math.min(clip.trimStart + 0.1, Math.max(0, (v.duration || 1) - 0.05));
    v.currentTime = target;
    await new Promise((r) => { const done = () => r(); v.addEventListener('seeked', done, { once: true }); setTimeout(done, 800); });
    const c = document.createElement('canvas');
    c.width = 108; c.height = 192;
    const cx = c.getContext('2d');
    const vw = v.videoWidth, vh = v.videoHeight;
    if (!vw || !vh) return;
    const sc = Math.max(c.width / vw, c.height / vh);
    cx.drawImage(v, (c.width - vw * sc) / 2, (c.height - vh * sc) / 2, vw * sc, vh * sc);
    clip.thumb = c.toDataURL('image/jpeg', 0.72);
  } catch (e) { /* thumbnail is optional */ }
}

async function addFiles(files) {
  const list = [...files].filter((f) => f.type.startsWith('image/') || f.type.startsWith('video/'));
  if (!list.length) { toast('사진이나 영상 파일을 골라 주세요'); return; }
  toast(`${list.length}개 불러오는 중…`, 1100);
  for (const file of list) {
    const type = file.type.startsWith('video/') ? 'video' : 'image';
    const clip = {
      id: uid(), type, name: file.name, file,
      src: URL.createObjectURL(file),
      duration: DEFAULT_PHOTO_DUR,
      trimStart: 0, trimEnd: 0, videoDuration: 0, speed: 1, volume: 1,
      thumb: null, naturalW: 0, naturalH: 0,
    };
    await loadMeta(clip);
    if (type === 'video') {
      clip.trimEnd = clip.videoDuration || 0;
      if (clip.videoDuration > 30) clip.trimEnd = 30;
    }
    state.clips.push(clip);
    ensureMediaEl(clip);
    makeThumb(clip).then(() => { renderTimeline(); });
  }
  const last = state.clips[state.clips.length - 1];
  state.playhead = clipStartTime(last);
  fitTimesToTotal();
  renderAll();
  scheduleSave();
}

function fitTimesToTotal() {
  const total = totalDuration();
  if (total <= 0) return;
  for (const s of [...state.subtitles, ...state.stickers]) {
    const dur = Math.max(0.4, (s.end - s.start) || 1);
    if (s.start > total - 0.05) { s.end = total; s.start = Math.max(0, total - dur); }
    s.end = Math.min(s.end, total);
    if (s.end - s.start < 0.3) {
      s.start = Math.max(0, Math.min(s.start, total - 0.3));
      s.end = Math.min(total, s.start + Math.max(0.3, Math.min(dur, total)));
    }
    s.start = Math.round(s.start * 100) / 100;
    s.end = Math.round(s.end * 100) / 100;
  }
  state.playhead = clamp(state.playhead, 0, total);
}

function removeClip(clip) {
  const i = state.clips.indexOf(clip);
  if (i < 0) return;
  if (clip.el) clip.el.remove();
  if (clip.src && clip.src.startsWith('blob:')) URL.revokeObjectURL(clip.src);
  state.clips.splice(i, 1);
  state.playhead = clamp(state.playhead, 0, Math.max(0, totalDuration() - 0.01));
  if (!state.clips.length) { state.playhead = 0; pause(); }
  fitTimesToTotal();
  renderAll();
  scheduleSave();
}

/* ------------------------------------------------------------------ */
/* stage                                                              */
/* ------------------------------------------------------------------ */
function layoutStage() {
  const wrap = $('stageWrap');
  const availW = wrap.clientWidth;
  const availH = wrap.clientHeight;
  if (!availW || !availH) return;
  let h = availH;
  let w = (h * 9) / 16;
  if (w > availW) { w = availW; h = (w * 16) / 9; }
  const stage = $('stage');
  stage.style.width = `${Math.floor(w)}px`;
  stage.style.height = `${Math.floor(h)}px`;
  stageScale = w / REF_W;
  styleOverlays();
  layoutSelFrame();
}

function mediaForActive(clip) {
  for (const c of state.clips) {
    if (!c.el) continue;
    const on = c === clip;
    c.el.classList.toggle('contain', state.settings.fillMode === 'contain');
    if (c.el.style.display !== (on ? 'block' : 'none')) c.el.style.display = on ? 'block' : 'none';
  }
  const bg = $('bgLayer');
  if (!clip || state.settings.fillMode !== 'contain' || !clip.src) {
    if (bg.dataset.for) { bg.innerHTML = ''; bg.dataset.for = ''; }
    return;
  }
  if (bg.dataset.for === clip.id) {
    const bgv = bg.querySelector('video');
    if (bgv && state.playing && bgv.paused) bgv.play().catch(() => {});
    return;
  }
  bg.innerHTML = '';
  let node;
  if (clip.type === 'video') {
    node = document.createElement('video');
    node.muted = true; node.playsInline = true; node.preload = 'auto'; node.src = clip.src;
    node.currentTime = 0;
  } else {
    node = document.createElement('img'); node.src = clip.src;
  }
  node.className = 'bg-el';
  bg.appendChild(node);
  bg.dataset.for = clip.id;
}

function updateMediaForTime(t, forceSeek = false) {
  const clip = clipAt(Math.min(t, Math.max(0, totalDuration() - 1e-4)));
  mediaForActive(clip);
  if (!clip) { activeClipId = null; return; }
  const changed = activeClipId !== clip.id;
  activeClipId = clip.id;
  if (clip.type !== 'video' || !clip.el) return;
  const v = clip.el;
  const local = clip.trimStart + (t - clipStartTime(clip)) * (clip.speed || 1);
  const target = clamp(local, clip.trimStart, Math.max(clip.trimStart, clip.trimEnd - 0.04));
  if (changed || forceSeek || Math.abs(v.currentTime - target) > 0.24) {
    try { v.currentTime = target; } catch (e) { /* ignore */ }
  }
  v.playbackRate = clamp(clip.speed || 1, 0.25, 4);
  const bgv = $('bgLayer').querySelector('video');
  if (bgv && changed) { try { bgv.currentTime = target; } catch (e) {} }
  if (state.playing) {
    if (v.paused) v.play().catch(() => { v.muted = true; v.play().catch(() => {}); });
    if (bgv && bgv.paused) bgv.play().catch(() => {});
  } else if (!v.paused) {
    v.pause();
  }
}

function hexA(hex, a) {
  if (!hex) return 'transparent';
  let h = String(hex).replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  if (Number.isNaN(n)) return hex;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function outlineShadow(color, r) {
  const out = [];
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    out.push(`${(Math.cos(a) * r).toFixed(2)}px ${(Math.sin(a) * r).toFixed(2)}px 0 ${color}`);
  }
  return out.join(',');
}

function applyTextStyle(node, sub, s) {
  const preset = PRESETS[sub.preset] || PRESETS.stroke;
  const size = (sub.size || 34) * s;
  node.style.fontFamily = fontCss(sub.font);
  node.style.fontSize = `${size}px`;
  node.style.color = sub.color;
  node.style.fontWeight = sub.bold === false ? '500' : '800';
  node.style.letterSpacing = '-0.01em';
  node.style.left = `${sub.x * 100}%`;
  node.style.top = `${sub.y * 100}%`;
  if (preset.bg) {
    const radius = preset.radius === 999 ? '999px' : `${(preset.radius || 0) * size}px`;
    node.style.background = hexA(preset.bg, preset.alpha == null ? 0.92 : preset.alpha);
    node.style.padding = `${size * 0.2}px ${size * 0.44}px`;
    node.style.borderRadius = radius;
    node.style.textShadow = 'none';
  } else {
    node.style.background = 'transparent';
    node.style.padding = '0';
    node.style.borderRadius = '0';
    if (sub.preset === 'glow') {
      node.style.textShadow = `0 0 ${size * 0.32}px #FFD166, 0 0 ${size * 0.72}px rgba(255,209,102,.7)`;
    } else if (sub.stroke && sub.strokeW) {
      node.style.textShadow = outlineShadow(sub.stroke, (sub.strokeW || 3) * s);
    } else {
      node.style.textShadow = '0 2px 6px rgba(0,0,0,.25)';
    }
  }
}

function styleOverlays() {
  const s = stageScale;
  for (const sub of state.subtitles) {
    const node = ovEls.get(`sub:${sub.id}`);
    if (node) applyTextStyle(node, sub, s);
  }
  for (const st of state.stickers) {
    const node = ovEls.get(`stk:${st.id}`);
    if (!node) continue;
    node.style.left = `${st.x * 100}%`;
    node.style.top = `${st.y * 100}%`;
    node.style.transform = `translate(-50%,-50%) rotate(${st.rot || 0}deg)`;
    node.firstChild.style.fontSize = `${(st.size || 90) * s}px`;
  }
}

function syncOverlays() {
  const layer = $('overlayLayer');
  const seen = new Set();
  for (const sub of state.subtitles) {
    const key = `sub:${sub.id}`;
    seen.add(key);
    let node = ovEls.get(key);
    if (!node) {
      node = el('div', 'ov ov-text');
      node.dataset.type = 'sub';
      node.dataset.id = sub.id;
      layer.appendChild(node);
      ovEls.set(key, node);
    }
    if (node.textContent !== (sub.text || '')) node.textContent = sub.text || '';
    const animCls = sub.anim === 'fade' ? 'anim-fade' : sub.anim === 'pop' ? 'anim-pop' : '';
    if (node.dataset.anim !== (sub.anim || 'none')) {
      node.dataset.anim = sub.anim || 'none';
      node.classList.remove('anim-fade', 'anim-pop');
      if (animCls) node.classList.add(animCls);
    }
    node.classList.toggle('selected', state.sel.type === 'sub' && state.sel.id === sub.id);
  }
  for (const st of state.stickers) {
    const key = `stk:${st.id}`;
    seen.add(key);
    let node = ovEls.get(key);
    if (!node) {
      node = el('div', 'ov ov-sticker');
      node.dataset.type = 'stk';
      node.dataset.id = st.id;
      node.appendChild(el('span', '', st.emoji));
      layer.appendChild(node);
      ovEls.set(key, node);
    }
    if (node.firstChild.textContent !== st.emoji) node.firstChild.textContent = st.emoji;
    node.classList.toggle('selected', state.sel.type === 'stk' && state.sel.id === st.id);
  }
  for (const [key, node] of [...ovEls]) {
    if (!seen.has(key)) { node.remove(); ovEls.delete(key); visibleOv.delete(node); }
  }
  styleOverlays();
}

function updateOverlayVisibility(t) {
  for (const sub of state.subtitles) {
    const node = ovEls.get(`sub:${sub.id}`);
    if (!node) continue;
    const on = t >= sub.start - 0.001 && t <= sub.end + 0.001;
    node.style.display = on ? 'block' : 'none';
    if (on && !visibleOv.has(node) && sub.anim && sub.anim !== 'none') {
      node.classList.remove('anim-fade', 'anim-pop');
      void node.offsetWidth;
      node.classList.add(sub.anim === 'fade' ? 'anim-fade' : 'anim-pop');
    }
    if (on) visibleOv.add(node); else visibleOv.delete(node);
  }
  for (const st of state.stickers) {
    const node = ovEls.get(`stk:${st.id}`);
    if (!node) continue;
    node.style.display = (t >= st.start - 0.001 && t <= st.end + 0.001) ? 'block' : 'none';
  }
}

function renderStage() {
  const t = state.playhead;
  updateMediaForTime(t);
  updateOverlayVisibility(t);
  $('stageEmpty').hidden = state.clips.length > 0;
  if (!state.playing) layoutSelFrame();
}

function layoutSelFrame() {
  const frame = $('selFrame');
  const { type, id } = state.sel;
  if (!type || !id) { frame.hidden = true; return; }
  const node = ovEls.get(`${type}:${id}`);
  if (!node || node.style.display === 'none') { frame.hidden = true; return; }
  const r = node.getBoundingClientRect();
  const sr = $('stage').getBoundingClientRect();
  if (!r.width && !r.height) { frame.hidden = true; return; }
  frame.hidden = false;
  frame.style.left = `${r.left - sr.left - 5}px`;
  frame.style.top = `${r.top - sr.top - 5}px`;
  frame.style.width = `${r.width + 10}px`;
  frame.style.height = `${r.height + 10}px`;
}

function selectItem(type, id) {
  state.sel = { type, id };
  if (type === 'sub' && state.tab !== 'clip') switchTab('clip');
  if (type === 'stk' && state.tab !== 'sticker') switchTab('sticker');
  syncOverlays();
  layoutSelFrame();
  updatePanels();
}
function deselect() {
  if (!state.sel.type) return;
  state.sel = { type: null, id: null };
  syncOverlays();
  layoutSelFrame();
  updatePanels();
}

function initOverlayDrag() {
  const layer = $('overlayLayer');
  layer.addEventListener('pointerdown', (e) => {
    const node = e.target.closest('.ov');
    if (!node) { deselect(); return; }
    const type = node.dataset.type;
    const id = node.dataset.id;
    selectItem(type, id);
    const item = type === 'sub' ? findSub(id) : findSticker(id);
    if (!item) return;
    const r = $('stage').getBoundingClientRect();
    const startX = e.clientX, startY = e.clientY;
    const ox = item.x, oy = item.y;
    let moved = false;
    const move = (ev) => {
      if (Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) > 2) moved = true;
      item.x = clamp(ox + (ev.clientX - startX) / r.width, 0.04, 0.96);
      item.y = clamp(oy + (ev.clientY - startY) / r.height, 0.05, 0.95);
      node.style.left = `${item.x * 100}%`;
      node.style.top = `${item.y * 100}%`;
      layoutSelFrame();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (moved) scheduleSave();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    try { node.setPointerCapture(e.pointerId); } catch (err) {}
    e.preventDefault();
  });

  $('selX').addEventListener('click', (e) => {
    e.stopPropagation();
    const { type, id } = state.sel;
    if (type === 'sub') deleteSub(id);
    if (type === 'stk') deleteSticker(id);
  });
}

/* ------------------------------------------------------------------ */
/* audio                                                              */
/* ------------------------------------------------------------------ */
function ensureAudio() {
  if (!audio.ctx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    const ctx = new Ctx();
    audio.ctx = ctx;
    audio.master = ctx.createGain();
    audio.master.connect(ctx.destination);
    audio.origGain = ctx.createGain();
    audio.origGain.gain.value = state.settings.originalVolume;
    audio.origGain.connect(audio.master);
    audio.bgmGain = ctx.createGain();
    audio.bgmGain.gain.value = state.settings.bgmVolume;
    audio.bgmGain.connect(audio.master);
  }
  if (audio.ctx.state === 'suspended') audio.ctx.resume();
  return audio.ctx;
}

function elementSource(node) {
  ensureAudio();
  if (!audio.ctx) return null;
  let src = audio.sources.get(node);
  if (!src) {
    try { src = audio.ctx.createMediaElementSource(node); } catch (e) { return null; }
    src.connect(audio.origGain);
    audio.sources.set(node, src);
  }
  return src;
}

function startBgm(t) {
  stopBgm();
  if (!state.bgm || !state.bgm.buffer) return;
  const ctx = ensureAudio();
  if (!ctx) return;
  const src = ctx.createBufferSource();
  src.buffer = state.bgm.buffer;
  src.loop = true;
  src.connect(audio.bgmGain);
  try { src.start(0, t % state.bgm.buffer.duration); } catch (e) {}
  bgmSource = src;
}
function stopBgm() {
  if (bgmSource) { try { bgmSource.stop(); } catch (e) {} try { bgmSource.disconnect(); } catch (e) {} bgmSource = null; }
}

async function loadBgm(file) {
  try {
    const ctx = ensureAudio();
    if (!ctx) throw new Error('no audio');
    const decoded = await ctx.decodeAudioData(await file.arrayBuffer());
    state.bgm = { name: file.name, buffer: decoded };
    updatePanels();
    toast(`BGM: ${file.name}`);
  } catch (e) {
    toast('이 오디오는 불러올 수 없어요. mp3 파일을 추천해요.');
  }
}

/* ------------------------------------------------------------------ */
/* playback                                                           */
/* ------------------------------------------------------------------ */
function play() {
  if (!state.clips.length) { toast('먼저 사진이나 영상을 추가해 주세요'); return; }
  if (state.playing) return;
  ensureAudio();
  if (state.playhead >= totalDuration() - 0.02) state.playhead = 0;
  state.playing = true;
  lastTs = performance.now();
  for (const c of state.clips) if (c.type === 'video' && c.el) { elementSource(c.el); c.el.muted = false; }
  startBgm(state.playhead);
  updateMediaForTime(state.playhead, true);
  $('playBtn').textContent = '❚❚';
  $('playBtn').setAttribute('aria-label', '일시정지');
  cancelAnimationFrame(rafId);
  rafId = requestAnimationFrame(tick);
  updateTransport();
}

function pause() {
  state.playing = false;
  cancelAnimationFrame(rafId);
  stopBgm();
  for (const c of state.clips) if (c.el && c.type === 'video' && !c.el.paused) c.el.pause();
  const bgv = $('bgLayer').querySelector('video');
  if (bgv && !bgv.paused) bgv.pause();
  $('playBtn').textContent = '▶';
  $('playBtn').setAttribute('aria-label', '재생');
  updateTransport();
}

function tick(ts) {
  if (!state.playing) return;
  const dt = lastTs ? Math.min(0.12, (ts - lastTs) / 1000) : 0;
  lastTs = ts;
  const total = totalDuration();
  state.playhead += dt;
  if (state.playhead >= total - 0.008) {
    state.playhead = total;
    renderStage();
    updateTransport();
    updatePlayhead();
    updatePanels();
    pause();
    return;
  }
  renderStage();
  updateTransport();
  updatePlayhead();
  rafId = requestAnimationFrame(tick);
}

function seekTo(t) {
  const total = totalDuration();
  state.playhead = clamp(t, 0, total);
  updateMediaForTime(state.playhead, true);
  if (state.playing) startBgm(state.playhead);
  renderStage();
  updateTransport();
  updatePlayhead();
  updatePanels();
}

function updateTransport() {
  $('curTime').textContent = fmt(state.playhead);
  $('totalTime').textContent = fmt(totalDuration());
}

/* ------------------------------------------------------------------ */
/* timeline                                                           */
/* ------------------------------------------------------------------ */
function pickStep(total) {
  for (const s of [0.5, 1, 2, 5, 10, 15, 30, 60]) if (total / s <= 8) return s;
  return 120;
}

function renderTimeline() {
  const total = totalDuration() || 1;
  const ruler = $('ruler');
  ruler.innerHTML = '';
  const step = pickStep(total);
  for (let t = 0; t <= total + 1e-6; t += step) {
    const left = (t / total) * 100;
    const major = Math.abs((t / step) % 2) < 1e-6;
    const tick = el('i', `tick${major ? ' major' : ''}`);
    tick.style.left = `${left}%`;
    ruler.appendChild(tick);
    if (major || step >= 1) {
      const lbl = el('span', 'lbl', `${Math.round(t)}`);
      lbl.style.left = `${left}%`;
      ruler.appendChild(lbl);
    }
  }

  const clips = $('trackClips');
  clips.innerHTML = '';
  const cur = currentClip();
  let acc = 0;
  for (const c of state.clips) {
    const d = clipDur(c);
    const block = el('div', `clip-block${c === cur ? ' sel' : ''}`);
    block.style.left = `${(acc / total) * 100}%`;
    block.style.width = `calc(${(d / total) * 100}% - 1px)`;
    block.dataset.clip = c.id;
    if (c.thumb) {
      const img = el('img', 'thumb');
      img.src = c.thumb;
      img.draggable = false;
      block.appendChild(img);
    }
    block.appendChild(el('span', 'cb-label', c.type === 'video' ? `영상 ${fmt(d)}s` : `사진 ${fmt(d)}s`));
    if (c.type === 'video' && c.speed !== 1) block.appendChild(el('span', 'badge', `${c.speed}x`));
    clips.appendChild(block);
    acc += d;
  }

  const subs = $('trackSubs');
  subs.innerHTML = '';
  for (const s of state.subtitles) {
    const block = el('div', `sub-block${state.sel.type === 'sub' && state.sel.id === s.id ? ' sel' : ''}`);
    block.style.left = `${(s.start / total) * 100}%`;
    block.style.width = `max(6px, ${((s.end - s.start) / total) * 100}%)`;
    block.textContent = s.text || '자막';
    block.dataset.block = 'sub';
    block.dataset.id = s.id;
    subs.appendChild(block);
  }

  const stks = $('trackStickers');
  stks.innerHTML = '';
  for (const s of state.stickers) {
    const block = el('div', `stk-block${state.sel.type === 'stk' && state.sel.id === s.id ? ' sel' : ''}`);
    block.style.left = `${(s.start / total) * 100}%`;
    block.style.width = `max(6px, ${((s.end - s.start) / total) * 100}%)`;
    block.textContent = s.emoji;
    block.dataset.block = 'stk';
    block.dataset.id = s.id;
    stks.appendChild(block);
  }

  updatePlayhead();
}

function updatePlayhead() {
  const total = totalDuration();
  $('playhead').style.left = `${total ? (state.playhead / total) * 100 : 0}%`;
}

function initTimelinePointer() {
  const body = $('tlBody');
  let drag = null;
  body.addEventListener('pointerdown', (e) => {
    const total = totalDuration();
    if (!total) return;
    const rect = body.getBoundingClientRect();
    const blockNode = e.target.closest('[data-block]');
    const clipNode = e.target.closest('[data-clip]');
    if (blockNode) {
      const type = blockNode.dataset.block;
      const id = blockNode.dataset.id;
      selectItem(type, id);
      const item = type === 'sub' ? findSub(id) : findSticker(id);
      if (!item) return;
      drag = { kind: 'block', item, startX: e.clientX, rectW: rect.width, total, baseStart: item.start, dur: item.end - item.start, moved: false };
      try { body.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
      return;
    }
    pause();
    if (clipNode) {
      const c = state.clips.find((x) => x.id === clipNode.dataset.clip);
      if (c) seekTo(clipStartTime(c) + Math.min(0.05, clipDur(c) / 2));
    } else {
      seekTo(((e.clientX - rect.left) / rect.width) * total);
    }
    drag = { kind: 'scrub', rect, total };
    try { body.setPointerCapture(e.pointerId); } catch (err) {}
    e.preventDefault();
  });
  body.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (drag.kind === 'scrub') {
      seekTo(((e.clientX - drag.rect.left) / drag.rect.width) * drag.total);
      return;
    }
    if (drag.kind === 'block') {
      const dt = ((e.clientX - drag.startX) / drag.rectW) * drag.total;
      if (Math.abs(e.clientX - drag.startX) > 2) drag.moved = true;
      const maxStart = Math.max(0, drag.total - drag.dur);
      const ns = clamp(drag.baseStart + dt, 0, maxStart);
      drag.item.start = Math.round(ns * 100) / 100;
      drag.item.end = Math.round((ns + drag.dur) * 100) / 100;
      renderTimeline();
      updatePanels();
      renderStage();
    }
  });
  const end = () => {
    if (drag && drag.kind === 'block' && drag.moved) scheduleSave();
    drag = null;
  };
  body.addEventListener('pointerup', end);
  body.addEventListener('pointercancel', end);
}

/* ------------------------------------------------------------------ */
/* clip bar                                                           */
/* ------------------------------------------------------------------ */
function renderClipBar() {
  const c = currentClip();
  const idx = $('cbIdx'), type = $('cbType'), trim = $('cbTrim');
  if (!c) {
    idx.textContent = '컷 없음';
    type.textContent = '사진이나 영상을 추가해 주세요';
    trim.hidden = true;
    return;
  }
  idx.textContent = `컷 ${state.clips.indexOf(c) + 1} / ${state.clips.length}`;
  type.textContent = c.type === 'video'
    ? `영상 · ${fmt(clipDur(c))}초 · ${c.speed}x 속도`
    : `사진 · ${fmt(clipDur(c))}초`;
  paintTrim(c);
}

function paintTrim(c) {
  const trim = $('cbTrim');
  trim.hidden = c.type !== 'video' || !c.videoDuration;
  if (trim.hidden) return;
  const dur = Math.max(0.3, c.videoDuration);
  $('trimStart').max = dur;
  $('trimEnd').max = dur;
  $('trimStart').value = c.trimStart;
  $('trimEnd').value = c.trimEnd;
  $('trimStartV').textContent = `${fmt(c.trimStart)}s`;
  $('trimEndV').textContent = `${fmt(c.trimEnd)}s`;
  [...$('speedSeg').children].forEach((b) => b.classList.toggle('on', Number(b.dataset.speed) === (c.speed || 1)));
}

function moveClip(dir, clip) {
  const i = state.clips.indexOf(clip);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= state.clips.length) return;
  state.clips.splice(i, 1);
  state.clips.splice(j, 0, clip);
  state.playhead = clipStartTime(clip) + 0.001;
  renderAll();
  scheduleSave();
}

function changeClipDuration(clip, sign) {
  if (clip.type === 'video') {
    clip.speed = clamp(Math.round(((clip.speed || 1) + sign * 0.25) * 100) / 100, 0.25, 3);
  } else {
    clip.duration = clamp((clip.duration || DEFAULT_PHOTO_DUR) + sign * 0.5, 0.5, 15);
  }
  fitTimesToTotal();
  renderAll();
  scheduleSave();
}

function initClipBar() {
  $('clipBar').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const c = currentClip();
    if (!c) { toast('먼저 사진이나 영상을 추가해 주세요'); return; }
    const act = btn.dataset.act;
    if (act === 'left') moveClip(-1, c);
    if (act === 'right') moveClip(1, c);
    if (act === 'durMinus') changeClipDuration(c, -1);
    if (act === 'durPlus') changeClipDuration(c, 1);
    if (act === 'del') removeClip(c);
  });
  $('trimStart').addEventListener('input', () => {
    const c = currentClip();
    if (!c || c.type !== 'video') return;
    c.trimStart = Math.min(Number($('trimStart').value), c.trimEnd - 0.2);
    afterTrim(c);
  });
  $('trimEnd').addEventListener('input', () => {
    const c = currentClip();
    if (!c || c.type !== 'video') return;
    c.trimEnd = Math.max(Number($('trimEnd').value), c.trimStart + 0.2);
    afterTrim(c);
  });
  $('speedSeg').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-speed]');
    if (!btn) return;
    const c = currentClip();
    if (!c || c.type !== 'video') return;
    c.speed = Number(btn.dataset.speed);
    afterTrim(c);
  });
}
function afterTrim(c) {
  fitTimesToTotal();
  state.playhead = clamp(clipStartTime(c) + 0.02, 0, totalDuration());
  renderAll();
  scheduleSave();
}

/* ------------------------------------------------------------------ */
/* subtitles & stickers                                               */
/* ------------------------------------------------------------------ */
function newSubStyle() { return { ...state.defaultStyle }; }

function addSubtitle() {
  const total = totalDuration();
  if (!total) { toast('먼저 사진·영상을 추가해 주세요'); return; }
  const start = clamp(state.playhead, 0, Math.max(0, total - 0.4));
  const end = clamp(start + 2, start + 0.4, total);
  const sub = {
    id: uid(), text: '자막을 입력하세요', start: +start.toFixed(2), end: +end.toFixed(2),
    anim: 'none', x: 0.5, y: 0.78, ...newSubStyle(),
  };
  state.subtitles.push(sub);
  selectItem('sub', sub.id);
  renderAll();
  setTimeout(() => { const t = $('subText'); t.focus(); t.select(); }, 80);
  scheduleSave();
}

function deleteSub(id) {
  const i = state.subtitles.findIndex((s) => s.id === id);
  if (i < 0) return;
  state.subtitles.splice(i, 1);
  if (state.sel.type === 'sub' && state.sel.id === id) state.sel = { type: null, id: null };
  renderAll();
  scheduleSave();
}

function addSticker(emoji = '✨') {
  const total = totalDuration();
  if (!total) { toast('먼저 사진·영상을 추가해 주세요'); return; }
  const start = clamp(state.playhead, 0, Math.max(0, total - 0.4));
  const end = clamp(start + 2.5, start + 0.5, total);
  const st = {
    id: uid(), emoji,
    start: +start.toFixed(2), end: +end.toFixed(2),
    x: 0.5, y: 0.42, size: 90, rot: 0,
  };
  state.stickers.push(st);
  selectItem('stk', st.id);
  renderAll();
  scheduleSave();
}

function deleteSticker(id) {
  const i = state.stickers.findIndex((s) => s.id === id);
  if (i < 0) return;
  state.stickers.splice(i, 1);
  if (state.sel.type === 'stk' && state.sel.id === id) state.sel = { type: null, id: null };
  renderAll();
  scheduleSave();
}

function selectedSticker() {
  if (state.sel.type === 'stk') return findSticker(state.sel.id);
  const at = state.stickers.find((s) => state.playhead >= s.start && state.playhead <= s.end);
  return at || null;
}

/* ------------------------------------------------------------------ */
/* panels                                                             */
/* ------------------------------------------------------------------ */
function switchTab(name) {
  state.tab = name;
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.panel-page').forEach((p) => { p.hidden = p.dataset.page !== name; });
  updatePanels();
}

function updatePanels() {
  const sub = targetSub();
  const hasSub = !!sub;
  $('subBody').hidden = !hasSub;
  $('subEmpty').hidden = hasSub;
  if (hasSub) {
    if (document.activeElement !== $('subText')) $('subText').value = sub.text || '';
    if (document.activeElement !== $('subStart')) $('subStart').value = fmt(sub.start);
    if (document.activeElement !== $('subEnd')) $('subEnd').value = fmt(sub.end);
    [...$('animSeg').children].forEach((b) => b.classList.toggle('on', (sub.anim || 'none') === b.dataset.anim));
    $('fontTarget').textContent = '선택한 자막';
  } else {
    $('fontTarget').textContent = '새 자막 기본값';
  }

  const style = hasSub ? sub : state.defaultStyle;
  [...$('fontList').children].forEach((b) => b.classList.toggle('on', b.dataset.font === style.font));
  $('fontSize').value = style.size || 34;
  $('fontSizeV').textContent = style.size || 34;
  [...$('presetRow').children].forEach((b) => b.classList.toggle('on', b.dataset.preset === style.preset));
  $('colorText').value = normHex(style.color, '#FFFFFF');
  $('colorStroke').value = normHex(style.stroke, '#2B1D16');
  $('colorBg').value = normHex(style.bg, '#3E2B21');

  $('bgmName').textContent = state.bgm ? state.bgm.name : 'BGM 없음';
  $('origVol').value = Math.round(state.settings.originalVolume * 100);
  $('origVolV').textContent = Math.round(state.settings.originalVolume * 100);
  $('bgmVol').value = Math.round(state.settings.bgmVolume * 100);
  $('bgmVolV').textContent = Math.round(state.settings.bgmVolume * 100);
  [...$('fillSeg').children].forEach((b) => b.classList.toggle('on', b.dataset.fill === state.settings.fillMode));

  const st = selectedSticker();
  if (st) {
    $('stickerSize').value = st.size;
    $('stickerSizeV').textContent = st.size;
    $('stickerRot').value = st.rot || 0;
    $('stickerRotV').textContent = `${st.rot || 0}°`;
  }
  renderClipBar();
}

function normHex(v, fallback) {
  if (!v) return fallback;
  let h = String(v).trim();
  if (!h.startsWith('#')) h = `#${h}`;
  if (h.length === 4) h = `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`;
  return /^#[0-9a-f]{6}$/i.test(h) ? h : fallback;
}

function applyStylePatch(patch) {
  const sub = targetSub();
  if (sub) Object.assign(sub, patch);
  else Object.assign(state.defaultStyle, patch);
  if (sub) { syncOverlays(); renderTimeline(); }
  scheduleSave();
}

function initPanels() {
  // sticker palette
  const grid = $('stickerGrid');
  for (const emoji of STICKERS) {
    const b = el('button', '', emoji);
    b.type = 'button';
    b.addEventListener('click', () => addSticker(emoji));
    grid.appendChild(b);
  }

  // fonts
  const fontList = $('fontList');
  for (const f of FONTS) {
    const b = el('button', 'font-chip', `<b style="font-family:${f.css}">가나다 Aa</b><small>${f.name}</small>`);
    b.type = 'button';
    b.dataset.font = f.id;
    b.addEventListener('click', () => {
      applyStylePatch({ font: f.id });
      updatePanels();
      ensureFontLoaded(f);
    });
    fontList.appendChild(b);
  }

  // presets
  const presetRow = $('presetRow');
  for (const [id, p] of Object.entries(PRESETS)) {
    const b = el('button', 'preset', `<span class="pv" style="${presetSampleCss(id)}">가</span><small>${p.name}</small>`);
    b.type = 'button';
    b.dataset.preset = id;
    b.addEventListener('click', () => {
      const patch = { preset: id, color: p.color };
      if (p.bg) patch.bg = p.bg;
      if (p.stroke) patch.stroke = p.stroke;
      applyStylePatch(patch);
      updatePanels();
    });
    presetRow.appendChild(b);
  }

  $('addSubBtn').addEventListener('click', addSubtitle);
  $('tlAddSub').addEventListener('click', addSubtitle);
  $('tlAddSticker').addEventListener('click', () => addSticker('✨'));
  $('addStickerBtn').addEventListener('click', () => addSticker('✨'));
  $('delSubBtn').addEventListener('click', () => { const s = targetSub(); if (s) deleteSub(s.id); else toast('삭제할 자막이 없어요'); });

  const sub = () => targetSub();
  $('subText').addEventListener('input', () => {
    const s = sub();
    if (!s) return;
    s.text = $('subText').value;
    syncOverlays();
    renderTimeline();
    layoutSelFrame();
    scheduleSave();
  });
  $('subStart').addEventListener('change', () => {
    const s = sub();
    if (!s) return;
    s.start = clamp(Number($('subStart').value) || 0, 0, s.end - 0.2);
    renderAll(); scheduleSave();
  });
  $('subEnd').addEventListener('change', () => {
    const s = sub();
    if (!s) return;
    s.end = clamp(Number($('subEnd').value) || 0, s.start + 0.2, totalDuration());
    renderAll(); scheduleSave();
  });
  $('animSeg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-anim]');
    if (!b) return;
    const s = sub();
    if (!s) return;
    s.anim = b.dataset.anim;
    syncOverlays(); updatePanels(); renderStage(); scheduleSave();
  });

  $('fontSize').addEventListener('input', () => {
    const v = Number($('fontSize').value);
    $('fontSizeV').textContent = v;
    applyStylePatch({ size: v });
    layoutSelFrame();
  });

  $('colorText').addEventListener('input', () => { applyStylePatch({ color: $('colorText').value }); });
  $('colorStroke').addEventListener('input', () => { applyStylePatch({ stroke: $('colorStroke').value }); });
  $('colorBg').addEventListener('input', () => { applyStylePatch({ bg: $('colorBg').value }); });

  $('stickerSize').addEventListener('input', () => {
    const st = selectedSticker();
    const v = Number($('stickerSize').value);
    $('stickerSizeV').textContent = v;
    if (!st) { toast('스티커를 먼저 선택해 주세요'); return; }
    st.size = v;
    styleOverlays(); layoutSelFrame(); scheduleSave();
  });
  $('stickerRot').addEventListener('input', () => {
    const st = selectedSticker();
    const v = Number($('stickerRot').value);
    $('stickerRotV').textContent = `${v}°`;
    if (!st) return;
    st.rot = v;
    styleOverlays(); layoutSelFrame(); scheduleSave();
  });

  $('origVol').addEventListener('input', () => {
    const v = Number($('origVol').value) / 100;
    state.settings.originalVolume = v;
    $('origVolV').textContent = $('origVol').value;
    if (audio.origGain) audio.origGain.gain.value = v;
    scheduleSave();
  });
  $('bgmVol').addEventListener('input', () => {
    const v = Number($('bgmVol').value) / 100;
    state.settings.bgmVolume = v;
    $('bgmVolV').textContent = $('bgmVol').value;
    if (audio.bgmGain) audio.bgmGain.gain.value = v;
    scheduleSave();
  });
  $('fillSeg').addEventListener('click', (e) => {
    const b = e.target.closest('[data-fill]');
    if (!b) return;
    state.settings.fillMode = b.dataset.fill;
    updatePanels();
    renderStage();
    scheduleSave();
  });

  $('addBgmBtn').addEventListener('click', () => $('bgmInput').click());
  $('bgmInput').addEventListener('change', (e) => {
    const f = e.target.files && e.target.files[0];
    if (f) loadBgm(f);
    e.target.value = '';
  });
  $('bgmClearBtn').addEventListener('click', () => {
    state.bgm = null; stopBgm(); updatePanels(); toast('BGM을 뺐어요');
  });

  $('tabBar').addEventListener('click', (e) => {
    const b = e.target.closest('.tab');
    if (b) switchTab(b.dataset.tab);
  });
}

function ensureFontLoaded(f) {
  try { document.fonts.load(`800 40px ${f.css.split(',')[0]}`, '가나다'); } catch (e) {}
}

function presetSampleCss(id) {
  const p = PRESETS[id];
  const base = 'font-weight:800;font-size:14px;line-height:1.2;padding:2px 5px;border-radius:4px;display:inline-block;';
  if (id === 'stroke') return `${base}color:#fff;text-shadow:0 0 1px #2B1D16,1px 1px 0 #2B1D16,-1px -1px 0 #2B1D16,1px -1px 0 #2B1D16,-1px 1px 0 #2B1D16;`;
  if (id === 'glow') return `${base}color:#fff;text-shadow:0 0 6px #FFC85C,0 0 12px rgba(255,180,60,.8);`;
  if (id === 'box') return `${base}color:#fff;background:#1D1712;border-radius:2px;`;
  if (id === 'round') return `${base}color:#fff;background:#3E2B21;border-radius:7px;`;
  if (id === 'yellow') return `${base}color:#231710;background:#FFD84D;`;
  return `${base}color:#5B4636;background:#FDE2E4;border-radius:99px;`;
}

/* ------------------------------------------------------------------ */
/* canvas renderer (shared with export)                               */
/* ------------------------------------------------------------------ */
function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  if (ctx.roundRect) { ctx.roundRect(x, y, w, h, rr); return; }
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function wrapText(ctx, text, maxW) {
  const out = [];
  for (const para of String(text || '').split('\n')) {
    if (!para) { out.push(''); continue; }
    let line = '';
    for (const ch of para) {
      const test = line + ch;
      if (line && ctx.measureText(test).width > maxW) { out.push(line); line = ch; }
      else line = test;
    }
    out.push(line);
  }
  return out.length ? out : [''];
}

function drawFit(ctx, node, W, H, mode, zoom = 1, alpha = 1) {
  const sw = node.videoWidth || node.naturalWidth || 0;
  const sh = node.videoHeight || node.naturalHeight || 0;
  if (!sw || !sh) return;
  if (node.tagName === 'VIDEO' && node.readyState < 2) return;
  const sc = (mode === 'cover' ? Math.max(W / sw, H / sh) : Math.min(W / sw, H / sh)) * zoom;
  const w = sw * sc, h = sh * sc;
  ctx.globalAlpha = alpha;
  try { ctx.drawImage(node, (W - w) / 2, (H - h) / 2, w, h); } catch (e) {}
  ctx.globalAlpha = 1;
}

function drawMediaFrame(ctx, clip, W, H) {
  const node = clip.el;
  if (!node) return;
  if (clip.type === 'video' && node.readyState < 2) return;
  if (state.settings.fillMode === 'contain') {
    ctx.save();
    let filtered = false;
    try { if ('filter' in ctx) { ctx.filter = 'blur(30px)'; filtered = true; } } catch (e) {}
    drawFit(ctx, node, W, H, 'cover', 1.12, filtered ? 0.92 : 0.5);
    try { ctx.filter = 'none'; } catch (e) {}
    ctx.fillStyle = 'rgba(32,24,19,.28)';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
    drawFit(ctx, node, W, H, 'contain', 1, 1);
  } else {
    drawFit(ctx, node, W, H, 'cover', 1, 1);
  }
}

function paintSubtitle(ctx, sub, t, W, H) {
  const s = W / REF_W;
  const preset = PRESETS[sub.preset] || PRESETS.stroke;
  const size = (sub.size || 34) * s;
  ctx.save();
  ctx.font = `${sub.bold === false ? 500 : 800} ${size}px ${fontCss(sub.font)}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lines = wrapText(ctx, sub.text, W * 0.84);
  const lh = size * 1.26;
  const blockH = lines.length * lh;
  const cx = sub.x * W;
  const cy = sub.y * H;

  let alpha = 1, sc = 1;
  if (sub.anim === 'fade' || sub.anim === 'pop') {
    const k = clamp((t - sub.start) / 0.36, 0, 1);
    if (sub.anim === 'fade') alpha = k;
    else {
      const c1 = 1.70158, c3 = c1 + 1;
      sc = Math.max(0.05, 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2));
    }
  }
  ctx.globalAlpha = alpha;
  if (sc !== 1) { ctx.translate(cx, cy); ctx.scale(sc, sc); ctx.translate(-cx, -cy); }

  if (preset.bg) {
    let maxW = 1;
    for (const l of lines) maxW = Math.max(maxW, ctx.measureText(l).width);
    const padX = size * 0.44, padY = size * 0.2;
    const bw = maxW + padX * 2, bh = blockH + padY * 2;
    const radius = preset.radius === 999 ? bh / 2 : (preset.radius || 0) * size;
    ctx.fillStyle = hexA(preset.bg, preset.alpha == null ? 0.92 : preset.alpha);
    roundRect(ctx, cx - bw / 2, cy - bh / 2, bw, bh, radius);
    ctx.fill();
  }

  if (sub.preset === 'glow') { ctx.shadowColor = '#FFD166'; ctx.shadowBlur = size * 0.55; }
  for (let i = 0; i < lines.length; i++) {
    const y = cy - blockH / 2 + lh * (i + 0.5);
    const line = lines[i];
    if (sub.stroke && sub.strokeW && sub.preset !== 'glow') {
      ctx.lineWidth = Math.max(1, sub.strokeW * 2 * s);
      ctx.strokeStyle = sub.stroke;
      ctx.lineJoin = 'round';
      ctx.miterLimit = 2;
      ctx.strokeText(line, cx, y);
    }
    ctx.fillStyle = sub.color;
    ctx.fillText(line, cx, y);
    if (sub.preset === 'glow') ctx.shadowBlur = size * 0.35;
  }
  ctx.restore();
}

function drawStickers(ctx, t, W, H) {
  const s = W / REF_W;
  for (const st of state.stickers) {
    if (t < st.start || t > st.end) continue;
    const size = (st.size || 90) * s;
    ctx.save();
    ctx.translate(st.x * W, st.y * H);
    ctx.rotate(((st.rot || 0) * Math.PI) / 180);
    ctx.font = `${size}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(st.emoji, 0, size * 0.06);
    ctx.restore();
  }
}

function drawFrame(ctx, t, W, H) {
  ctx.save();
  ctx.fillStyle = '#201813';
  ctx.fillRect(0, 0, W, H);
  const clip = clipAt(Math.min(t, Math.max(0, totalDuration() - 1e-4)));
  if (clip) drawMediaFrame(ctx, clip, W, H);
  for (const sub of state.subtitles) {
    if (t < sub.start - 0.001 || t > sub.end + 0.001) continue;
    paintSubtitle(ctx, sub, t, W, H);
  }
  drawStickers(ctx, t, W, H);
  ctx.restore();
}

/* ------------------------------------------------------------------ */
/* export                                                             */
/* ------------------------------------------------------------------ */
async function prepareFrame(t) {
  const clip = clipAt(Math.min(t, Math.max(0, totalDuration() - 1e-4)));
  if (!clip) return;
  mediaForActive(clip);
  if (clip.type !== 'video' || !clip.el) return;
  const v = clip.el;
  await waitCanPlay(v);
  v.pause();
  v.playbackRate = 1;
  const local = clip.trimStart + (t - clipStartTime(clip)) * (clip.speed || 1);
  const target = clamp(local, clip.trimStart, Math.max(clip.trimStart, clip.trimEnd - 0.04));
  if (Math.abs(v.currentTime - target) > 0.004) {
    await new Promise((res) => {
      let done = false;
      const fin = () => { if (done) return; done = true; v.removeEventListener('seeked', fin); res(); };
      v.addEventListener('seeked', fin);
      try { v.currentTime = target; } catch (e) { fin(); }
      setTimeout(fin, 700);
    });
  }
}

function beginExportAudio() {
  const ctx = ensureAudio();
  if (!ctx) return null;
  if (!audio.dest) audio.dest = ctx.createMediaStreamDestination();
  if (!audio.destOn) {
    audio.origGain.connect(audio.dest);
    audio.bgmGain.connect(audio.dest);
    audio.destOn = true;
  }
  return audio.dest;
}
function endExportAudio() { /* keep graph connected; harmless for later exports */ }

async function renderAudioMix(totalSeconds) {
  const sr = 48000;
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!Offline) return null;
  const ctx = new Offline(2, Math.max(1, Math.ceil(totalSeconds * sr)), sr);
  let any = false;
  if (state.bgm && state.bgm.buffer) {
    const src = ctx.createBufferSource();
    src.buffer = state.bgm.buffer;
    src.loop = true;
    const g = ctx.createGain();
    g.gain.value = state.settings.bgmVolume;
    src.connect(g).connect(ctx.destination);
    try { src.start(0); src.stop(totalSeconds); any = true; } catch (e) {}
  }
  const decCtx = audio.ctx || new (window.AudioContext || window.webkitAudioContext)();
  for (const c of state.clips) {
    if (c.type !== 'video' || !c.file) continue;
    if (c.audioBuffer === undefined) {
      try {
        const buf = await c.file.arrayBuffer();
        c.audioBuffer = await decCtx.decodeAudioData(buf.slice(0));
      } catch (e) { c.audioBuffer = null; }
    }
    if (!c.audioBuffer) continue;
    const src = ctx.createBufferSource();
    src.buffer = c.audioBuffer;
    src.playbackRate.value = clamp(c.speed || 1, 0.25, 4);
    const g = ctx.createGain();
    g.gain.value = state.settings.originalVolume;
    src.connect(g).connect(ctx.destination);
    const start = clipStartTime(c);
    const dur = Math.max(0.05, c.trimEnd - c.trimStart);
    try { src.start(start, c.trimStart, dur); any = true; } catch (e) {}
  }
  if (!any) return null;
  return ctx.startRendering();
}

const api = {
  state,
  totalDuration, clipAt, clipStartTime, clipDur,
  getPlayhead: () => state.playhead,
  seekTo: (t) => { state.playhead = clamp(t, 0, totalDuration()); updateMediaForTime(state.playhead, true); renderStage(); updateTransport(); updatePlayhead(); },
  play: () => { state.playhead = 0; updateMediaForTime(0, true); play(); },
  pause,
  prepareFrame,
  drawFrame,
  beginExportAudio,
  endExportAudio,
  renderAudioMix,
  getAudioContext: ensureAudio,
};

let exportUi = null;
let exportCancel = false;

async function startExport() {
  if (!state.clips.length) { toast('먼저 사진이나 영상을 추가해 주세요'); return; }
  ensureAudio(); // keep the user gesture for iOS audio unlock
  pause();
  exportCancel = false;
  lastExport = null;
  $('exportModal').hidden = false;
  $('exResult').hidden = true;
  $('exCancel').hidden = false;
  $('exCancel').textContent = '취소';
  $('exTitle').textContent = 'MP4 만드는 중…';
  $('exNote').textContent = '화면을 유지해 주세요. 릴스 길이만큼 걸려요.';
  $('exBar').style.width = '0%';
  $('exPct').textContent = '0%';

  const ui = {
    progress: (p, label) => {
      const pct = Math.max(0, Math.min(100, Math.round(p * 100)));
      $('exBar').style.width = `${pct}%`;
      $('exPct').textContent = `${pct}%`;
      if (label) $('exNote').textContent = label;
    },
    cancelled: () => exportCancel,
  };
  exportUi = ui;

  try {
    const mod = await import('./export.js?v=6');
    const result = await mod.exportMovie(api, ui);
    if (result.cancelled) { $('exportModal').hidden = true; return; }
    const blob = result.blob;
    if (!blob || !blob.size) throw new Error('영상이 비어 있어요. 다시 시도해 주세요.');
    const name = `reels-${stamp()}.${result.ext}`;
    lastExport = { blob, name };
    const sizeMb = (blob.size / 1048576).toFixed(1);
    const label = result.mode === 'webm' ? '이 브라우저는 MP4 대신 WebM으로 저장돼요' : 'MP4 · 1080×1920';
    const silent = result.mode === 'webcodecs' && result.hasAudio === false ? ' · 무음' : '';
    $('exTitle').textContent = '완성됐어요! 🎉';
    $('exNote').textContent = `${sizeMb}MB · ${label}${silent}`;
    $('exBar').style.width = '100%';
    $('exPct').textContent = '100%';
    $('exResult').hidden = false;
    $('exCancel').hidden = true;
  } catch (e) {
    if (exportCancel) { $('exportModal').hidden = true; return; }
    console.error(e);
    $('exTitle').textContent = '저장하지 못했어요';
    $('exNote').textContent = (e && e.message ? e.message : '알 수 없는 오류') + ' — 다시 한 번 시도하고, 계속 막히면 아이폰 Safari에서 저장해 주세요.';
    $('exPct').textContent = '';
    $('exResult').hidden = true;
    $('exCancel').hidden = false;
    $('exCancel').textContent = '닫기';
  }
}

function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 6000);
}

async function shareBlob(blob, name) {
  try {
    const file = new File([blob], name, { type: blob.type || 'video/mp4' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: '한나 릴스 스튜디오' });
      return;
    }
    downloadBlob(blob, name);
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    downloadBlob(blob, name);
  }
}

function initExportUi() {
  $('exportBtn').addEventListener('click', startExport);
  $('exCancel').addEventListener('click', () => {
    if (lastExport) { $('exportModal').hidden = true; return; }
    exportCancel = true;
    $('exNote').textContent = '취소하는 중…';
  });
  $('exClose').addEventListener('click', () => { $('exportModal').hidden = true; });
  $('exDownload').addEventListener('click', () => { if (lastExport) downloadBlob(lastExport.blob, lastExport.name); });
  $('exShare').addEventListener('click', () => { if (lastExport) shareBlob(lastExport.blob, lastExport.name); });
}

/* ------------------------------------------------------------------ */
/* render all & init                                                  */
/* ------------------------------------------------------------------ */
function renderAll() {
  syncOverlays();
  renderTimeline();
  renderClipBar();
  renderStage();
  updateTransport();
  updatePanels();
  layoutStage();
}

function init() {
  loadLocal();

  $('addMediaBtn').addEventListener('click', () => $('fileInput').click());
  $('fileInput').addEventListener('change', (e) => {
    if (e.target.files && e.target.files.length) addFiles(e.target.files);
    e.target.value = '';
  });
  $('playBtn').addEventListener('click', () => { if (state.playing) pause(); else play(); });

  initOverlayDrag();
  initTimelinePointer();
  initClipBar();
  initPanels();
  initExportUi();

  const stage = $('stage');
  stage.addEventListener('dragover', (e) => e.preventDefault());
  stage.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  });

  document.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    if (e.code === 'Space') { e.preventDefault(); if (state.playing) pause(); else play(); }
  });

  if ('ResizeObserver' in window) {
    const ro = new ResizeObserver(() => layoutStage());
    ro.observe($('stageWrap'));
  }
  window.addEventListener('orientationchange', () => setTimeout(layoutStage, 250));

  renderAll();
  requestAnimationFrame(() => { layoutStage(); requestAnimationFrame(layoutStage); });
  document.fonts && document.fonts.ready.then(() => setTimeout(() => { layoutStage(); renderStage(); }, 60));
}

init();
