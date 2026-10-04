// The film: a timeline of scenes on one 1920 x 1080 stage. window.renderAt(t) draws the frame at
// t seconds; the renderer (film/render/render.mjs) steps it frame by frame. ?t=12.5 previews one
// frame in a browser, ?play plays in real time. Scenes time themselves against their narration
// (ctx.vo / ctx.phrase) and register sound cues (ctx.cue), which the renderer exports for the mix.
import { el, loadCaptures, loadIcons, rng, W, H } from "./lib.js";
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
    "dir-trace-tier", "dir-trace-approval", "dir-trace-tool",
    "eco-home", "eco-approvals", "eco-approval-detail", "eco-controls", "eco-control-apr003", "eco-policies", "eco-usecases",
    "kc-login",
  ]),
  document.fonts.load('700 100px "Mona"'),
  document.fonts.load('500 20px "JBMono"'),
]);
await document.fonts.ready;

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
    cue(local, kind) {
      cues.push({ at: Math.round((act.start + local) * 1000) / 1000, kind });
    },
  };
  const scene = make(root, ctx);
  return { ...act, root, pre: scene.pre ?? 0, post: scene.post ?? 0, update: scene.update, z: scene.z ?? 0 };
});
window.filmCues = cues.sort((a, b) => a.at - b.at);

// A whisper of grain so flat white never bands; seeded per frame, identical on every render.
const grain = el("canvas", "", stage);
grain.id = "grain";
grain.width = W + 128;
grain.height = H + 128;
{
  const g = grain.getContext("2d");
  const img = g.createImageData(grain.width, grain.height);
  const r = rng(99);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = 128 + (r() - 0.5) * 255;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
}
const fade = el("div", "", stage);
fade.id = "fade";

window.renderAt = (t) => {
  for (const s of scenes) {
    const on = t >= s.start - s.pre && t < s.end + s.post;
    s.root.style.display = on ? "block" : "none";
    if (on) {
      s.root.style.zIndex = 10 + s.z + (t >= s.start ? 1 : 0);
      s.update(t - s.start, t);
    }
  }
  const frame = Math.round(t * timeline.fps);
  const jr = rng(frame + 1);
  grain.style.transform = `translate(${-Math.floor(jr() * 128)}px, ${-Math.floor(jr() * 128)}px)`;
  const end = timeline.duration;
  fade.style.opacity = t < 0.6 ? 1 - t / 0.6 : t > end - 1.2 ? Math.min(1, (t - (end - 1.2)) / 1.2) : 0;
};

window.filmDuration = timeline.duration;
window.filmFps = timeline.fps;

const params = new URLSearchParams(location.search);
if (params.has("play")) {
  const t0 = performance.now() - parseFloat(params.get("play") || "0") * 1000;
  const loop = () => {
    window.renderAt(((performance.now() - t0) / 1000) % timeline.duration);
    requestAnimationFrame(loop);
  };
  loop();
} else window.renderAt(parseFloat(params.get("t") ?? "0"));

window.filmReady = true;
