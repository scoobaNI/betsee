// Acts 4-7: Betsee Desk (the native chat app), the Gateway's fifteen stages as a track the camera
// rides, the same request decided the same way, and AI second, in the product's own words.
import { Callout, Screen, capState, chip, clamp, cut, ease, el, icon, kf, lerp, put, rectOf, seg, svgEl, text } from "../lib.js";

const soft = (t, a, d = 0.9) => seg(t, a, a + d, ease.soft);
const camera = (t, keys) => kf(t, keys, ease.inOutQuint);
const showFor = (t, a, b) => Math.min(soft(t, a, 0.8), 1 - seg(t, b - 0.4, b));

// ------------------------------------------------------------------ act 4: Betsee Desk

function desk(root, ctx) {
  const n10 = ctx.vo("n10");
  const n11 = ctx.vo("n11");
  const screen = new Screen(root, ["desk-setup", "desk-empty", "desk-work", "desk-input", "desk-guard"], { w: 1500, h: 900, native: true, title: "Betsee Desk" });
  const svg = svgEl("svg", { width: 1920, height: 1080, class: "abs" }, root);
  const over = el("div", "fill", root);
  const cover = el("div", "abs", over);
  cover.style.background = "#ffffff";
  const C = (title, sub, mono) => new Callout(over, svg, { title, sub, mono });
  const co = {
    claude: C("Claude Code", "The person's own sign-in or API key"),
    codex: C("Codex", "Its own sign-in, in a Betsee-owned CODEX_HOME"),
    filter: C("Checked before the model sees it", "", "CTL-IN-001 · input filter"),
    blocked: C("Never sent", "IBAN by mod-97, card numbers by Luhn", "CTL-IN-001"),
    hook: C("PreToolUse hook", "The runtime asks before it runs anything", "POST /api/v1/actions · as employee-assistant"),
    decision: C("Decided by the Gateway", "", "Allowed · CTL-RT-001 · CTL-CAP-001"),
    tier: C("Above the session ceiling", "", "Denied · CTL-TIER-001"),
    egress: C("No network egress", "", "Denied · CTL-RT-001"),
  };
  const unreachable = el(
    "div",
    "card",
    over,
    `<div style="padding:22px 26px;width:640px"><div style="display:flex;align-items:center;gap:12px;font-size:22px;font-weight:640"><span style="color:#e0484e;display:inline-flex">${icon("streamline-flex:warning-diamond", 24)}</span> Gateway unreachable ${chip("deny")}</div>
     <div style="font-size:18px;color:#4b5466;margin-top:10px;line-height:1.45">The Gateway could not be reached, so the agent runtime was not allowed to run this.</div>
     <div class="mono" style="font-size:15px;color:#3a5bd9;margin-top:10px">fail closed · nothing runs without a decision</div></div>`,
  );
  const R = (n, k) => rectOf(n, k);
  const claude = R("desk-setup", "claude");
  const codex = R("desk-setup", "codex");
  const tool = R("desk-work", "toolRead");
  const allowed = R("desk-work", "allowedChip");
  const name = R("desk-work", "toolName");
  const filter = R("desk-work", "filterNote");
  const notSent = R("desk-input", "notSent");
  const tierChip = R("desk-guard", "tierChip");
  const egressChip = R("desk-guard", "egressChip");
  const composer = R("desk-empty", "composer");
  const pSetup = ctx.phrase("n09", 1);
  const pDesk = ctx.phrase("n09", 2);
  const pCards = ctx.phrase("n10", 1);
  const pReach = ctx.phrase("n11", 1);
  const FULL = [0, 0, 1600, 960];
  const both = { x: claude.x, y: claude.y, w: codex.x + codex.w - claude.x, h: claude.h };
  ctx.cue(pDesk + 0.1, "whoosh");
  ctx.cue(pCards + 0.3, "deny");
  ctx.cue(n11.at + 0.8, "allow");
  ctx.cue(pReach + 0.3, "deny");
  return {
    update(t) {
      const enter = soft(t, 0, 1.2);
      screen.place({ x: 960, y: 572 + (1 - enter) * 50, s: 0.88 * (0.95 + 0.05 * enter), o: enter, rx: (1 - enter) * 10 });
      const onEmpty = t >= pDesk - 0.2 && t < n10.at + 0.4;
      const onWork = (t >= n10.at + 0.4 && t < pCards - 0.2) || (t >= n11.at - 0.3 && t < n11.end + 0.4);
      const onInput = t >= pCards - 0.2 && t < n11.at - 0.3;
      const onGuard = t >= n11.end + 0.4;
      screen.only("desk-setup");
      const fadeIn = (a) => seg(t, a, a + 0.35);
      if (onEmpty) screen.show("desk-empty", fadeIn(pDesk - 0.2));
      if (onWork) screen.show("desk-work", fadeIn(t < n11.at ? n10.at + 0.4 : n11.at - 0.3));
      if (onInput) screen.show("desk-input", fadeIn(pCards - 0.2));
      if (onGuard) screen.show("desk-guard", fadeIn(n11.end + 0.4));
      if (onEmpty || onWork || onInput || onGuard) screen.show("desk-setup", 0);
      const box = (r, padX, padY) => [r.x - padX, r.y - padY, r.w + padX * 2, r.h + padY * 2];
      screen.look(
        camera(t, [
          [0, [260, 40, 1100, 660]],
          [pSetup, box(both, 60, 120)],
          [pDesk - 0.3, box(both, 60, 120)],
          [pDesk, FULL],
          [pDesk + 1.4, box(composer, 160, 260)],
          [n10.at + 0.4, [380, 60, 860, 516]],
          [pCards - 0.2, [380, 60, 860, 516]],
          [pCards + 0.6, box(notSent, 300, 200)],
          [n11.at - 0.3, box(tool, 140, 170)],
          [n11.end + 0.4, box(tool, 140, 170)],
          [n11.end + 1.2, [380, 140, 860, 516]],
        ]),
      );
      // Typing the request.
      const typing = seg(t, pDesk + 0.5, pDesk + 2.0, ease.linear);
      const [x0, y0] = screen.map(composer.x + 46, composer.y + 14);
      const [x1, y1] = screen.map(composer.x + composer.w - 60, composer.y + 46);
      const left = lerp(x0, x1, typing);
      Object.assign(cover.style, { width: `${Math.max(0, x1 - left)}px`, height: `${y1 - y0}px`, transform: `translate(${left}px, ${y0}px)` });
      cover.style.opacity = onEmpty && typing < 1 ? 1 : 0;
      const at = (r, dx = 0, dy = 0) => screen.map(r.x + r.w / 2 + dx, r.y + r.h / 2 + dy);
      co.claude.update(at(claude, 0, -claude.h / 2 + 40), [300, 300], showFor(t, pSetup + 0.2, pDesk - 0.1));
      co.codex.update(at(codex, 0, -codex.h / 2 + 40), [1640, 300], showFor(t, pSetup + 0.6, pDesk - 0.1));
      co.filter.update(at(filter), [1580, 330], showFor(t, n10.at + 0.8, pCards - 0.2));
      co.blocked.update(at(notSent), [1560, 820], showFor(t, pCards + 0.7, n11.at - 0.3));
      co.hook.update(at(name), [360, 230], showFor(t, n11.at + 0.3, pReach - 0.1));
      co.decision.update(at(allowed), [1600, 230], showFor(t, n11.at + 0.9, pReach - 0.1));
      co.tier.update(at(tierChip), [1640, 330], showFor(t, n11.end + 1.2, ctx.length));
      co.egress.update(at(egressChip), [1640, 800], showFor(t, n11.end + 1.6, ctx.length));
      const u = showFor(t, pReach, n11.end + 0.5);
      put(unreachable, { x: 960, y: 830, o: u, s: 0.96 + 0.04 * u });
    },
  };
}

