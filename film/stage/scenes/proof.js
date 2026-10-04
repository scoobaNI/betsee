// Acts 12-14: four proof shots, risk to evidence, and the enterprise thesis.
import { Callout, Screen, agentMark, capState, chip, clamp, ease, el, icon, kf, lerp, noise1, put, rectOf, rng, seg, svgEl, text } from "../lib.js";

const soft = (t, a, d = 0.9) => seg(t, a, a + d, ease.soft);

/** A Director-style row: capability, target, tier, decision and the control behind it. */
function row(parent, { cap, target, tier = "", decision, controls = "" }) {
  const node = el(
    "div",
    "card",
    parent,
    `<div style="display:flex;align-items:center;gap:16px;padding:20px 26px;width:980px;box-sizing:border-box">
      <span class="agent" style="width:44px;height:44px">${icon("bot", 24)}</span>
      <span class="mono" style="font-size:21px;font-weight:600;color:#3a5bd9">${cap}</span>
      <span class="mono" style="font-size:19px;color:#4b5466">${target}</span>
      ${tier ? `<span style="font-size:17px;color:#4b5466;display:inline-flex;align-items:center;gap:6px">${icon("layers", 16)}${tier}</span>` : ""}
      <span class="slot" style="margin-left:auto;display:inline-flex;gap:12px;align-items:center">${controls ? `<span class="mono" style="font-size:15px;color:#8a94a6">${controls}</span>` : ""}${chip(decision)}</span></div>`,
  );
  node.style.borderRadius = "20px";
  return node;
}

// ------------------------------------------------------------------ act 12: proof

