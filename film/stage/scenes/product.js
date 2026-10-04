// Acts 4-7: Betsee Desk (the native chat app), the Gateway's fifteen stages, the same request
// decided the same way, and AI second.
import { Callout, Screen, capState, chip, clamp, ease, el, icon, kf, lerp, noise1, put, rectOf, seg, svgEl, text } from "../lib.js";

const soft = (t, a, d = 0.9) => seg(t, a, a + d, ease.soft);
const mid = (r) => [r.x + r.w / 2, r.y + r.h / 2];

/** Moves a screen's camera through [time, rect] keys with long, soft eases. */
const camera = (t, keys) => kf(t, keys, ease.inOutQuint);

// ------------------------------------------------------------------ act 4: Betsee Desk

function desk(root, ctx) {
  const n09 = ctx.vo("n09");
  const n10 = ctx.vo("n10");
  const n11 = ctx.vo("n11");
  const screen = new Screen(root, ["desk-setup", "desk-empty", "desk-work", "desk-input", "desk-guard"], { w: 1500, h: 900, native: true, title: "Betsee Desk" });
  const svg = svgEl("svg", { width: 1920, height: 1080, class: "abs" }, root);
  const over = el("div", "fill", root);
  // Typing in the composer: a cover over the captured text that slides away.
  const cover = el("div", "abs", over);
  Object.assign(cover.style, { height: "40px", background: "#ffffff" });
  const callouts = {
    claude: new Callout(over, svg, { title: "Claude Code", sub: "The person's own sign-in or API key" }),
    codex: new Callout(over, svg, { title: "Codex", sub: "Its own sign-in, in a Betsee-owned CODEX_HOME" }),
    filter: new Callout(over, svg, { title: "Checked before the model sees it", mono: "CTL-IN-001 · input filter" }),
    blocked: new Callout(over, svg, { title: "Not sent", sub: "IBAN found by mod-97 checksum; card numbers by Luhn", mono: "CTL-IN-001" }),
    hook: new Callout(over, svg, { title: "PreToolUse hook", sub: "The runtime asks before it runs anything", mono: "POST /api/v1/actions · as employee-assistant" }),
    decision: new Callout(over, svg, { title: "Decided by the Gateway", mono: "Allowed · CTL-RT-001 · CTL-CAP-001" }),
    tier: new Callout(over, svg, { title: "Above the session ceiling", mono: "Denied · CTL-TIER-001" }),
    egress: new Callout(over, svg, { title: "No network egress", mono: "Denied · CTL-RT-001" }),
  };
  const unreachable = el(
    "div",
    "card",
    over,
    `<div style="padding:22px 26px;width:620px"><div style="display:flex;align-items:center;gap:12px;font-size:22px;font-weight:640">${icon("streamline-flex:warning-diamond", 24)} Gateway unreachable ${chip("deny")}</div>
     <div style="font-size:18px;color:#4b5466;margin-top:10px;line-height:1.45">The Gateway could not be reached, so the agent runtime was not allowed to run this.</div>
     <div class="mono" style="font-size:15px;color:#3a5bd9;margin-top:10px">fail closed · nothing runs without a decision</div></div>`,
  );
  unreachable.querySelector("svg").style.color = "#e0484e";
  const caption = el("div", "h sm center", root, `Your assistant. <span class="blue">Betsee's boundary.</span>`);

  const t0 = n09.at;
  const pSetup = ctx.phrase("n09", 1);
  const pDesk = ctx.phrase("n09", 2);
  const pCards = ctx.phrase("n10", 1);
  const pReach = ctx.phrase("n11", 1);
  const toolR = rectOf("desk-work", "toolRead");
  const blockR = rectOf("desk-input", "blocked");
  const egressR = rectOf("desk-guard", "toolEgress");
  const FULL = [0, 0, 1600, 960];
  const CHAT = [380, 0, 860, 520];
  ctx.cue(pDesk + 0.2, "whoosh");
  ctx.cue(pCards + 0.2, "deny");
  ctx.cue(n11.at + 0.9, "allow");
  ctx.cue(pReach + 0.3, "deny");

  return {
    pre: 0.5,
    update(t) {
      const enter = soft(t, -0.5, 1.4);
      const zoomOut = seg(t, ctx.length - 1.0, ctx.length, ease.inOutQuint);
      screen.place({ x: 960, y: 575 + (1 - enter) * 60, s: 0.86 * (0.96 + 0.04 * enter) - zoomOut * 0.05, o: enter, rx: (1 - enter) * 8 });
      // Which screen is up.
      const onEmpty = t >= pDesk - 0.2 && t < n10.at + 0.4;
      const onWork = (t >= n10.at + 0.4 && t < pCards - 0.2) || (t >= n11.at - 0.3 && t < n11.end + 0.4);
      const onInput = t >= pCards - 0.2 && t < n11.at - 0.3;
      const onGuard = t >= n11.end + 0.4;
      const fadeIn = (a) => seg(t, a, a + 0.35);
      screen.only("desk-setup");
      if (onEmpty) screen.show("desk-empty", fadeIn(pDesk - 0.2));
      if (onWork) screen.show("desk-work", fadeIn(t < n11.at ? n10.at + 0.4 : n11.at - 0.3));
      if (onInput) screen.show("desk-input", fadeIn(pCards - 0.2));
      if (onGuard) screen.show("desk-guard", fadeIn(n11.end + 0.4));
      if (onEmpty || onWork || onInput || onGuard) screen.show("desk-setup", 0);
      // Camera.
      const view = camera(t, [
        [0, FULL],
        [pDesk, FULL],
        [pDesk + 1.2, [300, 400, 1000, 600]],
        [n10.at + 0.4, CHAT],
        [pCards - 0.2, CHAT],
        [pCards + 0.6, [blockR.x - 80, blockR.y - 70, blockR.w + 160, blockR.h + 260]],
        [n11.at - 0.3, [toolR.x - 120, toolR.y - 150, toolR.w + 240, toolR.h + 300]],
        [n11.end + 0.4, [toolR.x - 120, toolR.y - 150, toolR.w + 240, toolR.h + 300]],
        [n11.end + 1.2, [380, 140, 860, 460]],
      ]);
      screen.look(view);
      // Typing.
      const typing = seg(t, pDesk + 0.5, pDesk + 2.0, ease.linear);
      const [cx0, cy0] = screen.map(478, 733);
      const [cx1] = screen.map(1060, 733);
      const left = lerp(cx0, cx1, typing);
      cover.style.width = `${Math.max(0, cx1 - left + 8)}px`;
      cover.style.transform = `translate(${left}px, ${cy0}px) scale(1, ${screen.k * 0.86 / 0.86})`;
      cover.style.height = `${34 * screen.k * screen.at.s}px`;
      cover.style.opacity = onEmpty && typing < 1 ? 1 : 0;
      // Callouts.
      const cl = (name, anchor, at, a, b) => callouts[name].update(screen.map(...anchor), at, Math.min(soft(t, a, 0.8), 1 - seg(t, b - 0.4, b)));
      cl("claude", [420, 290], [250, 330], pSetup, pDesk - 0.1);
      cl("codex", [1150, 290], [1700, 330], pSetup + 0.4, pDesk - 0.1);
      cl("filter", [1180, 176], [1600, 300], n10.at + 0.8, pCards - 0.2);
      cl("blocked", [blockR.x + blockR.w - 300, blockR.y + 60], [1520, 760], pCards + 0.6, n11.at - 0.3);
      cl("hook", [toolR.x + 90, toolR.y + 30], [330, 230], n11.at + 0.3, pReach - 0.1);
      cl("decision", [toolR.x + toolR.w - 70, toolR.y + 30], [1590, 230], n11.at + 1.0, pReach - 0.1);
      const egress = mid(egressR);
      cl("tier", [egressR.x + egressR.w - 70, egressR.y - 115], [1610, 300], n11.end + 1.2, ctx.length);
      cl("egress", [egressR.x + egressR.w - 70, egress[1] - 35], [1610, 820], n11.end + 1.5, ctx.length);
      const u = Math.min(soft(t, pReach, 0.7), 1 - seg(t, n11.end + 0.1, n11.end + 0.5));
      put(unreachable, { x: 960, y: 820, o: u, s: 0.96 + 0.04 * u });
      const c = capState(t, 0.3, t0 + 0.2, { fout: 0.4 });
      text(caption, { x: 960, y: 70, ax: 0.5, o: c.o * 0, dy: c.dy });
    },
  };
}

