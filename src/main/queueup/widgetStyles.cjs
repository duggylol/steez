'use strict';
// Style system for the three TikTok overlays: the gifts card (/overlay/gifts), the daily
// gaming rank badge (/overlay/tiktok-rank) and the Gift Gallery badge (/overlay/tiktok-gallery).
//
// Every widget style is one flat object with three kinds of keys:
//   look     – set by a preset (theme): colours, type, shape, animation personality, effects.
//              Picking a preset overwrites these; "Reset to preset" puts them back.
//   prefs    – the streamer's own: scale, width, animation speed, animations on/off.
//              Presets never touch them.
//   content  – per widget: labels, titles and show/hide toggles. Presets never touch them.
// plus `preset`, the id of the theme the look came from.
//
// The overlays only ever receive the resolved flat object; theme CSS is chosen by `preset`.
// Pure Node so it can be unit-tested; the renderer gets the preset table over IPC.

const WIDGETS = ['gifts', 'rank', 'gallery'];

/* ------------------------------------------------------------------ */
/* option lists (shared with the editor)                               */
/* ------------------------------------------------------------------ */

const ENTRANCES = [
  { id: 'fade', label: 'Fade' },
  { id: 'rise', label: 'Rise' },
  { id: 'slide', label: 'Slide in' },
  { id: 'pop', label: 'Pop' },
  { id: 'blur', label: 'Soft focus' },
  { id: 'flicker', label: 'Neon flicker' },
  { id: 'shine', label: 'Shine reveal' },
  { id: 'slam', label: 'Slam' },
  { id: 'none', label: 'None' },
];

const CHANGES = [
  { id: 'bump', label: 'Bump' },
  { id: 'punch', label: 'Punch' },
  { id: 'flip', label: 'Flip' },
  { id: 'roll', label: 'Roll up' },
  { id: 'flash', label: 'Flash' },
  { id: 'coin', label: 'Coin pop' },
  { id: 'none', label: 'None' },
];

const IDLES = [
  { id: 'none', label: 'None' },
  { id: 'float', label: 'Float' },
  { id: 'pulse', label: 'Pulse' },
  { id: 'shimmer', label: 'Shimmer' },
  { id: 'sweep', label: 'Light sweep' },
  { id: 'flicker', label: 'Neon buzz' },
  { id: 'hue', label: 'Iridescent' },
  { id: 'blink', label: 'Blink' },
];

/** Fonts every Windows PC has (OBS renders on the streamer's machine), plus Inter if installed. */
const FONTS = [
  { id: 'Segoe UI Variable Display', label: 'Segoe UI Variable' },
  { id: 'Segoe UI', label: 'Segoe UI' },
  { id: 'Inter', label: 'Inter / system' },
  { id: 'Bahnschrift', label: 'Bahnschrift' },
  { id: 'Arial Black', label: 'Arial Black' },
  { id: 'Impact', label: 'Impact' },
  { id: 'Trebuchet MS', label: 'Trebuchet MS' },
  { id: 'Franklin Gothic Medium', label: 'Franklin Gothic' },
  { id: 'Georgia', label: 'Georgia' },
  { id: 'Lucida Console', label: 'Lucida Console' },
  { id: 'Consolas', label: 'Consolas' },
  { id: 'Courier New', label: 'Courier New' },
  { id: 'Comic Sans MS', label: 'Comic Sans MS' },
];

const WEIGHTS = [300, 400, 500, 600, 700, 800, 900];

const ids = (list) => list.map((o) => o.id);

/* ------------------------------------------------------------------ */
/* field types                                                         */
/* ------------------------------------------------------------------ */

