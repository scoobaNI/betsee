// Records the product clips on the landing page from the real Betsee interfaces. Each clip is a
// scripted walk through one screen with a visible cursor, captured from the compositor at 2x and
// encoded to landing/media/<clip>.webm (VP9) with a <clip>.webp poster. No H.264 copy: Safari
// plays VP9 WebM since 16 (macOS) and 17.4 (iOS), and older browsers fall back to the poster.
//
// Needs the same dev servers as film/capture/capture.mjs, all from the repository's own code:
//   web: VITE_BETSEE_MOCK=1 npm run dev -w @betsee/director     (:5174, mock world)
//   web: npm run dev -w @betsee/desk                            (:1430, the Desk window UI)
// The Desk talks to a governing-service stub started below, which streams fixture events shaped
// like agent-host's (contracts/events.md, "Employee chat stream") with real pauses between them.
//
//   node landing/record/record.mjs [clip ...]       needs ffmpeg with libvpx-vp9
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(join(root, "web/package.json"));
const { chromium } = require("@playwright/test");
const media = join(root, "landing/media");
mkdirSync(media, { recursive: true });

const DIRECTOR = "http://localhost:5174";
const DESK = "http://localhost:1430";

// CSS px of every clip; frames are captured at twice this.
const W = 1440;
const H = 900;
// Encoded width: the 2880 px capture scaled down, which keeps the UI's 13 px text legible in the
// page's widest frame on a 2x display and each clip at about 1 to 2 MB.
const OUT_W = 2400;
const FPS = 30;

// A Tuesday morning, so clocks in the UI read like a working day whatever time the clip is made.
const MORNING = new Date("2026-10-06T10:12:00+02:00");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// These flags put headless shell on the GPU; on SwiftShader the screencast falls to about 23 fps.
// --force-device-scale-factor with viewport: null is what makes the screencast deliver 2x frames:
// an emulated deviceScaleFactor is captured at 1x.
const launch = () =>
  chromium.launch({
    args: [
      "--enable-gpu",
      "--use-gl=angle",
      "--use-angle=gl-egl",
      "--ignore-gpu-blocklist",
      "--enable-gpu-rasterization",
      "--force-device-scale-factor=2",
      `--window-size=${W},${H}`,
      "--hide-scrollbars",
    ],
  });

// A drawn cursor, since headless Chromium paints none. Follows real input events.
const cursorScript = () => {
  const install = () => {
    if (document.getElementById("__rec_cursor")) return;
    const style = document.createElement("style");
    style.textContent = `
      #__rec_cursor { position: fixed; left: 0; top: 0; z-index: 2147483647; pointer-events: none;
        width: 24px; height: 24px; transform: translate(-80px, -80px); will-change: transform;
        filter: drop-shadow(0 1px 2px rgba(0,0,0,.35)); }
      .__rec_ring { position: fixed; z-index: 2147483646; pointer-events: none; width: 34px; height: 34px;
        margin: -17px 0 0 -17px; border-radius: 50%; border: 2px solid rgba(58,174,63,.9);
        background: rgba(91,200,95,.18); animation: __rec_ring .5s ease-out forwards; }
      @keyframes __rec_ring { from { transform: scale(.3); opacity: 1 } to { transform: scale(1.25); opacity: 0 } }`;
    document.documentElement.appendChild(style);
    const cursor = document.createElement("div");
    cursor.id = "__rec_cursor";
    cursor.innerHTML =
      '<svg viewBox="0 0 24 24" width="24" height="24"><path d="M5 2.5v17.2l4.3-4.1 2.7 6.2 3.1-1.4-2.7-6.1h6.1z" fill="#0b0d0b" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.documentElement.appendChild(cursor);
    const at = window.__rec_at ?? { x: -80, y: -80 };
    cursor.style.transform = `translate(${at.x - 5}px, ${at.y - 2}px)`;
    addEventListener(
      "mousemove",
      (e) => {
        window.__rec_at = { x: e.clientX, y: e.clientY };
        cursor.style.transform = `translate(${e.clientX - 5}px, ${e.clientY - 2}px)`;
      },
      true,
    );
    addEventListener(
      "mousedown",
      (e) => {
        const ring = document.createElement("div");
        ring.className = "__rec_ring";
        ring.style.left = `${e.clientX}px`;
        ring.style.top = `${e.clientY}px`;
        document.documentElement.appendChild(ring);
        setTimeout(() => ring.remove(), 600);
      },
      true,
    );
  };
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", install);
  else install();
};