// ------------------------------------------------------------------ act 5: the Gateway, a track of fifteen stages

const STAGES = [
  ["Authenticate", "key", "OAuth client credentials", 1.8],
  ["Resolve context", "route", "session · use case · human", 3.1],
  ["Identity", "id", "agent lifecycle · CTL-ID-002", 0.4],
  ["Capability", "tag", "delegated ∩ permitted · CTL-CAP-001", 0.3],
  ["Cedar policy", "scale", "explicit forbid wins", 0.9],
  ["Information tier", "layers", "session ceiling · CTL-TIER-001", 0.2],
  ["Command validation", "code", "templates · pinned tools", 0.3],
  ["Budget", "gauge", "spend · rate · breaker", 0.2],
  ["AI analysis", "sparkles", "may only tighten · CTL-AI-001", 182],
  ["Decision", "target", "allow · deny · approval · step-up", 0.1],
  ["Approval", "hand", "exact action · CTL-APR-001", 0],
  ["Step-up", "fingerprint", "one-time code · acr 2", 0],
  ["Connector", "link", "MCP · agent runtime · model", 24],
  ["Output controls", "filter", "CTL-OUT-001", 0.6],
  ["Audit", "list", "trace · spans · evidence", 2.4],
];
const GROUPS = [
  ["Who is asking", 0, 2],
  ["What may it do", 3, 7],
  ["AI, second", 8, 8],
  ["Decision and people", 9, 11],
  ["Execution and audit", 12, 14],
];
const STEP = 460;
const CW = 410;
const CH = 210;
const TRACK_Y = 560;
const sx = (i) => 300 + i * STEP;

