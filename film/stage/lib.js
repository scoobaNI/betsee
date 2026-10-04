// The film's toolkit. Every value on screen is a pure function of the scene clock, so any frame can
// be rendered alone and in any order, and two identical events animate on identical curves.

export const W = 1920;
export const H = 1080;

export const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const lerp = (a, b, p) => a + (b - a) * p;
export const mix = (a, b, p) => a.map((v, i) => lerp(v, b[i], p));

export const ease = {
  linear: (p) => p,
  inOut: (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2),
  out: (p) => 1 - Math.pow(1 - p, 3),
  outQuint: (p) => 1 - Math.pow(1 - p, 5),
  outExpo: (p) => (p >= 1 ? 1 : 1 - Math.pow(2, -10 * p)),
  in: (p) => p * p * p,
  inExpo: (p) => (p <= 0 ? 0 : Math.pow(2, 10 * p - 10)),
  inOutQuint: (p) => (p < 0.5 ? 16 * p ** 5 : 1 - Math.pow(-2 * p + 2, 5) / 2),
  // The Director's own curve, cubic-bezier(0.22, 1, 0.36, 1), solved numerically.
  soft: bezier(0.22, 1, 0.36, 1),
  snap: bezier(0.7, 0, 0.2, 1),
};

export function bezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (t) => ((ax * t + bx) * t + cx) * t;
  const sy = (t) => ((ay * t + by) * t + cy) * t;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i++) {
      const d = sx(t) - x;
      const dx = (3 * ax * t + 2 * bx) * t + cx;
      if (Math.abs(d) < 1e-6 || !dx) break;
      t -= d / dx;
    }
    return sy(clamp(t));
  };
}

/** Progress 0..1 of t between a and b, eased. */
export const seg = (t, a, b, e = ease.inOut) => e(clamp((t - a) / (b - a)));

/** In, hold, out: 0 -> 1 over [a, a+fin], 1 until b-fout, -> 0 at b. */
export const win = (t, a, b, fin = 0.4, fout = 0.4, e = ease.out) =>
  t < a || t > b ? 0 : Math.min(seg(t, a, a + fin, e), 1 - seg(t, b - fout, b, ease.in));

/** Piecewise keyframes: [[t, v], ...], v a number or an array of numbers. */
export function kf(t, keys, e = ease.inOut) {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1, e1] = keys[i];
    const [t0, v0] = keys[i - 1];
    if (t <= t1) {
      const p = (e1 ?? e)(clamp((t - t0) / (t1 - t0)));
      return Array.isArray(v0) ? mix(v0, v1, p) : lerp(v0, v1, p);
    }
  }
  return keys[keys.length - 1][1];
}

/** Deterministic pseudo-random numbers, so "chaos" is the same chaos on every render. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth value noise in 1D, for organic (AI) motion. */
export function noise1(seed) {
  const r = rng(seed);
  const pts = Array.from({ length: 256 }, () => r() * 2 - 1);
  return (x) => {
    const i = Math.floor(x), f = x - i;
    const a = pts[((i % 256) + 256) % 256], b = pts[(((i + 1) % 256) + 256) % 256];
    const s = f * f * (3 - 2 * f);
    return a + (b - a) * s;
  };
}

export function el(tag, cls = "", parent = null, html = null) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (html !== null) node.innerHTML = html;
  if (parent) parent.appendChild(node);
  return node;
}

export function svgEl(tag, attrs = {}, parent = null) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
}

