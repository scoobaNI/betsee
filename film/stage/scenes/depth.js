// Acts 8-11: the Director, live; one decision down to its rule; a verified human approval; and
// Policy Studio from business intent to Cedar.
import { Callout, Screen, capState, chip, clamp, cut, ease, el, icon, kf, lerp, markSvg, put, rectOf, seg, svgEl, text } from "../lib.js";

const soft = (t, a, d = 0.9) => seg(t, a, a + d, ease.soft);
const camera = (t, keys) => kf(t, keys, ease.inOutQuint);
const showFor = (t, a, b) => Math.min(soft(t, a, 0.8), 1 - seg(t, b - 0.4, b));
const center = (r) => [r.x + r.w / 2, r.y + r.h / 2];

const cedarHtml = (source, highlight) =>
  source
    .split("\n")
    .map((line) => {
      let html = line
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/("[^"]*")/g, '<span class="s">$1</span>')
        .replace(/^(@\w+)/, '<span class="a">$1</span>')
        .replace(/\b(forbid|permit|when|unless|principal|action|resource|in|is|has|context)\b/g, '<span class="k">$1</span>');
      if (line.trim().startsWith("//")) html = `<span class="c">${line}</span>`;
      return highlight && line.includes(highlight) ? `<span class="hl">${html}</span>` : html;
    })
    .join("\n");

async function cedarBlock(file, id) {
  const source = await (await fetch(`/policies/${file}`)).text();
  const lines = source.split("\n");
  const start = lines.findIndex((l) => l.includes(`@id("${id}")`));
  let end = start;
  while (end < lines.length && !lines[end].trim().endsWith(";")) end++;
  return lines.slice(start, end + 1).join("\n");
}
const TIER_CEDAR = await cedarBlock("20-tier.cedar", "forbid-resource-above-session-tier");
const PAY_CEDAR = await cedarBlock("60-approval.cedar", "approval-payment-above-threshold");

function cedarCard(parent, file, source, highlight, footer = "") {
  const card = el("div", "card", parent);
  Object.assign(card.style, { padding: "30px 38px", borderRadius: "22px" });
  card.innerHTML = `<div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;color:#8a94a6;font-size:17px;font-weight:560">${icon("code", 18)} <span class="mono">${file}</span></div><div class="code">${cedarHtml(source, highlight)}</div>${footer}`;
  return card;
}

// ------------------------------------------------------------------ act 8: the Director, live

// The agent page's derivation table: its last row's checks end here; the tags hang below the card.
const LAST_ROW = 1221;
const TAG_Y = 1290;

