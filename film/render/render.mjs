// Renders the film from film/stage frame by frame in headless Chromium and encodes it with ffmpeg.
//
//   node film/render/render.mjs --stills 3.2,12.5     PNG stills to film/out/stills
//   node film/render/render.mjs --cues                the scenes' sound cues to film/out/cues.json
//   node film/render/render.mjs [--from 0 --to 85.5] [--workers 4] [--fps 60]
//                                                    film/out/betsee-launch.mp4 (+ mix.wav if present)
// FFMPEG names an ffmpeg with libx264 when the system one has none (Fedora ships it without).
import { createServer } from "node:http";
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(join(root, "web/package.json"));
const { chromium } = require("@playwright/test");
const out = join(root, "film/out");
mkdirSync(out, { recursive: true });

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const timeline = JSON.parse(readFileSync(join(root, "film/stage/timeline.json"), "utf8"));
const fps = Number(opt("fps", timeline.fps));
const from = Number(opt("from", 0));
const to = Number(opt("to", timeline.duration));
const workers = Number(opt("workers", 4));
const stills = opt("stills", null);
const FF = process.env.FFMPEG ?? "ffmpeg";

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".woff2": "font/woff2", ".tsx": "text/plain", ".cedar": "text/plain", ".svg": "image/svg+xml" };
const server = createServer((req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname)).replace(/^(\.\.[/\\])+/, "");
  const file = join(root, path);
  if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
  createReadStream(file).pipe(res);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}/film/stage/index.html`;

const browser = await chromium.launch({ args: ["--force-color-profile=srgb", "--disable-lcd-text", "--font-render-hinting=none"] });
async function openStage() {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on("pageerror", (e) => console.error("pageerror", e.message));
  page.on("console", (m) => m.type() === "error" && console.error("console", m.text()));
  await page.goto(`${base}?t=0`);
  await page.waitForFunction(() => window.filmReady === true, null, { timeout: 120_000 });
  return page;
}

// Chromium reuses raster tiles between screenshots; right after a transform change, text from one edge
// of a wide moving layer could reappear at the other (the Gateway track). Two animation frames let
// paint and raster settle, and the frame then matches a fresh page pixel for pixel.
const settle = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

async function exportCues(page) {
  const cues = await page.evaluate(() => window.filmCues);
  writeFileSync(join(out, "cues.json"), JSON.stringify(cues, null, 1));
  return cues.length;
}

if (args.includes("--cues")) {
  const page = await openStage();
  console.log(`${await exportCues(page)} cues`);
  await browser.close();
  server.close();
  process.exit(0);
}

if (stills) {
  const dir = join(out, "stills");
  mkdirSync(dir, { recursive: true });
  const page = await openStage();
  await exportCues(page);
  for (const t of stills.split(",").map(Number)) {
    await page.evaluate((v) => window.renderAt(v), t);
    await settle(page);
    const file = join(dir, `t${t.toFixed(2).padStart(6, "0")}.png`);
    await page.screenshot({ path: file });
    console.log(file);
  }
  await browser.close();
  server.close();
  process.exit(0);
}

const first = Math.round(from * fps);
const last = Math.round(to * fps);
const total = last - first;
const chunk = Math.ceil(total / workers);
const parts = [];
let done = 0;
const started = Date.now();

async function renderPart(index, a, b) {
  const file = join(out, `part-${index}.mp4`);
  const ffmpeg = spawn(FF, ["-v", "error", "-y", "-f", "image2pipe", "-framerate", String(fps), "-c:v", "mjpeg", "-i", "-", "-c:v", "libx264", "-preset", "slow", "-crf", "16", "-pix_fmt", "yuv420p", "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", file], { stdio: ["pipe", "inherit", "inherit"] });
  const page = await openStage();
  for (let f = a; f < b; f++) {
    await page.evaluate((v) => window.renderAt(v), f / fps);
    await settle(page);
    const jpg = await page.screenshot({ type: "jpeg", quality: 97 });
    if (!ffmpeg.stdin.write(jpg)) await new Promise((r) => ffmpeg.stdin.once("drain", r));
    done++;
    if (done % 120 === 0) {
      const rate = done / ((Date.now() - started) / 1000);
      console.log(`${done}/${total} frames, ${rate.toFixed(1)} fps, ~${Math.round((total - done) / rate)} s left`);
    }
  }
  ffmpeg.stdin.end();
  await new Promise((r) => ffmpeg.on("close", r));
  await page.close();
  return file;
}

for (let i = 0; i < workers; i++) {
  const a = first + i * chunk;
  const b = Math.min(last, a + chunk);
  if (a < b) parts.push(renderPart(i, a, b));
}
const files = await Promise.all(parts);
await browser.close();
server.close();

const list = join(out, "parts.txt");
writeFileSync(list, files.map((f) => `file '${f}'`).join("\n"));
const video = join(out, "video.mp4");
await new Promise((r) => spawn(FF, ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, "-c", "copy", video], { stdio: "inherit" }).on("close", r));
files.forEach((f) => rmSync(f));
rmSync(list);

const mix = join(out, "mix.wav");
const final = join(out, "betsee-launch.mp4");
if (existsSync(mix) && from === 0) {
  await new Promise((r) =>
    spawn(FF, ["-v", "error", "-y", "-i", video, "-i", mix, "-c:v", "copy", "-c:a", "aac", "-b:a", "320k", "-shortest", "-movflags", "+faststart", final], { stdio: "inherit" }).on("close", r),
  );
  console.log(final);
} else console.log(video);
