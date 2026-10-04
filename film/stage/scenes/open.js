// Acts 1-3 and the close: AI at work across the company, the same prompt taking different paths,
// the boundary, and the BETSEE / BETTER SEE wordmark.
import { agentMark, avatar, capState, chip, clamp, ease, el, icon, kf, lerp, markSvg, noise1, put, rng, seg, svgEl, text } from "../lib.js";

const soft = (t, a, d = 0.9) => seg(t, a, a + d, ease.soft);

// ------------------------------------------------------------------ the branching request

const BRANCHES = [
  { cap: "payments.transfer", res: "48,000.00 EUR", decision: "approval" },
  { cap: "email.send", res: "accounts@nordwind.example", decision: "allow" },
  { cap: "files.read", res: "invoices/INV-2026-1187.pdf", decision: "allow" },
  { cap: "agent.message", res: "to report-bot", decision: "deny" },
  { cap: "shell.exec", res: "curl pay.example.net", decision: "deny" },
];
const BY = [380, 495, 610, 725, 840];
const PROMPT = [360, 610];
const FORK_X = 600;
const CARD_L = 1010;
const PLANE_X = 1515;
let gradientIds = 0;

function branches(parent) {
  const svg = svgEl("svg", { width: 1920, height: 1080, class: "abs" }, parent);
  const gid = `ai-${gradientIds++}`;
  const grad = svgEl("linearGradient", { id: gid, gradientUnits: "userSpaceOnUse", x1: FORK_X, x2: CARD_L, y1: 0, y2: 0 }, svgEl("defs", {}, svg));
  svgEl("stop", { offset: "0", "stop-color": "#cf3f97", "stop-opacity": 0.25 }, grad);
  svgEl("stop", { offset: "1", "stop-color": "#8a52c7", "stop-opacity": 0.9 }, grad);
  const paths = BRANCHES.map(() => svgEl("path", { fill: "none", stroke: `url(#${gid})`, "stroke-width": 2.4, "stroke-linecap": "round" }, svg));
  const noises = BRANCHES.map((_, i) => noise1(31 + i * 7));
  const prompt = el(
    "div",
    "card",
    parent,
    `<div style="display:flex;align-items:center;gap:18px;padding:20px 28px 20px 20px">
      <div style="position:relative;width:58px;height:58px"></div>
      <div><div style="font-size:17px;color:#8a94a6;font-weight:560">Maya Chen <span class="mono" style="color:#8a94a6">to invoice-assistant</span></div>
      <div style="font-size:28px;font-weight:640;margin-top:4px;letter-spacing:-0.015em">Pay the Nordwind invoice today.</div></div></div>`,
  );
  const face = avatar(prompt.querySelector("div div"), "maya", 58);
  face.style.position = "absolute";
  const cards = BRANCHES.map((b) =>
    el("div", "token abs", parent, `<span class="bot" style="background:#fcedf6;color:#cf3f97">${icon("sparkles", 18)}</span><span class="mono" style="font-size:18px">${b.cap}</span><span class="sub">${b.res}</span>`),
  );
  const probs = BRANCHES.map(() => el("div", "abs mono", parent));
  probs.forEach((p) => Object.assign(p.style, { fontSize: "16px", color: "#cf3f97", fontWeight: 600 }));
  const chips = BRANCHES.map((b) => el("div", "abs", parent, chip(b.decision, { size: "lg" })));

  /**
   * w: wobble clock; grow: 0..1 drawn; calm: 0 organic .. 1 straight; slide: cards to the plane;
   * pick: index of the path one run takes (-1 none); decided: chips 0..1.
   */
  return ({ o = 1, w = 0, grow = 1, calm = 0, slide = 0, pick = -1, decided = 0, probsOn = 1, dim = 0 }) => {
    put(prompt, { x: PROMPT[0], y: PROMPT[1], o: o * (1 - dim * 0.93) });
    BRANCHES.forEach((b, i) => {
      const width = cards[i].offsetWidth || 400;
      const left = lerp(CARD_L, PLANE_X - 16 - width, ease.inOutQuint(slide));
      const endX = left - 16;
      const pts = [];
      for (let k = 0; k <= 48; k++) {
        const u = k / 48;
        const x = lerp(FORK_X, endX, u);
        const base = lerp(PROMPT[1], BY[i], ease.inOut(clamp(u * 1.3)));
        const amp = 34 * Math.sin(Math.PI * Math.min(1, u * 1.15)) * (1 - calm);
        pts.push([x, base + amp * noises[i](u * 3 + w * 0.6)]);
      }
      const cut = Math.max(2, Math.round(48 * grow));
      const d = pts.slice(0, cut + 1).map(([x, y], k) => `${k ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
      const picked = pick === i;
      paths[i].setAttribute("d", d);
      paths[i].setAttribute("stroke-width", picked ? 5 : 2.4);
      paths[i].style.opacity = o * (pick >= 0 && !picked ? 0.35 : 1) * (1 - dim * 0.93);
      const cardO = o * clamp((grow - 0.85) / 0.15) * (pick >= 0 && !picked ? 0.45 : 1) * (1 - dim * 0.93);
      put(cards[i], { x: left + width / 2, y: BY[i], o: cardO, s: picked ? 1.06 : 1 });
      cards[i].style.boxShadow = picked ? "0 0 0 2px #cf3f97, 0 18px 40px -12px rgba(207,63,151,.45)" : "";
      const pr = 0.5 + 0.45 * noises[i](w * 0.9 + 11);
      probs[i].textContent = `p ${(pr * (i === 0 ? 0.9 : 0.6)).toFixed(2)}`;
      put(probs[i], { x: lerp(FORK_X, endX, 0.62), y: BY[i] - 30 + 24 * noises[i](w * 0.6 + 1.6), o: cardO * probsOn * (1 - calm) });
      const cp = clamp(decided * 1.6 - i * 0.15);
      put(chips[i], { x: PLANE_X + 36 + (chips[i].offsetWidth || 200) / 2 + (1 - ease.soft(cp)) * 24, y: BY[i], o: o * ease.soft(cp) });
    });
  };
}

// ------------------------------------------------------------------ act 1: AI at work

const UNITS = [
  { who: "maya", say: "Summarise the Q4 budget in finance/", agent: "Claude Code", x: 960, y: 540 },
  { who: "lena", say: "Draft a reply to this customer", agent: "support-triage", x: 520, y: 300 },
  { who: "ethan", say: "Fix the failing deploy check", agent: "Codex", x: 1420, y: 300 },
  { who: "marcus", say: "Pay the Nordwind invoice", agent: "invoice-assistant", x: 1440, y: 790 },
  { who: "grace", say: "Compare carrier rates for 2026", agent: "research-agent", x: 500, y: 790 },
  { who: "james", say: "Weekly ops report", agent: "report-bot", x: 960, y: 950 },
];
const HUBS = [
  { label: "Files", glyph: "file", x: 180, y: 540 },
  { label: "Email", glyph: "mail", x: 960, y: 130 },
  { label: "CRM", glyph: "users", x: 1760, y: 540 },
  { label: "Payments", glyph: "briefcase", x: 1780, y: 930 },
  { label: "MCP tools", glyph: "wrench", x: 140, y: 930 },
  { label: "Code", glyph: "code", x: 1780, y: 150 },
];

function company(root, ctx) {
  root.classList.add("dots");
  const world = el("div", "fill", root);
  world.style.transformOrigin = "0 0";
  const svg = svgEl("svg", { width: 1920, height: 1080, class: "abs" }, world);
  const r = rng(5);
  const units = UNITS.map((u) => {
    const n = el(
      "div",
      "abs",
      world,
      `<div style="display:flex;align-items:center;gap:14px">
        <div style="position:relative;width:60px;height:60px"></div>
        <div class="card" style="position:relative;padding:14px 22px;border-radius:20px 20px 20px 6px;font-size:22px;font-weight:560">${u.say}</div>
        <div class="pill" style="height:46px;font-size:18px">${agentMark(30)}<span class="mono">${u.agent}</span></div></div>`,
    );
    const face = avatar(n.querySelector("div div"), u.who, 60);
    face.style.position = "absolute";
    return n;
  });
  const hubs = HUBS.map((h) => ({ ...h, node: el("div", "abs", world, `<div class="pill" style="height:50px;font-size:20px;font-weight:600">${agentMark(32, "tool")}${h.label}</div>`) }));
  const edges = [];
  UNITS.forEach((u, i) => {
    [HUBS[i % 6], HUBS[(i + 3) % 6]].forEach((h, k) => {
      const mx = (u.x + h.x) / 2 + (r() - 0.5) * 200;
      const my = (u.y + h.y) / 2 + (r() - 0.5) * 200;
      const path = svgEl("path", { d: `M${u.x} ${u.y} Q${mx} ${my} ${h.x} ${h.y}`, fill: "none", stroke: "rgba(58,91,217,.22)", "stroke-width": 1.6 }, svg);
      const len = path.getTotalLength();
      path.style.strokeDasharray = `${len}`;
      const dot = svgEl("circle", { r: 4.5, fill: "#3a5bd9" }, svg);
      edges.push({ path, len, dot, unit: i, k, speed: 0.22 + r() * 0.18, off: r() });
    });
  });
  const n02 = ctx.vo("n02");
  const appear = [0.4, ...Array.from({ length: 5 }, (_, i) => ctx.phrase("n02", Math.min(i, 3)) + (i >= 4 ? 0.6 : 0) - 0.2)];
  const head = el("div", "h md center", root, `Every team. <span class="soft">Every model.</span> <span class="blue">Every tool.</span>`);

  return {
    update(t) {
      const s = kf(t, [[0, 1.5], [3.2, 1.15, ease.inOut], [n02.end, 0.9, ease.inOut], [ctx.length, 0.86]]);
      world.style.transform = `translate(960px, 540px) scale(${s}) translate(-960px, -540px)`;
      units.forEach((u, i) => {
        const p = soft(t, appear[i], 1.0);
        put(u, { x: UNITS[i].x, y: UNITS[i].y + (1 - p) * 20, o: p });
      });
      hubs.forEach((h, i) => {
        const p = soft(t, 2.6 + i * 0.25, 1.0);
        put(h.node, { x: h.x, y: h.y, o: p, s: 0.94 + 0.06 * p });
      });
      edges.forEach((e) => {
        const at = Math.max(appear[e.unit], 2.8) + 0.4 + e.k * 0.3;
        const p = seg(t, at, at + 1.2, ease.soft);
        e.path.style.strokeDashoffset = `${e.len * (1 - p)}`;
        const run = t - at - 0.8;
        if (run > 0) {
          const u = (run * e.speed + e.off) % 1;
          const pt = e.path.getPointAtLength(u * e.len);
          e.dot.setAttribute("cx", pt.x);
          e.dot.setAttribute("cy", pt.y);
          e.dot.style.opacity = Math.sin(Math.PI * u) * 0.9;
        } else e.dot.style.opacity = 0;
      });
      const hs = capState(t, n02.end + 0.2, ctx.length + 0.3, { fout: 0.4 });
      text(head, { x: 960, y: 540, ax: 0.5, o: hs.o, dy: hs.dy, blur: hs.blur });
      world.style.opacity = 1 - 0.85 * seg(t, n02.end, n02.end + 0.8);
    },
  };
}

// ------------------------------------------------------------------ act 2: same prompt, other paths

function problem(root, ctx) {
  const n04 = ctx.vo("n04");
  const n05 = ctx.vo("n05");
  const n06 = ctx.vo("n06");
  const n07 = ctx.vo("n07");
  const draw = branches(root);
  const runPill = el("div", "abs", root);
  const PICKS = [0, 1, 3, 2];
  const fine = el("div", "h md", root, `Fine for a first draft.`);
  const not = el("div", "h md", root, `<span class="pink">Not for permissions.</span>`);
  const q = el("div", "h xl center", root, `Who decides? <span class="pink">The model,</span><br/>or <span class="blue">the company?</span>`);
  q.style.lineHeight = "1.06";
  return {
    pre: 0.4,
    update(t) {
      root.style.opacity = seg(t, -0.4, 0.3);
      const runs = [0, 1, 2, 3].map((k) => ctx.phrase("n05", k));
      let k = -1;
      runs.forEach((at, i) => {
        if (t >= at) k = i;
      });
      const inRuns = t >= runs[0] && t < n05.end + 0.6;
      draw({
        o: soft(t, -0.2, 0.8),
        w: t,
        grow: seg(t, n04.at + 0.2, n04.at + 1.8, ease.soft),
        pick: inRuns ? PICKS[k] : -1,
        dim: seg(t, n07.at - 0.3, n07.at + 0.5),
      });
      runPill.innerHTML = `<span class="pill" style="height:44px;font-size:19px;gap:12px"><span class="mono" style="color:#cf3f97">run ${k + 1}</span><span style="color:#8a94a6">same prompt, same model</span></span>`;
      put(runPill, { x: 1250, y: 280, o: inRuns ? soft(t, runs[0], 0.5) * (1 - seg(t, n05.end + 0.3, n05.end + 0.6)) : 0 });
      const a = capState(t, n06.at, n07.at - 0.1, { fout: 0.4 });
      const b = capState(t, ctx.phrase("n06", 1), n07.at - 0.1, { fout: 0.4 });
      text(fine, { x: 150, y: 180, o: a.o, dy: a.dy, blur: a.blur });
      text(not, { x: 150, y: 245, o: b.o, dy: b.dy, blur: b.blur });
      const qs = capState(t, n07.at, ctx.length + 0.4, { fin: 1.0, fout: 0.5 });
      text(q, { x: 960, y: 540, ax: 0.5, o: qs.o, dy: qs.dy, blur: qs.blur });
    },
  };
}

// ------------------------------------------------------------------ the wordmark

const PX = 220;

function wordmark(parent) {
  const box = el("div", "fill", parent);
  box.style.transformOrigin = "0 0";
  // Each letter is measured in the DOM at both widths of the variable font.
  const probe = el("span", "letter", box);
  probe.style.fontSize = `${PX}px`;
  probe.style.visibility = "hidden";
  const width = (ch, stretch) => {
    probe.style.fontStretch = `${stretch}%`;
    probe.textContent = ch === " " ? " " : ch;
    return probe.getBoundingClientRect().width * 0.98;
  };
  const layout = (chars, stretch) => {
    const ws = chars.map((c) => width(c, stretch) * (c === " " ? 0.9 : 1));
    const total = ws.reduce((a, b) => a + b, 0);
    let x = 960 - total / 2;
    return ws.map((w) => {
      const at = x;
      x += w;
      return at;
    });
  };
  const A_STRETCH = 118;
  const B_STRETCH = 100;
  const A = layout([..."BETSEE"], A_STRETCH);
  const B = layout([..."BETTER SEE"], B_STRETCH);
  const make = (ch) => {
    const clip = el("div", "abs", box);
    Object.assign(clip.style, { height: `${PX * 1.04}px`, overflow: "hidden", paddingRight: "30px" });
    const letter = el("div", "letter", clip, ch);
    Object.assign(letter.style, { fontSize: `${PX}px`, position: "relative" });
    return { clip, letter };
  };
  const kept = [
    [0, 0],
    [1, 1],
    [2, 2],
    [3, 7],
    [4, 8],
    [5, 9],
  ].map(([a, b], i) => ({ ch: "BETSEE"[i], a: A[a], b: B[b], ...make("BETSEE"[i]) }));
  const added = [3, 4, 5].map((b, i) => ({ ch: "TER"[i], b: B[b], ...make("TER"[i]) }));
  const sub = el("div", "h md center", box, `what your agents do.`);
  sub.style.fontWeight = 520;
  sub.style.color = "#4b5466";
  const fine = el("div", "h sm center", box, `And deterministically <span class="blue">control</span> what they can do.`);
  fine.style.color = "#8a94a6";
  const mark = el("div", "abs", box, markSvg(170));
  const Y = 470;
  /** m: 0 BETSEE .. 1 BETTER SEE; lift moves it up; logo brings in the mark. */
  return ({ m = 0, o = 1, s = 1, lift = 0, logo = 0, subO = 0, fineO = 0, blur = 0 }) => {
    box.style.opacity = o;
    box.style.filter = blur > 0.05 ? `blur(${blur}px)` : "none";
    box.style.transform = `translate(960px, 540px) scale(${s}) translate(-960px, -540px)`;
    const slide = ease.inOutQuint(clamp(m * 1.2));
    const stretch = lerp(A_STRETCH, B_STRETCH, slide);
    const shift = logo * 120;
    const y = Y - lift;
    for (const k of kept) {
      k.letter.style.fontStretch = `${stretch}%`;
      k.clip.style.transform = `translate(${lerp(k.a, k.b, slide) + shift}px, ${y - PX * 0.52}px)`;
    }
    added.forEach((k, i) => {
      const q = clamp((m - 0.4 - i * 0.1) / 0.45);
      k.letter.style.fontStretch = `${B_STRETCH}%`;
      k.clip.style.transform = `translate(${k.b + shift}px, ${y - PX * 0.52}px)`;
      k.letter.style.transform = `translateY(${(1 - ease.outQuint(q)) * PX}px)`;
      k.letter.style.opacity = q > 0 ? 1 : 0;
    });
    text(sub, { x: 960, y: y + 190, ax: 0.5, o: subO, dy: (1 - subO) * 16, blur: (1 - subO) * 8 });
    text(fine, { x: 960, y: y + 268, ax: 0.5, o: fineO, dy: (1 - fineO) * 12, blur: (1 - fineO) * 6 });
    put(mark, { x: kept[0].a + shift - 130, y: y - 4, o: logo, s: 0.8 + 0.2 * logo, blur: (1 - logo) * 8 });
  };
}

// ------------------------------------------------------------------ act 3: the boundary, the name

function hero(root, ctx) {
  const n08 = ctx.vo("n08");
  const draw = branches(root);
  const plane = el("div", "abs", root);
  Object.assign(plane.style, { width: "4px", height: "760px", borderRadius: "4px", background: "linear-gradient(180deg, transparent, #3a5bd9 10%, #3a5bd9 90%, transparent)", boxShadow: "0 0 30px rgba(58,91,217,.35)" });
  const planeName = el("div", "abs eyebrow", root, "Betsee");
  const label = el("div", "h md", root, `AI may vary. <span class="blue">The boundary does not.</span>`);
  const white = el("div", "fill", root);
  white.style.background = "#fbfbfd";
  const mark = wordmark(root);
  const b0 = 0.2;
  ctx.cue(b0 + 1.35, "boom");
  ctx.cue(n08.at, "shimmer");
  return {
    update(t) {
      const slide = seg(t, b0 + 0.6, b0 + 1.35, ease.linear);
      draw({ o: 1, w: 30, calm: seg(t, b0 + 1.3, b0 + 2.1), slide, decided: seg(t, b0 + 1.5, b0 + 2.3, ease.linear), probsOn: 1 - seg(t, 0, 0.6) });
      const pp = seg(t, b0, b0 + 0.6, ease.outExpo);
      put(plane, { x: PLANE_X, y: 610, sy: pp, o: pp > 0 ? 1 : 0 });
      put(planeName, { x: PLANE_X, y: 200, o: seg(t, b0 + 1.4, b0 + 2.0) });
      const lb = capState(t, b0 + 0.5, n08.at, { fout: 0.3 });
      text(label, { x: 150, y: 170, o: lb.o, dy: lb.dy, blur: lb.blur });
      // The name.
      const w = seg(t, n08.at - 0.35, n08.at + 0.1);
      white.style.opacity = w;
      const p1 = ctx.phrase("n08", 1);
      const p2 = ctx.phrase("n08", 2);
      mark({
        m: seg(t, p1 - 0.1, p1 + 0.9, ease.linear),
        o: w,
        s: 0.96 + 0.04 * seg(t, n08.at, ctx.length, ease.linear),
        subO: soft(t, p1 + 0.6, 0.8),
        fineO: soft(t, p2, 0.8),
      });
    },
  };
}

// ------------------------------------------------------------------ the close

function final(root, ctx) {
  root.classList.add("plain");
  const n31 = ctx.vo("n31");
  const mark = wordmark(root);
  const l1 = el("div", "h lg center", root, `<span class="pink">Non-deterministic</span> AI.`);
  const l2 = el("div", "h lg center", root, `<span class="blue">Deterministic</span> control.`);
  const tag = el("div", "h sm center", root, `The control layer for enterprise AI agents.`);
  tag.style.color = "#4b5466";
  tag.style.fontWeight = 500;
  ctx.cue(ctx.phrase("n31", 2), "final");
  return {
    pre: 0.5,
    update(t) {
      const inP = soft(t, -0.4, 1.0);
      const m = seg(t, 0.3, 1.2, ease.linear) * (1 - seg(t, n31.at - 0.2, n31.at + 0.5, ease.linear));
      const logo = soft(t, n31.at + 0.2, 0.9);
      const up = soft(t, ctx.phrase("n31", 1) - 0.6, 1.0);
      mark({
        m,
        o: inP,
        s: 1 - 0.36 * up,
        lift: (190 * up) / (1 - 0.36 * up),
        logo,
        subO: soft(t, 0.9, 0.7) * (1 - seg(t, n31.at - 0.3, n31.at + 0.1)),
      });
      const a = capState(t, ctx.phrase("n31", 1), ctx.length + 1, { fin: 0.9, fout: 0.01 });
      const b = capState(t, ctx.phrase("n31", 2), ctx.length + 1, { fin: 0.9, fout: 0.01 });
      const c = capState(t, n31.end + 0.5, ctx.length + 1, { fin: 1.0, fout: 0.01 });
      text(l1, { x: 960, y: 600, ax: 0.5, o: a.o, dy: a.dy, blur: a.blur });
      text(l2, { x: 960, y: 700, ax: 0.5, o: b.o, dy: b.dy, blur: b.blur });
      text(tag, { x: 960, y: 830, ax: 0.5, o: c.o, dy: c.dy, blur: c.blur });
    },
  };
}

export const open = { company, problem, hero, final };