function director(root, ctx) {
  const n20 = ctx.vo("n20");
  const n20b = ctx.vo("n20b");
  const n20c = ctx.vo("n20c");
  const n21 = ctx.vo("n21");
  const screen = new Screen(root, ["dir-agent-employee-assistant"], { w: 1600, h: 900, url: "director.betsee.localhost" });
  const LIVE = [
    ["overview", "director.betsee.localhost"],
    ["activity", "director.betsee.localhost/activity"],
    ["graph", "director.betsee.localhost/graph"],
    ["orgchart", "director.betsee.localhost/agents"],
  ];
  for (const [name] of LIVE) screen.live(name, ctx.clips[name]);
  const PAGES = [...LIVE, ["dir-agent-employee-assistant", "director.betsee.localhost/agents/employee-assistant"]];
  const svg = svgEl("svg", { width: 1920, height: 1080, class: "abs" }, root);
  const over = el("div", "fill", root);
  const C = (title, sub, mono, size) => new Callout(over, svg, { title, sub, mono, size });
  const ov = rectOf("dir-overview", "attention");
  const den = rectOf("dir-overview", "denied");
  const act0 = rectOf("dir-activity", "row0");
  const maya = rectOf("dir-orgchart", "maya");
  const report = rectOf("dir-graph", "reportBot");
  const R = (k) => rectOf("dir-agent-employee-assistant", k);
  const co = {
    attention: C("Needs attention", "Quarantines, approvals and step-ups, live"),
    denied: C("Denied, last 15 minutes", "Stopped before execution"),
    rows: C("Every decision, as it happens", "", "Allowed · Denied · Approval · Step-up"),
    graph: C("Who touched what", "People, agents and tools, by latest decision"),
    maya: C("Maya Chen", "and the agents she runs, live"),
    delegated: C("by the person", "", "", "sm"),
    permitted: C("by the use case", "", "", "sm"),
    effective: C("what it can use", "", "", "sm"),
  };
  const at = [0, n20b.at - 0.5, n20c.at - 0.5, n21.at - 0.5, ctx.phrase("n21", 1) - 0.4];
  at.forEach((a, i) => i && ctx.cue(a, "whoosh"));
  const views = [
    [[0, 0, 1920, 1080], [180, 120, 1500, 844]],
    [[220, 140, 1500, 844], [300, 440, 1400, 788]],
    [[200, 80, 1620, 911], [520, 160, 1300, 731]],
    [[260, 120, 1600, 900], [800, 200, 1100, 619]],
    [[380, 680, 1300, 731], [860, 860, 860, 484]],
  ];
  return {
    update(t) {
      const enter = soft(t, 0, 1.2);
      screen.place({ x: 960, y: 570 + (1 - enter) * 40, s: 0.98 * (0.96 + 0.04 * enter), o: enter });
      let page = 0;
      at.forEach((a, i) => {
        if (t >= a) page = i;
      });
      const start = at[page];
      const end = at[page + 1] ?? ctx.length;
      // Pages slide past like a swipe: the old one leaves left as the new one arrives.
      const swipe = seg(t, start, start + 0.7, ease.inOutQuint);
      screen.only(PAGES[page][0]);
      screen.url(PAGES[page][1]);
      const [v0, v1] = views[page];
      screen.look(camera(t, [[start, v0], [start + 0.5, v0], [end, v1]]));
      for (const [name] of LIVE) screen.frame(name, Math.max(0, t - at[LIVE.findIndex((p) => p[0] === name)]));
      const cur = screen.pages.get(PAGES[page][0]);
      cur.style.translate = `${(1 - swipe) * 260}px 0`;
      cur.style.opacity = page === 0 ? 1 : swipe;
      if (page > 0) {
        const prev = screen.pages.get(PAGES[page - 1][0]);
        prev.style.visibility = swipe < 1 ? "visible" : "hidden";
        prev.style.opacity = 1 - swipe;
        prev.style.translate = `${-swipe * 260}px 0`;
      }
      const m = (r, dx = 0, dy = 0) => screen.map(r.x + r.w / 2 + dx, r.y + r.h / 2 + dy);
      co.attention.update(m(ov, -ov.w / 2 + 160, -ov.h / 2 + 70), [330, 880], page === 0 ? showFor(t, n20.at, end) : 0);
      co.denied.update(m(den, 0, -40), [1620, 220], page === 0 ? showFor(t, n20.at + 0.6, end) : 0);
      co.rows.update(m(act0, act0.w / 2 - 120, 0), [1600, 200], page === 1 ? showFor(t, start + 0.7, end) : 0);
      co.graph.update(m(report), [1560, 170], page === 2 ? showFor(t, start + 0.8, end) : 0);
      co.maya.update(m(maya), [1580, 860], page === 3 ? showFor(t, start + 0.7, end) : 0);
      // Each column of the derivation, header to last row, with its tag hanging just under the card
      // (above the page's own "All of them" link).
      const column = (k, co, from) => {
        const r = R(k);
        co.update(screen.mapRect({ x: r.x + 12, y: r.y, w: r.w - 24, h: LAST_ROW - r.y }), screen.map(r.x + r.w / 2, TAG_Y), page === 4 ? showFor(t, from, ctx.length + 1) : 0);
      };
      column("hDelegated", co.delegated, ctx.phrase("n21", 2));
      column("hPermitted", co.permitted, ctx.phrase("n21", 3));
      column("hEffective", co.effective, ctx.phrase("n21", 3) + 0.5);
    },
  };
}

// ------------------------------------------------------------------ act 9: one decision, down to the rule