let lastPage = null;

async function newPage(browser, { mockWorld = false, quiet = false } = {}) {
  const context = await browser.newContext({ viewport: null, timezoneId: "Europe/Warsaw", locale: "en-GB" });
  await context.clock.install({ time: MORNING });
  await context.addInitScript(cursorScript);
  // The Director's live toasts stack over the cards a clip is pointing at.
  if (quiet)
    await context.addInitScript(() =>
      addEventListener("DOMContentLoaded", () => {
        const style = document.createElement("style");
        style.textContent = "div[aria-live=polite].fixed { display: none !important; }";
        document.head.appendChild(style);
      }),
    );
  if (mockWorld) {
    // Mock mode keeps its world in module scope; hand it to the page so a clip can launch the
    // scenarios the Director's command palette does (same rewrite as film/capture).
    await context.route(/localhost:5174\/src\/main\.tsx/, async (route) => {
      const response = await route.fetch();
      const body = (await response.text()).replace("world.start();", "world.start(); window.__world = world;");
      await route.fulfill({ response, body });
    });
  }
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log("  pageerror", e.message));
  page.on("console", (m) => m.type() === "error" && console.log("  console", m.text()));
  lastPage = page;
  page.__pos = { x: W * 0.62, y: H * 0.7 };
  return { context, page };
}

const goInApp = (page, path) =>
  page.evaluate((p) => {
    history.pushState({}, "", p);
    dispatchEvent(new PopStateEvent("popstate"));
  }, path);

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

/** Calls step(0..1, eased) about every frame for `ms`, paced by the clock, not by step count. */
async function tween(ms, step) {
  const t0 = Date.now();
  for (;;) {
    const k = Math.min(1, (Date.now() - t0) / ms);
    await step(ease(k));
    if (k >= 1) return;
    await sleep(12);
  }
}

async function glide(page, x, y, ms = 650) {
  const from = page.__pos;
  await tween(ms, (t) => page.mouse.move(from.x + (x - from.x) * t, from.y + (y - from.y) * t));
  page.__pos = { x, y };
}

/**
 * The centre of an element, wheel-scrolled into view first when it is outside the middle of the
 * viewport. Not scrollIntoViewIfNeeded: it jumps, and waits for the element to stop moving, which a
 * live org-chart card never does.
 */
