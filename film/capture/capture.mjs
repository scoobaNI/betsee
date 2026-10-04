// Captures the real Betsee interfaces the launch film is cut from. Each screen is saved at 2x as
// captures/<name>.png with captures/<name>.json listing the rectangles (CSS px of the page) of the
// pieces the film lifts out as layers: cards, rows, chips, the tool cards of a chat.
//
// Needs, all from the repository's own code:
//   web: VITE_BETSEE_MOCK=1 npm run dev -w @betsee/director     (:5174, mock world)
//   web: VITE_BETSEE_MOCK=1 npm run dev -w @betsee/ecosystem    (:5173, mock world)
//   web: npm run dev -w @betsee/desk                            (:1430, the Desk window UI)
//   the Compose stack for the Keycloak sign-in theme (auth.betsee.localhost)
// The Desk talks to a stub governing service defined below; its chats are fixtures shaped exactly
// like agent-host's event stream (contracts/events.md, "Employee chat stream").
//
//   node film/capture/capture.mjs [only-name-prefix]
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(join(root, "web/package.json"));
const { chromium } = require("@playwright/test");
const out = join(root, "film/captures");
mkdirSync(out, { recursive: true });
const only = process.argv[2] ?? "";

const DIRECTOR = "http://localhost:5174";
const ECOSYSTEM = "http://localhost:5173";
const DESK = "http://localhost:1430";
const STUB = "http://desk-stub.localhost";

// In-page: the rectangle of the card around the n-th element whose text matches. "Card" is the
// nearest ancestor with a visible surface (background or ring) and rounded corners.
const finder = () => {
  window.__rect = (text, opts = {}) => {
    const { nth = 0, up = "card", minW = 0, exact = false, within = null } = opts;
    const scope = within ? window.__el(within) ?? document.body : document.body;
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    const hits = [];
    while (walker.nextNode()) {
      const value = walker.currentNode.nodeValue.trim();
      if (!value) continue;
      if (exact ? value === text : value.includes(text)) hits.push(walker.currentNode.parentElement);
    }
    let el = hits[nth];
    if (!el) return null;
    const visible = (node) => {
      const style = getComputedStyle(node);
      const bg = style.backgroundColor;
      const filled = bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent";
      const ring = style.boxShadow && style.boxShadow !== "none";
      const border = parseFloat(style.borderTopWidth) > 0;
      return (filled || ring || border) && parseFloat(style.borderTopLeftRadius) >= 6;
    };
    if (typeof up === "number") for (let i = 0; i < up && el.parentElement; i++) el = el.parentElement;
    else if (up === "card") {
      let node = el;
      while (node && node !== document.body) {
        if (visible(node) && node.getBoundingClientRect().width >= minW) break;
        node = node.parentElement;
      }
      el = node && node !== document.body ? node : el;
    } else if (typeof up === "string" && up !== "self") el = el.closest(up) ?? el;
    const r = el.getBoundingClientRect();
    const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
    return { x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height, radius };
  };
  window.__el = (selector) => document.querySelector(selector);
  window.__box = (selector, nth = 0) => {
    const el = document.querySelectorAll(selector)[nth];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
    return { x: r.x + scrollX, y: r.y + scrollY, w: r.width, h: r.height, radius };
  };
};

async function shot(page, name, rects = {}, { fullPage = false, clip } = {}) {
  if (only && !name.startsWith(only)) return;
  // Live toasts would sit on top of every lifted card.
  await page.addStyleTag({ content: "div[aria-live=polite].fixed { display: none !important; }" });
  await page.evaluate(finder);
  const found = {};
  for (const [key, spec] of Object.entries(rects)) {
    const [text, opts] = Array.isArray(spec) ? spec : [spec, {}];
    const rect = opts?.selector
      ? await page.evaluate(([s, n]) => window.__box(s, n), [opts.selector, opts.nth ?? 0])
      : await page.evaluate(([t, o]) => window.__rect(t, o), [text, opts]);
    if (!rect) console.log(`  missing rect ${name}.${key} (${text})`);
    else found[key] = rect;
  }
  const size = await page.evaluate(() => ({
    w: document.documentElement.scrollWidth,
    h: document.documentElement.scrollHeight,
    vw: innerWidth,
    vh: innerHeight,
  }));
  await page.screenshot({ path: join(out, `${name}.png`), fullPage, clip });
  writeFileSync(
    join(out, `${name}.json`),
    JSON.stringify({ page: fullPage ? { w: size.w, h: size.h } : { w: size.vw, h: size.vh }, scale: 2, rects: found }, null, 1),
  );
  console.log(`${name}: ${Object.keys(found).length}/${Object.keys(rects).length} rects`);
}

