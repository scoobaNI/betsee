// Acts 8-11: the Director tour, one decision down to its rule, a verified human approval, and
// Policy Studio from business intent to Cedar.
import { Callout, Screen, capState, chip, clamp, cut, ease, el, icon, kf, lerp, put, rectOf, seg, svgEl, text } from "../lib.js";

const soft = (t, a, d = 0.9) => seg(t, a, a + d, ease.soft);
const camera = (t, keys) => kf(t, keys, ease.inOutQuint);
/** A callout that is up between a and b. */
const showFor = (t, a, b) => Math.min(soft(t, a, 0.8), 1 - seg(t, b - 0.4, b));

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

// ------------------------------------------------------------------ act 8: the Director

const PAGES = [
  ["dir-overview", "director.betsee.localhost"],
  ["dir-activity", "director.betsee.localhost/activity"],
  ["dir-graph", "director.betsee.localhost/graph"],
  ["dir-orgchart", "director.betsee.localhost/agents"],
  ["dir-agent-employee-assistant", "director.betsee.localhost/agents/employee-assistant"],
  ["dir-access", "director.betsee.localhost/access"],
];

function director(root, ctx) {
  const n19 = ctx.vo("n19");
  const n20 = ctx.vo("n20");
  const n21 = ctx.vo("n21");
  const screen = new Screen(root, PAGES.map((p) => p[0]), { w: 1600, h: 900, url: PAGES[0][1] });
  const svg = svgEl("svg", { width: 1920, height: 1080, class: "abs" }, root);
  const over = el("div", "fill", root);
  const C = (title, sub, mono) => new Callout(over, svg, { title, sub, mono });
  const co = {
    attention: C("Needs attention", "Approvals and step-ups waiting for a person"),
    denied: C("Denied in the last 15 minutes", "Stopped before execution"),
    rows: C("Every decision, as it happens", "", "Allowed · Denied · Approval · Step-up"),
    who: C("Who asked, through which agent", "Live over Server-Sent Events"),
    graph: C("Who touched what", "People, agents and tools, by latest decision"),
    maya: C("Maya Chen", "and the agents she runs, live"),
    delegated: C("Delegated", "by the person"),
    permitted: C("Permitted", "by the use case"),
    effective: C("Effective", "what the agent can actually use"),
    suggest: C("AI suggests, a person decides", "Revoke what an agent does not need"),
    matrix: C("Every agent, every capability", "Granted, delegated or quarantined"),
  };
  const head = el("div", "h md center", root, `The <span class="blue">Director</span>. Your AI organization, live.`);
  const p = (id, k) => ctx.phrase(id, k);
  // When each page is up.
  const at = [n19.at - 0.6, p("n20", 1) - 0.3, p("n20", 2) - 0.3, n21.at - 0.3, p("n21", 1) - 0.3, n21.end + 0.5];
  at.forEach((a, i) => i && ctx.cue(a, "whoosh"));
  const views = [
    [[0, 0, 1920, 1080], [180, 40, 1600, 900]],
    [[200, 120, 1600, 900], [300, 500, 1440, 810]],
    [[0, 30, 1920, 1080], [250, 120, 1600, 900]],
    [[150, 80, 1700, 956], [700, 180, 1150, 647]],
    [[380, 680, 1300, 731], [820, 820, 1000, 563]],
    [[300, 30, 1600, 900], [330, 900, 1400, 788]],
  ];

  return {
    pre: 0.5,
    update(t) {
      const enter = soft(t, -0.5, 1.3);
      screen.place({ x: 960, y: 570 + (1 - enter) * 50, s: 0.98 * (0.96 + 0.04 * enter), o: enter });
      let page = 0;
      at.forEach((a, i) => {
        if (t >= a) page = i;
      });
      const pageStart = at[page];
      const pageEnd = at[page + 1] ?? ctx.length;
      screen.only(PAGES[page][0]);
      if (page > 0) screen.show(PAGES[page - 1][0], 1 - seg(t, pageStart, pageStart + 0.35));
      screen.show(PAGES[page][0], seg(t, pageStart, pageStart + 0.35));
      screen.url(PAGES[page][1]);
      const [v0, v1] = views[page];
      screen.look(camera(t, [[pageStart, v0], [pageStart + 0.4, v0], [pageEnd, v1]]));
      const map = (x, y) => screen.map(x, y);
      co.attention.update(map(700, 700), [330, 900], page === 0 ? showFor(t, p("n20", 0), pageEnd) : 0);
      co.denied.update(map(1180, 300), [1620, 220], page === 0 ? showFor(t, p("n20", 0) + 0.5, pageEnd) : 0);
      co.rows.update(map(1525, 686), [1600, 210], page === 1 ? showFor(t, pageStart + 0.6, pageEnd) : 0);
      co.who.update(map(800, 760), [380, 230], page === 1 ? showFor(t, pageStart + 1.0, pageEnd) : 0);
      co.graph.update(map(1015, 470), [1560, 160], page === 2 ? showFor(t, pageStart + 0.4, pageEnd) : 0);
      co.maya.update(map(1205, 366), [1580, 840], page === 3 ? showFor(t, pageStart + 0.5, pageEnd) : 0);
      co.delegated.update(map(1347, 1046), [1150, 975], page === 4 ? showFor(t, p("n21", 2), pageEnd) : 0);
      co.permitted.update(map(1458, 1046), [1440, 975], page === 4 ? showFor(t, p("n21", 3), pageEnd) : 0);
      co.effective.update(map(1570, 1046), [1730, 975], page === 4 ? showFor(t, p("n21", 3) + 0.5, pageEnd) : 0);
      co.suggest.update(map(620, 470), [1580, 260], page === 5 ? showFor(t, pageStart + 0.4, pageEnd) : 0);
      co.matrix.update(map(980, 1110), [1580, 860], page === 5 ? showFor(t, pageStart + 1.6, pageEnd) : 0);
      const h = capState(t, -0.2, n19.end + 0.2, { fout: 0.4 });
      text(head, { x: 960, y: 1035, ax: 0.5, o: h.o * 0 });
    },
  };
}

