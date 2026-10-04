// Every section renders complete without this file. Clip playback, the navigation and the copy
// button work on their own; everything GSAP adds is motion on top, and none of it runs when the
// visitor asks for reduced motion or the vendor scripts did not load.
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const motion = !reduceMotion && typeof window.gsap !== "undefined";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

// Navigation: ruled once the page moves, hidden while reading down, back on the way up.
const nav = $(".nav");
const progress = $(".progress");
let lastY = scrollY;
function onScroll() {
  const y = scrollY;
  nav.classList.toggle("is-scrolled", y > 8);
  if (y > 480 && y > lastY + 4) nav.classList.add("is-hidden");
  else if (y < lastY - 4 || y <= 480) nav.classList.remove("is-hidden");
  lastY = y;
  const max = document.documentElement.scrollHeight - innerHeight;
  progress.style.transform = `scaleX(${max > 0 ? Math.min(1, y / max) : 0})`;
}
addEventListener("scroll", onScroll, { passive: true });
onScroll();

// Clips load the first time they come into view and play only while on screen. A clip in the
// pinned product stage plays only while its step is the active one (data-gate).
const VISIBLE = 0.15;
const clips = $$(".clip");
const onScreen = new Set();
const viewer = $(".viewer");
const big = $("video", viewer);

const load = (video) => {
  if (!video.getAttribute("src")) video.src = video.dataset.src;
};

function sync(clip) {
  const video = $("video", clip);
  const wanted = onScreen.has(clip) && !clip.userPaused && clip.dataset.gate !== "closed" && !viewer.open;
  if (wanted) {
    load(video);
    video.play().catch(() => {});
  } else video.pause();
}

function showState(clip, playing) {
  const toggle = $("[data-toggle]", clip);
  clip.classList.toggle("is-paused", !playing);
  toggle.setAttribute("aria-label", playing ? "Pause video" : "Play video");
  $("use", toggle).setAttribute("href", playing ? "#i-pause" : "#i-play");
}

function openViewer(video) {
  load(video);
  for (const clip of clips) $("video", clip).pause();
  big.src = video.getAttribute("src");
  big.poster = video.poster;
  big.setAttribute("aria-label", video.getAttribute("aria-label"));
  viewer.showModal();
  big.play().catch(() => {});
}

for (const clip of clips) {
  const video = $("video", clip);
  clip.userPaused = reduceMotion;
  showState(clip, false);
  video.addEventListener("play", () => showState(clip, true));
  video.addEventListener("pause", () => showState(clip, false));
  $("[data-toggle]", clip).addEventListener("click", () => {
    clip.userPaused = !video.paused;
    if (video.paused) {
      load(video);
      video.play().catch(() => {});
    } else video.pause();
  });
  $("[data-expand]", clip).addEventListener("click", () => openViewer(video));
  video.addEventListener("click", () => openViewer(video));
}

const observer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (entry.intersectionRatio >= VISIBLE) onScreen.add(entry.target);
      else onScreen.delete(entry.target);
      sync(entry.target);
    }
  },
  { threshold: VISIBLE },
);
for (const clip of clips) observer.observe(clip);

$(".viewer-close").addEventListener("click", () => viewer.close());
viewer.addEventListener("click", (event) => {
  if (event.target === viewer) viewer.close();
});
viewer.addEventListener("close", () => {
  big.pause();
  big.removeAttribute("src");
  big.load();
  for (const clip of clips) sync(clip);
});

for (const button of $$("[data-copy]")) {
  const label = button.textContent;
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
    } catch {
      // No clipboard outside a secure context (a LAN address over plain HTTP): select the
      // command so a keyboard copy takes it.
      const range = document.createRange();
      range.selectNodeContents($(".term-typed"));
      getSelection().removeAllRanges();
      getSelection().addRange(range);
      return;
    }
    button.classList.add("is-done");
    button.textContent = "Copied";
    setTimeout(() => {
      button.classList.remove("is-done");
      button.textContent = label;
    }, 1600);
  });
}