/** Positions an absolutely placed node: centre (x, y) in stage px, scale, rotation, opacity, blur. */
export function put(node, { x = 0, y = 0, s = 1, sx = null, sy = null, r = 0, o = 1, blur = 0, z = null, origin = null, rx = 0, ry = 0, persp = 0 } = {}) {
  const scale = sx !== null || sy !== null ? `scale(${sx ?? s}, ${sy ?? s})` : `scale(${s})`;
  const rot3 = rx || ry ? ` rotateX(${rx}deg) rotateY(${ry}deg)` : "";
  node.style.transform = `${persp ? `perspective(${persp}px) ` : ""}translate(${x}px, ${y}px) translate(-50%, -50%)${rot3} ${scale} rotate(${r}deg)`;
  node.style.opacity = o;
  node.style.filter = blur > 0.05 ? `blur(${blur}px)` : "none";
  node.style.visibility = o <= 0.002 ? "hidden" : "visible";
  if (z !== null) node.style.zIndex = z;
  if (origin) node.style.transformOrigin = origin;
}

export const show = (node, on) => {
  node.style.visibility = on ? "visible" : "hidden";
};

// Captures: one 2x screenshot per screen plus the rectangles of its parts (film/capture).
const captures = new Map();
export async function loadCaptures(names) {
  await Promise.all(
    names.map(async (name) => {
      const meta = await (await fetch(`../captures/${name}.json`)).json();
      const img = new Image();
      img.src = `../captures/${name}.png`;
      await img.decode();
      captures.set(name, { ...meta, img });
    }),
  );
}
export const capture = (name) => {
  const c = captures.get(name);
  if (!c) throw new Error(`capture ${name} not loaded`);
  return c;
};

/**
 * A layer cut from a capture: rect is a part name from the capture's JSON or {x, y, w, h, radius}
 * in the page's CSS px. The div is sized in CSS px and shows the 2x pixels, so it stays sharp up
 * to a 2x zoom.
 */
export function cut(name, rect = null, parent = null, cls = "") {
  const c = capture(name);
  const r = typeof rect === "string" ? c.rects[rect] : rect ?? { x: 0, y: 0, w: c.page.w, h: c.page.h, radius: 0 };
  if (!r) throw new Error(`capture ${name} has no part ${rect}`);
  const node = el("div", `cut ${cls}`, parent);
  node.style.width = `${r.w}px`;
  node.style.height = `${r.h}px`;
  node.style.backgroundImage = `url(${c.img.src})`;
  node.style.backgroundSize = `${c.page.w}px ${c.page.h}px`;
  node.style.backgroundPosition = `${-r.x}px ${-r.y}px`;
  node.style.borderRadius = `${r.radius ?? 0}px`;
  node.dataset.w = r.w;
  node.dataset.h = r.h;
  return node;
}
export const rectOf = (name, part, optional = false) => {
  const r = capture(name).rects[part];
  if (!r && !optional) throw new Error(`capture ${name} has no part ${part}`);
  return r;
};

// Icons: the Director's own glyph set (Remix fill, from its icon.tsx) and the ecosystem's Streamline
// subset (packages/ui/src/icons.json), both read from the repository at load time.
const glyphs = new Map();
export async function loadIcons() {
  const source = await (await fetch("/web/apps/director/src/components/icon.tsx")).text();
  for (const m of source.matchAll(/^\s+'?([\w-]+)'?: '(<[^']+)',?$/gm)) glyphs.set(m[1], { body: m[2], box: 24, fill: true });
  const sets = await (await fetch("/web/packages/ui/src/icons.json")).json();
  for (const set of sets)
    for (const [name, icon] of Object.entries(set.icons)) glyphs.set(`${set.prefix}:${name}`, { body: icon.body, box: set.width, fill: false });
}
export function icon(name, size = 20, cls = "") {
  const g = glyphs.get(name);
  if (!g) throw new Error(`icon ${name}`);
  return `<svg class="ic ${cls}" viewBox="0 0 ${g.box} ${g.box}" width="${size}" height="${size}" ${g.fill ? 'fill="currentColor"' : ""} aria-hidden="true">${g.body}</svg>`;
}