function trace(root, ctx) {
  const n22 = ctx.vo("n22");
  const screen = new Screen(root, ["dir-trace-tier"], { w: 1600, h: 900, url: "director.betsee.localhost/traces/4a507d20" });
  screen.live("replay", ctx.clips.replay);
  const svg = svgEl("svg", { width: 1920, height: 1080, class: "abs" }, root);
  const over = el("div", "fill", root);
  const R = (k) => rectOf("dir-trace-tier", k, k === "qRes");
  const C = (title, sub, mono) => new Callout(over, svg, { title, sub, mono });
  // The question grid: who, agent, use case on the first row; capability, resource, policy below.
  const who = R("qWho");
  const cap = R("qCap");
  const policy = R("qPolicy");
  const agentCell = { x: who.x + 420, y: who.y, w: 160, h: who.h };
  const resourceCell = { x: cap.x + 420, y: cap.y, w: 300, h: cap.h };
  // Labels sit just above the first row and just below the second, beside what they name.
  const co = [
    [C("Who asked", "Maya Chen"), who, [-20, -150]],
    [C("Through which agent", "", "invoice-assistant"), agentCell, [60, -150]],
    [C("For what", "", "files.read"), cap, [-20, 150]],
    [C("On which resource", "", "folder:files/hr/compensation-2026 · Restricted"), resourceCell, [120, 150]],
  ];
  void policy;
  const rule = cedarCard(
    over,
    "policies/20-tier.cedar",
    TIER_CEDAR,
    "when {",
    `<div style="display:flex;gap:14px;align-items:center;margin-top:22px;font-size:18px;color:#4b5466"><span class="mono">resource.tier</span> restricted &gt; <span class="mono">session.tierCeiling</span> internal <span style="margin-left:auto;display:inline-flex;gap:10px">${chip("deny", { size: "lg" })}<span class="pill mono">CTL-TIER-001</span></span></div>`,
  );
  const ruleCall = el("div", "abs", over, `<span class="eyebrow">The exact rule that decided it</span>`);
  const p = (k) => ctx.phrase("n22", k);
  const replayAt = p(-1) - 1.8;
  ctx.cue(p(-1) + 0.6, "deny");
  return {
    update(t) {
      const enter = soft(t, 0, 1.0);
      const out = seg(t, p(-1) + 0.2, p(-1) + 0.9, ease.inOut);
      screen.place({ x: 960, y: 570, s: 0.98 - out * 0.06, o: enter, blur: out * 4 });
      const onReplay = t >= replayAt;
      screen.only(onReplay ? "replay" : "dir-trace-tier");
      if (onReplay) screen.frame("replay", t - replayAt);
      screen.look(
        camera(t, [
          [0, [391, 60, 1264, 711]],
          [p(1) - 0.3, [391, 60, 1264, 711]],
          [p(1) + 0.5, [380, 400, 1290, 420]],
          [replayAt - 0.05, [380, 400, 1290, 420]],
          [replayAt, [380, 1150, 1300, 731]],
          [p(-1) + 0.4, [380, 1180, 1300, 731]],
        ]),
      );
      co.forEach(([c, r, [dx, dy]], i) => {
        const a = screen.map(...center(r));
        c.update(a, [a[0] + dx, a[1] + dy], showFor(t, p(i + 1), replayAt));
      });
      const rp = soft(t, p(-1) + 0.4, 0.9);
      put(rule, { x: 960, y: 580 + (1 - rp) * 30, o: rp, s: 0.97 + 0.03 * rp });
      put(ruleCall, { x: 960, y: 230, o: rp });
    },
  };
}

// ------------------------------------------------------------------ act 10: a human decides

const OTP = "482913";
const GX = 1180;