// ------------------------------------------------------------------ act 5: fifteen stages

const STAGES = [
  ["Authenticate", "key", "OAuth client credentials"],
  ["Resolve context", "route", "session · use case · human"],
  ["Identity", "id", "agent lifecycle · CTL-ID-002"],
  ["Capability", "tag", "delegated ∩ permitted · CTL-CAP-001"],
  ["Cedar policy", "scale", "explicit forbid wins"],
  ["Information tier", "layers", "session ceiling · CTL-TIER-001"],
  ["Command validation", "code", "templates · pinned tools"],
  ["Budget", "gauge", "spend · rate · breaker"],
  ["AI analysis", "sparkles", "may only tighten · CTL-AI-001"],
  ["Decision", "target", "allow · deny · approval · step-up"],
  ["Approval", "hand", "exact action · CTL-APR-001"],
  ["Step-up", "fingerprint", "one-time code · acr 2"],
  ["Connector", "link", "MCP · agent runtime · model"],
  ["Output controls", "filter", "CTL-OUT-001"],
  ["Audit", "list", "trace · spans · evidence"],
];
const SPANS = [1.8, 3.1, 0.4, 0.3, 0.9, 0.2, 0.3, 0.2, 182, 0.1, 0, 0, 24, 0.6, 2.4];
const CW = 322;
const CH = 128;
const GX = 22;
const GY = 40;
const cardAt = (i) => {
  const row = Math.floor(i / 5);
  const col = i % 5;
  return [100 + CW / 2 + col * (CW + GX), 420 + row * (CH + GY)];
};