export const MARK =
  "M46.67 92.36C46.49 92.33 45.79 92.26 45.12 92.19C35.66 91.27 26.61 87.42 18.88 81.05C17.18 79.64 13.51 75.89 12.11 74.12C6.90 67.55 3.16 59.57 2.10 52.76C1.88 51.33 1.88 51.23 2.14 51.81C2.55 52.69 4.01 54.76 5.06 55.93C8.55 59.83 15.24 64.30 22.50 67.60C26.87 69.59 32.91 71.56 38.41 72.79C44.12 74.07 50.69 74.75 53.59 74.35C55.74 74.06 57.02 73.66 58.87 72.69C61.48 71.33 63.150 70.21 65.25 68.40C69.33 64.88 72.19 60.11 73.18 55.15C73.47 53.73 73.53 50.64 73.30 49.09C72.70 44.99 70.86 41.47 67.64 38.24C65.11 35.71 62.09 33.73 58.89 32.52L57.90 32.15L58.78 31.96C61.56 31.35 65.45 31.24 68.58 31.69C72.71 32.29 76.49 33.55 80.94 35.80C88.62 39.69 94.32 44.88 96.71 50.19C97.97 52.98 98.36 55.73 97.86 58.37C97.73 59.07 97.52 59.97 97.39 60.37C95.52 66.17 90.73 73.20 84.98 78.57C79.11 84.04 72.51 87.83 64.53 90.31C62.36 90.98 59.12 91.66 56.21 92.05C54.40 92.29 53.60 92.34 50.55 92.37C48.60 92.38 46.86 92.38 46.67 92.36ZM48.31 68.57C45.59 68.31 42.56 67.17 40.40 65.58C39.19 64.69 37.53 63.01 36.67 61.81C34.70 59.06 33.59 55.32 33.79 52.08C33.95 49.51 34.44 47.58 35.44 45.63C36.26 44.05 37.01 43.03 38.35 41.68C41.48 38.55 45.52 36.82 50.11 36.67C51.60 36.62 52.11 36.65 53.26 36.85C55.74 37.27 57.67 38.04 59.76 39.43C64.97 42.90 67.61 49.34 66.35 55.52C66.04 57.05 65.80 57.75 65.03 59.32C63.47 62.53 60.99 65.05 57.83 66.67C55.24 68.00 53.36 68.49 50.50 68.62C49.86 68.65 48.88 68.62 48.31 68.57ZM20.39 60.18C19.34 59.44 15.96 57.28 13.57 55.81C7.88 52.30 5.46 50.25 4.15 47.83C2.93 45.55 2.83 42.83 3.86 39.65C4.67 37.16 7.18 32.81 10.23 28.60C13.80 23.68 18.37 19.30 23.29 16.09C29.44 12.08 36.33 9.39 43.57 8.20C48.21 7.43 54.16 7.38 59.04 8.09C66.91 9.22 74.82 12.52 81.27 17.35C84.24 19.57 85.61 20.80 88.27 23.64C90.56 26.08 92.55 28.57 94.10 30.92C95.27 32.71 95.79 33.58 96.56 35.08C98.05 38.00 98.05 37.99 96.78 36.64C94.75 34.49 91.75 32.09 88.93 30.37C81.26 25.70 72.06 24.02 62.59 25.55C55.54 26.69 45.74 29.95 39.52 33.22C36.50 34.81 33.15 36.94 30.87 38.73C29.36 39.91 27.35 41.38 25.66 42.53C21.57 45.31 17.74 47.07 14.12 47.85C13.20 48.05 12.60 48.10 11.24 48.10C10.29 48.10 9.31 48.05 9.05 47.98C8.79 47.91 8.58 47.90 8.58 47.94C8.58 47.99 8.86 48.42 9.20 48.90C11.93 52.72 16.03 56.80 20.31 59.96C21.18 60.61 21.44 60.83 21.30 60.81C21.29 60.81 20.88 60.52 20.39 60.18Z";
export const markSvg = (size, cls = "") =>
  `<svg class="${cls}" viewBox="0 0 100 100" width="${size}" height="${size}" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="${MARK}"/></svg>`;