async function centre(page, locator) {
  await locator.waitFor();
  let box = await locator.boundingBox();
  if (!box) throw new Error(`no box for ${locator}`);
  const mid = box.y + box.height / 2;
  if (mid < 90 || mid > H - 90) {
    await scroll(page, Math.round(mid - H * 0.5), 800);
    await sleep(250);
    box = await locator.boundingBox();
  }
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function hover(page, locator, ms) {
  const { x, y } = await centre(page, locator);
  await glide(page, x, y, ms);
}

async function click(page, locator, { ms = 650 } = {}) {
  const { x, y } = await centre(page, locator);
  await glide(page, x, y, ms);
  await sleep(140);
  await page.mouse.down();
  await sleep(90);
  await page.mouse.up();
}

/** Scrolls by `dy` CSS px with the wheel, eased, so the capture sees a smooth scroll. */
async function scroll(page, dy, ms = 900) {
  let done = 0;
  await tween(ms, async (t) => {
    const target = Math.round(dy * t);
    if (target !== done) await page.mouse.wheel(0, target - done);
    done = target;
  });
}

async function type(page, locator, text, delay = 28) {
  await locator.pressSequentially(text, { delay });
}

function ffmpeg(args) {
  const result = spawnSync("nice", ["-n", "10", "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`ffmpeg failed: ${args.at(-1)}`);
}

const still = (input, output) => ffmpeg(["-i", input, "-vf", `scale=${OUT_W}:-2:flags=lanczos`, "-c:v", "libwebp", "-quality", "86", output]);

class Recorder {
  constructor(page, name) {
    this.page = page;
    this.name = name;
    this.dir = mkdtempSync(join(tmpdir(), `betsee-rec-${name}-`));
    this.frames = [];
  }

  async start() {
    this.cdp = await this.page.context().newCDPSession(this.page);
    this.cdp.on("Page.screencastFrame", (frame) => {
      void this.cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => {});
      if (this.stopped) return;
      const file = join(this.dir, `f${String(this.frames.length).padStart(5, "0")}.jpg`);
      writeFileSync(file, Buffer.from(frame.data, "base64"));
      this.frames.push({ file, t: frame.metadata.timestamp });
    });
    await this.cdp.send("Page.startScreencast", { format: "jpeg", quality: 94, maxWidth: W * 2, maxHeight: H * 2, everyNthFrame: 1 });
    // A first frame even on a still page: nudge the drawn cursor.
    const { x, y } = this.page.__pos;
    await this.page.mouse.move(x + 1, y);
    await this.page.mouse.move(x, y);
    await sleep(120);
  }

  async stop(holdMs = 1200) {
    await sleep(holdMs);
    const end = Date.now() / 1000;
    this.stopped = true;
    await this.cdp.send("Page.stopScreencast").catch(() => {});
    if (this.frames.length < 2) throw new Error(`${this.name}: only ${this.frames.length} frames`);
    const lines = [];
    this.frames.forEach((frame, i) => {
      const next = this.frames[i + 1]?.t ?? Math.max(end, frame.t + 1 / FPS);
      lines.push(`file '${frame.file}'`, `duration ${Math.max(0.001, next - frame.t).toFixed(4)}`);
    });
    lines.push(`file '${this.frames.at(-1).file}'`);
    writeFileSync(join(this.dir, "frames.txt"), `${lines.join("\n")}\n`);
    const seconds = Math.max(end, this.frames.at(-1).t) - this.frames[0].t;
    console.log(`  ${this.name}: ${this.frames.length} frames over ${seconds.toFixed(1)} s`);
    return this;
  }

  encode({ poster = 0.5 } = {}) {
    const vf = `fps=${FPS},scale=${OUT_W}:-2:flags=lanczos,format=yuv420p`;
    const webm = join(media, `${this.name}.webm`);
    ffmpeg(["-f", "concat", "-safe", "0", "-i", join(this.dir, "frames.txt"), "-vf", vf, "-c:v", "libvpx-vp9", "-crf", "32", "-b:v", "0", "-row-mt", "1", "-tile-columns", "2", "-deadline", "good", "-cpu-used", "3", "-g", "240", "-an", webm]);
    const frame = this.frames[Math.min(this.frames.length - 1, Math.floor(this.frames.length * poster))];
    still(frame.file, join(media, `${this.name}.webp`));
    rmSync(this.dir, { recursive: true, force: true });
  }
}

function deskStub() {
  const chats = new Map();
  const streams = new Set();
  let script = [];
  let sent = 0;
  const START = Date.now();
  const now = () => new Date(MORNING.getTime() + (Date.now() - START)).toISOString();
  const chatRow = (chat) => ({
    chat_id: chat.id,
    title: chat.title,
    busy: chat.busy,
    created_at: chat.created,
    updated_at: chat.updated,
    events: chat.events.length,
    agent_id: "employee-assistant",
    use_case: { id: "employee-assistance", name: "Employee assistance" },
  });
  const history = (id, title, minutesAgo, count) => ({
    id,
    title,
    busy: false,
    created: new Date(MORNING.getTime() - minutesAgo * 60_000).toISOString(),
    updated: new Date(MORNING.getTime() - minutesAgo * 60_000 + 30_000).toISOString(),
    events: Array.from({ length: count }),
    listeners: new Set(),
  });
  const older = [
    history("chat-6a10", "Draft a short status update for my team from my workspace notes.", 95, 14),
    history("chat-5f02", "Compare the 2026 carrier rates with last year's contracts.", 60 * 26, 22),
    history("chat-4c88", "What files are in my workspace, and what is each one for?", 60 * 50, 9),
  ];
  const push = (chat, type, fields) => {
    const event = { id: chat.events.length + 1, type, at: now(), ...fields };
    chat.events.push(event);
    chat.updated = event.at;
    if (type === "run_started") chat.busy = true;
    if (type === "idle") chat.busy = false;
    for (const res of chat.listeners) res.write(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`);
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://stub");
    res.setHeader("access-control-allow-origin", "*");
    res.setHeader("access-control-allow-headers", req.headers["access-control-request-headers"] ?? "*");
    res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") return res.writeHead(204).end();
    let body = "";
    for await (const chunk of req) body += chunk;
    const input = body ? JSON.parse(body) : {};
    const json = (value, status = 200) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(value));

    if (url.pathname === "/desk/state")
      return json({
        signed_in: true,
        human: { sub: "maya", display_name: "Maya Chen" },
        runtime: "claude",
        runtimes: [
          { runtime: "claude", label: "Claude Code", installed: true, path: "/usr/local/bin/claude", version: "2.4.1 (Claude Code)", logged_in: true, auth: "subscription", detail: "Signed in with your Claude account", selected: true },
          { runtime: "codex", label: "Codex", installed: true, path: "/usr/local/bin/codex", version: "codex-cli 0.58.0", logged_in: true, auth: "chatgpt", detail: "Signed in with ChatGPT", selected: false },
        ],
        workspace: "~/.local/share/betsee-desk/workspace",
        gateway: "http://api.betsee.localhost",
      });
    if (url.pathname === "/desk/files")
      return json({
        items: [
          { path: "uploads/carrier-rates-2026.pdf", size: 48213, modified: 0 },
          { path: "finance/q4-budget.csv", size: 2210, modified: 0 },
          { path: "handbook/expense-policy.md", size: 3412, modified: 0 },
          { path: "handbook/onboarding.md", size: 2904, modified: 0 },
          { path: "hr/salaries-2026.csv", size: 1890, modified: 0 },
          { path: "notes/team-sync.md", size: 1204, modified: 0 },
        ],
      });
    if (url.pathname === "/api/v1/chat/sessions" && req.method === "POST") {
      const chat = { id: `chat-${(0x7d21 + chats.size).toString(16)}`, title: null, busy: false, created: now(), updated: now(), events: [], listeners: new Set() };
      chats.set(chat.id, chat);
      return json(chatRow(chat));
    }
    if (url.pathname === "/api/v1/chat/sessions")
      return json({ items: [...[...chats.values()].reverse(), ...older].map(chatRow) });
    if (url.pathname === "/api/v1/chat/messages") {
      const chat = chats.get(input.chat_id);
      const step = script[sent++];
      if (!chat || !step) return json({ error: "unexpected", message: "No scripted reply" }, 400);
      const messageId = `m${sent}`;
      chat.title ??= input.text.slice(0, 80);
      if (step.blocked) {
        push(chat, "input_blocked", { message_id: messageId, ...step.blocked });
        return json({ status: "blocked", message_id: messageId, ...step.blocked });
      }
      push(chat, "user_message", { message_id: messageId, text: input.text, trace_id: step.trace });
      json({ status: "accepted", message_id: messageId, trace_id: step.trace });
      for (const [delay, type, fields] of step.events) {
        await sleep(delay);
        push(chat, type, fields);
      }
      return;
    }
    const stream = url.pathname.match(/^\/api\/v1\/chat\/stream\/(.+)$/);
    if (stream) {
      const chat = chats.get(decodeURIComponent(stream[1]));
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
      const after = Number(req.headers["last-event-id"] ?? 0);
      for (const event of chat?.events ?? []) if (event.id > after) res.write(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`);
      const ping = setInterval(() => res.write(": ping\n\n"), 5000);
      chat?.listeners.add(res);
      streams.add(res);
      // The response's close, not the request's: a request emits close once its body is read.
      res.on("close", () => {
        clearInterval(ping);
        chat?.listeners.delete(res);
        streams.delete(res);
      });
      return;
    }
    return json({});
  });
  return {
    listen: () => new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`))),
    play: (steps) => {
      script = steps;
      sent = 0;
      chats.clear();
    },
    close: () => {
      for (const res of streams) res.end();
      server.closeAllConnections();
      server.close();
    },
  };
}

const trace = (n) => `${n}4bf92f35a1c0d7e2b96f0e3a7c1d5b8`.slice(0, 32);

const clips = {};

// Hero: the Director's control room, then one denied request followed down to its rule.
clips.director = async (browser) => {
  const { page } = await newPage(browser, { mockWorld: true, quiet: true });
  await page.goto(`${DIRECTOR}/`, { waitUntil: "networkidle" });
  await sleep(2500);
  const rec = new Recorder(page, "director");
  await rec.start();
  await sleep(700);
  await page.evaluate(() => window.__world.launch("act4-agents-talking"));
  await hover(page, page.getByText("Actions, last 15 min"), 900);
  await sleep(500);
  await hover(page, page.getByText("Denied, last 15 min"), 600);
  await page.evaluate(() => window.__world.launch("act2-deterministic-boundaries"));
  await sleep(900);
  await hover(page, page.getByText("wants to run").first(), 700);
  await sleep(700);
  await click(page, page.locator('nav a[href="/activity"] >> visible=true').first());
  await sleep(1800);
  await click(page, page.getByText("Denied", { exact: true }).first());
  await sleep(1200);
  const row = page.locator("a[href^='/traces/']", { hasText: "compensation-2026" }).first();
  await click(page, (await row.count()) ? row : page.locator("a[href^='/traces/']").first());
  await sleep(2200);
  await glide(page, W * 0.55, H * 0.55, 500);
  await scroll(page, 520, 1100);
  await sleep(1400);
  await scroll(page, 430, 1000);
  await sleep(1600);
  (await rec.stop(1200)).encode({ poster: 0.06 });
  await page.context().close();
};

// Desk: Maya asks, every tool call is decided, a write waits for an approver.
clips.desk = async (browser, stub, stubUrl) => {
  stub.play([
    {
      trace: trace("1"),
      events: [
        [500, "run_started", { model: "claude-sonnet-5-5" }],
        [900, "assistant_text", { text: "I'll read the Q4 budget from your workspace first." }],
        [700, "tool_call", { tool_use_id: "t1", tool: "Read", input: { file_path: "workspace/finance/q4-budget.csv" } }],
        [350, "decision", {
          tool_use_id: "t1", tool: "Read", capability: "files.read",
          resource: { id: "workspace/finance/q4-budget.csv", type: "file", tier: "internal" },
          decision: "allow",
          reasons: ["files.read is delegated in this session and the file is internal, within the session ceiling."],
          control_ids: ["CTL-RT-001", "CTL-CAP-001"], trace_id: trace("2"),
        }],
        [500, "tool_result", { tool_use_id: "t1", content: "line,owner,amount_eur\ncarrier-contracts,ops,48000.00\n..." }],
        [1100, "assistant_text", { text: "**Q4 budget**: 14 lines, 3 of them above 10,000 EUR:\n- Carrier contracts, `48,000.00 EUR`\n- Warehouse lease, `22,500.00 EUR`\n- Fleet telematics, `12,800.00 EUR`" }],
        [300, "idle", {}],
      ],
    },
    {
      trace: trace("3"),
      events: [
        [500, "run_started", { model: "claude-sonnet-5-5" }],
        [900, "tool_call", { tool_use_id: "t2", tool: "Write", input: { file_path: "workspace/finance/payment-run-oct.csv", content: "payee,amount_eur\n..." } }],
        [350, "decision", {
          tool_use_id: "t2", tool: "Write", capability: "files.write",
          resource: { id: "workspace/finance/payment-run-oct.csv", type: "file", tier: "internal" },
          decision: "require_approval", approval_state: "pending", waiting_seconds: 300,
          reasons: ["approval is required for files.write in Employee assistance"],
          control_ids: ["CTL-RT-001", "CTL-APR-001"], trace_id: trace("4"),
        }],
        [3400, "decision", {
          tool_use_id: "t2", tool: "Write", capability: "files.write",
          resource: { id: "workspace/finance/payment-run-oct.csv", type: "file", tier: "internal" },
          decision: "allow", approval_state: "approved",
          reasons: ["Approved by Daniel Ortiz with a fresh one-time code (acr 2). The same policy now allows it."],
          control_ids: ["CTL-RT-001", "CTL-APR-001"], trace_id: trace("4"),
        }],
        [500, "tool_result", { tool_use_id: "t2", content: "Wrote 3 lines." }],
        [700, "assistant_text", { text: "Done. `finance/payment-run-oct.csv` holds the three payments for review." }],
        [300, "idle", {}],
      ],
    },
  ]);
  const { page } = await newPage(browser);
  // The chat stream stays open, so the page never goes network-idle.
  await page.goto(`${DESK}/?api=${encodeURIComponent(stubUrl)}&token=landing`);
  const box = page.getByRole("textbox", { name: "Message the employee assistant" });
  await box.waitFor();
  await sleep(1800);
  const rec = new Recorder(page, "desk");
  await rec.start();
  await sleep(500);
  await click(page, box, { ms: 800 });
  await type(page, box, "Summarise the Q4 budget in finance/ and flag every line above 10,000 EUR.");
  await sleep(300);
  await page.keyboard.press("Enter");
  await sleep(5600);
  await click(page, box, { ms: 700 });
  await type(page, box, "Write the payment run for those three lines to finance/payment-run-oct.csv.");
  await sleep(300);
  await page.keyboard.press("Enter");
  await sleep(2200);
  await hover(page, page.getByText("Awaiting approval").last(), 700);
  await sleep(2600);
  await glide(page, W * 0.6, H * 0.82, 600);
  (await rec.stop(1800)).encode({ poster: 0.62 });
  await page.context().close();
};

// Desk: what never reaches the model, and what the Gateway refuses the model.
clips.guard = async (browser, stub, stubUrl) => {
  stub.play([
    {
      blocked: {
        reasons: ["the message contains an IBAN"],
        control_ids: ["CTL-IN-001"],
        trace_id: trace("8"),
        findings: [{ class: "iban", label: "IBAN", masked: "DE89 **** **** **** **30 00" }],
      },
    },
    {
      trace: trace("5"),
      events: [
        [500, "run_started", { model: "claude-sonnet-5-5" }],
        [800, "tool_call", { tool_use_id: "t1", tool: "Read", input: { file_path: "workspace/hr/salaries-2026.csv" } }],
        [350, "decision", {
          tool_use_id: "t1", tool: "Read", capability: "files.read",
          resource: { id: "workspace/hr/salaries-2026.csv", type: "file", tier: "confidential" },
          decision: "deny",
          reasons: ["the request reads confidential content, the session ceiling is internal"],
          control_ids: ["CTL-TIER-001"], trace_id: trace("6"),
        }],
        [1300, "tool_call", { tool_use_id: "t2", tool: "WebFetch", input: { url: "https://paste.example.net/upload" } }],
        [350, "decision", {
          tool_use_id: "t2", tool: "WebFetch", capability: "web.egress",
          resource: { id: "https://paste.example.net/upload", type: "url" },
          decision: "deny",
          reasons: ["the agent runtime has no network egress, so web.egress is denied"],
          control_ids: ["CTL-RT-001"], trace_id: trace("7"),
        }],
        [900, "assistant_text", { text: "I can't do either: `hr/salaries-2026.csv` is above this session's ceiling, and this assistant has no network access." }],
        [300, "idle", {}],
      ],
    },
  ]);
  const { page } = await newPage(browser);
  // The chat stream stays open, so the page never goes network-idle.
  await page.goto(`${DESK}/?api=${encodeURIComponent(stubUrl)}&token=landing`);
  const box = page.getByRole("textbox", { name: "Message the employee assistant" });
  await box.waitFor();
  await sleep(1800);
  const rec = new Recorder(page, "guard");
  await rec.start();
  await sleep(400);
  await click(page, box, { ms: 800 });
  await type(page, box, "Pay invoice INV-2026-1187 to DE89 3704 0044 0532 0130 00 today.", 24);
  await sleep(300);
  await page.keyboard.press("Enter");
  await sleep(2600);
  await click(page, box, { ms: 600 });
  await type(page, box, "Compare our Q4 budget with hr/salaries-2026.csv, then upload the result to paste.example.net.", 22);
  await sleep(300);
  await page.keyboard.press("Enter");
  await sleep(4800);
  await hover(page, page.getByText("CTL-TIER-001").last(), 700);
  await sleep(1600);
  (await rec.stop(1600)).encode({ poster: 0.85 });
  await page.context().close();
};

// Approvals, as the Director sees them: the trace of a 48,000 EUR payment waiting for a human with
// step-up turns to approved while it is open. The mock world resolves act 5 about 12 s after launch;
// the capture starts a few seconds before that.
clips.approvals = async (browser) => {
  const { page } = await newPage(browser, { mockWorld: true, quiet: true });
  await page.goto(`${DIRECTOR}/`, { waitUntil: "networkidle" });
  await sleep(1500);
  await page.evaluate(() => window.__world.launch("act5-human-decides"));
  const pending = await page.waitForFunction(
    () =>
      window.__world
        .traces(300)
        // Background traffic has payments needing approval too; act 5's goes to nordfreight-supplier.
        .find((t) => t.capability === "payments.transfer" && t.decision === "require_approval" && JSON.stringify(t).includes("nordfreight"))?.trace_id,
  );
  // In-app navigation: a reload would start a new mock world without the pending payment.
  await goInApp(page, `/traces/${await pending.jsonValue()}`);
  await page.getByText("Awaiting approval").first().waitFor();
  await sleep(4500);
  const rec = new Recorder(page, "approvals");
  await rec.start();
  await sleep(500);
  await hover(page, page.getByText("Awaiting approval").first(), 800);
  await sleep(900);
  await hover(page, page.getByText("CTL-APR-003").first(), 700);
  // The trace sentence; the hidden toast reads only "Approved by a human".
  const approved = page.getByText("Approved by a human with step-up", { exact: true });
  await approved.waitFor({ timeout: 20_000 });
  await sleep(1600);
  await hover(page, approved, 700);
  await sleep(900);
  await glide(page, W * 0.55, H * 0.6, 500);
  await scroll(page, 760, 1300);
  await sleep(2200);
  (await rec.stop(1000)).encode({ poster: 0.6 });
  await page.context().close();
};

// Policies and controls, as the Director shows them: what each use case permits and what needs a
// human, then every named control with the Cedar policies that decide under it.
clips.policy = async (browser) => {
  const { page } = await newPage(browser, { mockWorld: true, quiet: true });
  await page.goto(`${DIRECTOR}/configuration`, { waitUntil: "networkidle" });
  await sleep(2000);
  const rec = new Recorder(page, "policy");
  await rec.start();
  await sleep(500);
  await hover(page, page.getByText("Invoice processing").first(), 800);
  await sleep(600);
  await hover(page, page.getByText("Step-up", { exact: true }).first(), 700);
  await sleep(1000);
  await click(page, page.getByText("Policies", { exact: true }).first(), { ms: 800 });
  await sleep(1500);
  await hover(page, page.getByText("Payment threshold").first(), 800);
  await sleep(1000);
  await hover(page, page.getByText("AI analysis only tightens").first(), 700);
  await sleep(800);
  await glide(page, W * 0.55, H * 0.6, 400);
  await scroll(page, 520, 1100);
  await sleep(1600);
  (await rec.stop(1000)).encode({ poster: 0.6 });
  await page.context().close();
};

// Org chart: every agent is a principal, sitting under the person who runs it.
clips.agents = async (browser) => {
  const { page } = await newPage(browser, { mockWorld: true, quiet: true });
  await page.goto(`${DIRECTOR}/agents`, { waitUntil: "networkidle" });
  await sleep(2500);
  const rec = new Recorder(page, "agents");
  await rec.start();
  await sleep(600);
  await hover(page, page.getByText("Finance Operations Lead").first(), 900);
  await sleep(600);
  await click(page, page.getByText("invoice-assistant").first(), { ms: 800 });
  await sleep(2000);
  await glide(page, W * 0.55, H * 0.6, 500);
  await scroll(page, 420, 1000);
  await sleep(1200);
  const derived = page.getByText("How this was derived").first();
  if (await derived.count()) await click(page, derived, { ms: 700 });
  await sleep(1400);
  await scroll(page, 360, 900);
  await sleep(1800);
  (await rec.stop(1000)).encode({ poster: 0.15 });
  await page.context().close();
};

// Stills of the Director screens the page shows without motion.
clips.stills = async (browser) => {
  const { page } = await newPage(browser, { mockWorld: true, quiet: true });
  await page.goto(`${DIRECTOR}/`, { waitUntil: "networkidle" });
  await sleep(1500);
  for (const act of ["act2-deterministic-boundaries", "act3-hijacked-goal", "act4-agents-talking", "act6-supply-chain-and-rogue"])
    await page.evaluate((id) => window.__world.launch(id), act);
  await sleep(6000);
  await page.mouse.move(-50, -50);
  const dir = mkdtempSync(join(tmpdir(), "betsee-stills-"));
  for (const [path, name] of [
    ["/graph", "still-graph"],
    ["/determinism", "still-determinism"],
    ["/coverage", "still-coverage"],
  ]) {
    await page.locator(`nav a[href="${path}"] >> visible=true`).first().click();
    await sleep(2500);
    const png = join(dir, `${name}.png`);
    await page.screenshot({ path: png });
    still(png, join(media, `${name}.webp`));
    console.log(`  ${name}`);
  }
  rmSync(dir, { recursive: true, force: true });
  await page.context().close();
};

const wanted = process.argv.slice(2);
const names = wanted.length ? wanted : Object.keys(clips);
const unknown = names.filter((n) => !clips[n]);
if (unknown.length) throw new Error(`unknown clip(s): ${unknown.join(", ")}; known: ${Object.keys(clips).join(", ")}`);

const stub = deskStub();
const stubUrl = await stub.listen();
const browser = await launch();
try {
  for (const name of names) {
    console.log(name);
    await clips[name](browser, stub, stubUrl);
  }
} catch (error) {
  const shot = join(tmpdir(), "betsee-record-failure.png");
  await lastPage?.screenshot({ path: shot }).catch(() => {});
  console.log(`  failure screenshot: ${shot}`);
  throw error;
} finally {
  await browser.close();
  stub.close();
}