function gateway(root, ctx) {
  root.classList.add("dots");
  const n12 = ctx.vo("n12");
  const n13 = ctx.vo("n13");
  const n14 = ctx.vo("n14");
  const n15 = ctx.vo("n15");
  const svg = svgEl("svg", { width: 1920, height: 1080, class: "abs" }, root);
  const pathPts = STAGES.map((_, i) => cardAt(i));
  // Each row reads left to right; the rail returns to the start of the next row.
  const railPts = pathPts.map((p) => p.join(",")).join(" ");
  const rail = svgEl("polyline", { points: railPts, fill: "none", stroke: "rgba(58,91,217,.18)", "stroke-width": 2.5, "stroke-dasharray": "2 10", "stroke-linecap": "round" }, svg);
  const cards = STAGES.map(([name, glyph, detail], i) => {
    const c = el("div", "stage-card", root, `<div class="n">${String(i + 1).padStart(2, "0")}</div><div class="t"><span class="g" style="color:#8a94a6">${icon(glyph, 22)}</span>${name}</div><div class="d">${detail}</div>`);
    return c;
  });
  const token = el("div", "abs", root, `<span class="token" style="height:46px;font-size:17px"><span class="bot" style="width:32px;height:32px">${icon("bot", 18)}</span><span class="mono">files.read</span></span>`);
  const eyebrow = el("div", "abs eyebrow", root, "Betsee Gateway");
  const title = el("div", "h lg", root, `Fifteen <span class="blue">deterministic</span> stages.`);
  const aiNote = el("div", "abs", root, `<span class="pill" style="height:48px;font-size:20px;color:#a32a76;box-shadow:0 0 0 1.5px #f0b5d8">${icon("sparkles", 18)} After policy. It can only make a decision stricter.</span>`);
  // The trace: one row per stage, laid out on one time axis.
  const panel = el("div", "card", root);
  Object.assign(panel.style, { width: "1500px", padding: "30px 36px", boxSizing: "border-box" });
  const total = SPANS.reduce((a, b) => a + b, 0);
  panel.innerHTML =
    `<div style="display:flex;align-items:center;gap:14px"><span style="font-size:26px;font-weight:660">Trace</span><span class="mono" style="font-size:17px;color:#8a94a6">4bf92f35</span>${chip("allow")}<span style="margin-left:auto;font-size:18px;color:#4b5466">15 spans · ${total.toFixed(1)} ms in the Gateway</span></div>` +
    `<div style="margin-top:20px;display:grid;grid-template-columns:230px 1fr 90px;row-gap:7px;align-items:center">` +
    STAGES.map(([name], i) => {
      const before = SPANS.slice(0, i).reduce((a, b) => a + b, 0);
      const left = (before / total) * 100;
      const w = Math.max(0.5, (SPANS[i] / total) * 100);
      const skipped = SPANS[i] === 0;
      return `<span style="font-size:16px;color:${skipped ? "#b4bcc8" : "#2b3240"}">${name}</span><span style="position:relative;height:14px;background:#f2f4f7;border-radius:7px"><i class="bar" style="position:absolute;left:${left}%;width:${skipped ? 0 : w}%;top:0;bottom:0;border-radius:7px;background:${i === 8 ? "#cf3f97" : "#3a5bd9"}"></i></span><span class="mono" style="font-size:14px;color:#8a94a6;text-align:right">${skipped ? "not needed" : SPANS[i] + " ms"}</span>`;
    }).join("") +
    `</div>`;
  const bars = [...panel.querySelectorAll(".bar")];
  const spanCap = el("div", "h md", root, `Every stage is a <span class="blue">span</span>.`);
  const traceCap = el("div", "h md", root, `Every decision is a <span class="blue">trace</span>.`);

  // When each stage is named in the narration.
  const named = new Map([
    [2, ctx.phrase("n13", 0)],
    [1, ctx.phrase("n13", 1)],
    [3, ctx.phrase("n13", 2)],
    [4, ctx.phrase("n13", 3)],
    [5, ctx.phrase("n13", 4)],
    [6, ctx.phrase("n13", 5)],
    [7, ctx.phrase("n13", 6)],
    [8, n14.at],
    [10, ctx.phrase("n15", 0)],
    [11, ctx.phrase("n15", 1)],
    [12, ctx.phrase("n15", 2)],
    [14, ctx.phrase("n15", 3)],
  ]);
  named.set(0, n12.at + 1.2);
  named.set(9, n14.at + 1.6);
  named.set(13, ctx.phrase("n15", 3) - 0.3);
  const tSpan = ctx.phrase("n15", -2);
  const tTrace = ctx.phrase("n15", -1);
  for (const [, at] of named) ctx.cue(at, "tick");

  return {
    pre: 0.4,
    update(t) {
      root.style.opacity = seg(t, -0.4, 0.2);
      const gridOut = seg(t, tSpan - 0.3, tSpan + 0.5, ease.inOutQuint);
      // Token walks the stages in the order they are named.
      let lit = -1;
      let at = -1;
      for (let i = 0; i < 15; i++) {
        const when = named.get(i) ?? 99;
        if (t >= when && when > at) {
          lit = i;
          at = when;
        }
      }
      cards.forEach((c, i) => {
        const [x, y] = cardAt(i);
        const p = soft(t, n12.at + 0.2 + i * 0.06, 0.9);
        const when = named.get(i) ?? 99;
        const active = lit === i;
        const done = t >= when;
        const ai = i === 8 && t >= n14.at;
        put(c, { x, y: y + (1 - p) * 30 - gridOut * 120, o: p * (1 - gridOut), s: active ? 1.06 : 1 });
        const g = c.querySelector(".g");
        g.style.color = ai ? "#cf3f97" : done ? "#3a5bd9" : "#8a94a6";
        c.style.boxShadow = active
          ? `0 0 0 2px ${ai ? "#cf3f97" : "#3a5bd9"}, 0 24px 60px -18px ${ai ? "rgba(207,63,151,.45)" : "rgba(58,91,217,.45)"}`
          : done
            ? "0 0 0 1px rgba(58,91,217,.25), 0 14px 34px -18px rgba(16,24,40,.25)"
            : "";
      });
      rail.style.opacity = soft(t, n12.at + 0.8, 1.0) * (1 - gridOut);
      if (lit >= 0) {
        const [x, y] = cardAt(lit);
        const prev = cardAt(Math.max(0, lit - 1));
        const m = soft(t, at, 0.5);
        put(token, { x: lerp(prev[0], x, m), y: lerp(prev[1], y, m) - CH / 2 - 14, o: 1 - gridOut });
      } else put(token, { o: 0 });
      const e = capState(t, 0.3, tSpan - 0.2, { fout: 0.4 });
      text(eyebrow, { x: 130, y: 140, o: e.o });
      text(title, { x: 130, y: 215, o: e.o, dy: e.dy, blur: e.blur });
      const ai = Math.min(soft(t, n14.at + 0.4, 0.8), 1 - seg(t, n15.at - 0.3, n15.at));
      const [ax, ay] = cardAt(8);
      put(aiNote, { x: ax - 120, y: ay + CH / 2 + 46, o: ai });
      // The trace.
      const tp = soft(t, tSpan - 0.1, 1.0);
      put(panel, { x: 960, y: 640 - (1 - tp) * -40, o: tp });
      bars.forEach((b, i) => {
        b.style.transform = `scaleX(${clamp((t - tSpan - 0.2 - i * 0.06) / 0.4)})`;
        b.style.transformOrigin = "0 50%";
      });
      const sc = capState(t, tSpan, ctx.length + 0.5, { fout: 0.4 });
      const tc = capState(t, tTrace, ctx.length + 0.5, { fout: 0.4 });
      text(spanCap, { x: 210, y: 150, o: sc.o * (1 - seg(t, tTrace - 0.3, tTrace)), dy: sc.dy, blur: sc.blur });
      text(traceCap, { x: 210, y: 150, o: tc.o, dy: tc.dy, blur: tc.blur });
    },
  };
}

