// Acts 1-3 and the close: AI at work across the company, the same prompt taking different paths,
// the boundary, the eye that opens into BETSEE / BETTER SEE, and the mosaic that becomes the logo.
import { MARK, agentMark, avatar, capState, capture, chip, clamp, ease, el, icon, kf, lerp, markSvg, noise1, put, rng, seg, svgEl, text } from "../lib.js";

const soft = (t, a, d = 0.9) => seg(t, a, a + d, ease.soft);
const back = (p) => {
  const c = 1.7;
  return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2);
};

// ------------------------------------------------------------------ the branching request

const BRANCHES = [
  { cap: "payments.transfer", res: "48,000.00 EUR", decision: "approval" },
  { cap: "email.send", res: "accounts@nordwind.example", decision: "allow" },
  { cap: "files.read", res: "invoices/INV-2026-1187.pdf", decision: "allow" },
  { cap: "agent.message", res: "to report-bot", decision: "deny" },
  { cap: "shell.exec", res: "curl pay.example.net", decision: "deny" },
];
const BY = [400, 510, 620, 730, 840];
const PROMPT = [360, 620];
const FORK_X = 600;
const CARD_L = 1000;
const PLANE_X = 1500;
let gradientIds = 0;

function branches(parent) {
  const svg = svgEl("svg", { width: 1920, height: 1080, class: "abs" }, parent);
  const defs = svgEl("defs", {}, svg);
  const gid = `ai-${gradientIds++}`;
  const grad = svgEl("linearGradient", { id: gid, gradientUnits: "userSpaceOnUse", x1: FORK_X, x2: CARD_L, y1: 0, y2: 0 }, defs);
  svgEl("stop", { offset: "0", "stop-color": "#cf3f97", "stop-opacity": 0.25 }, grad);
  svgEl("stop", { offset: "1", "stop-color": "#8a52c7", "stop-opacity": 0.95 }, grad);
  const glow = BRANCHES.map(() => svgEl("path", { fill: "none", stroke: "#cf3f97", "stroke-width": 12, "stroke-linecap": "round", opacity: 0.08 }, svg));
  const paths = BRANCHES.map(() => svgEl("path", { fill: "none", stroke: `url(#${gid})`, "stroke-width": 2.6, "stroke-linecap": "round" }, svg));
  const straight = BRANCHES.map(() => svgEl("path", { fill: "none", stroke: "#3a5bd9", "stroke-width": 2.6, "stroke-linecap": "round" }, svg));
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

  /** w wobble clock; grow drawn; calm 0 organic..1 straight; slide cards to the plane; pick one run's path. */
  return ({ o = 1, w = 0, grow = 1, calm = 0, slide = 0, pick = -1, decided = 0, probsOn = 1, dim = 0, blue = 0 }) => {
    put(prompt, { x: PROMPT[0], y: PROMPT[1], o: o * (1 - dim * 0.93) });
    BRANCHES.forEach((b, i) => {
      const width = cards[i].offsetWidth || 400;
      const left = lerp(CARD_L, PLANE_X - 18 - width, ease.inOutQuint(slide));
      const endX = left - 16;
      const pts = [];
      for (let k = 0; k <= 56; k++) {
        const u = k / 56;
        const x = lerp(FORK_X, endX, u);
        const base = lerp(PROMPT[1], BY[i], ease.inOut(clamp(u * 1.3)));
        const amp = 34 * Math.sin(Math.PI * Math.min(1, u * 1.15)) * (1 - calm);
        pts.push([x, base + amp * noises[i](u * 3 + w * 0.6)]);
      }
      const cut = Math.max(2, Math.round(56 * grow));
      const d = pts.slice(0, cut + 1).map(([x, y], k) => `${k ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
      const picked = pick === i;
      const fade = (pick >= 0 && !picked ? 0.35 : 1) * (1 - dim * 0.93);
      for (const p of [paths[i], glow[i], straight[i]]) p.setAttribute("d", d);
      paths[i].setAttribute("stroke-width", picked ? 5 : 2.6);
      paths[i].style.opacity = o * fade * (1 - blue);
      glow[i].style.opacity = o * fade * 0.1 * (1 - blue);
      straight[i].style.opacity = o * fade * blue;
      const cardO = o * clamp((grow - 0.85) / 0.15) * fade;
      put(cards[i], { x: left + width / 2, y: BY[i], o: cardO, s: picked ? 1.06 : 1 });
      cards[i].style.boxShadow = picked ? "0 0 0 2px #cf3f97, 0 18px 40px -12px rgba(207,63,151,.45)" : "";
      cards[i].querySelector(".bot").style.background = blue > 0.5 ? "#eef2fd" : "#fcedf6";
      cards[i].querySelector(".bot").style.color = blue > 0.5 ? "#3a5bd9" : "#cf3f97";
      const pr = 0.5 + 0.45 * noises[i](w * 0.9 + 11);
      probs[i].textContent = `p ${(pr * (i === 0 ? 0.9 : 0.6)).toFixed(2)}`;
      put(probs[i], { x: lerp(FORK_X, endX, 0.62), y: BY[i] - 30 + 24 * noises[i](w * 0.6 + 1.6), o: cardO * probsOn * (1 - calm) });
      const cp = clamp(decided * 1.6 - i * 0.15);
      put(chips[i], { x: PLANE_X + 40 + (chips[i].offsetWidth || 200) / 2 + (1 - ease.soft(cp)) * 30, y: BY[i], o: o * ease.soft(cp), s: 0.9 + 0.1 * back(cp) });
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
  { label: "Files", x: 180, y: 540 },
  { label: "Email", x: 960, y: 130 },
  { label: "CRM", x: 1760, y: 540 },
  { label: "Payments", x: 1780, y: 930 },
  { label: "MCP tools", x: 140, y: 930 },
  { label: "Code", x: 1780, y: 150 },
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
  const appear = [0.35, ...Array.from({ length: 5 }, (_, i) => ctx.phrase("n02", Math.min(i, 3)) + (i >= 4 ? 0.5 : 0) - 0.2)];
  const head = el("div", "h lg center", root, `Every team. <span class="soft">Every model.</span> <span class="blue">Every tool.</span>`);
  return {
    update(t) {
      const s = kf(t, [[0, 1.55], [3.0, 1.12, ease.inOut], [n02.end, 0.9, ease.inOut], [ctx.length, 0.84]]);
      world.style.transform = `translate(960px, 540px) scale(${s}) rotate(${-1.2 + 1.2 * seg(t, 0, ctx.length, ease.linear)}deg) translate(-960px, -540px)`;
      units.forEach((u, i) => {
        const p = soft(t, appear[i], 1.0);
        put(u, { x: UNITS[i].x, y: UNITS[i].y + (1 - p) * 24, o: p, s: 0.96 + 0.04 * p });
      });
      hubs.forEach((h, i) => put(h.node, { x: h.x, y: h.y, o: soft(t, 2.4 + i * 0.2, 1.0) }));
      edges.forEach((e) => {
        const at = Math.max(appear[e.unit], 2.6) + 0.4 + e.k * 0.3;
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
      const hs = capState(t, n02.end + 0.15, ctx.length + 0.8, { fout: 0.4 });
      text(head, { x: 960, y: 540, ax: 0.5, o: hs.o, dy: hs.dy, blur: hs.blur, s: 0.98 + 0.02 * hs.o });
      world.style.opacity = 1 - 0.9 * seg(t, n02.end, n02.end + 0.7);
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
    update(t) {
      const runs = [0, 1, 2, 3].map((k) => ctx.phrase("n05", k));
      let k = -1;
      runs.forEach((at, i) => {
        if (t >= at) k = i;
      });
      const inRuns = t >= runs[0] && t < n05.end + 0.5;
      draw({ o: soft(t, 0, 0.8), w: t, grow: seg(t, n04.at + 0.2, n04.at + 1.6, ease.soft), pick: inRuns ? PICKS[k] : -1, dim: seg(t, n07.at - 0.3, n07.at + 0.5) });
      runPill.innerHTML = `<span class="pill" style="height:44px;font-size:19px;gap:12px"><span class="mono" style="color:#cf3f97">run ${k + 1}</span><span style="color:#8a94a6">same prompt, same model</span></span>`;
      put(runPill, { x: 1250, y: 300, o: inRuns ? soft(t, runs[0], 0.4) * (1 - seg(t, n05.end + 0.2, n05.end + 0.5)) : 0, s: 1 + 0.04 * Math.max(0, 1 - (t - runs[Math.max(0, k)]) * 4) });
      const a = capState(t, n06.at, n07.at - 0.1, { fout: 0.4 });
      const b = capState(t, ctx.phrase("n06", 1), n07.at - 0.1, { fout: 0.4 });
      text(fine, { x: 150, y: 190, o: a.o, dy: a.dy, blur: a.blur });
      text(not, { x: 150, y: 255, o: b.o, dy: b.dy, blur: b.blur });
      const qs = capState(t, n07.at, ctx.length + 1, { fin: 1.0, fout: 0.5 });
      text(q, { x: 960, y: 540, ax: 0.5, o: qs.o, dy: qs.dy, blur: qs.blur, s: 0.97 + 0.03 * seg(t, n07.at, ctx.length, ease.linear) });
    },
  };
}

// ------------------------------------------------------------------ the eye and the wordmark

const PX = 210;

function wordmark(parent) {
  const box = el("div", "fill", parent);
  box.style.transformOrigin = "0 0";
  const probe = el("span", "letter", box);
  probe.style.fontSize = `${PX}px`;
  probe.style.visibility = "hidden";
  const width = (ch, stretch) => {
    probe.style.fontStretch = `${stretch}%`;
    probe.textContent = ch === " " ? " " : ch;
    return probe.getBoundingClientRect().width * 0.98;
  };
  const layout = (chars, stretch, shift) => {
    const ws = chars.map((c) => width(c, stretch) * (c === " " ? 0.9 : 1));
    const total = ws.reduce((a, b) => a + b, 0);
    let x = 960 - total / 2 + shift;
    return ws.map((w) => {
      const at = x;
      x += w;
      return at;
    });
  };
  const A_STRETCH = 116;
  const B_STRETCH = 100;
  // BETSEE sits right of the eye; BETTER SEE takes the whole line.
  const A = layout([..."BETSEE"], A_STRETCH, 115);
  const B = layout([..."BETTER SEE"], B_STRETCH, 0);
  const make = (ch) => {
    const clip = el("div", "abs", box);
    Object.assign(clip.style, { height: `${PX * 1.04}px`, overflow: "hidden", paddingRight: "30px" });
    const letter = el("div", "letter", clip, ch);
    Object.assign(letter.style, { fontSize: `${PX}px`, position: "relative" });
    return { clip, letter };
  };
  const kept = [[0, 0], [1, 1], [2, 2], [3, 7], [4, 8], [5, 9]].map(([a, b], i) => ({ a: A[a], b: B[b], ...make("BETSEE"[i]) }));
  const added = [3, 4, 5].map((b, i) => ({ b: B[b], ...make("TER"[i]) }));
  // A band of light that crosses the letters once.
  const sweep = el("div", "abs", box);
  Object.assign(sweep.style, { width: "220px", height: `${PX * 1.1}px`, background: "linear-gradient(90deg, transparent, rgba(106,140,255,.55), transparent)", mixBlendMode: "screen", filter: "blur(10px)" });
  const sub = el("div", "h lg center", box, `what your agents do.`);
  Object.assign(sub.style, { fontWeight: 540, color: "#4b5466" });
  const subWords = sub.textContent.split(" ");
  sub.innerHTML = subWords.map((w) => `<span style="display:inline-block">${w}&nbsp;</span>`).join("");
  const fine = el("div", "h sm center", box, `And deterministically <span class="blue" style="position:relative">control<i class="u" style="position:absolute;left:0;right:0;bottom:-6px;height:3px;border-radius:2px;background:#3a5bd9;transform-origin:0 50%"></i></span> what they can do.`);
  fine.style.color = "#8a94a6";
  const underline = fine.querySelector(".u");
  // The eye: the mark, opening like a lid.
  const eye = el("div", "abs", box, markSvg(190));
  eye.style.color = "#0b1220";
  const Y = 460;
  return ({ open = 1, reveal = 1, m = 0, o = 1, s = 1, lift = 0, eyeAt = null, eyeScale = 1, subO = 0, fineO = 0, under = 0, light = -1, zoom = 0, blur = 0 }) => {
    box.style.opacity = o;
    box.style.filter = blur > 0.05 ? `blur(${blur}px)` : "none";
    // The camera: a push into the eye's pupil when zoom > 0.
    const ex = eyeAt ? eyeAt[0] : kept[0].a - 125;
    const ey = eyeAt ? eyeAt[1] : Y - lift - 6;
    const k = s * (1 + zoom * zoom * 26);
    const cx = lerp(960, ex, clamp(zoom * 3));
    const cy = lerp(540, ey, clamp(zoom * 3));
    box.style.transform = `translate(${cx}px, ${cy}px) scale(${k}) translate(${-cx}px, ${-cy}px)`;
    const slide = ease.inOutQuint(clamp(m * 1.15));
    const stretch = lerp(A_STRETCH, B_STRETCH, slide);
    const y = Y - lift;
    kept.forEach((kk, i) => {
      const r = clamp((reveal - i * 0.08) / 0.5);
      kk.letter.style.fontStretch = `${stretch}%`;
      kk.letter.style.transform = `translateX(${(1 - ease.outQuint(r)) * -PX * 0.9}px)`;
      kk.letter.style.opacity = r > 0 ? 1 : 0;
      kk.clip.style.transform = `translate(${lerp(kk.a, kk.b, slide)}px, ${y - PX * 0.52}px)`;
    });
    added.forEach((kk, i) => {
      const q = clamp((m - 0.38 - i * 0.09) / 0.42);
      kk.letter.style.fontStretch = `${B_STRETCH}%`;
      kk.clip.style.transform = `translate(${kk.b}px, ${y - PX * 0.52}px)`;
      kk.letter.style.transform = `translateY(${(1 - back(q)) * -PX * 1.05}px)`;
      kk.letter.style.opacity = q > 0 ? 1 : 0;
    });
    const sw = light;
    sweep.style.opacity = sw >= 0 && sw <= 1 ? Math.sin(Math.PI * sw) : 0;
    sweep.style.transform = `translate(${lerp(B[0] - 300, B[9] + 300, clamp(sw))}px, ${y - PX * 0.55}px) skewX(-18deg)`;
    text(sub, { x: 960, y: y + 180, ax: 0.5, o: subO > 0 ? 1 : 0 });
    [...sub.children].forEach((w, i) => {
      const p = clamp(subO * 1.6 - i * 0.18);
      w.style.opacity = ease.soft(p);
      w.style.transform = `translateY(${(1 - ease.soft(p)) * 26}px)`;
    });
    text(fine, { x: 960, y: y + 258, ax: 0.5, o: fineO, dy: (1 - fineO) * 12, blur: (1 - fineO) * 6 });
    underline.style.transform = `scaleX(${under})`;
    // The eye opens: the lid lifts with a little overshoot; it slides aside as the name arrives.
    put(eye, { x: ex, y: ey, sx: eyeScale, sy: eyeScale * Math.max(0.02, back(clamp(open))), o: open > 0 ? Math.min(1, open * 4) : 0 });
  };
}

// ------------------------------------------------------------------ act 3: the boundary, the name

function hero(root, ctx) {
  const n08 = ctx.vo("n08");
  const draw = branches(root);
  // The boundary: a pane of glass, turned a little toward us.
  const pane = el("div", "abs", root);
  Object.assign(pane.style, {
    width: "110px",
    height: "780px",
    borderRadius: "14px",
    background: "linear-gradient(90deg, rgba(255,255,255,0.0), rgba(238,242,253,0.85) 60%, rgba(255,255,255,0.95))",
    borderRight: "3px solid #3a5bd9",
    boxShadow: "18px 0 50px -12px rgba(58,91,217,.45), inset -14px 0 30px -18px rgba(58,91,217,.35)",
  });
  const rings = BY.map(() => {
    const n = el("div", "abs", root);
    Object.assign(n.style, { width: "30px", height: "30px", borderRadius: "999px", boxShadow: "0 0 0 2.5px #3a5bd9, 0 0 24px rgba(58,91,217,.6)" });
    return n;
  });
  const paneName = el("div", "abs", root, `<span style="display:inline-flex;align-items:center;gap:10px;color:#3a5bd9">${markSvg(26)}<span class="eyebrow">Betsee</span></span>`);
  const l1 = el("div", "h lg", root, `AI may <span class="pink">vary</span>.`);
  const l2 = el("div", "h lg", root, `The boundary <span class="blue">does not</span>.`);
  const wipe = el("div", "fill", root);
  wipe.style.background = "#fbfbfd";
  const mark = wordmark(root);
  const b0 = 0.15;
  const p0 = n08.at;
  const p1 = ctx.phrase("n08", 1);
  const p2 = ctx.phrase("n08", 2);
  ctx.cue(b0 + 1.35, "boom");
  ctx.cue(p0, "shimmer");
  ctx.cue(p1 + 0.3, "whoosh");
  ctx.cue(ctx.length - 0.8, "whoosh");
  return {
    update(t) {
      const slide = seg(t, b0 + 0.55, b0 + 1.35, ease.linear);
      const calm = seg(t, b0 + 1.3, b0 + 2.0);
      draw({ o: 1, w: 30, calm, slide, decided: seg(t, b0 + 1.45, b0 + 2.2, ease.linear), probsOn: 1 - seg(t, 0, 0.5), blue: calm });
      const pp = seg(t, b0, b0 + 0.7, ease.outExpo);
      pane.style.transformOrigin = "50% 50%";
      pane.style.transform = `translate(${PLANE_X - 55 - 55}px, ${620 - 390}px) perspective(1400px) rotateY(-24deg) scaleY(${pp})`;
      pane.style.opacity = pp;
      BY.forEach((y, i) => {
        const p = seg(t, b0 + 1.33 + i * 0.02, b0 + 1.9 + i * 0.02, ease.out);
        put(rings[i], { x: PLANE_X, y, s: 0.4 + p * 1.8, o: p > 0 ? (1 - p) * 0.9 : 0 });
      });
      put(paneName, { x: PLANE_X - 30, y: 210, o: seg(t, b0 + 1.4, b0 + 2.0) });
      const a = capState(t, b0 + 0.4, p0 - 0.35, { fout: 0.3 });
      const b = capState(t, b0 + 1.2, p0 - 0.35, { fout: 0.3 });
      text(l1, { x: 140, y: 170, o: a.o, dy: a.dy, blur: a.blur });
      text(l2, { x: 140, y: 260, o: b.o, dy: b.dy, blur: b.blur });
      // A clean wipe to white, led by the boundary.
      const w = seg(t, p0 - 0.6, p0 - 0.05, ease.inOutQuint);
      wipe.style.clipPath = `inset(0 0 0 ${(1 - w) * 100}%)`;
      wipe.style.opacity = t >= p0 - 0.6 ? 1 : 0;
      // The eye opens on "Betsee", the name slides out of it, then becomes the line.
      const zoom = seg(t, ctx.length - 0.95, ctx.length + 0.1, ease.inExpo);
      mark({
        o: t >= p0 - 0.2 ? 1 : 0,
        open: seg(t, p0 - 0.15, p0 + 0.5, ease.linear),
        reveal: seg(t, p0 + 0.25, p0 + 1.0, ease.linear),
        m: seg(t, p1 - 0.05, p1 + 1.0, ease.linear),
        eyeAt: [lerp(960 - 470, 960, seg(t, p1 - 0.1, p1 + 0.7, ease.inOutQuint)), lerp(454, 210, seg(t, p1 - 0.1, p1 + 0.7, ease.inOutQuint))],
        eyeScale: lerp(1, 0.62, seg(t, p1 - 0.1, p1 + 0.7, ease.inOutQuint)),
        light: seg(t, p1 + 0.8, p1 + 1.6, ease.linear) * (t > p1 + 0.8 ? 1 : -1),
        subO: seg(t, p1 + 0.7, p1 + 1.6, ease.linear),
        fineO: soft(t, p2, 0.8),
        under: seg(t, p2 + 0.9, p2 + 1.5, ease.inOutQuint),
        s: 1 + 0.035 * seg(t, p0, ctx.length, ease.linear),
        zoom,
      });
    },
  };
}

// ------------------------------------------------------------------ the close: a mosaic becomes the logo

const MOSAIC_SOURCES = [
  "dir-overview", "dir-activity", "dir-graph", "dir-orgchart", "dir-determinism", "dir-coverage", "dir-trace-tier", "dir-access",
  "desk-work", "desk-guard", "desk-input", "desk-setup", "eco-approval-detail", "eco-controls", "eco-usecases", "eco-home",
];

function final(root, ctx) {
  root.classList.add("plain");
  const n31 = ctx.vo("n31");
  // Rasterise the eye and keep the grid cells it covers.
  const N = 22;
  const SIZE = 820;
  const cell = SIZE / N;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = N * 4;
  const g = canvas.getContext("2d");
  g.scale((N * 4) / 100, (N * 4) / 100);
  g.fill(new Path2D(MARK), "evenodd");
  const data = g.getImageData(0, 0, N * 4, N * 4).data;
  const r = rng(2026);
  const tiles = [];
  const field = el("div", "fill", root);
  field.style.perspective = "1600px";
  for (let row = 0; row < N; row++)
    for (let col = 0; col < N; col++) {
      const px = col * 4 + 2;
      const py = row * 4 + 2;
      if (data[(py * N * 4 + px) * 4 + 3] < 128) continue;
      const src = MOSAIC_SOURCES[Math.floor(r() * MOSAIC_SOURCES.length)];
      const c = capture(src);
      const z = 2.4 + r() * 2.2;
      const node = el("div", "abs", field);
      // Each tile is a real piece of a Betsee screen, magnified.
      const sx = 120 + r() * (c.page.w - 600);
      const sy = 80 + r() * Math.min(900, c.page.h - 400);
      Object.assign(node.style, {
        width: `${cell - 2}px`,
        height: `${cell - 2}px`,
        borderRadius: "5px",
        backgroundImage: `url(${c.img.src})`,
        backgroundSize: `${c.page.w * z * (cell / 60)}px ${c.page.h * z * (cell / 60)}px`,
        backgroundPosition: `${-sx * z * (cell / 60)}px ${-sy * z * (cell / 60)}px`,
        boxShadow: "0 0 0 1px rgba(16,24,40,.08)",
      });
      const tint = el("div", "fill", node);
      tint.style.background = "#0b1220";
      tint.style.borderRadius = "5px";
      const ang = r() * Math.PI * 2;
      const dist = 900 + r() * 900;
      tiles.push({
        node,
        tint,
        x: 960 - SIZE / 2 + col * cell + cell / 2,
        y: 520 - SIZE / 2 + row * cell + cell / 2,
        fx: 960 + Math.cos(ang) * dist,
        fy: 540 + Math.sin(ang) * dist * 0.6,
        fz: -1200 + r() * 2400,
        rot: (r() - 0.5) * 140,
        delay: r() * 0.9 + (Math.hypot(col - N / 2, row - N / 2) / N) * 0.6,
      });
    }
  const solid = el("div", "abs", root, markSvg(SIZE));
  solid.style.color = "#0b1220";
  const mark = wordmark(root);
  const l1 = el("div", "h lg center", root, `<span class="pink">Non-deterministic</span> AI.`);
  const l2 = el("div", "h lg center", root, `<span class="blue">Deterministic</span> control.`);
  const tag = el("div", "h sm center", root, `The control layer for enterprise AI agents.`);
  Object.assign(tag.style, { color: "#4b5466", fontWeight: 500 });
  const p0 = n31.at;
  const p1 = ctx.phrase("n31", 1);
  const p2 = ctx.phrase("n31", 2);
  ctx.cue(0.2, "whoosh");
  ctx.cue(p0 - 0.15, "final");
  return {
    update(t) {
      // Tiles fly in from everywhere and settle into the eye.
      const settle = seg(t, p0 - 0.6, p0 - 0.05, ease.inOutQuint);
      tiles.forEach((tile) => {
        const p = ease.inOutQuint(clamp((t - 0.15 - tile.delay) / 1.6));
        const x = lerp(tile.fx, tile.x, p);
        const y = lerp(tile.fy, tile.y, p);
        tile.node.style.transform = `translate(${x - cell / 2}px, ${y - cell / 2}px) translateZ(${lerp(tile.fz, 0, p)}px) rotate(${lerp(tile.rot, 0, p)}deg)`;
        tile.node.style.opacity = clamp(p * 3) * (1 - seg(t, p0 + 0.05, p0 + 0.35));
        tile.tint.style.opacity = settle;
      });
      field.style.transform = `scale(${1.08 - 0.08 * seg(t, 0, p0, ease.out)})`;
      // On "Betsee", the mosaic is the mark; it shrinks into the lockup.
      const into = seg(t, p0 + 0.1, p0 + 0.9, ease.inOutQuint);
      const sOn = t >= p0 - 0.05 ? 1 : 0;
      put(solid, { x: lerp(960, 960 - 470, into), y: lerp(520, 456, into), s: lerp(1, 190 / SIZE, into), o: sOn * (1 - seg(t, p0 + 0.85, p0 + 0.95)) });
      const up = seg(t, p1 - 0.6, p1 + 0.4, ease.inOutQuint);
      mark({
        o: t >= p0 + 0.85 ? 1 : 0,
        open: 1,
        reveal: seg(t, p0 + 0.6, p0 + 1.3, ease.linear),
        m: 0,
        s: 1 - 0.34 * up,
        lift: (200 * up) / (1 - 0.34 * up),
      });
      const a = capState(t, p1, ctx.length + 1, { fin: 0.9, fout: 0.01 });
      const b = capState(t, p2, ctx.length + 1, { fin: 0.9, fout: 0.01 });
      const c = capState(t, n31.end + 0.6, ctx.length + 1, { fin: 1.0, fout: 0.01 });
      text(l1, { x: 960, y: 610, ax: 0.5, o: a.o, dy: a.dy, blur: a.blur });
      text(l2, { x: 960, y: 715, ax: 0.5, o: b.o, dy: b.dy, blur: b.blur });
      text(tag, { x: 960, y: 845, ax: 0.5, o: c.o, dy: c.dy, blur: c.blur });
    },
  };
}

export const open = { company, problem, hero, final };