function gateway(root, ctx) {
  root.classList.add("dots");
  const n12 = ctx.vo("n12");
  const n14 = ctx.vo("n14");
  const world = el("div", "abs", root);
  world.style.transformOrigin = "0 0";
  const svg = svgEl("svg", { width: sx(14) + 600, height: 1080, class: "abs" }, world);
  svgEl("line", { x1: sx(0) - 300, y1: TRACK_Y, x2: sx(14) + 400, y2: TRACK_Y, stroke: "rgba(58,91,217,.18)", "stroke-width": 3, "stroke-dasharray": "2 12", "stroke-linecap": "round" }, svg);
  const lit = svgEl("line", { x1: sx(0) - 300, y1: TRACK_Y, x2: sx(0) - 300, y2: TRACK_Y, stroke: "#3a5bd9", "stroke-width": 4, "stroke-linecap": "round" }, svg);
  const cards = STAGES.map(([name, glyph, detail, ms], i) => {
    const ai = i === 8;
    const c = el(
      "div",
      "card",
      world,
      `<div style="width:${CW}px;height:${CH}px;padding:26px 28px;box-sizing:border-box;position:relative">
        <div style="display:flex;justify-content:space-between;align-items:center"><span class="mono" style="font-size:16px;color:#8a94a6">${String(i + 1).padStart(2, "0")}</span><span class="ok" style="display:inline-flex;color:${ai ? "#cf3f97" : "#14a05a"}">${icon("circle-check", 26)}</span></div>
        <div style="display:flex;align-items:center;gap:14px;margin-top:22px"><span style="display:grid;place-items:center;width:48px;height:48px;border-radius:14px;background:${ai ? "#fcedf6" : "#eef2fd"};color:${ai ? "#cf3f97" : "#3a5bd9"}">${icon(glyph, 26)}</span><span style="font-size:25px;font-weight:660;letter-spacing:-0.02em;white-space:nowrap">${name}</span></div>
        <div class="mono" style="font-size:15px;color:#4b5466;margin-top:18px;white-space:nowrap">${detail}</div>
        <div class="mono ms" style="position:absolute;right:26px;bottom:22px;font-size:15px;color:#8a94a6">${ms ? `${ms} ms` : "not needed"}</div></div>`,
    );
    c.style.borderRadius = "26px";
    return c;
  });
  const groups = GROUPS.map(([label, a, b]) => ({ n: el("div", "abs eyebrow", world, label), x: (sx(a) + sx(b)) / 2 }));
  const token = el("div", "abs", world, `<span class="token" style="height:56px"><span class="bot">${icon("bot", 20)}</span><span class="mono" style="font-size:19px">invoice-assistant</span><span class="mono" style="font-size:19px;color:#3a5bd9">files.read</span></span>`);
  const aiNote = el("div", "abs", world, `<span class="pill" style="height:50px;font-size:21px;color:#a32a76;box-shadow:0 0 0 1.5px #f0b5d8">${icon("sparkles", 18)} After policy. It can only make a decision stricter.</span>`);
  const title = el("div", "h lg", root, `Fifteen <span class="blue">deterministic</span> stages.`);
  const eyebrow = el("div", "abs eyebrow", root, "Betsee Gateway");
  // The trace the walk leaves behind.
  const panel = el("div", "card", root);
  Object.assign(panel.style, { width: "1500px", padding: "30px 36px", boxSizing: "border-box" });
  const total = STAGES.reduce((a, s) => a + s[3], 0);
  panel.innerHTML =
    `<div style="display:flex;align-items:center;gap:14px"><span style="font-size:28px;font-weight:680">Trace</span><span class="mono" style="font-size:17px;color:#8a94a6">4bf92f35</span>${chip("allow")}<span style="margin-left:auto;font-size:18px;color:#4b5466">15 spans · ${total.toFixed(1)} ms in the Gateway</span></div>` +
    `<div style="margin-top:20px;display:grid;grid-template-columns:230px 1fr 100px;row-gap:7px;align-items:center">` +
    STAGES.map(([name, , , ms], i) => {
      const before = STAGES.slice(0, i).reduce((a, s) => a + s[3], 0);
      return `<span style="font-size:16px;color:${ms ? "#2b3240" : "#b4bcc8"}">${name}</span><span style="position:relative;height:14px;background:#f2f4f7;border-radius:7px"><i class="bar" style="position:absolute;left:${(before / total) * 100}%;width:${ms ? Math.max(0.5, (ms / total) * 100) : 0}%;top:0;bottom:0;border-radius:7px;background:${i === 8 ? "#cf3f97" : "#3a5bd9"};transform-origin:0 50%"></i></span><span class="mono" style="font-size:14px;color:#8a94a6;text-align:right">${ms ? `${ms} ms` : "not needed"}</span>`;
    }).join("") +
    `</div>`;
  const bars = [...panel.querySelectorAll(".bar")];
  const spanCap = el("div", "h md", root, `Every stage is a <span class="blue">span</span>.`);
  const traceCap = el("div", "h md", root, `Every decision is a <span class="blue">trace</span>.`);
  // When the camera reaches each stage, in track order: the narration names most of them.
  const p13 = (k) => ctx.phrase("n13", k);
  const p15 = (k) => ctx.phrase("n15", k);
  const reach = [n12.at + 0.6, p13(0) - 0.35, p13(0), p13(2), p13(3), p13(4), p13(5), p13(6), n14.at, n14.end - 0.2, p15(0), p15(1), p15(2), (p15(2) + p15(3)) / 2, p15(3)];
  const tSpan = p15(-2);
  const tTrace = p15(-1);
  reach.forEach((r) => ctx.cue(r, "tick"));
  ctx.cue(tSpan - 0.2, "whoosh");
  return {
    update(t) {
      let i = 0;
      while (i < 14 && t >= reach[i + 1]) i++;
      const pos = t < reach[0] ? sx(0) - (1 - soft(t, 0, 1.2)) * 600 : lerp(sx(Math.max(0, i - 1)), sx(i), ease.inOutQuint(clamp((t - reach[i]) / 0.55)));
      // The whole track at once, when every stage has become a span.
      const out = seg(t, tSpan - 0.4, tSpan + 0.8, ease.inOutQuint);
      const zoom = lerp(1, 0.26, out);
      const camX = lerp(pos, (sx(0) + sx(14)) / 2, out);
      world.style.transform = `translate(960px, ${lerp(560, 520, out)}px) scale(${zoom}) translate(${-camX}px, ${-TRACK_Y}px)`;
      world.style.opacity = 1 - seg(t, tSpan + 0.5, tSpan + 1.0);
      cards.forEach((c, k) => {
        const done = t >= reach[k];
        const here = done && (k === 14 || t < reach[k + 1]);
        put(c, { x: sx(k), y: TRACK_Y - (here ? 14 : 0), s: here ? 1.05 : 1 });
        c.style.boxShadow = here
          ? `0 0 0 2.5px ${k === 8 ? "#cf3f97" : "#3a5bd9"}, 0 40px 80px -30px ${k === 8 ? "rgba(207,63,151,.5)" : "rgba(58,91,217,.5)"}`
          : done
            ? "0 0 0 1.5px rgba(58,91,217,.3), 0 20px 50px -30px rgba(16,24,40,.3)"
            : "";
        const p = soft(t, reach[k] + 0.2, 0.5);
        const ok = c.querySelector(".ok");
        ok.style.opacity = p;
        ok.style.transform = `scale(${0.6 + 0.4 * p})`;
        c.querySelector(".ms").style.opacity = p;
      });
      lit.setAttribute("x2", pos);
      groups.forEach((gr) => put(gr.n, { x: gr.x, y: TRACK_Y - CH / 2 - 54, o: 0.9 }));
      put(token, { x: pos, y: TRACK_Y + CH / 2 + 60, o: soft(t, 0, 0.6) });
      put(aiNote, { x: sx(8), y: TRACK_Y - CH / 2 - 120, o: showFor(t, n14.at + 0.4, n14.end + 0.4) });
      const e = capState(t, 0.2, reach[2] + 0.2, { fout: 0.5 });
      text(eyebrow, { x: 130, y: 120, o: e.o });
      text(title, { x: 130, y: 200, o: e.o, dy: e.dy, blur: e.blur });
      const tp = soft(t, tSpan + 0.4, 1.0);
      put(panel, { x: 960, y: 610 + (1 - tp) * 40, o: tp });
      bars.forEach((b, k) => (b.style.transform = `scaleX(${clamp((t - tSpan - 0.6 - k * 0.05) / 0.4)})`));
      const sc = capState(t, tSpan, tTrace - 0.05, { fout: 0.3 });
      const tc = capState(t, tTrace, ctx.length + 1, { fout: 0.4 });
      text(spanCap, { x: 210, y: 140, o: sc.o, dy: sc.dy, blur: sc.blur });
      text(traceCap, { x: 210, y: 140, o: tc.o, dy: tc.dy, blur: tc.blur });
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
  const runs = [0.35, 1.35, 2.35, ctx.phrase("n17", 0) + 0.2, ctx.phrase("n17", 1) + 0.1, ctx.phrase("n17", 3) + 0.2];
  const flip = ctx.phrase("n17", 2) + 0.3;
  const results = runs.map((_, i) =>
    el("div", "abs", root, `<span style="display:inline-flex;align-items:center;gap:16px"><span class="mono" style="font-size:16px;color:#8a94a6;width:58px">run ${i + 1}</span>${chip(i < 5 ? "deny" : "allow", { size: "lg", label: i < 5 ? "Denied" : "Allowed" })}</span>`),
  );
  runs.forEach((at, i) => ctx.cue(at + TRAVEL, i < 5 ? "deny" : "allow"));
  ctx.cue(flip, "tick");
  return {
    update(t) {
      const cp = soft(t, 0, 0.8);
      put(cond, { x: 450, y: 560 + (1 - cp) * 20, o: cp });
      ceilingVal.textContent = t >= flip ? "Confidential" : "Internal";
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
        put(results[i], { x: PLANE + 240 - (1 - rp) * 30, y: 330 + i * 78, o: local >= TRAVEL ? rp : 0, s: 0.9 + 0.1 * rp });
      });
      put(token, { x: tokX, y: 560, o: tokO });
      flash.style.boxShadow = `0 0 0 3px ${flashC}, 0 0 30px ${flashC}`;
      put(flash, { x: PLANE, y: 560, s: 1 + (1 - flashO) * 2.2, o: flashO });
      const d = Math.min(soft(t, n16.at - 0.2, 0.6), 1 - seg(t, n16.end + 0.3, n16.end + 0.9));
      dim.style.opacity = d;
      thesis.forEach((n, i) => {
        const st = capState(t, ctx.phrase("n16", i), n16.end + 0.9, { fin: 0.6, fout: 0.5 });
        text(n, { x: 960, y: 400 + i * 130, ax: 0.5, o: st.o, dy: st.dy, blur: st.blur });
      });
    },
  };
}