// Decisions, in the Director's colours (web/apps/director/src/director.css).
export const DECISION = {
  allow: { label: "Allowed", color: "#14a05a", soft: "#ebf7f0", ink: "#0d7a43", icon: "circle-check" },
  deny: { label: "Denied", color: "#e0484e", soft: "#fdeeee", ink: "#b8262c", icon: "ban" },
  approval: { label: "Approval required", color: "#e28a0c", soft: "#fef5e6", ink: "#9a5800", icon: "hourglass" },
  pending: { label: "Awaiting approval", color: "#e28a0c", soft: "#fef5e6", ink: "#9a5800", icon: "hourglass" },
  stepup: { label: "Step-up", color: "#8a52c7", soft: "#f5effc", ink: "#6a35a3", icon: "fingerprint" },
  ai: { label: "AI-tightened", color: "#cf3f97", soft: "#fcedf6", ink: "#a32a76", icon: "sparkles" },
  quar: { label: "Quarantined", color: "#ea6a1e", soft: "#fff1e8", ink: "#b04c0d", icon: "lock" },
  approved: { label: "Approved", color: "#14a05a", soft: "#ebf7f0", ink: "#0d7a43", icon: "circle-check" },
};
export const ACCENT = "#3a5bd9";


export function chip(kind, { size = "md", label = null } = {}) {
  const d = DECISION[kind];
  return `<span class="chip chip-${size}" style="--c:${d.color};--soft:${d.soft}">${icon(d.icon, size === "xl" ? 34 : size === "lg" ? 22 : 17)}<span>${label ?? d.label}</span></span>`;
}

/** A point along a cubic bezier. */
export function cubic(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return [
    u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
    u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
  ];
}

/** Types text out by character count, deterministic per frame. */
export const typed = (text, p) => text.slice(0, Math.round(clamp(p) * text.length));

/**
 * Places a text block: (x, y) is the anchor, ax 0 = left edge, 0.5 = centre, 1 = right edge; the
 * block is vertically centred on y. Enter/exit as a soft rise out of blur.
 */
export function text(node, { x, y, ax = 0, o = 1, dy = 0, blur = 0, s = 1, ls = null }) {
  node.style.transform = `translate(${x}px, ${y + dy}px) translate(${-ax * 100}%, -50%) scale(${s})`;
  node.style.transformOrigin = `${ax * 100}% 50%`;
  node.style.opacity = o;
  node.style.filter = blur > 0.05 ? `blur(${blur}px)` : "none";
  node.style.visibility = o <= 0.002 ? "hidden" : "visible";
  if (ls !== null) node.style.letterSpacing = ls;
}

/** A caption's state at time t for a window [a, b]: opacity, rise and blur. */
export function capState(t, a, b, { fin = 0.8, fout = 0.5, rise = 18, blur = 10 } = {}) {
  const pin = seg(t, a, a + fin, ease.soft);
  const pout = seg(t, b - fout, b, ease.in);
  const o = t < a || t > b ? 0 : Math.min(pin, 1 - pout);
  return { o, dy: (1 - pin) * rise - pout * rise * 0.5, blur: (1 - pin) * blur + pout * blur * 0.6 };
}

export const PEOPLE = {
  maya: { name: "Maya Chen", role: "Finance Operations Lead", photo: "maya-chen" },
  daniel: { name: "Daniel Ortiz", role: "Security officer", photo: "daniel-ortiz" },
  priya: { name: "Priya Raman", role: "Platform admin", photo: "priya-raman" },
  marcus: { name: "Marcus Webb", role: "Chief Financial Officer", photo: "marcus-webb" },
  james: { name: "James Okafor", role: "Chief Operating Officer", photo: "james-okafor" },
  lena: { name: "Lena Fischer", role: "Customer Support Lead", photo: "lena-fischer" },
  clara: { name: "Clara Rossi", role: "HR Business Partner", photo: "clara-rossi" },
  ethan: { name: "Ethan Park", role: "Engineer", photo: "ethan-park" },
  grace: { name: "Grace Kim", role: "Analyst", photo: "grace-kim" },
  helena: { name: "Helena Brooks", role: "Legal", photo: "helena-brooks" },
  noah: { name: "Noah Schmidt", role: "Logistics", photo: "noah-schmidt" },
  olivia: { name: "Olivia Bennett", role: "Sales", photo: "olivia-bennett" },
  aisha: { name: "Aisha Rahman", role: "Procurement", photo: "aisha-rahman" },
};
export const photo = (key) => `/web/apps/director/public/people/${PEOPLE[key]?.photo ?? key}.jpg`;