function proofs(root, ctx) {
  root.classList.add("dots");
  const shots = [
    { title: "Sensitive data", at: ctx.phrase("n26", 0) },
    { title: "Changed tools", at: ctx.phrase("n26", 1) },
    { title: "Runaway agents", at: ctx.phrase("n27", 0) },
    { title: "Agent to agent", at: ctx.phrase("n27", 1) },
  ];
  shots.forEach((s, i) => {
    s.end = shots[i + 1]?.at ?? ctx.length;
    s.g = el("div", "fill", root);
    s.eb = el("div", "abs eyebrow", s.g, `0${i + 1} · ${s.title}`);
  });
  // 01: read confidential data, then try to send it out.
  const g1 = shots[0].g;
  const r1 = row(g1, { cap: "files.read", target: "finance/payroll-2026.xlsx", tier: "Confidential", decision: "allow", controls: "CTL-CAP-001" });
  const taint = el("div", "abs", g1, `<span class="pill" style="height:48px;font-size:20px">${icon("layers", 18)} The session now holds <b>Confidential</b> data</span>`);
  const r2 = row(g1, { cap: "email.send", target: "partner@nordwind.example", tier: "External", decision: "deny", controls: "CTL-TIER-002 · forbid-write-down" });
  // 02: a tool descriptor that no longer matches its pin.
  const g2 = shots[1].g;
  const tool = el(
    "div",
    "card",
    g2,
    `<div style="padding:32px 38px;width:820px;box-sizing:border-box">
      <div style="display:flex;align-items:center;gap:16px">${agentMark(54, "tool")}<div><div style="font-size:28px;font-weight:680">payments</div><div class="mono" style="font-size:16px;color:#8a94a6">MCP tool · pinned when reviewed</div></div></div>
      <div class="mono" style="display:grid;grid-template-columns:160px 1fr;gap:16px 20px;margin-top:26px;font-size:24px">
        <span style="color:#8a94a6">pinned</span><span>sha256:9f2c…e1</span>
        <span style="color:#8a94a6">observed</span><span class="obs">sha256:9f2c…e1</span></div></div>`,
  );
  const obs = tool.querySelector(".obs");
  const blocked = el("div", "abs", g2, `<span style="display:inline-flex;gap:14px;align-items:center">${chip("deny", { size: "lg", label: "Descriptor changed, blocked" })}<span class="mono" style="font-size:16px;color:#8a94a6">CTL-TOOL-001 · forbid-tool-descriptor-drift</span></span>`);
  // 03: valid actions that add up.
  const g3 = shots[2].g;
  const agentTile = el("div", "abs", g3, `<div class="pill" style="height:70px;font-size:26px;padding:0 26px 0 12px;border-radius:20px">${agentMark(48)}<span class="mono">report-bot</span></div>`);
  const meter = el("div", "abs", g3, `<div style="width:700px"><div style="display:flex;justify-content:space-between;font-size:20px;color:#4b5466"><span>Session budget</span><span class="mono amt">10.00 EUR</span></div><div style="margin-top:12px;height:14px;border-radius:999px;background:#eceef2;overflow:hidden"><div class="bar" style="height:100%;background:linear-gradient(90deg,#3a5bd9,#6a8cff);border-radius:999px"></div></div></div>`);
  const amt = meter.querySelector(".amt");
  const bar = meter.querySelector(".bar");
  const ticks = Array.from({ length: 12 }, () => el("div", "abs", g3, `<span class="pill mono" style="height:36px;font-size:15px;gap:8px"><span style="color:#14a05a;display:inline-flex">${icon("circle-check", 15)}</span>crm.read</span>`));
  const over = el("div", "abs", g3, `<span style="display:inline-flex;gap:14px;align-items:center">${chip("deny", { size: "lg" })}<span class="mono" style="font-size:16px;color:#8a94a6">CTL-RUN-001 · forbid-budget-exceeded</span></span>`);
  const quar = el("div", "abs", g3, `<span style="display:inline-flex;gap:14px;align-items:center">${chip("quar", { size: "lg" })}<span class="mono" style="font-size:16px;color:#8a94a6">CTL-RUN-003 · circuit breaker</span></span>`);
  // 04: a message is not a delegation.
  const g4 = shots[3].g;
  const lines = svgEl("svg", { width: 1920, height: 1080, class: "abs" }, g4);
  svgEl("line", { x1: 590, y1: 500, x2: 900, y2: 500, stroke: "#3a5bd9", "stroke-width": 2.5, opacity: 0.5 }, lines);
  const cutLine = svgEl("line", { x1: 1020, y1: 500, x2: 1330, y2: 500, stroke: "#e0484e", "stroke-width": 2.5, "stroke-dasharray": "6 9" }, lines);
  const from = el("div", "abs", g4, `<div class="pill" style="height:64px;font-size:23px;padding:0 22px 0 10px;border-radius:18px">${agentMark(44)}<span class="mono">research-agent</span></div>`);
  const to = el("div", "abs", g4, `<div class="pill" style="height:64px;font-size:23px;padding:0 22px 0 10px;border-radius:18px">${agentMark(44)}<span class="mono">invoice-assistant</span></div>`);
  const gw = el("div", "abs", g4, `<div style="width:116px;height:116px;border-radius:30px;display:grid;place-items:center;background:#fff;box-shadow:0 0 0 2px #3a5bd9,0 24px 60px -18px rgba(58,91,217,.5);color:#3a5bd9">${icon("shield", 48)}</div>`);
  const msg = el("div", "abs", g4, `<span class="pill mono" style="height:46px;font-size:18px">${icon("message", 16)} "please run payments.transfer"</span>`);
  const cross = el("div", "abs", g4, icon("x", 56));
  cross.style.color = "#e0484e";
  const a2a = el("div", "abs", g4, `<span style="display:inline-flex;gap:14px;align-items:center">${chip("deny", { size: "lg" })}<span class="mono" style="font-size:16px;color:#8a94a6">CTL-A2A-003 · a message is not a delegation</span></span>`);
  ctx.cue(shots[0].at + 2.0, "deny");
  ctx.cue(shots[1].at + 1.6, "deny");
  ctx.cue(shots[2].at + 2.4, "deny");
  ctx.cue(shots[2].at + 3.1, "boom");
  ctx.cue(shots[3].at + 1.7, "deny");

  return {
    update(t) {
      shots.forEach((s, i) => {
        const o = Math.min(soft(t, s.at - 0.35, 0.6), 1 - seg(t, s.end - 0.35, s.end + 0.05));
        s.g.style.opacity = o;
        s.g.style.display = o > 0.001 ? "block" : "none";
        // A slow push on every shot.
        s.g.style.transform = `scale(${1.1 + 0.03 * seg(t, s.at - 0.35, s.end, ease.linear)})`;
        text(s.eb, { x: 150, y: 150, o: 1 });
        void i;
      });
      let l = t - shots[0].at;
      put(r1, { x: 960, y: 380, o: soft(l, 0, 0.6) });
      put(taint, { x: 960, y: 500, o: soft(l, 0.9, 0.6) });
      put(r2, { x: 960, y: 620 + (1 - soft(l, 1.4, 0.6)) * 20, o: soft(l, 1.4, 0.6) });
      r2.querySelector(".slot").style.opacity = soft(l, 2.0, 0.3);
      l = t - shots[1].at;
      put(tool, { x: 960, y: 470, o: soft(l, 0, 0.6) });
      const scramble = seg(l, 0.6, 1.4, ease.linear);
      const r = rng(Math.floor(scramble * 20) + 5);
      const hex = () => "0123456789abcdef"[Math.floor(r() * 16)];
      obs.textContent = scramble <= 0 ? "sha256:9f2c…e1" : scramble >= 1 ? "sha256:4ab0…77" : `sha256:${hex()}${hex()}${hex()}${hex()}…${hex()}${hex()}`;
      obs.style.color = scramble >= 1 ? "#e0484e" : "#0b1220";
      put(blocked, { x: 960, y: 720, o: soft(l, 1.6, 0.6) });
      l = t - shots[2].at;
      put(agentTile, { x: 560, y: 400, o: soft(l, 0, 0.6) });
      put(meter, { x: 1220, y: 400, o: soft(l, 0, 0.6) });
      const spent = seg(l, 0.3, 2.2, ease.linear);
      bar.style.width = `${(1 - spent) * 100}%`;
      amt.textContent = `${((1 - spent) * 10).toFixed(2)} EUR`;
      ticks.forEach((tk, i) => put(tk, { x: 380 + (i % 6) * 232, y: 540 + Math.floor(i / 6) * 54, o: soft(l, 0.3 + i * 0.15, 0.3) }));
      put(over, { x: 960, y: 700, o: soft(l, 2.4, 0.5) });
      const q = soft(l, 3.1, 0.6);
      put(quar, { x: 960, y: 776, o: q });
      agentTile.firstElementChild.style.boxShadow = q > 0 ? `0 0 0 2px rgba(234,106,30,${q}), 0 18px 40px -16px rgba(234,106,30,${q * 0.6})` : "";
      agentTile.firstElementChild.style.background = q > 0 ? `repeating-linear-gradient(135deg, rgba(255,138,76,${0.16 * q}) 0 8px, #fff 8px 16px)` : "#fff";
      l = t - shots[3].at;
      put(from, { x: 420, y: 500, o: soft(l, 0, 0.6) });
      put(to, { x: 1510, y: 500, o: soft(l, 0, 0.6) });
      put(gw, { x: 960, y: 500, o: soft(l, 0.2, 0.6) });
      const mp = ease.inOut(seg(l, 0.5, 1.4, ease.linear));
      put(msg, { x: lerp(560, 880, mp), y: 420, o: soft(l, 0.5, 0.3) * (1 - seg(l, 1.4, 1.6)) });
      cutLine.style.opacity = soft(l, 0.4, 0.4) * (1 - seg(l, 1.6, 2.0) * 0.7);
      put(cross, { x: 1175, y: 500, o: soft(l, 1.6, 0.3), s: 0.8 + 0.2 * soft(l, 1.6, 0.3) });
      put(a2a, { x: 960, y: 690, o: soft(l, 1.7, 0.6) });
    },
  };
}