// ------------------------------------------------------------------ act 6: same request, same decision

const COND = [
  ["Identity", "invoice-assistant", "for Maya Chen"],
  ["Use case", "Invoice processing", ""],
  ["Capability", "files.read", ""],
  ["Resource", "finance/payroll-2026.xlsx", "Confidential"],
  ["Session ceiling", "Internal", ""],
  ["Policy", "forbid-resource-above-session-tier", "CTL-TIER-001"],
];
const PLANE = 1230;
const TRAVEL = 0.6;

function same(root, ctx) {
  const n16 = ctx.vo("n16");
  const n17 = ctx.vo("n17");
  const cond = el("div", "card", root);
  Object.assign(cond.style, { width: "600px", padding: "30px 34px", boxSizing: "border-box" });
  cond.innerHTML =
    `<div class="eyebrow" style="font-size:15px">One request, its conditions</div>` +
    COND.map(
      ([k, v, extra], i) =>
        `<div class="row" data-i="${i}" style="display:flex;justify-content:space-between;align-items:center;gap:20px;padding:14px 12px;margin:0 -12px;border-top:${i ? "1px solid #eef0f3" : "0"};margin-top:${i ? 0 : 12}px;border-radius:12px">
          <span style="font-size:19px;color:#667085">${k}</span>
          <span style="text-align:right"><span class="mono val" style="font-size:18px">${v}</span>${extra ? `<span style="display:block;font-size:15px;color:#8a94a6">${extra}</span>` : ""}</span></div>`,
    ).join("");
  const ceilingVal = cond.querySelector('[data-i="4"] .val');
  const ceilingRow = cond.querySelector('[data-i="4"]');
  const plane = el("div", "abs", root);
  Object.assign(plane.style, { width: "4px", height: "620px", borderRadius: "4px", background: "linear-gradient(180deg, transparent, #3a5bd9 8%, #3a5bd9 92%, transparent)", boxShadow: "0 0 24px rgba(58,91,217,.3)" });
  const planeLabel = el("div", "abs", root, `<div class="mono" style="font-size:17px;color:#3a5bd9;text-align:center">forbid-resource-above-session-tier</div><div class="mono" style="font-size:14px;color:#8a94a6;margin-top:6px;text-align:center">CTL-TIER-001 · Cedar</div>`);
  const token = el("div", "abs", root, `<span class="token"><span class="bot">${icon("bot", 20)}</span><span class="mono" style="font-size:18px">files.read</span></span>`);
  const flash = el("div", "abs", root);
  Object.assign(flash.style, { width: "44px", height: "44px", borderRadius: "999px" });
  const dim = el("div", "fill", root);
  dim.style.background = "rgba(251,251,253,.95)";
  const thesis = [`Same conditions.`, `Same policy.`, `<span class="blue">Same decision.</span>`].map((s) => el("div", "h xl center", root, s));

  const lead = 0.35;
  const runs = [lead, lead + 1.0, lead + 2.0, ctx.phrase("n17", 0) + 0.2, ctx.phrase("n17", 1) + 0.1, ctx.phrase("n17", 3) + 0.2];
  const flip = ctx.phrase("n17", 2) + 0.3;
  const results = runs.map((_, i) =>
    el("div", "abs", root, `<span style="display:inline-flex;align-items:center;gap:16px"><span class="mono" style="font-size:16px;color:#8a94a6;width:58px">run ${i + 1}</span>${chip(i < 5 ? "deny" : "allow", { size: "lg", label: i < 5 ? "Denied" : "Allowed" })}</span>`),
  );
  runs.forEach((at, i) => ctx.cue(at + TRAVEL, i < 5 ? "deny" : "allow"));
  ctx.cue(flip, "tick");

  return {
    update(t) {
      const cp = soft(t, -0.1, 0.9);
      put(cond, { x: 450, y: 560 + (1 - cp) * 20, o: cp });
      const changed = t >= flip;
      ceilingVal.textContent = changed ? "Confidential" : "Internal";
      const hl = seg(t, flip, flip + 0.2) * (1 - seg(t, ctx.length - 1, ctx.length));
      ceilingRow.style.boxShadow = `0 0 0 ${hl * 2.5}px rgba(58,91,217,${hl})`;
      ceilingRow.style.background = `rgba(238,242,253,${hl})`;
      const pl = seg(t, 0, 0.6, ease.outExpo);
      put(plane, { x: PLANE, y: 560, sy: pl, o: pl > 0 ? 1 : 0 });
      put(planeLabel, { x: PLANE, y: 220, o: soft(t, 0.2, 0.6) });
      let tokO = 0;
      let tokX = 860;
      let flashO = 0;
      let flashC = "#e0484e";
      runs.forEach((at, i) => {
        const local = t - at;
        const pass = i === 5;
        const w = token.offsetWidth || 200;
        if (local >= 0 && local < TRAVEL + 0.5) {
          // One curve for every run: the same input moves the same way.
          const p = ease.inOut(clamp(local / TRAVEL));
          tokX = lerp(860, pass ? PLANE + 1000 : PLANE - 16 - w / 2, p);
          tokO = Math.min(seg(local, 0, 0.12, ease.linear), pass ? 1 - seg(local, 0.36, 0.5) : 1 - seg(local, TRAVEL + 0.15, TRAVEL + 0.45));
          const hit = local - TRAVEL * (pass ? 0.4 : 1);
          if (hit >= -0.01) {
            flashO = Math.max(flashO, 1 - clamp(hit / 0.4));
            flashC = pass ? "#14a05a" : "#e0484e";
          }
        }
        const rp = ease.soft(clamp((local - TRAVEL) / 0.45));
        put(results[i], { x: PLANE + 90 + 150 - (1 - rp) * 30, y: 330 + i * 78, o: local >= TRAVEL ? rp : 0 });
      });
      put(token, { x: tokX, y: 560, o: tokO });
      flash.style.boxShadow = `0 0 0 3px ${flashC}, 0 0 30px ${flashC}`;
      put(flash, { x: PLANE, y: 560, s: 1 + (1 - flashO) * 2.2, o: flashO });
      // The thesis, over everything, in time with the voice.
      const d = Math.min(soft(t, n16.at - 0.2, 0.6), 1 - seg(t, n16.end + 0.3, n16.end + 0.9));
      dim.style.opacity = d;
      thesis.forEach((n, i) => {
        const st = capState(t, ctx.phrase("n16", i), n16.end + 0.9, { fin: 0.6, fout: 0.5 });
        text(n, { x: 960, y: 400 + i * 130, ax: 0.5, o: st.o, dy: st.dy, blur: st.blur });
      });
    },
  };
}