export function avatar(parent, key, size) {
  const node = el("div", "avatar", parent);
  node.style.width = node.style.height = `${size}px`;
  node.style.backgroundImage = `url(${photo(key)})`;
  return node;
}

export function agentMark(size, kind = "") {
  const glyph = kind === "tool" ? "wrench" : kind === "model" ? "sparkles" : "bot";
  return `<span class="agent ${kind}" style="width:${size}px;height:${size}px">${icon(glyph, Math.round(size * 0.56))}</span>`;
}

/** A request token: agent, capability, optional resource. */
export function request(parent, { agent = "", cap, res = "", cls = "" }) {
  return el(
    "div",
    `token abs ${cls}`,
    parent,
    `<span class="bot">${icon("bot", 20)}</span>${agent ? `<span class="mono" style="font-size:18px">${agent}</span>` : ""}<span class="mono" style="font-size:18px;color:#3a5bd9">${cap}</span>${res ? `<span class="sub mono" style="font-size:16px">${res}</span>` : ""}`,
  );
}

const BAR = 46;

/**
 * A real app screen in a window: chrome (browser bar with URL, or a native title bar) over a
 * viewport that frames any rectangle of one of several captured pages. map() turns a page point
 * into stage coordinates, so callouts can point at real elements while the camera moves.
 */