function approval(root, ctx) {
  const n23 = ctx.vo("n23");
  const n24 = ctx.vo("n24");
  const p23 = ctx.phrase("n23", 1);
  const pOtp = n24.at;
  const pCtx = ctx.phrase("n24", 1);
  const pSame = ctx.phrase("n24", -1);
  const plane = el("div", "abs", root);
  Object.assign(plane.style, { width: "4px", height: "560px", borderRadius: "4px", background: "linear-gradient(180deg, transparent, #3a5bd9 8%, #3a5bd9 92%, transparent)", boxShadow: "0 0 24px rgba(58,91,217,.3)" });
  const planeLabel = el("div", "abs", root, `<div class="mono" style="font-size:17px;color:#3a5bd9;text-align:center">approval-payment-above-threshold</div><div class="mono" style="font-size:14px;color:#8a94a6;margin-top:6px;text-align:center">CTL-APR-003 · CTL-APR-002</div>`);
  const req = el(
    "div",
    "card",
    root,
    `<div style="display:flex;align-items:center;gap:16px;padding:20px 26px"><span class="agent" style="width:50px;height:50px">${icon("bot", 26)}</span>
      <div><div class="mono" style="font-size:20px;font-weight:600">invoice-assistant <span style="color:#3a5bd9">payments.transfer</span></div>
      <div style="font-size:18px;color:#4b5466;margin-top:6px"><b style="color:#0b1220">48,000.00 EUR</b> to <span class="mono">payments/nordfreight-supplier</span> · for Maya Chen</div></div></div>`,
  );
  const obligation = el("div", "abs", root, `<span style="display:inline-flex;gap:12px">${chip("approval", { size: "lg" })}${chip("stepup", { size: "lg" })}</span>`);
  const context = el(
    "div",
    "abs",
    root,
    `<div class="card" style="position:relative;padding:20px 26px"><div class="mono" style="display:flex;flex-direction:column;gap:10px;font-size:19px;color:#4b5466">
      <div>context.approval.granted <b class="v1" style="color:#e0484e">false</b></div>
      <div>context.approval.stepUp <b class="v2" style="color:#e0484e">false</b></div></div></div>`,
  );
  const v1 = context.querySelector(".v1");
  const v2 = context.querySelector(".v2");
  const done = el("div", "abs", root, `<span style="display:inline-flex;gap:12px">${chip("allow", { size: "lg" })}${chip("allow", { size: "lg", label: "Executed" })}</span>`);
  const flash = el("div", "abs", root);
  Object.assign(flash.style, { width: "44px", height: "44px", borderRadius: "999px", boxShadow: "0 0 0 3px #14a05a, 0 0 30px #14a05a" });
  const head = el("div", "h md", root, `High-impact actions <span class="blue">wait for a human.</span>`);
  // Approvals: the exact action, as the Gateway recorded it.
  const screen = new Screen(root, ["eco-approval-detail"], { w: 1600, h: 900, url: "betsee.localhost/approvals" });
  const svg = svgEl("svg", { width: 1920, height: 1080, class: "abs" }, root);
  const over = el("div", "fill", root);
  const A = (k) => rectOf("eco-approval-detail", k);
  // The values' own text: the payee with its type tag, and the name rather than the whole cell.
  const ca = [
    [new Callout(over, svg, { title: "The exact amount", sub: "As the Gateway recorded it" }), A("amount")],
    [new Callout(over, svg, { title: "The exact payee", mono: "payments/nordfreight-supplier" }), { ...A("payee"), w: 390 }],
    [new Callout(over, svg, { title: "Who started the session", sub: "Maya Chen, Invoice processing" }), { ...A("sessionBy"), w: 78 }],
  ];
  // Keycloak step-up in the light look the Director and Desk sign in with.
  const kc = el("div", "abs", root);
  const kcRect = { x: 730, y: 278, w: 460, h: 526, radius: 24 };
  cut("kc-light", kcRect, kc, "lifted");
  Object.assign(kc.style, { width: `${kcRect.w}px`, height: `${kcRect.h}px` });
  const form = el("div", "abs", kc);
  Object.assign(form.style, { left: "40px", top: "140px", width: "380px", height: "360px", background: "#ffffff", fontFamily: "'Plus Jakarta Sans Variable', Mona, sans-serif", color: "#101828" });
  form.innerHTML = `<div style="display:flex;align-items:center;gap:12px;margin-top:4px"><span style="color:#3a5bd9;display:inline-flex">${icon("fingerprint", 30)}</span><span style="font-size:30px;font-weight:700;letter-spacing:-.02em">Confirm it is you</span></div>
    <div style="font-size:15px;color:#475467;margin-top:10px">Daniel Ortiz, approving payments.transfer 48,000.00 EUR</div>
    <div style="font-size:14px;font-weight:600;color:#475467;margin-top:26px">One-time code</div>
    <div class="otp" style="display:flex;gap:8px;margin-top:8px">${Array.from({ length: 6 }, () => '<span style="flex:1;height:56px;border-radius:12px;background:#fff;box-shadow:inset 0 0 0 1px #d3d8e0;display:grid;place-items:center;font-size:26px;font-weight:600;font-family:JBMono"></span>').join("")}</div>
    <div style="margin-top:30px;height:50px;border-radius:12px;background:#101828;color:#fff;display:grid;place-items:center;font-weight:600;font-size:16px">Verify</div>`;
  const digits = [...form.querySelectorAll(".otp span")];
  const kcTag = el("div", "abs eyebrow", root, "Keycloak · step-up");
  const checks = [
    ["Identity", "Daniel Ortiz"],
    ["Role", "approver"],
    ["Step-up", "one-time code"],
    ["Authentication", "acr 2 · 6 s ago"],
  ].map(([k, v]) => el("div", "abs", root, `<div style="display:flex;align-items:center;gap:14px;font-size:24px"><span style="color:#14a05a;display:inline-flex">${icon("circle-check", 28)}</span><span style="color:#8a94a6;width:190px">${k}</span><span style="font-weight:640">${v}</span></div>`));
  const tr = el("div", "abs", root);
  const trRect = rectOf("dir-trace-approval", "why");
  cut("dir-trace-approval", { ...trRect, radius: 22 }, tr, "lifted");
  Object.assign(tr.style, { width: `${trRect.w}px`, height: `${trRect.h}px` });
  const facts = [
    ["Approved by", "Daniel Ortiz"],
    ["What", "payments.transfer · 48,000.00 EUR"],
    ["Proof", "one-time code · acr 2"],
  ].map(([k, v]) => el("div", "abs", root, `<span class="pill" style="height:50px;font-size:20px;gap:12px"><span style="color:#8a94a6">${k}</span><b style="font-weight:640">${v}</b></span>`));
  const c2 = el("div", "h md", root, `The approval becomes <span class="blue">context</span>.`);
  const c3 = el("div", "h md center", root, `<span class="soft">The same policy</span> decides again.`);
  ctx.cue(0.9, "approval");
  ctx.cue(pOtp + 1.5, "tick");
  ctx.cue(pCtx + 1.3, "allow");
  return {
    update(t) {
      const g1 = soft(t, 0, 0.5) * (1 - seg(t, p23 - 0.5, p23 - 0.1));
      const g2 = soft(t, pCtx - 0.2, 0.5) * (1 - seg(t, pSame + 0.4, pSame + 0.8));
      const g = Math.max(g1, g2);
      put(plane, { x: GX, y: 560, sy: g, o: g });
      put(planeLabel, { x: GX, y: 245, o: g });
      const w = req.offsetWidth || 640;
      const first = ease.inOut(seg(t, 0.1, 0.7, ease.linear));
      const second = ease.inOut(seg(t, pCtx + 0.9, pCtx + 1.5, ease.linear));
      const rx = t < pCtx ? lerp(140 + w / 2, GX - 16 - w / 2, first) : lerp(GX - 16 - w / 2, GX + 900, second);
      put(req, { x: rx, y: 560, o: t < pCtx ? g1 : g2 * (1 - seg(t, pCtx + 1.3, pCtx + 1.5)) });
      put(obligation, { x: GX + 36 + (obligation.offsetWidth || 400) / 2, y: 560, o: soft(t, 0.8, 0.4) * g1 });
      put(context, { x: GX - 16 - w + (context.offsetWidth || 440) / 2, y: 410, o: g2 });
      const flip = t >= pCtx + 0.5;
      v1.textContent = flip ? "true" : "false";
      v2.textContent = flip ? "true (acr 2)" : "false";
      v1.style.color = v2.style.color = flip ? "#14a05a" : "#e0484e";
      put(done, { x: GX + 36 + (done.offsetWidth || 340) / 2, y: 680, o: soft(t, pCtx + 1.3, 0.4) * g2 });
      const fl = t > pCtx + 1.2 ? 1 - clamp((t - pCtx - 1.2) / 0.4) : 0;
      put(flash, { x: GX, y: 560, s: 1 + (1 - fl) * 2.2, o: fl * g2 });
      const h1 = capState(t, 0.2, p23 - 0.2, { fout: 0.4 });
      text(head, { x: 140, y: 150, o: h1.o, dy: h1.dy, blur: h1.blur });
      const a = soft(t, p23 - 0.4, 0.8) * (1 - seg(t, pOtp - 0.4, pOtp));
      screen.place({ x: 960, y: 570, s: 0.98, o: a });
      screen.look(camera(t, [[p23 - 0.4, [700, 320, 1220, 686]], [pOtp, [880, 360, 1050, 590]]]));
      // Labels in one column right of the card, each level with its value: the hairlines run
      // straight through the empty half of the panel.
      ca.forEach(([c, r], i) => {
        const b = screen.mapRect(r);
        c.update(b, [1545 + (c.node.offsetWidth || 280) / 2, b[1] + b[3] / 2], a > 0.01 ? showFor(t, p23 + 0.3 + i * 0.7, pOtp - 0.1) : 0);
      });
      const k = soft(t, pOtp - 0.2, 0.6) * (1 - seg(t, pCtx - 0.4, pCtx - 0.1));
      put(kc, { x: 700, y: 560, o: k, s: 1.12 });
      put(kcTag, { x: 700, y: 200, o: k });
      const typed = Math.round(seg(t, pOtp + 0.5, pOtp + 1.3, ease.linear) * 6);
      digits.forEach((d, i) => {
        d.textContent = i < typed ? OTP[i] : "";
        d.style.boxShadow = i === typed && typed < 6 ? "inset 0 0 0 2px #3a5bd9" : "inset 0 0 0 1px #d3d8e0";
      });
      checks.forEach((c, i) => {
        const q = soft(t, pOtp + 1.4 + i * 0.15, 0.6);
        put(c, { x: 1190 + (c.offsetWidth || 520) / 2 - (1 - q) * 20, y: 440 + i * 70, o: q * k });
      });
      const s2 = capState(t, pCtx, pSame + 0.6, { fout: 0.4 });
      text(c2, { x: 140, y: 150, o: s2.o, dy: s2.dy, blur: s2.blur });
      const tp = soft(t, pSame + 0.5, 0.9);
      put(tr, { x: 960, y: 470, o: tp, s: 1.14 * (0.97 + 0.03 * tp) });
      facts.forEach((f, i) => put(f, { x: 960 + (i - 1) * 540, y: 830, o: soft(t, pSame + 1.0 + i * 0.25, 0.7) }));
      const s3 = capState(t, pSame, ctx.length + 1, { fout: 0.4 });
      text(c3, { x: 960, y: 120, ax: 0.5, o: s3.o * tp, dy: s3.dy, blur: s3.blur });
    },
  };
}