function color(v) {
  const s = String(v ?? '').trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s.toLowerCase();
  const m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(s);
  return m ? ('#' + m[1] + m[1] + m[2] + m[2] + m[3] + m[3]).toLowerCase() : undefined;
}
const num = (min, max, round) => (v) => {
  const n = typeof v === 'number' ? v : parseFloat(v);
  if (!Number.isFinite(n)) return undefined;
  const c = Math.min(max, Math.max(min, n));
  return round ? Math.round(c) : Math.round(c * 1000) / 1000;
};
const bool = (v) => (typeof v === 'boolean' ? v : v === 1 || v === 'true' ? true : v === 0 || v === 'false' ? false : undefined);
const oneOf = (list) => (v) => (list.includes(v) ? v : undefined);
const text = (max) => (v) => (v == null ? undefined : String(v).replace(/[\r\n\t]+/g, ' ').slice(0, max));
/** A font family name that is safe to drop into CSS: no quotes, braces or semicolons. */
function font(v) {
  const s = String(v ?? '')
    .replace(/["'`<>;{}\\]/g, '')
    .trim()
    .slice(0, 48);
  return s || undefined;
}
const weight = (v) => {
  const n = parseInt(v, 10);
  return WEIGHTS.includes(n) ? n : undefined;
};

/** Preset-controlled keys, the same for every widget. */
const LOOK_FIELDS = {
  accent: color,
  accent2: color,
  textColor: color,
  bg: color,
  bgOpacity: num(0, 1),
  fontFamily: font,
  fontWeight: weight,
  radius: num(0, 48, true),
  borderWidth: num(0, 8, true),
  spacing: num(0.6, 1.6),
  entrance: oneOf(ids(ENTRANCES)),
  change: oneOf(ids(CHANGES)),
  countUp: bool,
  idle: oneOf(ids(IDLES)),
  glow: bool,
  particles: bool,
  ring: bool,
  showIcon: bool,
};
const LOOK_KEYS = Object.keys(LOOK_FIELDS);

/** The streamer's own layout and motion preferences — kept when the preset changes. */
const PREF_FIELDS = {
  gifts: { scale: num(0.4, 3), width: num(300, 700, true), speed: num(0.25, 3), animations: bool },
  rank: { scale: num(0.4, 3), width: num(160, 480, true), speed: num(0.25, 3), animations: bool },
  gallery: { scale: num(0.4, 3), width: num(160, 480, true), speed: num(0.25, 3), animations: bool },
};
const PREF_DEFAULTS = {
  gifts: { scale: 1, width: 420, speed: 1, animations: true },
  rank: { scale: 1, width: 244, speed: 1, animations: true },
  gallery: { scale: 1, width: 244, speed: 1, animations: true },
};

/** What each widget says and which parts it shows. */
const CONTENT_FIELDS = {
  gifts: {
    mode: oneOf(['both', 'streak', 'gifter']),
    rotateSeconds: num(3, 60, true),
    streakTitle: text(24),
    gifterTitle: text(24),
    showTitle: bool,
    showLiveStreak: bool,
    showDiamonds: bool,
    showGiftName: bool,
    showAvatar: bool,
    emptyText: text(60),
  },
  rank: {
    rankLabel: text(32),
    showLabel: bool,
    showScore: bool,
    unrankedText: text(20),
  },
  gallery: {
    galleryLabel: text(32),
    showLabel: bool,
    showBar: bool,
    showTotal: bool,
  },
};
const CONTENT_DEFAULTS = {
  gifts: {
    mode: 'both', // streak | gifter | both (alternates)
    rotateSeconds: 8,
    streakTitle: 'TOP STREAK',
    gifterTitle: 'TOP GIFTER',
    showTitle: true,
    showLiveStreak: true, // jump to a combo while it is being tapped
    showDiamonds: true,
    showGiftName: true,
    showAvatar: true,
    emptyText: 'No gifts yet',
  },
  rank: { rankLabel: 'GAMING · DAILY', showLabel: true, showScore: true, unrankedText: 'Unranked' },
  gallery: { galleryLabel: 'GIFT GALLERY', showLabel: true, showBar: true, showTotal: true },
};

/* ------------------------------------------------------------------ */
/* presets                                                             */
/* ------------------------------------------------------------------ */

/**
 * `look` applies to all three widgets; `widgets.<id>` overrides it for one of them.
 * `layout` is how the gifts card is arranged (stack = medallion on top, row = side by side),
 * used by the editor for the suggested OBS size.
 */
const PRESETS = [
  {
    id: 'steez',
    name: 'Steez Clean',
    tagline: 'Flat dark grey, square, 1px lines',
    layout: 'stack',
    look: {
      accent: '#d4d4d4', accent2: '#8c8c8c', textColor: '#f2f2f2', bg: '#121212', bgOpacity: 0.82,
      fontFamily: 'Segoe UI Variable Display', fontWeight: 700, radius: 0, borderWidth: 1, spacing: 1,
      entrance: 'rise', change: 'bump', countUp: false, idle: 'none',
      glow: false, particles: false, ring: false, showIcon: false,
    },
  },
  {
    id: 'classic',
    name: 'QueueUp Classic',
    tagline: 'Gold and purple, orbit ring, sparkles',
    layout: 'stack',
    look: {
      accent: '#ffb547', accent2: '#a970ff', textColor: '#ffffff', bg: '#0b0d14', bgOpacity: 0.78,
      fontFamily: 'Inter', fontWeight: 800, radius: 16, borderWidth: 1, spacing: 1,
      entrance: 'rise', change: 'punch', countUp: false, idle: 'float',
      glow: true, particles: true, ring: true, showIcon: true,
    },
    // The original QueueUp gifts card floats on the scene with no panel behind it.
    widgets: { gifts: { bgOpacity: 0, radius: 22 } },
  },
  {
    id: 'neon',
    name: 'Neon',
    tagline: 'Glowing tubes that flicker on',
    layout: 'stack',
    look: {
      accent: '#ff3df2', accent2: '#2ef9ff', textColor: '#fff5fe', bg: '#07020f', bgOpacity: 0.55,
      fontFamily: 'Bahnschrift', fontWeight: 600, radius: 14, borderWidth: 2, spacing: 1,
      entrance: 'flicker', change: 'flash', countUp: false, idle: 'flicker',
      glow: true, particles: false, ring: true, showIcon: true,
    },
  },
  {
    id: 'glass',
    name: 'Glass',
    tagline: 'Frosted card with a soft light sweep',
    layout: 'stack',
    look: {
      accent: '#ffffff', accent2: '#9fd8ff', textColor: '#ffffff', bg: '#b9c8ff', bgOpacity: 0.16,
      fontFamily: 'Segoe UI Variable Display', fontWeight: 600, radius: 20, borderWidth: 1, spacing: 1.05,
      entrance: 'blur', change: 'roll', countUp: true, idle: 'sweep',
      glow: false, particles: false, ring: false, showIcon: true,
    },
  },
  {
    id: 'arcade',
    name: 'Arcade',
    tagline: 'Chunky pixels, coin-pop counters',
    layout: 'stack',
    look: {
      accent: '#ffe14d', accent2: '#ff3d7f', textColor: '#ffffff', bg: '#1b1450', bgOpacity: 0.94,
      fontFamily: 'Lucida Console', fontWeight: 700, radius: 0, borderWidth: 4, spacing: 1,
      entrance: 'pop', change: 'coin', countUp: true, idle: 'blink',
      glow: false, particles: true, ring: false, showIcon: true,
    },
  },
  {
    id: 'minimal',
    name: 'Minimal Line',
    tagline: 'Just type and a thin accent rule',
    layout: 'row',
    look: {
      accent: '#ffffff', accent2: '#ff5c5c', textColor: '#ffffff', bg: '#000000', bgOpacity: 0,
      fontFamily: 'Segoe UI Variable Display', fontWeight: 600, radius: 0, borderWidth: 2, spacing: 1,
      entrance: 'slide', change: 'roll', countUp: false, idle: 'none',
      glow: false, particles: false, ring: false, showIcon: false,
    },
  },
  {
    id: 'holo',
    name: 'Holo Chrome',
    tagline: 'Iridescent edge and chrome sheen',
    layout: 'stack',
    look: {
      accent: '#9ff3ff', accent2: '#ff9cf0', textColor: '#ffffff', bg: '#0d0f1a', bgOpacity: 0.8,
      fontFamily: 'Segoe UI Variable Display', fontWeight: 800, radius: 12, borderWidth: 2, spacing: 1,
      entrance: 'shine', change: 'flip', countUp: true, idle: 'hue',
      glow: true, particles: false, ring: true, showIcon: true,
    },
  },
  {
    id: 'esports',
    name: 'Esports',
    tagline: 'Angled slab, team bars, hard hits',
    layout: 'row',
    look: {
      accent: '#ff4655', accent2: '#00d1ff', textColor: '#ffffff', bg: '#0f1923', bgOpacity: 0.94,
      fontFamily: 'Bahnschrift', fontWeight: 800, radius: 0, borderWidth: 0, spacing: 1,
      entrance: 'slam', change: 'punch', countUp: true, idle: 'shimmer',
      glow: false, particles: false, ring: false, showIcon: true,
    },
  },
];
const PRESET_BY_ID = Object.fromEntries(PRESETS.map((p) => [p.id, p]));

/** The look new users get: the gifts card keeps its QueueUp look, the badges their Steez one. */
const DEFAULT_PRESET = { gifts: 'classic', rank: 'steez', gallery: 'steez' };

function isWidget(w) {
  return WIDGETS.includes(w);
}
function isPreset(id) {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(PRESET_BY_ID, id);
}

/** Every look key for this preset on this widget. Unknown presets fall back to the widget default. */
function presetLook(id, widget) {
  const p = PRESET_BY_ID[isPreset(id) ? id : DEFAULT_PRESET[widget] || 'steez'];
  return { ...p.look, ...((p.widgets && p.widgets[widget]) || {}) };
}

function fieldsFor(widget) {
  return { ...LOOK_FIELDS, ...PREF_FIELDS[widget], ...CONTENT_FIELDS[widget] };
}

/** Keeps only keys this widget knows, with values of the right type and range. */
function sanitize(widget, patch) {
  const fields = fieldsFor(widget);
  const out = {};
  if (!patch || typeof patch !== 'object') return out;
  for (const [k, v] of Object.entries(patch)) {
    if (!Object.prototype.hasOwnProperty.call(fields, k)) continue;
    const clean = fields[k](v);
    if (clean !== undefined) out[k] = clean;
  }
  return out;
}

function defaultStyle(widget) {
  const preset = DEFAULT_PRESET[widget];
  return { preset, ...CONTENT_DEFAULTS[widget], ...PREF_DEFAULTS[widget], ...presetLook(preset, widget) };
}

/**
 * Loads a saved style. Styles saved before presets existed have no `preset`: they are put
 * on `legacyPreset` (QueueUp Classic for the gifts card, Steez Clean for the badges) and
 * every value the streamer had customised is laid over it, so nothing on screen changes.
 */
function normalizeStyle(widget, raw, legacyPreset) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const preset = isPreset(src.preset) ? src.preset : isPreset(legacyPreset) ? legacyPreset : DEFAULT_PRESET[widget];
  return { preset, ...CONTENT_DEFAULTS[widget], ...PREF_DEFAULTS[widget], ...presetLook(preset, widget), ...sanitize(widget, src) };
}

/**
 * An edit from the editor. A new `preset` in the patch swaps the look first; the other
 * keys in the same patch are then laid over it.
 */
function applyPatch(widget, cur, patch) {
  let next = { ...cur };
  const p = patch && typeof patch === 'object' ? patch : {};
  if (isPreset(p.preset) && p.preset !== cur.preset) next = { ...next, ...presetLook(p.preset, widget), preset: p.preset };
  return { ...next, ...sanitize(widget, p) };
}

/** Picks a preset (or, with no id, restores the current one): look keys only. */
function applyPreset(widget, cur, id) {
  const preset = isPreset(id) ? id : isPreset(cur && cur.preset) ? cur.preset : DEFAULT_PRESET[widget];
  return { ...(cur || defaultStyle(widget)), ...presetLook(preset, widget), preset };
}

/** Look keys that differ from the preset — the editor shows "Modified" when there are any. */
function modifiedKeys(widget, style) {
  if (!style) return [];
  const look = presetLook(style.preset, widget);
  return LOOK_KEYS.filter((k) => k in style && style[k] !== look[k]);
}

/** Everything the editor and the preset thumbnails need. */
function kitInfo() {
  return {
    widgets: WIDGETS,
    presets: PRESETS.map((p) => ({
      id: p.id,
      name: p.name,
      tagline: p.tagline,
      layout: p.layout,
      looks: Object.fromEntries(WIDGETS.map((w) => [w, presetLook(p.id, w)])),
    })),
    defaults: Object.fromEntries(WIDGETS.map((w) => [w, defaultStyle(w)])),
    lookKeys: LOOK_KEYS,
    options: { entrances: ENTRANCES, changes: CHANGES, idles: IDLES, fonts: FONTS, weights: WEIGHTS },
  };
}

module.exports = {
  WIDGETS,
  PRESETS,
  DEFAULT_PRESET,
  LOOK_KEYS,
  CONTENT_DEFAULTS,
  PREF_DEFAULTS,
  ENTRANCES,
  CHANGES,
  IDLES,
  FONTS,
  isWidget,
  isPreset,
  presetLook,
  sanitize,
  defaultStyle,
  normalizeStyle,
  applyPatch,
  applyPreset,
  modifiedKeys,
  kitInfo,
};