export class Screen {
  constructor(parent, pages, { w = 1500, h = 844, url = "", title = "", dark = false, native = false } = {}) {
    this.w = w;
    this.h = h;
    this.node = el("div", `screen ${dark ? "dark" : ""}`, parent);
    Object.assign(this.node.style, { width: `${w}px`, height: `${h + BAR}px` });
    const bar = el("div", "bar", this.node);
    if (native)
      bar.innerHTML = `<span class="title">${markSvg(18)} ${title}</span><span class="controls"><i></i><i></i><i></i></span>`;
    else bar.innerHTML = `<span class="lights"><i></i><i></i><i></i></span><span class="url">${icon("lock", 13)}<span class="u">${url}</span></span>`;
    this.urlNode = bar.querySelector(".u");
    this.viewNode = el("div", "view", this.node);
    Object.assign(this.viewNode.style, { width: `${w}px`, height: `${h}px` });
    this.pages = new Map();
    for (const name of [].concat(pages)) {
      const page = cut(name, null, this.viewNode, "page");
      this.pages.set(name, page);
    }
    this.k = 1;
    this.tx = 0;
    this.ty = 0;
    this.at = { x: 960, y: 540, s: 1 };
  }
  place({ x = 960, y = 560, s = 1, o = 1, blur = 0, rx = 0, ry = 0 } = {}) {
    this.at = { x, y, s };
    const H = this.h + BAR;
    this.node.style.transformOrigin = "50% 50%";
    this.node.style.transform = `translate(${x - this.w / 2}px, ${y - H / 2}px) perspective(2600px) rotateX(${rx}deg) rotateY(${ry}deg) scale(${s})`;
    this.node.style.opacity = o;
    this.node.style.visibility = o > 0.002 ? "visible" : "hidden";
    this.node.style.filter = blur > 0.05 ? `blur(${blur}px)` : "none";
  }
  /** Frames page rectangle [x, y, w, h] (CSS px of the capture) in the viewport. */
  look([px, py, pw, ph]) {
    const k = Math.min(this.w / pw, this.h / ph);
    this.k = k;
    this.tx = this.w / 2 - (px + pw / 2) * k;
    this.ty = this.h / 2 - (py + ph / 2) * k;
    for (const page of this.pages.values()) page.style.transform = `translate(${this.tx}px, ${this.ty}px) scale(${k})`;
  }
  /**
   * A live page: the Director recorded frame by frame (film/capture/live.mjs). frame(name, t) shows
   * the frame for t seconds into the clip; the stage waits for it to decode before capturing.
   */
  live(name, clip) {
    // The page box is in page coordinates; the recorded viewport sits at the clip's scroll offset.
    const page = el("div", "page", this.viewNode);
    Object.assign(page.style, { width: `${clip.width}px`, height: `${clip.scroll + clip.height}px` });
    const img = el("img", "", page);
    Object.assign(img.style, { position: "absolute", left: "0", top: `${clip.scroll}px`, width: `${clip.width}px`, height: `${clip.height}px` });
    this.pages.set(name, page);
    this.clips = this.clips ?? new Map();
    this.clips.set(name, { img, clip, src: "" });
    return page;
  }
  frame(name, seconds) {
    const c = this.clips.get(name);
    const n = Math.min(c.clip.frames, Math.max(1, Math.floor(seconds * c.clip.fps) + 1));
    const src = `../captures/live/${name}/${String(n).padStart(4, "0")}.jpg`;
    if (c.src !== src) {
      c.src = src;
      c.img.src = src;
      window.__pending?.push(c.img.decode().catch(() => {}));
    }
  }
  show(name, o = 1) {
    for (const [key, page] of this.pages) {
      if (key === name) {
        page.style.opacity = o;
        page.style.visibility = o > 0.002 ? "visible" : "hidden";
      }
    }
  }
  only(name) {
    for (const [key, page] of this.pages) {
      page.style.opacity = key === name ? 1 : 0;
      page.style.visibility = key === name ? "visible" : "hidden";
    }
  }
  url(text) {
    if (this.urlNode && this.urlNode.textContent !== text) this.urlNode.textContent = text;
  }
  map(px, py) {
    const lx = this.tx + px * this.k;
    const ly = BAR + this.ty + py * this.k;
    const H = this.h + BAR;
    return [this.at.x + (lx - this.w / 2) * this.at.s, this.at.y + (ly - H / 2) * this.at.s];
  }
  /** Dims the page around a page rectangle {x, y, w, h, radius}; o 0..1. */
  spotlight(rect, o) {
    this.spot = this.spot ?? el("div", "spot", this.viewNode);
    this.spot.style.visibility = rect && o > 0.002 ? "visible" : "hidden";
    if (!rect) return;
    const pad = 10;
    Object.assign(this.spot.style, {
      left: `${this.tx + rect.x * this.k - pad}px`,
      top: `${this.ty + rect.y * this.k - pad}px`,
      width: `${rect.w * this.k + 2 * pad}px`,
      height: `${rect.h * this.k + 2 * pad}px`,
      borderRadius: `${(rect.radius || 12) * this.k + pad}px`,
      boxShadow: `0 0 0 4000px rgba(246, 247, 250, ${0.8 * o})`,
    });
  }
  /** A page rectangle {x, y, w, h} as a stage rectangle [x, y, w, h]. */
  mapRect({ x, y, w, h }) {
    const [ax, ay] = this.map(x, y);
    const [bx, by] = this.map(x + w, y + h);
    return [ax, ay, bx - ax, by - ay];
  }
}

/**
 * A callout: a label that names a real element, joined to it by a hairline. The anchor is a point
 * [x, y] (a dot) or a stage rectangle [x, y, w, h], which gets a frame around the exact element and
 * the hairline leaves from the frame's side facing the label. size "sm" is a one-line tag.
 */