// ------------------------------------------------------------------ act 7: AI second, in the product's own words

function aisecond(root, ctx) {
  const n18 = ctx.vo("n18b");
  const pNever = n18.at;
  const BLOCK = { x: 395, y: 865, w: 1256, h: 205 };
  const makeRow = (name) => {
    const g = el("div", "abs", root);
    Object.assign(g.style, { width: `${BLOCK.w}px`, height: `${BLOCK.h}px` });
    const parts = ["detCtl", "aiBox", "finalBox"].map((k) => {
      const r = rectOf(name, k);
      const p = cut(name, { ...r, radius: 18 }, g, "lifted");
      p.style.left = `${r.x - BLOCK.x}px`;
      p.style.top = `${r.y - BLOCK.y}px`;
      return p;
    });
    const arrows = ["aiBox", "finalBox"].map((k) => {
      const a = el("div", "abs", g, icon("arrow-right", 30));
      const r = rectOf(name, k);
      Object.assign(a.style, { color: "#8a94a6", left: `${r.x - BLOCK.x - 36}px`, top: `${r.y - BLOCK.y + r.h / 2 - 15}px` });
      return a;
    });
    return { g, parts, arrows };
  };
  const tight = makeRow("dir-trace-tightened");
  const hold = makeRow("dir-trace-tier");
  const title = el("div", "h lg", root, `AI may <span class="pink">tighten</span>.`);
  const title2 = el("div", "h lg", root, `It can never <span class="blue">loosen</span> your boundary.`);
  const eyebrow = el("div", "abs eyebrow", root, "Deterministic first, AI second");
  const note = el("div", "abs", root, `<span class="pill" style="height:50px;font-size:20px">${icon("sparkles", 18)} Instructions found inside data: <b style="margin-left:6px">rejected, stricter than policy</b></span>`);
  const lock = el("div", "abs", root, `<span class="pill" style="height:54px;font-size:21px;gap:12px;box-shadow:0 0 0 2px #3a5bd9"><span style="color:#3a5bd9;display:inline-flex">${icon("lock", 20)}</span>A deterministic deny stays a deny</span>`);
  const stat = el("div", "abs", root);
  const loosened = rectOf("dir-determinism", "loosened");
  cut("dir-determinism", { ...loosened, radius: 22 }, stat, "lifted");
  Object.assign(stat.style, { width: `${loosened.w}px`, height: `${loosened.h}px` });
  const statNote = el("div", "abs eyebrow", root, "Director · Determinism");
  statNote.style.color = "#8a94a6";
  ctx.cue(ctx.vo("n18").at + 1.4, "tick");
  ctx.cue(pNever + 0.8, "deny");
  return {
    update(t) {
      const show = (row, a, b) => {
        const o = Math.min(soft(t, a, 0.6), 1 - seg(t, b - 0.4, b));
        put(row.g, { x: 960, y: 560, o, s: 1.12 });
        row.parts.forEach((p, i) => {
          const q = soft(t, a + 0.25 + i * 0.55, 0.6);
          p.style.opacity = q;
          p.style.transform = `translateY(${(1 - q) * 24}px) scale(${0.96 + 0.04 * q})`;
        });
        row.arrows.forEach((ar, i) => (ar.style.opacity = soft(t, a + 0.55 + i * 0.55, 0.4)));
      };
      show(tight, 0, pNever - 0.1);
      show(hold, pNever - 0.1, ctx.length + 1);
      const a = capState(t, 0.1, pNever - 0.1, { fout: 0.4 });
      const b = capState(t, pNever, ctx.length + 1, { fout: 0.4 });
      text(eyebrow, { x: 140, y: 140, o: Math.max(a.o, b.o) });
      text(title, { x: 140, y: 225, o: a.o, dy: a.dy, blur: a.blur });
      text(title2, { x: 140, y: 225, o: b.o, dy: b.dy, blur: b.blur });
      put(note, { x: 960, y: 800, o: showFor(t, 2.0, pNever - 0.1) });
      const l = soft(t, pNever + 0.8, 0.6);
      put(lock, { x: 960, y: 800, o: l, s: 0.9 + 0.1 * l });
      const st = soft(t, n18.end + 0.3, 0.8);
      put(stat, { x: 1600, y: 360 + (1 - st) * 20, o: st, s: 0.92 });
      put(statNote, { x: 1600, y: 225, o: st });
    },
  };
}

export const product = { desk, gateway, same, aisecond };