// ------------------------------------------------------------------ act 13: risk to evidence

const CHAIN = [
  ["Risk", "ASI02", "Tool misuse and exploitation"],
  ["Control", "CTL-TOOL-001", "Pinned MCP tool descriptors"],
  ["Policy", "forbid-tool-descriptor-drift", "policies/30-tools.cedar"],
  ["Decision", null, "Before execution, every time"],
  ["Trace", "0e77b8a3", "payments · 8.4 ms in the Gateway"],
  ["Evidence", "ASI02 evidenced", "Coverage, this run"],
];

function evidence(root, ctx) {
  const n28 = ctx.vo("n28");
  const pEv = ctx.phrase("n28", 1);
  const screen = new Screen(root, ["dir-coverage"], { w: 1600, h: 900, url: "director.betsee.localhost/coverage" });
  const svg = svgEl("svg", { width: 1920, height: 1080, class: "abs" }, root);
  const over = el("div", "fill", root);
  const cRisk = new Callout(over, svg, { title: "All ten OWASP agentic risks", sub: "Each mapped to its controls" });
  const score = rectOf("dir-coverage", "score");
  const veil = el("div", "fill", root);
  veil.style.background = "rgba(251,251,253,.9)";
  const chainSvg = svgEl("svg", { width: 1920, height: 1080, class: "abs" }, root);
  const STEP = 300;
  const cards = CHAIN.map(([kind, title, sub], i) => {
    const x = 210 + i * STEP;
    const n = el(
      "div",
      "card",
      root,
      `<div style="padding:22px 24px;width:270px;box-sizing:border-box">
        <div class="eyebrow" style="font-size:14px">${kind}</div>
        ${title ? `<div class="mono" style="font-size:${title.length > 16 ? 15 : 21}px;font-weight:600;margin-top:12px">${title}</div>` : `<div style="margin-top:10px">${chip("deny", { size: "lg" })}</div>`}
        <div style="font-size:16px;color:#4b5466;margin-top:8px;line-height:1.35">${sub}</div></div>`,
    );
    const line = i < CHAIN.length - 1 ? svgEl("line", { x1: x + 135, y1: 560, x2: x + 135, y2: 560, stroke: "#3a5bd9", "stroke-width": 2.5 }, chainSvg) : null;
    return { n, x, line };
  });
  const head = el("div", "h md center", root, `Every decision leaves <span class="blue">evidence</span>.`);
  ctx.cue(pEv, "tick");
  return {
    pre: 0.4,
    update(t) {
      const enter = soft(t, -0.4, 1.0);
      screen.place({ x: 960, y: 570, s: 0.98, o: enter });
      // The header stays in frame while the score is named; the push-in comes under the veil.
      screen.look(kf(t, [[0, [330, 40, 1600, 900]], [pEv - 0.3, [300, 30, 1600, 900]], [pEv + 0.6, [380, 140, 1300, 731]]], ease.inOutQuint));
      const sb = screen.mapRect(score);
      cRisk.update(sb, [1540 + (cRisk.node.offsetWidth || 300) / 2, sb[1] + sb[3] / 2], Math.min(soft(t, n28.at + 0.4, 0.8), 1 - seg(t, pEv - 0.2, pEv + 0.2)));
      veil.style.opacity = soft(t, pEv - 0.3, 0.6);
      cards.forEach((c, i) => {
        const p = soft(t, pEv + i * 0.25, 0.7);
        put(c.n, { x: c.x, y: 560 + (1 - p) * 24, o: p });
        if (c.line) {
          const lp = soft(t, pEv + i * 0.25 + 0.3, 0.5);
          c.line.setAttribute("x1", c.x + 135);
          c.line.setAttribute("x2", lerp(c.x + 135, c.x + STEP - 135, lp));
          c.line.style.opacity = lp > 0 ? 1 : 0;
        }
      });
      const h = capState(t, pEv + 0.6, ctx.length + 0.4, { fout: 0.4 });
      text(head, { x: 960, y: 290, ax: 0.5, o: h.o, dy: h.dy, blur: h.blur });
    },
  };
}