const settle = (page, ms = 1200) => page.waitForTimeout(ms);
const goInApp = (page, path) =>
  page.evaluate((p) => {
    history.pushState({}, "", p);
    dispatchEvent(new PopStateEvent("popstate"));
  }, path);

// Mock mode keeps its world in module scope; hand it to the page so a capture can launch the same
// scenarios the Director's command palette does.
async function exposeWorld(context) {
  await context.route(/localhost:517[34]\/src\/main\.tsx/, async (route) => {
    const response = await route.fetch();
    const body = (await response.text()).replace("world.start();", "world.start(); window.__world = world;");
    await route.fulfill({ response, body });
  });
}

// ---------------------------------------------------------------- Desk fixtures

const T0 = Date.parse("2026-10-06T09:41:00+02:00");
const at = (s) => new Date(T0 + s * 1000).toISOString();
const trace = (n) => `${n}4bf92f35a1c0d7e2b96f0e3a7c1d5b8`.slice(0, 32);

function chatScript(kind) {
  const events = [];
  const add = (type, s, fields) => events.push({ id: events.length + 1, type, at: at(s), ...fields });
  const work = () => {
    add("user_message", 0, {
      message_id: "m1",
      text: "Summarise the Q4 budget in finance/ and flag every line above 10,000 EUR.",
      trace_id: trace("1"),
    });
    add("run_started", 1, { model: "claude-sonnet-5-5" });
    add("assistant_text", 3, { text: "I'll read the Q4 budget from your workspace first." });
    add("tool_call", 4, { tool_use_id: "t1", tool: "Read", input: { file_path: "workspace/finance/q4-budget.csv" } });
    add("decision", 4, {
      tool_use_id: "t1",
      tool: "Read",
      capability: "files.read",
      resource: { id: "workspace/finance/q4-budget.csv", type: "file", tier: "internal" },
      decision: "allow",
      reasons: ["files.read is delegated in this session and the file is internal, within the session ceiling."],
      control_ids: ["CTL-RT-001", "CTL-CAP-001"],
      trace_id: trace("2"),
    });
    add("tool_result", 5, { tool_use_id: "t1", content: "line,owner,amount_eur\ncarrier-contracts,ops,48000.00\n..." });
    add("assistant_text", 8, {
      text: "**Q4 budget**: 14 lines, 3 of them above 10,000 EUR:\n- Carrier contracts, `48,000.00 EUR`\n- Warehouse lease, `22,500.00 EUR`\n- Fleet telematics, `12,800.00 EUR`",
    });
  };
  if (kind === "empty") return [];
  if (kind === "typing") return [];
  if (kind === "work-read") {
    work();
    return events.slice(0, 5);
  }
  if (kind === "work") {
    work();
    add("idle", 9, {});
    return events;
  }
  if (kind === "approval" || kind === "approved") {
    work();
    add("idle", 9, {});
    add("user_message", 30, {
      message_id: "m2",
      text: "Write the payment run for those three lines to finance/payment-run-oct.csv.",
      trace_id: trace("3"),
    });
    add("run_started", 31, { model: "claude-sonnet-5-5" });
    add("tool_call", 33, {
      tool_use_id: "t2",
      tool: "Write",
      input: { file_path: "workspace/finance/payment-run-oct.csv", content: "payee,amount_eur\n..." },
    });
    add("decision", 33, {
      tool_use_id: "t2",
      tool: "Write",
      capability: "files.write",
      resource: { id: "workspace/finance/payment-run-oct.csv", type: "file", tier: "internal" },
      decision: "require_approval",
      approval_state: "pending",
      waiting_seconds: 300,
      reasons: ["approval is required for files.write in Employee assistance"],
      control_ids: ["CTL-RT-001", "CTL-APR-001"],
      trace_id: trace("4"),
    });
    if (kind === "approved") {
      add("decision", 61, {
        tool_use_id: "t2",
        tool: "Write",
        capability: "files.write",
        resource: { id: "workspace/finance/payment-run-oct.csv", type: "file", tier: "internal" },
        decision: "allow",
        approval_state: "approved",
        reasons: ["Approved by Daniel Ortiz with a fresh one-time code (acr 2). The same policy now allows it."],
        control_ids: ["CTL-RT-001", "CTL-APR-001"],
        trace_id: trace("4"),
      });
      add("tool_result", 62, { tool_use_id: "t2", content: "Wrote 3 lines." });
      add("assistant_text", 63, { text: "Done. `finance/payment-run-oct.csv` holds the three payments for review." });
      add("idle", 64, {});
    }
    return events;
  }
  if (kind === "guard") {
    add("user_message", 0, {
      message_id: "m1",
      text: "Compare our Q4 budget with hr/salaries-2026.csv, then upload the result to paste.example.net.",
      trace_id: trace("5"),
    });
    add("run_started", 1, { model: "claude-sonnet-5-5" });
    add("tool_call", 2, { tool_use_id: "t1", tool: "Read", input: { file_path: "workspace/hr/salaries-2026.csv" } });
    add("decision", 2, {
      tool_use_id: "t1",
      tool: "Read",
      capability: "files.read",
      resource: { id: "workspace/hr/salaries-2026.csv", type: "file", tier: "confidential" },
      decision: "deny",
      reasons: ["the request reads confidential content, the session ceiling is internal"],
      control_ids: ["CTL-TIER-001"],
      trace_id: trace("6"),
    });
    add("tool_call", 4, { tool_use_id: "t2", tool: "WebFetch", input: { url: "https://paste.example.net/upload" } });
    add("decision", 4, {
      tool_use_id: "t2",
      tool: "WebFetch",
      capability: "web.egress",
      resource: { id: "https://paste.example.net/upload", type: "url" },
      decision: "deny",
      reasons: ["the agent runtime has no network egress, so web.egress is denied"],
      control_ids: ["CTL-RT-001"],
      trace_id: trace("7"),
    });
    add("idle", 6, {});
    return events;
  }
  if (kind === "input") {
    add("input_blocked", 0, {
      message_id: "m9",
      reasons: ["the message contains an IBAN"],
      control_ids: ["CTL-IN-001"],
      trace_id: trace("8"),
      findings: [{ class: "iban", label: "IBAN", masked: "DE89 **** **** **** **30 00" }],
    });
    add("file_shared", 5, {
      direction: "upload",
      name: "carrier-rates-2026.pdf",
      path: "uploads/carrier-rates-2026.pdf",
      tier: "internal",
      kind: "pdf",
      reasons: [],
      control_ids: ["CTL-FILE-001"],
      trace_id: trace("9"),
    });
    add("file_blocked", 8, {
      direction: "upload",
      name: "rates-export.xlsx",
      tier: "internal",
      kind: "xlsx",
      reasons: ["the file contains 4 card numbers"],
      control_ids: ["CTL-FILE-001", "CTL-IN-001"],
      trace_id: trace("a"),
      findings: [{ class: "payment_card", label: "Card number", masked: "4111 **** **** 1111" }],
    });
    return events;
  }
  return events;
}