// ------------------------------------------------------------------ act 7: AI second

function aisecond(root, ctx) {
  const n18 = ctx.vo("n18");
  const slab = el("div", "card", root);
  Object.assign(slab.style, { width: "820px", height: "150px", borderRadius: "22px", boxShadow: "0 0 0 2px #3a5bd9, 0 30px 70px -20px rgba(58,91,217,.35)", overflow: "hidden" });
  slab.innerHTML = `<div style="position:absolute;inset:0;background:repeating-linear-gradient(90deg, rgba(58,91,217,.06) 0 1px, transparent 1px 40px),repeating-linear-gradient(0deg, rgba(58,91,217,.06) 0 1px, transparent 1px 40px)"></div>
    <div style="position:absolute;left:34px;top:50%;transform:translateY(-50%);display:flex;align-items:center;gap:16px;color:#3a5bd9">${icon("scale", 40)}<div><div style="font-size:30px;font-weight:700;letter-spacing:-.02em;color:#0b1220">Deterministic policy</div><div class="mono" style="font-size:16px;color:#8a94a6;margin-top:4px">Cedar · same input, same answer</div></div></div>`;
  const wall = el("div", "abs", root);
  Object.assign(wall.style, { width: "18px", height: "440px", borderRadius: "9px", background: "linear-gradient(90deg, #6a8cff, #3a5bd9)", boxShadow: "0 0 30px rgba(58,91,217,.4)" });
  const wallLabel = el("div", "abs eyebrow", root, "Your boundary");
  const aiSvg = svgEl("svg", { width: 600, height: 380, class: "abs", viewBox: "-300 -190 600 380" }, root);
  const g = svgEl("radialGradient", { id: "aiw" }, svgEl("defs", {}, aiSvg));
  svgEl("stop", { offset: "0", "stop-color": "#ffd0ec" }, g);
  svgEl("stop", { offset: "0.6", "stop-color": "#e46cb8" }, g);
  svgEl("stop", { offset: "1", "stop-color": "#9b4fd0" }, g);
  const blob = svgEl("path", { fill: "url(#aiw)" }, aiSvg);
  const blobLabel = el("div", "abs", root, `<div style="display:flex;align-items:center;gap:10px;font-size:24px;font-weight:680;color:#fff">${icon("sparkles", 24)} AI analysis</div>`);
  const nz = [noise1(21), noise1(22)];
  const outAllow = el("div", "abs", root, chip("allow", { size: "xl" }));
  const outTight = el("div", "abs", root, `<span style="display:inline-flex;gap:14px;align-items:center">${chip("approval", { size: "xl" })}${chip("ai", { size: "lg" })}</span>`);
  const outDeny = el("div", "abs", root, chip("deny", { size: "xl" }));
  const suggest = el("div", "abs", root, `<div class="mono" style="font-size:19px;color:#a32a76;padding:10px 16px;border-radius:12px;background:#fcedf6">model: "looks fine, allow it"</div>`);
  const k1 = el("div", "h lg", root, `AI may <span class="pink">tighten</span>.`);
  const k2 = el("div", "h md", root, `<span class="soft">It can never silently loosen your boundary.</span>`);
  // Then the proof in the product: the Director's determinism page.
  const screen = new Screen(root, ["dir-determinism"], { w: 1560, h: 878, url: "director.betsee.localhost/determinism" });
  const svg = svgEl("svg", { width: 1920, height: 1080, class: "abs" }, root);
  const over = el("div", "fill", root);
  const c1 = new Callout(over, svg, { title: "100% of decisions held by policy", sub: "Same request, same answer" });
  const c2 = new Callout(over, svg, { title: "AI analysis may only tighten", mono: "4 tightened · 0 loosened" });
  const c3 = new Callout(over, svg, { title: "Loosened by AI: 0", sub: "No decision ended less strict than policy" });
  const pTight = ctx.phrase("n18", 1);
  const pNever = ctx.phrase("n18", -1);
  const tScreen = n18.end + 0.6;
  ctx.cue(pTight + 0.9, "tick");
  ctx.cue(pNever + 1.2, "boom");

  return {
    update(t) {
      const end = 1 - seg(t, tScreen - 0.4, tScreen + 0.2);
      const sp = soft(t, -0.1, 0.7);
      put(slab, { x: 760, y: 720 + (1 - sp) * 40, o: sp * end });
      const ap = soft(t, 0.3, 0.8);
      const press = seg(t, pNever + 0.3, pNever + 1.2, ease.inOut);
      const bx = lerp(-60, 300, press);
      const pts = [];
      for (let k = 0; k <= 72; k++) {
        const a = (k / 72) * Math.PI * 2;
        const r = (92 + 8 * nz[0](Math.cos(a) * 1.4 + t * 1.1) + 6 * nz[1](Math.sin(a) * 1.6 + t * 0.7)) * ap;
        let px = Math.cos(a) * r * 1.25 + bx;
        // Against the wall the shape gives way; the wall does not move.
        if (px > 330) px = 330 + (px - 330) * 0.05;
        pts.push(`${px.toFixed(1)} ${(Math.sin(a) * r).toFixed(1)}`);
      }
      blob.setAttribute("d", `M${pts.join(" L")}Z`);
      put(aiSvg, { x: 760, y: 420, o: ap * end });
      put(blobLabel, { x: 760 + bx, y: 420, o: ap * end });
      const wp = seg(t, pNever, pNever + 0.3, ease.snap);
      put(wall, { x: 760 + 330 + 9, y: 470, sy: wp, o: wp * end });
      put(wallLabel, { x: 760 + 340, y: 225, o: wp * end });
      const at = (n) => 1220 + (n.offsetWidth || 300) / 2;
      put(outAllow, { x: at(outAllow), y: 720, o: (t >= 0.5 && t < pTight + 0.9 ? soft(t, 0.5, 0.4) : 0) * end });
      put(outTight, { x: at(outTight), y: 720, o: (t >= pTight + 0.9 && t < pNever ? 1 : 0) * end });
      put(outDeny, { x: at(outDeny), y: 720, o: (t >= pNever ? 1 : 0) * end });
      put(suggest, { x: 640, y: 230, o: Math.min(soft(t, pNever + 0.4, 0.5), 1 - seg(t, n18.end, n18.end + 0.4)) * end });
      const a = capState(t, pTight - 0.1, tScreen, { fout: 0.4 });
      const b = capState(t, pNever, tScreen, { fout: 0.4 });
      text(k1, { x: 130, y: 120, o: a.o, dy: a.dy, blur: a.blur });
      text(k2, { x: 130, y: 205, o: b.o, dy: b.dy, blur: b.blur });
      // The Director, showing it happened.
      const so = soft(t, tScreen - 0.2, 1.0);
      screen.place({ x: 960, y: 560 + (1 - so) * 50, s: 0.98, o: so });
      screen.look(camera(t, [[tScreen, [360, 110, 1560, 878]], [ctx.length, [400, 130, 1500, 844]]]));
      c1.update(screen.map(976, 500), [700, 900], soft(t, tScreen + 0.9, 0.9));
      c2.update(screen.map(1230, 447), [1500, 190], soft(t, tScreen + 1.5, 0.9));
      c3.update(screen.map(1150, 862), [1560, 930], soft(t, tScreen + 2.1, 0.9));
    },
  };
}

export const product = { desk, gateway, same, aisecond };
