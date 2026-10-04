// The film: a timeline of scenes on one 1920 x 1080 stage. window.renderAt(t) draws the frame at
// t seconds; the renderer (film/render/render.mjs) steps it frame by frame. ?t=12.5 previews one
// frame in a browser, ?play plays in real time. Scenes time themselves against their narration
// (ctx.vo / ctx.phrase) and register sound cues (ctx.cue), which the renderer exports for the mix.
import { el, loadCaptures, loadIcons } from "./lib.js";
import { open } from "./scenes/open.js";
import { product } from "./scenes/product.js";
import { depth } from "./scenes/depth.js";
import { proof } from "./scenes/proof.js";

const timeline = await (await fetch("timeline.json")).json();
const stage = document.getElementById("stage");

await Promise.all([
  loadIcons(),
  loadCaptures([
    "desk-setup", "desk-empty", "desk-work", "desk-approval", "desk-approved", "desk-guard", "desk-input",
    "dir-overview", "dir-activity", "dir-graph", "dir-orgchart", "dir-person", "dir-access", "dir-config",
    "dir-agent-invoice-assistant", "dir-agent-employee-assistant", "dir-determinism", "dir-coverage",
    "dir-trace-tier", "dir-trace-approval", "dir-trace-tool", "dir-trace-tightened",
    "eco-home", "eco-approvals", "eco-approval-detail", "eco-controls", "eco-control-apr003", "eco-policies", "eco-usecases",
    "kc-login", "kc-light",
  ]),
  document.fonts.load('700 100px "Mona"'),
  document.fonts.load('500 20px "JBMono"'),
]);
await document.fonts.ready;

const clips = await (await fetch("../captures/live/clips.json")).json().catch(() => ({}));
const builders = { ...open, ...product, ...depth, ...proof };
const cues = [];
const scenes = timeline.acts.map((act) => {
  const make = builders[act.id];
  if (!make) throw new Error(`no scene for act ${act.id}`);
  const root = el("div", "scene", stage);
  root.dataset.act = act.id;
  const lines = new Map(timeline.vo.map((v) => [v.id, v]));
  const ctx = {
    act,
    timeline,
    clips,
    length: act.end - act.start,
    /** A narration line in act-local seconds: { at, end, dur }. */
    vo(id) {
      const v = lines.get(id);
      if (!v) throw new Error(`no narration line ${id}`);
      return { at: v.at - act.start, end: v.at - act.start + v.dur, dur: v.dur };
    },
    /** Act-local start of the k-th phrase of a line (detected from its pauses); k < 0 counts from the end. */
    phrase(id, k) {
      const v = lines.get(id);
      const i = k < 0 ? Math.max(0, v.phrases.length + k) : Math.min(k, v.phrases.length - 1);
      const p = v.phrases[i] ?? 0;
      return v.at - act.start + p;
    },
    /** Act-local time at which a word of a line is spoken: ctx.word("n25", "Underneath"). */
    word(id, needle) {
      const v = lines.get(id);
      const text = (timeline.lines ?? {})[id] ?? "";
      const at = text.toLowerCase().indexOf(needle.toLowerCase());
      if (at < 0) throw new Error(`"${needle}" is not in line ${id}`);
      let time = 0;
      for (const [index, t] of v.words) if (index <= at) time = t;
      return v.at - act.start + time;
    },
    cue(local, kind) {
      cues.push({ at: Math.round((act.start + local) * 1000) / 1000, kind });
    },
  };
  const scene = make(root, ctx);
  return { ...act, root, update: scene.update, push: scene.push !== false };
});
// Every act hands over with the same move: the outgoing scene drifts toward the viewer and dissolves
// while the next one settles in underneath it.
const HANDOVER = 0.7;
window.filmCues = cues.sort((a, b) => a.at - b.at);

const fade = el("div", "", stage);
fade.id = "fade";

window.renderAt = async (t) => {
  window.__pending = [];
  scenes.forEach((s, i) => {
    const last = i === scenes.length - 1;
    const on = t >= s.start && (t < s.end + (last ? 0 : HANDOVER));
    s.root.style.display = on ? "block" : "none";
    if (!on) return;
    const out = last ? 0 : Math.min(1, Math.max(0, (t - s.end) / HANDOVER));
    const into = Math.min(1, Math.max(0, (t - s.start) / HANDOVER));
    const e = (p) => 1 - Math.pow(1 - p, 3);
    // Outgoing: forward and away. Incoming: a touch from below scale.
    const scale = out > 0 ? 1 + 0.06 * e(out) : i > 0 ? 0.97 + 0.03 * e(into) : 1;
    s.root.style.zIndex = out > 0 ? 30 : 10;
    s.root.style.opacity = out > 0 ? 1 - e(out) : 1;
    s.root.style.filter = out > 0.01 ? `blur(${6 * out}px)` : "none";
    s.root.style.transform = s.push ? `scale(${scale})` : "none";
    s.update(t - s.start, t);
  });
  const end = timeline.duration;
  fade.style.opacity = t < 0.6 ? 1 - t / 0.6 : t > end - 1.2 ? Math.min(1, (t - (end - 1.2)) / 1.2) : 0;
  // Live frames swap images; wait until they are decoded so no frame is captured half-drawn.
  await Promise.all(window.__pending);
};

window.filmDuration = timeline.duration;
window.filmFps = timeline.fps;

const params = new URLSearchParams(location.search);
if (params.has("play")) {
  const t0 = performance.now() - parseFloat(params.get("play") || "0") * 1000;
  const loop = () => {
    window.renderAt(((performance.now() - t0) / 1000) % timeline.duration).then(() => requestAnimationFrame(loop));
  };
  loop();
} else await window.renderAt(parseFloat(params.get("t") ?? "0"));

window.filmReady = true;