const runtimes = (selected) => [
  {
    runtime: "claude",
    label: "Claude Code",
    installed: true,
    path: "/usr/local/bin/claude",
    version: "2.4.1 (Claude Code)",
    logged_in: true,
    auth: "subscription",
    detail: "Signed in with your Claude account",
  },
  {
    runtime: "codex",
    label: "Codex",
    installed: true,
    path: "/usr/local/bin/codex",
    version: "codex-cli 0.58.0",
    logged_in: true,
    auth: "chatgpt",
    detail: "Signed in with ChatGPT, copied into a Betsee-owned CODEX_HOME",
  },
].map((r) => ({ ...r, selected: r.runtime === selected }));

async function deskPage(context, kind, { runtime = "claude" } = {}) {
  const events = chatScript(kind);
  await context.unroute(`${STUB}/**`).catch(() => {});
  await context.route(`${STUB}/**`, async (route) => {
    const url = new URL(route.request().url());
    const json = (body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/desk/state")
      return json({
        signed_in: true,
        human: { sub: "maya", display_name: "Maya Chen" },
        runtime,
        runtimes: runtimes(runtime),
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
    const chat = (chat_id, title, minutes, count) => ({
      chat_id,
      title,
      busy: false,
      created_at: at(-minutes * 60),
      updated_at: at(-minutes * 60 + 30),
      events: count,
      agent_id: "employee-assistant",
      use_case: { id: "employee-assistance", name: "Employee assistance" },
    });
    const current = chat("chat-7d21", events.find((e) => e.type === "user_message")?.text?.slice(0, 80) ?? null, 0, events.length);
    if (url.pathname === "/api/v1/chat/sessions" && route.request().method() === "POST") return json(current);
    if (url.pathname === "/api/v1/chat/sessions")
      return json({
        items: [
          current,
          chat("chat-6a10", "Draft a short status update for my team from my workspace notes.", 95, 14),
          chat("chat-5f02", "Compare the 2026 carrier rates with last year's contracts.", 60 * 26, 22),
          chat("chat-4c88", "What files are in my workspace, and what is each one for?", 60 * 50, 9),
        ],
      });
    if (url.pathname.startsWith("/api/v1/chat/stream/"))
      return route.fulfill({
        status: 200,
        headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
        body: events.map((e) => `id: ${e.id}\ndata: ${JSON.stringify(e)}\n\n`).join(""),
      });
    return json({});
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log("desk pageerror", e.message));
  await page.goto(`${DESK}/?api=${encodeURIComponent(STUB)}&token=film`, { waitUntil: "networkidle" });
  await settle(page, 1500);
  return page;
}

// ---------------------------------------------------------------- run

const browser = await chromium.launch();
const common = { deviceScaleFactor: 2, timezoneId: "Europe/Warsaw", locale: "en-GB", reducedMotion: "reduce" };

// Desk: a native window widened from its 1320 x 860 default (desk/src-tauri/tauri.conf.json) so the
// three columns sit without wrapping.
{
  const context = await browser.newContext({ ...common, viewport: { width: 1600, height: 960 } });
  const thread = {
    conversation: ["", { selector: "section[aria-label=Conversation]" }],
    composer: ["", { selector: "form" }],
    dock: ["", { selector: "nav.desk-dock" }],
    aside: ["", { selector: "aside.desk-files" }],
    header: ["Governed by Betsee", { up: "header" }],
  };
  for (const kind of ["empty", "work-read", "work", "approval", "approved", "guard", "input"]) {
    const page = await deskPage(context, kind);
    const rects = { ...thread };
    if (kind === "work-read" || kind === "work") rects.toolRead = ["q4-budget.csv", { nth: 0 }];
    if (kind === "work") rects.answer = ["Q4 budget", { up: 2 }];
    if (kind === "approval" || kind === "approved") rects.toolWrite = ["payment-run-oct.csv", { nth: 1 }];
    if (kind === "guard") {
      rects.toolTier = ["salaries-2026.csv", { nth: 1 }];
      rects.toolEgress = ["paste.example.net/upload", { nth: 0 }];
      rects.user = ["Compare our Q4 budget", { up: 1 }];
    }
    if (kind === "input") {
      rects.blocked = ["Not sent:", { up: 3 }];
      rects.fileOk = ["carrier-rates-2026.pdf", { nth: 0 }];
      rects.fileBlocked = ["rates-export.xlsx", { nth: 0 }];
    }
    if (kind === "approval" || kind === "approved") {
      await page.evaluate(() => {
        const box = document.querySelector("section[aria-label=Conversation] .overflow-y-auto");
        if (box) box.scrollTop = box.scrollHeight;
      });
      await settle(page, 400);
    }
    if (kind === "empty") {
      await page.getByRole("textbox", { name: "Message the employee assistant" }).fill(
        "Summarise the Q4 budget in finance/ and flag every line above 10,000 EUR.",
      );
    }
    await shot(page, `desk-${kind}`, rects);
    await page.close();
  }
  // Setup: Choose your assistant (Claude Code or Codex).
  const page = await deskPage(context, "empty");
  await page.getByRole("button", { name: "Assistant and keys" }).click();
  await settle(page, 800);
  await shot(page, "desk-setup", {
    claude: ["Claude Code", { minW: 300 }],
    codex: ["Codex", { exact: true, minW: 300 }],
    title: ["Choose your assistant", { up: "self" }],
  });
  await page.close();
  await context.close();
}

// Director (mock world, Acme Logistics).
{
  const context = await browser.newContext({ ...common, viewport: { width: 1920, height: 1080 } });
  await exposeWorld(context);
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log("director pageerror", e.message));
  await page.goto(`${DIRECTOR}/`, { waitUntil: "networkidle" });
  await settle(page, 2500);
  await shot(page, "dir-overview", {
    agents: "Agents active",
    actions: "Actions, last 15 min",
    denied: "Denied, last 15 min",
    awaiting: "Awaiting a human",
    attention: ["wants to run", { minW: 900 }],
    dock: ["", { selector: "nav" }],
    hero: ["things need your attention", { up: "self" }],
  });

  for (const act of ["act2-deterministic-boundaries", "act4-agents-talking", "act6-supply-chain-and-rogue", "act3-hijacked-goal", "act5-human-decides"])
    await page.evaluate((id) => window.__world.launch(id), act);
  // Act 5's approval resolves after 12 s in the mock world; wait so its trace carries the approver.
  await settle(page, 15000);

  await goInApp(page, "/activity");
  await settle(page, 2000);
  const rows = {};
  for (let i = 0; i < 8; i++) rows[`row${i}`] = ["", { selector: "a[href^='/traces/'], [role=row], li a", nth: i }];
  await shot(page, "dir-activity", { chart: "Last hour", list: ["", { selector: "a[href^='/traces/']", nth: 0 }], ...rows });

  const traces = await page.evaluate(() =>
    window.__world.traces(300).map((t) => ({ id: t.trace_id, agent: t.agent_id, cap: t.capability, decision: t.decision, controls: t.control_ids })),
  );
  writeFileSync(join(out, "traces.json"), JSON.stringify(traces, null, 1));
  const pickTrace = (pred) => traces.find(pred)?.id;
  const traceIds = {
    tier: pickTrace((t) => t.decision === "deny" && t.controls?.includes("CTL-TIER-001")),
    tool: pickTrace((t) => t.decision === "deny" && t.controls?.includes("CTL-TOOL-001")),
    a2a: pickTrace((t) => t.decision === "deny" && t.controls?.some((c) => c.startsWith("CTL-A2A"))),
    budget: pickTrace((t) => t.decision === "deny" && t.controls?.some((c) => c.startsWith("CTL-RUN"))),
    tightened: pickTrace((t) => t.controls?.includes("CTL-AI-001") && t.decision !== "deny"),
    approval: pickTrace((t) => t.cap === "payments.transfer" && t.controls?.includes("CTL-APR-003")),
  };
  console.log("traces", traceIds);
  for (const [key, id] of Object.entries(traceIds)) {
    if (!id) continue;
    await goInApp(page, `/traces/${id}`);
    await settle(page, 1800);
    for (const label of ["Show Cedar", "Execution context"]) {
      const toggle = page.getByText(label, { exact: true });
      if (await toggle.count()) await toggle.first().click();
    }
    await settle(page, 800);
    await shot(
      page,
      `dir-trace-${key}`,
      {
        sentence: ["", { selector: "h1" }],
        pipeline: ["Authenticate", { minW: 600 }],
        why: ["Why", { exact: true, minW: 300 }],
        how: ["How the Gateway decided", { minW: 300 }],
      },
      { fullPage: true },
    );
  }

  await goInApp(page, "/determinism");
  await settle(page, 2500);
  await shot(
    page,
    "dir-determinism",
    {
      boundary: ["The boundary, live", { minW: 900 }],
      policy: "Decided by policy",
      tightened: "Tightened by AI",
      loosened: "Loosened by AI",
      person: "Resolved by a person",
      same: ["Same request, same decision", { up: "self" }],
      can: "What AI analysis can do",
      cannot: "What it cannot do",
    },
    { fullPage: true },
  );

  await goInApp(page, "/graph");
  await settle(page, 2500);
  await shot(page, "dir-graph", {
    canvas: ["PEOPLE", { minW: 1200 }],
    legend: ["decisions, last hour", { minW: 500 }],
  });

  await goInApp(page, "/agents");
  await settle(page, 2500);
  await shot(page, "dir-orgchart", {
    canvas: ["Expand all", { minW: 1200 }],
    maya: ["Finance Operations Lead", { minW: 200 }],
    marcus: ["Chief Financial Officer", { minW: 200 }],
    chat: ["Started", { minW: 200 }],
  });
  await page.getByText("Maya Chen", { exact: true }).first().click();
  await settle(page, 1500);
  await shot(page, "dir-person", { sheet: ["", { selector: "[role=dialog], aside" }] });
  await page.keyboard.press("Escape");

  for (const agent of ["invoice-assistant", "employee-assistant"]) {
    await goInApp(page, `/agents/${agent}`);
    await settle(page, 2000);
    const derived = page.getByText("How this was derived");
    if (await derived.count()) await derived.first().click();
    await settle(page, 800);
    await shot(
      page,
      `dir-agent-${agent}`,
      {
        head: [agent, { minW: 900 }],
        session: ["Current session", { up: 2 }],
        may: ["What it may do", { up: 2 }],
        derived: ["How this was derived", { minW: 400 }],
      },
      { fullPage: true },
    );
  }

  await goInApp(page, "/access");
  await settle(page, 2000);
  await shot(page, "dir-access", { matrix: ["", { selector: "table" }] }, { fullPage: true });

  await goInApp(page, "/coverage");
  await settle(page, 2000);
  await shot(page, "dir-coverage", { list: ["Agent goal hijack", { minW: 1000 }], score: ["risks evidenced this run", { up: 2 }] });

  await goInApp(page, "/configuration");
  await settle(page, 2000);
  await shot(page, "dir-config", { invoice: ["Invoice processing", { minW: 500 }], triage: ["Ticket triage", { minW: 500 }] });
  await page.close();
  await context.close();
}

// Ecosystem (mock world): Approvals with Act 5's payment, Policy Studio, Home.
{
  const context = await browser.newContext({ ...common, viewport: { width: 1920, height: 1080 } });
  await exposeWorld(context);
  const page = await context.newPage();
  page.on("pageerror", (e) => console.log("ecosystem pageerror", e.message));
  await page.goto(`${ECOSYSTEM}/`, { waitUntil: "networkidle" });
  await settle(page, 2500);
  await shot(page, "eco-home", { pipeline: ["One execution boundary", { minW: 1000 }], hero: ["See every agent", { up: "self" }] });
  await page.evaluate(() => window.__world.launch("act5-human-decides"));
  await settle(page, 3000);
  await goInApp(page, "/approvals");
  await settle(page, 2500);
  await shot(page, "eco-approvals", { card: ["payments.transfer", { minW: 700 }], header: ["A human decides", { up: "self" }] });
  const open = page.getByText("payments.transfer").first();
  if (await open.count()) await open.click();
  await settle(page, 1500);
  await shot(page, "eco-approval-detail", { card: ["48,000.00", { minW: 600 }] }, { fullPage: true });

  for (const [path, name, rects] of [
    ["/policy-studio/controls", "eco-controls", { first: ["CTL-ID-001", { minW: 300 }] }],
    ["/policy-studio/controls/CTL-APR-003", "eco-control-apr003", { card: ["Payment threshold", { minW: 600 }] }],
    ["/policy-studio/policies", "eco-policies", { first: ["", { selector: "pre", nth: 0 }] }],
    ["/policy-studio/use-cases", "eco-usecases", { invoice: ["Invoice processing", { minW: 400 }] }],
  ]) {
    await goInApp(page, path);
    await settle(page, 2000);
    await shot(page, name, rects, { fullPage: true });
  }
  await page.close();
  await context.close();
}

// Keycloak: the themed sign-in (live stack). The step-up page is this card with the OTP form.
{
  const context = await browser.newContext({ ...common, viewport: { width: 1920, height: 1080 } });
  const page = await context.newPage();
  await page.goto("http://auth.betsee.localhost/realms/betsee/account", { waitUntil: "networkidle" }).catch(() => {});
  await settle(page, 1200);
  await shot(page, "kc-login", { card: ["Sign in to your account", { minW: 300 }] });
  await page.close();
  await context.close();
}

await browser.close();