// ------------------------------------------------------------------ act 11: Policy Studio

// Measured on the captures: the control page's "invoice-processing" chip under "Attached to", and
// the use case's first approval rule (two lines under the "Approval rules" heading).
const INVOICE_CHIP = { x: 1001, y: 683, w: 172, h: 22 };
const FIRST_RULE = { x: 417, y: 677, w: 379, h: 36 };

function studio(root, ctx) {
  const n25 = ctx.vo("n25");
  const tCedar = ctx.word("n25", "Cedar") - 0.2;
  const screen = new Screen(root, ["eco-usecases", "eco-control-apr003", "eco-policies"], { w: 1600, h: 900, url: "betsee.localhost/policy-studio/use-cases" });
  const svg = svgEl("svg", { width: 1920, height: 1080, class: "abs" }, root);
  const over = el("div", "fill", root);
  const U = (k) => rectOf("eco-usecases", k);
  const K = (k) => rectOf("eco-control-apr003", k);
  const cUse = new Callout(over, svg, { title: "Use case: Invoice processing", sub: "Capability ceiling, approval rules, budget" });
  const cRules = new Callout(over, svg, { title: "Approval above 10,000.00 EUR", sub: "In plain words, for the business" });
  const cCtl = new Callout(over, svg, { title: "Attached to the use case", sub: "CTL-APR-003 applies to invoice-processing" });
  const cDec = new Callout(over, svg, { title: "Decided by Cedar policies", mono: "approval-payment-above-threshold" });
  const cedar = cedarCard(over, "policies/60-approval.cedar", PAY_CEDAR, "context.amountCents >", `<div style="display:flex;gap:12px;margin-top:20px">${chip("approval", { size: "lg", label: "require_approval" })}<span class="pill">Evaluated before anything executes</span></div>`);
  // Business intent while it is named, its control after, the Cedar rule on "Cedar".
  const t1 = n25.at + 2.1;
  ctx.cue(t1, "whoosh");
  ctx.cue(tCedar, "whoosh");
  return {
    update(t) {
      const enter = soft(t, 0, 1.0);
      const out = seg(t, tCedar + 0.1, tCedar + 0.8, ease.inOut);
      screen.place({ x: 960, y: 570, s: 0.98 - out * 0.05, o: enter, blur: out * 4 });
      const page = t < t1 ? "eco-usecases" : t < tCedar ? "eco-control-apr003" : "eco-policies";
      screen.only(page);
      screen.url(page === "eco-usecases" ? "betsee.localhost/policy-studio/use-cases" : page === "eco-control-apr003" ? "betsee.localhost/policy-studio/controls/CTL-APR-003" : "betsee.localhost/policy-studio/policies");
      screen.look(
        page === "eco-usecases"
          ? camera(t, [[0, [300, 100, 1500, 844]], [t1, [380, 280, 1100, 619]]])
          : page === "eco-control-apr003"
            ? camera(t, [[t1, [380, 260, 1450, 816]], [tCedar, [900, 380, 950, 534]]])
            : camera(t, [[tCedar, [380, 300, 1450, 816]], [ctx.length, [900, 400, 950, 534]]]),
      );
      // The card in focus stays lit; each label sits beside its value, moving with the page.
      const uses = page === "eco-usecases";
      screen.spotlight(uses ? U("invoice") : page === "eco-control-apr003" ? K("card") : null, uses ? showFor(t, n25.at + 0.2, t1) : showFor(t, t1 + 0.1, tCedar));
      const beside = (c, r, y = null) => {
        const b = screen.mapRect(r);
        return [b[0] + b[2] + 56 + (c.node.offsetWidth || 300) / 2, y ?? b[1] + b[3] / 2];
      };
      const card = U("invoice");
      cUse.update(screen.mapRect(card), beside(cUse, card, screen.map(0, card.y + 75)[1]), uses ? showFor(t, n25.at + 0.4, t1) : 0);
      const rule = screen.mapRect(FIRST_RULE);
      cRules.update(rule, beside(cRules, card, rule[1] + rule[3] / 2), uses ? showFor(t, n25.at + 0.9, t1) : 0);
      cCtl.update(screen.mapRect(INVOICE_CHIP), beside(cCtl, INVOICE_CHIP), page === "eco-control-apr003" ? showFor(t, t1 + 0.2, tCedar) : 0);
      cDec.update(screen.mapRect(K("deciding")), beside(cDec, K("deciding")), page === "eco-control-apr003" ? showFor(t, t1 + 0.8, tCedar) : 0);
      const r = soft(t, tCedar + 0.4, 1.0);
      put(cedar, { x: 960, y: 540 + (1 - r) * 30, o: r });
    },
  };
}

export const depth = { director, trace, approval, studio };
void markSvg;
