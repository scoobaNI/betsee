// Records the Director live, frame by frame, for the film: the mock world keeps acting while
// Playwright's clock advances one frame at a time, so feeds, charts and the graph move exactly as
// they do in the app, and every frame is as sharp as a screenshot. Writes
// film/captures/live/<clip>/0001.jpg ... and live/clips.json (frame count, fps, scroll offset).
//
// Needs the Director's Vite dev server in mock mode on :5174 (see capture.mjs).
//   node film/capture/live.mjs [clip ...]
import { createRequire } from "node:module";
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(join(root, "web/package.json"));
const { chromium } = require("@playwright/test");
const out = join(root, "film/captures/live");
mkdirSync(out, { recursive: true });
const FPS = 30;
const DIRECTOR = "http://localhost:5174";
const only = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const SECONDS = process.argv.includes("--short") ? 1 : null;

const CLIPS = [
  { name: "overview", path: "/", seconds: 9 },
  { name: "activity", path: "/activity", seconds: 9 },
  { name: "graph", path: "/graph", seconds: 9 },
  { name: "orgchart", path: "/agents", seconds: 8 },
  { name: "determinism", path: "/determinism", seconds: 9 },
  { name: "replay", path: "trace", seconds: 8, scroll: 1150, replay: true },
];

const browser = await chromium.launch();
const manifest = existsSync(join(out, "clips.json")) ? JSON.parse(readFileSync(join(out, "clips.json"), "utf8")) : {};
for (const clip of CLIPS) {
  if (only.length && !only.includes(clip.name)) continue;
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1.5, timezoneId: "Europe/Warsaw", locale: "en-GB" });
  // Motion runs opacity and transform on the Web Animations API, whose timeline the fake clock does not
  // drive, so an exit could never finish. Without Element.animate it falls back to its own frame loop,
  // which runs on the (fake) requestAnimationFrame.
  await context.addInitScript(() => {
    delete Element.prototype.animate;
  });
  await context.route(/localhost:5174\/src\/main\.tsx/, async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace("world.start();", "world.start(); window.__world = world;");
    await route.fulfill({ response, body });
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log(clip.name, "pageerror", e.message));
  await page.clock.install({ time: new Date("2026-10-06T09:30:00+02:00") });
  await page.goto(`${DIRECTOR}/`, { waitUntil: "domcontentloaded" });
  // Let the world fill up: some history, then the stage scenarios for variety.
  await page.clock.runFor(4000);
  await page.waitForFunction(() => !!window.__world);
  for (const act of ["act2-deterministic-boundaries", "act4-agents-talking", "act6-supply-chain-and-rogue", "act3-hijacked-goal", "act5-human-decides"])
    await page.evaluate((id) => window.__world.launch(id), act);
  await page.clock.runFor(30_000);
  let target = clip.path;
  if (clip.path === "trace") {
    await page.waitForFunction(() => !!window.__world);
    const id = await page.evaluate(() => window.__world.traces(300).find((t) => t.decision === "deny" && t.control_ids?.includes("CTL-TIER-001"))?.trace_id);
    target = `/traces/${id}`;
  }
  await page.evaluate((p) => {
    history.pushState({}, "", p);
    dispatchEvent(new PopStateEvent("popstate"));
  }, target);
  await page.clock.runFor(2500);
  await page.addStyleTag({ content: "div[aria-live=polite].fixed { display: none !important; }" });
  if (clip.scroll) await page.evaluate((y) => window.scrollTo(0, y), clip.scroll);
  if (clip.replay) {
    await page.getByText("Replay", { exact: true }).first().click();
    await page.clock.runFor(100);
  }
  const dir = join(out, clip.name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const frames = (SECONDS ?? clip.seconds) * FPS;
  for (let f = 1; f <= frames; f++) {
    await page.clock.runFor(1000 / FPS);
    await page.screenshot({ path: join(dir, `${String(f).padStart(4, "0")}.jpg`), type: "jpeg", quality: 88 });
  }
  manifest[clip.name] = { frames, fps: FPS, scroll: clip.scroll ?? 0, width: 1920, height: 1080 };
  // Saved after every clip, so a later failure keeps what was recorded.
  writeFileSync(join(out, "clips.json"), JSON.stringify(manifest, null, 1));
  console.log(`${clip.name}: ${frames} frames`);
  await context.close();
}
writeFileSync(join(out, "clips.json"), JSON.stringify(manifest, null, 1));
await browser.close();