// The curtain: the eye opens, looks left and right, blinks while the fonts load, and animate()
// then opens the page through its pupil.
const curtain = $(".curtain");
if (motion) {
  curtain.style.animation = "none";
  const { gsap } = window;
  const eye = $(".eye-curtain", curtain);
  const lids = $(".eye-lids", eye);
  const pupil = $(".pupil", eye);
  const number = $(".curtain-n", curtain);
  const count = { v: 0 };
  gsap.set([lids, pupil], { svgOrigin: "50 52" });
  const look = gsap
    .timeline()
    .from(lids, { scaleY: 0.04, duration: 0.6, ease: "expo.out" }, 0.1)
    .from(pupil, { scale: 0, duration: 0.5, ease: "back.out(2.4)" }, 0.25)
    .to(pupil, { x: -11, duration: 0.3, ease: "power3.inOut" }, 0.7)
    .to(pupil, { x: 11, duration: 0.4, ease: "power3.inOut" }, 1.0)
    .to(pupil, { x: 0, duration: 0.3, ease: "power3.inOut" }, 1.4)
    .to([lids, pupil], { scaleY: 0.06, duration: 0.08, ease: "power2.in" }, 1.62)
    .to([lids, pupil], { scaleY: 1, duration: 0.14, ease: "power2.out" }, 1.7)
    .to(
      count,
      {
        v: 100,
        duration: 1.7,
        ease: "power2.inOut",
        onUpdate: () => {
          number.textContent = String(Math.round(count.v)).padStart(2, "0");
        },
      },
      0.05,
    );
  const looked = new Promise((resolve) => look.eventCallback("onComplete", resolve));
  Promise.all([looked, document.fonts.ready]).then(animate);
} else curtain.remove();

function animate() {
  const { gsap, ScrollTrigger, ScrollSmoother, SplitText } = window;
  gsap.registerPlugin(ScrollTrigger, ScrollSmoother, SplitText);

  const smoother = ScrollSmoother.create({
    wrapper: "#smooth-wrapper",
    content: "#smooth-content",
    smooth: 1.35,
    effects: true,
    smoothTouch: false,
  });

  for (const link of $$('a[href^="#"]')) {
    link.addEventListener("click", (event) => {
      const id = link.getAttribute("href");
      const target = id === "#top" ? 0 : $(id);
      if (target === null) return;
      event.preventDefault();
      smoother.scrollTo(target, true, "top 60px");
      history.replaceState(null, "", id);
    });
  }

  openThroughPupil(gsap);
  hero(gsap, ScrollTrigger, SplitText);
  pointer(gsap);
  rules(gsap);
  band(gsap, ScrollTrigger);
  headings(gsap, SplitText);
  reveals(gsap, ScrollTrigger);
  thesis(gsap, SplitText);
  figures(gsap);
  terminal(gsap);
  eyes(gsap);

  const mm = gsap.matchMedia();
  mm.add({ wide: "(min-width: 961px)", narrow: "(max-width: 960px)" }, (context) => {
    pipeline(gsap, context.conditions.wide);
    if (!context.conditions.wide) return undefined;
    const undoStory = story(gsap, ScrollTrigger);
    const undoGallery = gallery(gsap);
    owaspPin(ScrollTrigger);
    return () => {
      undoStory();
      undoGallery();
    };
  });
  owaspRows(gsap, ScrollTrigger);

  ScrollTrigger.refresh();
}