// ------------------------------------------------------------------ act 14: the thesis

const BASE = [
  ["Identity", "id"],
  ["Deterministic policy", "scale"],
  ["Gateway", "shield"],
  ["Approvals", "hand"],
  ["Execution", "zap"],
  ["Audit", "list"],
];
const MODELS = ["Claude", "Codex", "Internal model", "Model v4", "Claude", "Model v5"];
const AGENTS = ["invoice-assistant", "report-bot", "support-triage", "research-agent", "ops-runner", "employee-assistant", "pricing-agent", "hr-helper"];

function thesis(root, ctx) {
  root.classList.add("plain");
  const n29 = ctx.vo("n29");
  const n30 = ctx.vo("n30");
  const p = (k) => ctx.phrase("n29", k);
  // Above: everything that changes. A split-flap model badge, a carousel of agents.
  const top = el("div", "fill", root);
  const flap = el("div", "abs", top);
  const flapFace = () => el("div", "abs", flap);
  const faceA = flapFace();
  const faceB = flapFace();
  [faceA, faceB].forEach((f) => Object.assign(f.style, { left: "0", top: "0" }));
  Object.assign(flap.style, { width: "520px", height: "120px", perspective: "900px" });
  const badge = (label) => `<div class="pill" style="width:520px;height:120px;box-sizing:border-box;justify-content:center;font-size:44px;font-weight:700;letter-spacing:-.02em;border-radius:30px;gap:18px">${agentMark(64, "model")}${label}</div>`;
  const agents = AGENTS.map((a) => el("div", "abs", top, `<div class="pill mono" style="height:56px;font-size:20px;border-radius:16px">${agentMark(34)}${a}</div>`));
  const glow = el("div", "fill", top);
  glow.style.background = "radial-gradient(900px 340px at 50% 30%, rgba(207,63,151,.12), transparent 70%)";
  // Below: the boundary, drawn once, and what rests on it.
  const line = el("div", "abs", root);
  Object.assign(line.style, { width: "1640px", height: "4px", borderRadius: "4px", background: "#3a5bd9", boxShadow: "0 0 30px rgba(58,91,217,.45)" });
  const base = el("div", "abs", root);
  Object.assign(base.style, { display: "flex", gap: "16px" });
  base.innerHTML = BASE.map(
    ([b, g]) =>
      `<div style="width:254px;height:124px;border-radius:22px;background:#fff;box-shadow:0 0 0 1.5px rgba(58,91,217,.4),0 30px 60px -26px rgba(58,91,217,.4);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;color:#3a5bd9">${icon(g, 30)}<span style="font-size:21px;font-weight:640;color:#0b1220">${b}</span></div>`,
  ).join("");
  const cap = [`Models will change.`, `Agents will change.`].map((x) => el("div", "h lg center", root, x));
  const yours = el("div", "h xl center", root, `Your enterprise boundary<br/><span class="blue">remains yours.</span>`);
  yours.style.lineHeight = "1.05";
  const close = el("div", "h xl center", root, `Use AI, <span class="soft">without handing control to AI.</span>`);
  close.style.fontSize = "78px";
  for (let i = 0; i < 5; i++) ctx.cue(p(0) + 0.2 + i * 0.28, "tick");
  ctx.cue(p(2), "boom");
  return {
    update(t) {
      // Split-flap: one flip per beat while models change.
      const flips = clamp((t - p(0) - 0.1) / 0.28, 0, MODELS.length - 1.001);
      const n = Math.floor(flips);
      const f = ease.inOut(flips - n);
      faceA.innerHTML = badge(MODELS[n]);
      faceB.innerHTML = badge(MODELS[Math.min(n + 1, MODELS.length - 1)]);
      faceA.style.transform = `rotateX(${f * 90}deg)`;
      faceB.style.transform = `rotateX(${(1 - f) * -90}deg)`;
      faceA.style.opacity = f < 0.5 ? 1 : 0;
      faceB.style.opacity = f >= 0.5 ? 1 : 0;
      const away = seg(t, p(2) - 0.2, p(2) + 0.7, ease.inOutQuint);
      put(flap, { x: 960, y: 250 - away * 120, o: soft(t, 0, 0.6) * (1 - away), blur: away * 10 });
      // The carousel: agents slide by, swapping places as they change.
      agents.forEach((a, i) => {
        const slide = (t - p(1)) * 260;
        const x = ((i * 300 + slide + 2400 * 4) % 2400) - 240;
        put(a, { x, y: 400 + (i % 2) * 26, o: soft(t, p(1) - 0.3, 0.6) * (1 - away), blur: away * 8 });
      });
      top.style.transform = `translateY(${-away * 60}px)`;
      glow.style.opacity = 1 - away;
      const lp = seg(t, p(2) - 0.3, p(2) + 0.5, ease.inOutQuint);
      line.style.transformOrigin = "0 50%";
      put(line, { x: 960, y: 770, sx: lp, sy: 1, o: lp > 0 ? 1 : 0 });
      put(base, { x: 960, y: 852, o: soft(t, p(2) + 0.2, 0.7) });
      cap.forEach((c, i) => {
        const st = capState(t, p(i), p(i + 1) - 0.05, { fin: 0.4, fout: 0.25 });
        text(c, { x: 960, y: 560, ax: 0.5, o: st.o, dy: st.dy, blur: st.blur });
      });
      const y = capState(t, p(2), n30.at - 0.1, { fout: 0.4 });
      text(yours, { x: 960, y: 520, ax: 0.5, o: y.o, dy: y.dy, blur: y.blur });
      const c = capState(t, n30.at, ctx.length + 1, { fout: 0.5 });
      text(close, { x: 960, y: 520, ax: 0.5, o: c.o, dy: c.dy, blur: c.blur, s: 0.98 + 0.02 * seg(t, n30.at, ctx.length, ease.linear) });
      void n29;
    },
  };
}

export const proof = { proofs, evidence, thesis };
void clamp;
void Screen;