// ------------------------------------------------------------------ act 9: one decision, down to the rule

function trace(root, ctx) {
  const n22 = ctx.vo("n22");
  const screen = new Screen(root, ["dir-trace-tier"], { w: 1600, h: 900, url: "director.betsee.localhost/traces/4a507d20" });
  const svg = svgEl("svg", { width: 1920, height: 1080, class: "abs" }, root);
  const over = el("div", "fill", root);
  const C = (title, sub, mono) => new Callout(over, svg, { title, sub, mono });
  const co = [
    [C("Who asked", "Maya Chen"), [490, 556], [300, 210]],
    [C("Through which agent", "", "employee-assistant"), [945, 556], [960, 160]],
    [C("For what", "", "files.read"), [462, 686], [300, 930]],
    [C("On which resource", "", "file:hr/salary-bands-2026.xlsx · Restricted"), [970, 686], [960, 960]],
  ];
  const rule = cedarCard(
    over,
    "policies/20-tier.cedar",
    TIER_CEDAR,
    "when {",
    `<div style="display:flex;gap:14px;align-items:center;margin-top:22px;font-size:18px;color:#4b5466"><span class="mono">resource.tier</span> restricted &gt; <span class="mono">session.tierCeiling</span> internal <span style="margin-left:auto;display:inline-flex;gap:10px">${chip("deny", { size: "lg" })}<span class="pill mono">CTL-TIER-001</span></span></div>`,
  );
  const p = (k) => ctx.phrase("n22", k);
  ctx.cue(p(-1) + 0.4, "deny");
  return {
    pre: 0.5,
    update(t) {
      const enter = soft(t, -0.5, 1.2);
      const out = seg(t, p(-1) - 0.1, p(-1) + 0.6, ease.inOut);
      screen.place({ x: 960, y: 570, s: 0.98 - out * 0.06, o: enter, blur: out * 4 });
      screen.look(
        camera(t, [
          [0, [391, 60, 1264, 711]],
          [p(1) - 0.3, [391, 60, 1264, 711]],
          [p(1) + 0.6, [380, 380, 1290, 440]],
          [p(-1), [380, 380, 1290, 440]],
          [p(-1) + 1.0, [380, 1380, 1300, 731]],
        ]),
      );
      co.forEach(([c, anchor, label], i) => c.update(screen.map(...anchor), label, showFor(t, p(i + 1), p(-1) + 0.3)));
      const r = soft(t, p(-1) + 0.2, 1.0);
      put(rule, { x: 960, y: 560 + (1 - r) * 30, o: r });
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
  // Gateway: the request and its obligation.
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
  // Approvals: the exact action.
  const screen = new Screen(root, ["eco-approval-detail"], { w: 1600, h: 900, url: "betsee.localhost/approvals", dark: true });
  const svg = svgEl("svg", { width: 1920, height: 1080, class: "abs" }, root);
  const over = el("div", "fill", root);
  const ca = [
    [new Callout(over, svg, { title: "The exact amount", sub: "As the Gateway recorded it" }), [1290, 572], [1660, 220]],
    [new Callout(over, svg, { title: "The exact payee and capability", mono: "payments/nordfreight-supplier" }), [1290, 640], [330, 300]],
    [new Callout(over, svg, { title: "Who started the session", sub: "Maya Chen, Invoice processing" }), [1200, 762], [330, 820]],
  ];
  // Keycloak step-up: the themed card with its one-time-code form.
  const kc = el("div", "abs", root);
  const kcRect = { x: 759, y: 316, w: 402, h: 448, radius: 20 };
  cut("kc-login", kcRect, kc, "lifted");
  Object.assign(kc.style, { width: `${kcRect.w}px`, height: `${kcRect.h}px` });
  const form = el("div", "abs", kc);
  Object.assign(form.style, { left: "20px", top: "110px", width: "362px", height: "318px", background: "#121512", fontFamily: "Inter, sans-serif", color: "#edf2ed" });
  form.innerHTML = `<div style="display:flex;align-items:center;gap:12px;margin-top:18px"><span style="color:#5bc85f">${icon("streamline-flex:fingerprint-1", 30)}</span><span style="font-family:Urbanist;font-size:28px;font-weight:600">Confirm it is you</span></div>
    <div style="font-size:14px;color:#a2aaa2;margin-top:10px">Daniel Ortiz, approving payments.transfer 48,000.00 EUR</div>
    <div style="font-size:13px;font-weight:600;color:#a2aaa2;margin-top:26px">One-time code</div>
    <div class="otp" style="display:flex;gap:8px;margin-top:8px">${Array.from({ length: 6 }, () => '<span style="flex:1;height:52px;border-radius:8px;background:#242924;box-shadow:inset 0 0 0 1px rgba(237,242,237,.12);display:grid;place-items:center;font-size:26px;font-weight:600;font-family:JBMono"></span>').join("")}</div>
    <div style="margin-top:30px;height:44px;border-radius:8px;background:#3aae3f;color:#031004;display:grid;place-items:center;font-weight:600;font-size:15px">Verify</div>`;
  const digits = [...form.querySelectorAll(".otp span")];
  const kcTag = el("div", "abs eyebrow", root, "Keycloak · step-up");
  const checks = [
    ["Identity", "Daniel Ortiz"],
    ["Role", "approver"],
    ["Step-up", "one-time code"],
    ["Authentication", "acr 2 · 6 s ago"],
  ].map(([k, v]) => el("div", "abs", root, `<div style="display:flex;align-items:center;gap:14px;font-size:24px"><span style="color:#14a05a">${icon("circle-check", 28)}</span><span style="color:#8a94a6;width:190px">${k}</span><span style="font-weight:640">${v}</span></div>`));
  // The trace of the approved action.
  const tr = el("div", "abs", root);
  const trRect = rectOf("dir-trace-approval", "why");
  cut("dir-trace-approval", trRect, tr, "lifted");
  Object.assign(tr.style, { width: `${trRect.w}px`, height: `${trRect.h}px`, borderRadius: "22px" });
  const facts = [
    ["Approved by", "Daniel Ortiz"],
    ["What", "payments.transfer · 48,000.00 EUR"],
    ["Proof", "one-time code · acr 2"],
  ].map(([k, v]) => el("div", "abs", root, `<span class="pill" style="height:50px;font-size:20px;gap:12px"><span style="color:#8a94a6">${k}</span><b style="font-weight:640">${v}</b></span>`));
  const c2 = el("div", "h md", root, `The approval becomes <span class="blue">context</span>.`);
  const c3 = el("div", "h md center", root, `<span class="soft">The same policy</span> decides again.`);
  ctx.cue(0.9, "approval");
  ctx.cue(pOtp + 1.4, "otp");
  ctx.cue(pCtx + 1.3, "allow");

  return {
    pre: 0.4,
    update(t) {
      root.style.opacity = seg(t, -0.4, 0.2);
      // Gateway, first and second pass.
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
      // Approvals.
      const a = soft(t, p23 - 0.4, 0.8) * (1 - seg(t, pOtp - 0.4, pOtp));
      screen.place({ x: 960, y: 570, s: 0.98, o: a });
      screen.look(camera(t, [[p23 - 0.4, [700, 300, 1220, 686]], [pOtp, [880, 330, 1050, 590]]]));
      ca.forEach(([c, anchor, label], i) => c.update(screen.map(...anchor), label, a > 0.01 ? showFor(t, p23 + 0.3 + i * 0.7, pOtp - 0.1) : 0));
      // Keycloak.
      const k = soft(t, pOtp - 0.2, 0.6) * (1 - seg(t, pCtx - 0.4, pCtx - 0.1));
      put(kc, { x: 700, y: 560, o: k, s: 1.3 });
      put(kcTag, { x: 700, y: 210, o: k });
      const typed = Math.round(seg(t, pOtp + 0.5, pOtp + 1.3, ease.linear) * 6);
      digits.forEach((d, i) => {
        d.textContent = i < typed ? OTP[i] : "";
        d.style.boxShadow = i === typed && typed < 6 ? "inset 0 0 0 1.5px #5bc85f" : "inset 0 0 0 1px rgba(237,242,237,.12)";
      });
      checks.forEach((c, i) => put(c, { x: 1180 + (c.offsetWidth || 520) / 2 - (1 - soft(t, pOtp + 1.4 + i * 0.15, 0.6)) * 20, y: 440 + i * 70, o: soft(t, pOtp + 1.4 + i * 0.15, 0.6) * k }));
      const s2 = capState(t, pCtx, pSame + 0.6, { fout: 0.4 });
      text(c2, { x: 140, y: 150, o: s2.o, dy: s2.dy, blur: s2.blur });
      // The trace.
      const tp = soft(t, pSame + 0.5, 0.9);
      put(tr, { x: 960, y: 470, o: tp, s: 1.14 * (0.97 + 0.03 * tp) });
      facts.forEach((f, i) => put(f, { x: 960 + (i - 1) * 540, y: 830, o: soft(t, pSame + 1.0 + i * 0.25, 0.7) }));
      const s3 = capState(t, pSame, ctx.length + 0.5, { fout: 0.4 });
      text(c3, { x: 960, y: 120, ax: 0.5, o: s3.o * tp, dy: s3.dy, blur: s3.blur });
    },
  };
}

// ------------------------------------------------------------------ act 11: Policy Studio

function studio(root, ctx) {
  const n25 = ctx.vo("n25");
  const pUnder = ctx.phrase("n25", 1);
  const pBefore = ctx.phrase("n25", -1);
  const screen = new Screen(root, ["eco-usecases", "eco-control-apr003", "eco-policies"], { w: 1600, h: 900, url: "betsee.localhost/policy-studio/use-cases", dark: true });
  const svg = svgEl("svg", { width: 1920, height: 1080, class: "abs" }, root);
  const over = el("div", "fill", root);
  const cUse = new Callout(over, svg, { title: "Use case: Invoice processing", sub: "Capability ceiling, approval rules, budget" });
  const cCtl = new Callout(over, svg, { title: "Control CTL-APR-003", sub: "Payment threshold, attached to invoice-processing" });
  const rule = cedarCard(over, "policies/60-approval.cedar", PAY_CEDAR, "context.amountCents >", `<div style="display:flex;gap:12px;margin-top:20px">${chip("approval", { size: "lg", label: "require_approval" })}<span class="pill">Evaluated before anything executes</span></div>`);
  const t1 = n25.at + 1.8;
  ctx.cue(t1, "whoosh");
  ctx.cue(pUnder, "whoosh");
  return {
    pre: 0.5,
    update(t) {
      const enter = soft(t, -0.5, 1.2);
      const out = seg(t, pUnder + 0.6, pUnder + 1.4, ease.inOut);
      screen.place({ x: 960, y: 570, s: 0.98 - out * 0.05, o: enter, blur: out * 4 });
      const page = t < t1 ? "eco-usecases" : t < pUnder ? "eco-control-apr003" : "eco-policies";
      screen.only(page);
      screen.url(page === "eco-usecases" ? "betsee.localhost/policy-studio/use-cases" : page === "eco-control-apr003" ? "betsee.localhost/policy-studio/controls/CTL-APR-003" : "betsee.localhost/policy-studio/policies");
      screen.look(
        page === "eco-usecases"
          ? camera(t, [[0, [300, 100, 1500, 844]], [t1, [380, 250, 1150, 647]]])
          : page === "eco-control-apr003"
            ? camera(t, [[t1, [380, 250, 1450, 816]], [pUnder, [900, 360, 950, 534]]])
            : camera(t, [[pUnder, [380, 300, 1450, 816]], [ctx.length, [900, 400, 950, 534]]]),
      );
      cUse.update(screen.map(620, 600), [1500, 320], page === "eco-usecases" ? showFor(t, n25.at + 0.5, t1) : 0);
      cCtl.update(screen.map(1180, 470), [500, 860], page === "eco-control-apr003" ? showFor(t, t1 + 0.4, pUnder) : 0);
      const r = soft(t, pUnder + 0.8, 1.0);
      put(rule, { x: 960, y: 540 + (1 - r) * 30, o: r });
      void pBefore;
    },
  };
}

export const depth = { director, trace, approval, studio };
void clamp;
void lerp;