function hero(gsap, ScrollTrigger, SplitText) {
  const lines = $$(".hl");
  const chars = lines.flatMap((line) => SplitText.create(line, { type: "words,chars", mask: "words", wordsClass: "word", charsClass: "char" }).chars);
  gsap
    .timeline({ defaults: { ease: "expo.out" }, delay: 0.75, onComplete: () => keys(gsap, chars) })
    .from(".hero-meta p", { y: 16, autoAlpha: 0, duration: 0.9, stagger: 0.08 }, 0)
    .from(chars, { yPercent: 115, duration: 1.3, stagger: 0.028 }, 0.1)
    .from([".lede", ".cta"], { y: 30, autoAlpha: 0, duration: 1.1, stagger: 0.1 }, 0.7)
    .from(".feed", { y: 30, autoAlpha: 0, duration: 1.1 }, 0.8)
    .from(".hero-film", { y: 80, autoAlpha: 0, duration: 1.4 }, 0.9);

  // Soft colour fields drift on their own behind the grid.
  gsap.to(".blob", {
    x: "random(-90, 90)",
    y: "random(-70, 70)",
    scale: "random(0.85, 1.2)",
    duration: "random(7, 11)",
    ease: "sine.inOut",
    repeat: -1,
    yoyo: true,
    repeatRefresh: true,
  });
  gsap.to(".aurora", { yPercent: 30, ease: "none", scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom top", scrub: true } });

  // The three lines drift apart as the page leaves the hero.
  const drift = { trigger: ".hero", start: "top top", end: "bottom top", scrub: true };
  gsap.to(".hl-1", { xPercent: -5, ease: "none", scrollTrigger: drift });
  gsap.to(".hl-2", { xPercent: 3, ease: "none", scrollTrigger: drift });
  gsap.to(".hl-3", { xPercent: 9, ease: "none", scrollTrigger: drift });

  // The Director film opens from a narrow plate to the full width.
  const media = $(".hero-film .film-media");
  const open = { trigger: ".hero-film", start: "top 92%", end: "top 20%", scrub: true };
  gsap.fromTo(media, { clipPath: "inset(7% 16% 7% 16%)" }, { clipPath: "inset(0% 0% 0% 0%)", ease: "none", scrollTrigger: open });
  gsap.fromTo($("video", media), { scale: 1.18 }, { scale: 1, ease: "none", scrollTrigger: open });

  feed(gsap, ScrollTrigger);
}

/** Letters under the pointer press down like keys and spring back. */
function keys(gsap, chars) {
  if (!matchMedia("(hover: hover) and (pointer: fine)").matches) return;
  gsap.set(chars, { transformOrigin: "50% 100%" });
  const all = chars.map((char) => ({
    char,
    y: gsap.quickTo(char, "yPercent", { duration: 0.6, ease: "power3" }),
    s: gsap.quickTo(char, "scaleY", { duration: 0.6, ease: "power3" }),
  }));
  const title = $(".hero-title");
  title.addEventListener("pointermove", (event) => {
    for (const key of all) {
      const box = key.char.getBoundingClientRect();
      const near = Math.max(0, 1 - Math.hypot(event.clientX - box.left - box.width / 2, event.clientY - box.top - box.height / 2) / 240);
      key.y(near * 10);
      key.s(1 - near * 0.14);
    }
  });
  title.addEventListener("pointerleave", () => {
    for (const key of all) {
      key.y(0);
      key.s(1);
    }
  });
}

/** A dot that follows the pointer, grows over links and becomes a labelled disc over clips. */
function pointer(gsap) {
  if (!matchMedia("(hover: hover) and (pointer: fine)").matches) return;
  const el = document.createElement("div");
  el.className = "cursor is-out";
  el.setAttribute("aria-hidden", "true");
  const dot = document.createElement("div");
  dot.className = "cursor-dot";
  const label = document.createElement("span");
  label.textContent = "View";
  dot.append(label);
  el.append(dot);
  document.body.append(el);
  document.documentElement.classList.add("has-cursor");
  const x = gsap.quickTo(el, "x", { duration: 0.5, ease: "power3" });
  const y = gsap.quickTo(el, "y", { duration: 0.5, ease: "power3" });
  addEventListener(
    "pointermove",
    (event) => {
      x(event.clientX);
      y(event.clientY);
      const media = event.target.closest?.(".film-media") != null;
      el.classList.remove("is-out");
      el.classList.toggle("is-media", media);
      el.classList.toggle("is-link", !media && event.target.closest?.("a, button") != null);
    },
    { passive: true },
  );
  document.documentElement.addEventListener("pointerleave", () => el.classList.add("is-out"));
}

/** Section openings draw in from the left, rule and all. */
function rules(gsap) {
  for (const el of $$(".section-head, .story-head, .how-head, .thesis .split-grid, .gallery-head, .owasp-side, .term, .hosts, .figures-row, .band-small")) {
    gsap.fromTo(
      el,
      { clipPath: "inset(0% 100% 0% 0%)" },
      {
        clipPath: "inset(0% 0% 0% 0%)",
        duration: 1.6,
        ease: "expo.inOut",
        scrollTrigger: { trigger: el, start: "top 90%" },
        onComplete: () => gsap.set(el, { clearProps: "clipPath" }),
      },
    );
  }
}

// Demo decisions for the hero feed; the shape of what the Director's activity list shows.
const FEED = [
  ["invoice-assistant", "files.read", "ok", "Allowed"],
  ["research-agent", "agent.message", "bad", "Denied"],
  ["support-triage", "tickets.read", "ok", "Allowed"],
  ["ops-runner", "shell.exec", "verify", "Step-up"],
  ["employee-assistant", "Read", "ok", "Allowed"],
  ["support-triage", "memory.write", "ai", "Tightened by AI"],
  ["invoice-assistant", "payments.transfer", "wait", "Awaiting approval"],
  ["employee-assistant", "WebFetch", "bad", "Denied"],
  ["report-bot", "crm.read", "quar", "Quarantined"],
  ["invoice-assistant", "crm.read", "ok", "Allowed"],
  ["employee-assistant", "Write", "wait", "Awaiting approval"],
  ["research-agent", "files.read", "bad", "Denied"],
];

function feed(gsap, ScrollTrigger) {
  const list = $(".feed-rows");
  const clock = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  let next = 0;
  let timer;
  const push = () => {
    const [agent, capability, tone, outcome] = FEED[next++ % FEED.length];
    const row = document.createElement("li");
    const time = document.createElement("time");
    const who = document.createElement("b");
    const cap = document.createElement("code");
    const out = document.createElement("em");
    time.textContent = clock.format(new Date());
    who.textContent = agent;
    cap.textContent = capability;
    out.textContent = outcome;
    out.className = tone;
    row.append(time, who, cap, out);
    list.prepend(row);
    gsap.from(row, { height: 0, autoAlpha: 0, duration: 0.6, ease: "expo.out" });
    gsap.fromTo(row, { backgroundColor: "rgba(11, 11, 12, 0.07)" }, { backgroundColor: "rgba(11, 11, 12, 0)", duration: 1.8, ease: "power2.out" });
    gsap.from(row.children, { y: -10, duration: 0.6, ease: "expo.out", stagger: 0.04 });
    while (list.children.length > 8) list.lastElementChild.remove();
  };
  ScrollTrigger.create({
    trigger: ".hero",
    start: "top top",
    end: "bottom top",
    onToggle: (self) => {
      clearInterval(timer);
      if (self.isActive) timer = setInterval(push, 1700);
    },
  });
}

function band(gsap, ScrollTrigger) {
  const tweens = $$(".band-row").map((row) => {
    const track = $(".band-track", row);
    const copy = track.cloneNode(true);
    copy.setAttribute("aria-hidden", "true");
    row.appendChild(copy);
    const reverse = row.classList.contains("band-reverse");
    return gsap.fromTo(
      [track, copy],
      { xPercent: reverse ? -100 : 0 },
      { xPercent: reverse ? 0 : -100, duration: row.classList.contains("band-big") ? 36 : 60, ease: "none", repeat: -1 },
    );
  });

  // Scroll speed pushes the rows faster and shears them, then they settle; direction follows scroll.
  const boost = { v: 1 };
  let direction = 1;
  const apply = () => tweens.forEach((t) => t.timeScale(boost.v * direction));
  const skew = gsap.quickTo(".band-big .band-track", "skewX", { duration: 0.6, ease: "power3" });
  let settle;
  ScrollTrigger.create({
    trigger: ".band",
    start: "top bottom",
    end: "bottom top",
    onUpdate(self) {
      const velocity = self.getVelocity();
      direction = self.direction;
      gsap.killTweensOf(boost);
      boost.v = Math.max(boost.v, gsap.utils.clamp(1, 7, 1 + Math.abs(velocity) / 350));
      apply();
      gsap.to(boost, { v: 1, duration: 1.4, ease: "power2.out", onUpdate: apply });
      skew(gsap.utils.clamp(-12, 12, velocity / -260));
      clearTimeout(settle);
      settle = setTimeout(() => skew(0), 140);
    },
  });
}

function headings(gsap, SplitText) {
  for (const heading of $$("h2.split")) {
    SplitText.create(heading, {
      type: "lines",
      mask: "lines",
      linesClass: "line",
      autoSplit: true,
      onSplit: (self) =>
        gsap.from(self.lines, {
          yPercent: 110,
          duration: 1.2,
          ease: "expo.out",
          stagger: 0.09,
          scrollTrigger: { trigger: heading, start: "top 86%" },
        }),
    });
  }
}

function reveals(gsap, ScrollTrigger) {
  const targets = $$(
    [
      ".section-head .label",
      ".section-head .sub",
      ".how-head .label",
      ".story-head .label",
      ".story-head .sub",
      ".thesis .label",
      ".gallery-head .label",
      ".owasp-side .label",
      ".owasp-side .sub",
      ".request",
      ".hosts div",
      ".rules li",
      ".story-step > *:not(.clip)",
    ].join(", "),
  );
  gsap.set(targets, { y: 40, autoAlpha: 0 });
  ScrollTrigger.batch(targets, {
    start: "top 88%",
    once: true,
    // "auto", not true: true would also kill other tweens on the same element, like a rule reveal.
    onEnter: (batch) => gsap.to(batch, { y: 0, autoAlpha: 1, duration: 1.1, ease: "expo.out", stagger: 0.07, overwrite: "auto" }),
  });
}

function thesis(gsap, SplitText) {
  const words = SplitText.create(".thesis-line", { type: "words", wordsClass: "word" }).words;
  gsap
    .timeline({ scrollTrigger: { trigger: ".thesis", start: "center center", end: "+=900", pin: true, scrub: 0.6 } })
    .fromTo(words, { opacity: 0.1 }, { opacity: 1, stagger: 0.12, ease: "none" })
    .from(".thesis-sub", { y: 30, autoAlpha: 0, ease: "expo.out", duration: 0.6 }, "-=0.2");
}

function figures(gsap) {
  gsap.from(".figures-row strong", {
    yPercent: 40,
    autoAlpha: 0,
    duration: 1.2,
    ease: "expo.out",
    stagger: 0.1,
    scrollTrigger: { trigger: ".figures-row", start: "top 85%" },
  });
  for (const el of $$("[data-count]")) {
    const to = Number(el.dataset.count);
    const value = { v: Number(el.dataset.from ?? 0) };
    el.textContent = String(value.v);
    gsap.to(value, {
      v: to,
      duration: 1.8,
      ease: "power3.out",
      scrollTrigger: { trigger: el, start: "top 88%", once: true },
      onUpdate: () => {
        el.textContent = String(Math.round(value.v));
      },
    });
  }
}

/**
 * One request walks the fifteen stages: each row floods black and shows what its stage found.
 * Wide screens pin the section and scrub the walk with the scroll; narrow ones play it once.
 */
function pipeline(gsap, pinned) {
  const rows = $$(".stages li");
  // Waiting for a human takes longer than any check.
  const length = [1, 1, 1, 1, 1, 1, 1, 1, 1.2, 1.2, 2.2, 1.8, 1, 1, 1.2];
  const st = { check: $(".st-check"), wait: $(".st-wait"), verify: $(".st-verify"), ok: $(".st-ok") };

  gsap.set([st.wait, st.verify, st.ok], { autoAlpha: 0 });
  gsap.set(st.check, { autoAlpha: 1 });

  const tl = gsap.timeline({
    defaults: { ease: "none" },
    scrollTrigger: pinned
      ? { trigger: ".how-pin", start: "top top", end: "+=2600", pin: true, scrub: 0.8, anticipatePin: 1 }
      : { trigger: ".stages", start: "top 75%", once: true },
  });
  if (!pinned) tl.timeScale(4);

  const swap = (from, to, at) => {
    tl.to(from, { autoAlpha: 0, y: -12, duration: 0.25 }, at).fromTo(to, { autoAlpha: 0, y: 12 }, { autoAlpha: 1, y: 0, duration: 0.25 }, at + 0.15);
  };

  let at = 0.3;
  rows.forEach((row, i) => {
    tl.to($(".wipe", row), { scaleX: 1, duration: length[i] * 0.7, ease: "power2.inOut" }, at)
      .to(row, { color: "#ffffff", duration: 0.2 }, at + length[i] * 0.3)
      .to($(".res", row), { opacity: 1, duration: 0.25 }, at + length[i] * 0.55);
    if (i === 9) swap(st.check, st.wait, at + 0.5);
    if (i === 11) swap(st.wait, st.verify, at + 0.2);
    if (i === 12) swap(st.verify, st.ok, at + 0.2);
    at += length[i];
  });
  tl.to({}, { duration: 0.8 });
}

// Each product step's colour and the soft field the section takes on while it is active.
const STORY_TONES = {
  blue: ["#3a5bd9", "#eef2fd"],
  bad: ["#e0484e", "#fdeeee"],
  wait: ["#9a5800", "#fef5e6"],
  verify: ["#8a52c7", "#f5effc"],
  ok: ["#14a05a", "#ebf7f0"],
};

function story(gsap, ScrollTrigger) {
  const section = $(".story");
  const grid = $(".story-grid");
  const stage = $(".story-stage");
  const steps = $$(".story-step");
  const now = $(".story-now");
  const bar = $(".story-bar i");
  const storyClips = steps.map((step) => $(".story-clip", step));

  grid.classList.add("is-staged");
  for (const clip of storyClips) {
    clip.dataset.gate = "closed";
    stage.appendChild(clip);
  }
  gsap.set(storyClips, { autoAlpha: 0 });

  let active = -1;
  const show = (index) => {
    if (index === active) return;
    const down = index > active;
    const first = active < 0;
    active = index;
    storyClips.forEach((clip, i) => {
      const on = i === index;
      clip.dataset.gate = on ? "open" : "closed";
      const media = $(".film-media", clip);
      if (on) {
        gsap.set(clip, { autoAlpha: 1, zIndex: 2 });
        // The incoming plate wipes over the outgoing one from the scroll direction.
        gsap.fromTo(media, { clipPath: first ? "inset(0% 0% 0% 0%)" : down ? "inset(100% 0% 0% 0%)" : "inset(0% 0% 100% 0%)" }, { clipPath: "inset(0% 0% 0% 0%)", duration: 0.9, ease: "expo.inOut" });
        gsap.fromTo($("video", clip), { scale: 1.12 }, { scale: 1, duration: 2, ease: "expo.out" });
        if (!first) $("video", clip).currentTime = 0;
      } else gsap.to(clip, { autoAlpha: 0, zIndex: 1, duration: 0.01, delay: 0.9, overwrite: true });
      sync(clip);
    });
    steps.forEach((step, i) => step.classList.toggle("is-active", i === index));
    gsap.fromTo(now, { yPercent: first ? 0 : down ? 100 : -100 }, { yPercent: 0, duration: 0.7, ease: "expo.out", onStart: () => (now.textContent = String(index + 1).padStart(2, "0")) });
    gsap.to(bar, { scaleX: (index + 1) / steps.length, duration: 0.7, ease: "expo.out" });
    const [tone, tint] = STORY_TONES[steps[index].dataset.tone] ?? STORY_TONES.blue;
    gsap.to(section, { "--story-tone": tone, "--story-tint": tint, duration: 0.9, ease: "power2.out" });
  };
  show(0);

  ScrollTrigger.create({ trigger: grid, start: "top top", end: "bottom bottom", pin: ".story-media", pinSpacing: false });
  steps.forEach((step, i) =>
    ScrollTrigger.create({ trigger: step, start: "top center", end: "bottom center", onToggle: (self) => self.isActive && show(i) }),
  );

  return () => {
    gsap.set(section, { clearProps: "--story-tone,--story-tint" });
    grid.classList.remove("is-staged");
    storyClips.forEach((clip, i) => {
      delete clip.dataset.gate;
      gsap.set([clip, $(".film-media", clip)], { clearProps: "all" });
      steps[i].appendChild(clip);
      sync(clip);
    });
    steps.forEach((step) => step.classList.remove("is-active"));
  };
}

function gallery(gsap) {
  const track = $(".gallery-track");
  track.classList.add("is-pinned");
  const distance = () => track.scrollWidth - innerWidth;
  const range = { trigger: ".gallery-pin", start: "top top", end: () => `+=${distance()}`, scrub: 1, invalidateOnRefresh: true };
  const slide = gsap.to(track, { x: () => -distance(), ease: "none", scrollTrigger: { ...range, pin: true } });
  gsap.fromTo(".gallery-word", { xPercent: 0 }, { xPercent: -35, ease: "none", scrollTrigger: range });
  for (const img of $$(".shot-img img")) {
    gsap.fromTo(
      img,
      { scale: 1.16, xPercent: -5 },
      { scale: 1.02, xPercent: 5, ease: "none", scrollTrigger: { trigger: img.closest(".shot"), containerAnimation: slide, start: "left right", end: "right left", scrub: true } },
    );
  }
  return () => track.classList.remove("is-pinned");
}

function owaspPin(ScrollTrigger) {
  const side = $(".owasp-side");
  ScrollTrigger.create({
    trigger: ".owasp-grid",
    start: "top 90px",
    end: () => `bottom ${90 + side.offsetHeight}px`,
    pin: side,
    pinSpacing: false,
    invalidateOnRefresh: true,
  });
}

function owaspRows(gsap, ScrollTrigger) {
  const counter = $(".owasp-n");
  let done = 0;
  counter.textContent = "0";
  for (const row of $$(".risks li")) {
    gsap.set(row, { x: 60, autoAlpha: 0 });
    ScrollTrigger.create({
      trigger: row,
      start: "top 80%",
      onEnter: () => {
        counter.textContent = String(++done);
        gsap.to(row, { x: 0, autoAlpha: 1, duration: 0.9, ease: "expo.out" });
      },
      onLeaveBack: () => {
        counter.textContent = String(--done);
        gsap.to(row, { x: 60, autoAlpha: 0, duration: 0.5, ease: "power2.in" });
      },
    });
  }
}

function terminal(gsap) {
  const typed = $(".term-typed");
  const command = typed.textContent;
  const caret = document.createElement("span");
  caret.className = "caret";
  caret.setAttribute("aria-hidden", "true");
  typed.after(caret);
  typed.textContent = "";
  const lines = $$(".term-out span");
  gsap.set(lines, { autoAlpha: 0 });
  const progress = { n: 0 };
  gsap
    .timeline({ scrollTrigger: { trigger: ".term", start: "top 75%", once: true }, delay: 0.3 })
    .to(progress, {
      n: command.length,
      duration: command.length * 0.065,
      ease: "none",
      onUpdate: () => {
        typed.textContent = command.slice(0, Math.round(progress.n));
      },
    })
    .to(lines, { autoAlpha: 1, duration: 0.01, stagger: 0.22 }, "+=0.4")
    .set(caret, { display: "none" });
}

/** The page appears through a hole that grows from the pupil while the eye rushes towards you. */
function openThroughPupil(gsap) {
  const eye = $(".eye-curtain");
  const box = $(".pupil", eye).getBoundingClientRect();
  const frame = eye.getBoundingClientRect();
  const x = box.left + box.width / 2;
  const y = box.top + box.height / 2;
  gsap.set(curtain, { "--x": `${x}px`, "--y": `${y}px`, "--r": "0px" });
  gsap
    .timeline()
    .to(eye, { scale: 9, transformOrigin: `${x - frame.left}px ${y - frame.top}px`, duration: 1.1, ease: "expo.in" }, 0)
    .to(curtain, { "--r": `${Math.hypot(innerWidth, innerHeight)}px`, duration: 1, ease: "expo.inOut" }, 0.3)
    .set(curtain, { display: "none" });
}

/** The closing eye follows the pointer and blinks now and then. */
function eyes(gsap) {
  const eye = $(".eye-outro");
  const lids = $(".eye-lids", eye);
  const pupil = $(".pupil", eye);
  gsap.set([lids, pupil], { svgOrigin: "50 52" });
  const px = gsap.quickTo(pupil, "x", { duration: 0.7, ease: "power3" });
  const py = gsap.quickTo(pupil, "y", { duration: 0.7, ease: "power3" });
  addEventListener(
    "pointermove",
    (event) => {
      const box = eye.getBoundingClientRect();
      const dx = event.clientX - (box.left + box.width * 0.506);
      const dy = event.clientY - (box.top + box.height * 0.526);
      const reach = Math.min(1, Math.hypot(dx, dy) / 500);
      const angle = Math.atan2(dy, dx);
      // The pupil travels further sideways than up and down, as an eye does.
      px(Math.cos(angle) * 11 * reach);
      py(Math.sin(angle) * 5 * reach);
    },
    { passive: true },
  );
  const blink = () =>
    gsap
      .timeline({ onComplete: () => gsap.delayedCall(gsap.utils.random(2.5, 6), blink) })
      .to([lids, pupil], { scaleY: 0.06, duration: 0.08, ease: "power2.in" })
      .to([lids, pupil], { scaleY: 1, duration: 0.16, ease: "power2.out" });
  gsap.delayedCall(2, blink);
  gsap.from(eye, { scaleY: 0.05, autoAlpha: 0, duration: 1, ease: "expo.out", scrollTrigger: { trigger: ".outro", start: "top 70%" } });
}