export class Callout {
  constructor(parent, svg, { title, sub = "", mono = "", size = "" }) {
    this.node = el("div", `callout ${size}`, parent, `<b>${title}</b>${sub ? `<span>${sub}</span>` : ""}${mono ? `<span class="mono">${mono}</span>` : ""}`);
    this.frame = svgEl("rect", { rx: 10, fill: "rgba(58,91,217,.06)", stroke: "#3a5bd9", "stroke-width": 1.8 }, svg);
    this.line = svgEl("line", { stroke: "#3a5bd9", "stroke-width": 1.6, "stroke-linecap": "round" }, svg);
    this.halo = svgEl("circle", { r: 13, fill: "rgba(58,91,217,.14)" }, svg);
    this.dot = svgEl("circle", { r: 5.5, fill: "#3a5bd9", stroke: "#fff", "stroke-width": 2 }, svg);
  }
  /** anchor: [x, y] or [x, y, w, h]; at: the label's centre; p: 0..1 reveal. */
  update(anchor, at, p) {
    const w = this.node.offsetWidth || 260;
    const h = this.node.offsetHeight || 60;
    const [lx, ly] = at;
    const boxed = anchor.length === 4;
    let ax = anchor[0];
    let ay = anchor[1];
    if (boxed) {
      // The frame settles onto the element from a little further out.
      const pad = 7 + (1 - ease.out(clamp(p * 2))) * 10;
      const [x, y, bw, bh] = [anchor[0] - pad, anchor[1] - pad, anchor[2] + 2 * pad, anchor[3] + 2 * pad];
      Object.entries({ x, y, width: bw, height: bh }).forEach(([k, v]) => this.frame.setAttribute(k, v));
      this.frame.style.opacity = clamp(p * 3);
      // Level with the label where the frame allows it, so the hairline runs straight.
      if (lx - w / 2 > x + bw) [ax, ay] = [x + bw, clamp(ly, y + 10, y + bh - 10)];
      else if (lx + w / 2 < x) [ax, ay] = [x, clamp(ly, y + 10, y + bh - 10)];
      else [ax, ay] = [clamp(lx, x + 10, x + bw - 10), ly > y + bh ? y + bh : y];
    } else this.frame.style.opacity = 0;
    // The hairline meets the label on the side facing the anchor.
    const ex = Math.abs(ax - lx) > w / 2 ? lx + (ax > lx ? w / 2 : -w / 2) : ax;
    const ey = Math.abs(ax - lx) > w / 2 ? ly : ly + (ay > ly ? h / 2 : -h / 2);
    const draw = clamp(p * 2);
    this.line.setAttribute("x1", ax);
    this.line.setAttribute("y1", ay);
    this.line.setAttribute("x2", ax + (ex - ax) * draw);
    this.line.setAttribute("y2", ay + (ey - ay) * draw);
    this.line.style.opacity = p > 0 ? 0.85 : 0;
    for (const c of [this.dot, this.halo]) {
      c.setAttribute("cx", ax);
      c.setAttribute("cy", ay);
      c.style.opacity = clamp(p * 3);
    }
    this.dot.setAttribute("r", boxed ? 4 : 5.5);
    this.halo.setAttribute("r", boxed ? 0 : 13 * (0.6 + 0.4 * clamp(p * 2)));
    const lp = clamp((p - 0.25) / 0.75);
    this.node.style.transform = `translate(${lx - w / 2}px, ${ly - h / 2 + (1 - ease.soft(lp)) * 10}px)`;
    this.node.style.opacity = ease.soft(lp);
    this.node.style.visibility = lp > 0 ? "visible" : "hidden";
  }
}

/** Reveal 0..1 for a window [a, b] with soft in and out. */
export const reveal = (t, a, b, fin = 0.7, fout = 0.5) => (t < a || t > b ? 0 : Math.min(clamp((t - a) / fin), clamp((b - t) / fout)));
