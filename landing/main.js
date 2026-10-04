const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const nav = document.querySelector(".nav");
const onScroll = () => nav.classList.toggle("is-scrolled", scrollY > 8);
addEventListener("scroll", onScroll, { passive: true });
onScroll();

// Clips load the first time they come into view and play only while on screen. With reduced
// motion nothing starts by itself; the play button still works.
const clips = [...document.querySelectorAll(".clip")];
// Low enough that the hero clip, which starts below the fold on a laptop screen, plays at once.
const VISIBLE = 0.15;
const onScreen = new Set();

const load = (video) => {
  if (!video.getAttribute("src")) video.src = video.dataset.src;
};

const play = (video) => {
  load(video);
  video.play().catch(() => {});
};

function showState(clip, playing) {
  const toggle = clip.querySelector("[data-toggle]");
  clip.classList.toggle("is-paused", !playing);
  toggle.setAttribute("aria-label", playing ? "Pause video" : "Play video");
  toggle.querySelector("use").setAttribute("href", playing ? "#i-pause" : "#i-play");
}

for (const clip of clips) {
  const video = clip.querySelector("video");
  clip.userPaused = reduceMotion;
  showState(clip, false);
  video.addEventListener("play", () => showState(clip, true));
  video.addEventListener("pause", () => showState(clip, false));
  clip.querySelector("[data-toggle]").addEventListener("click", () => {
    clip.userPaused = !video.paused;
    if (video.paused) play(video);
    else video.pause();
  });
  clip.querySelector("[data-expand]").addEventListener("click", () => openViewer(video));
  video.addEventListener("click", () => openViewer(video));
}

const observer = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      const clip = entry.target;
      const video = clip.querySelector("video");
      if (entry.intersectionRatio >= VISIBLE) {
        onScreen.add(clip);
        if (!clip.userPaused && !viewer.open) play(video);
      } else {
        onScreen.delete(clip);
        video.pause();
      }
    }
  },
  { threshold: VISIBLE },
);

// Larger view, from the start, with native controls.
const viewer = document.querySelector(".viewer");
const big = viewer.querySelector("video");

function openViewer(video) {
  load(video);
  for (const clip of clips) clip.querySelector("video").pause();
  big.src = video.getAttribute("src");
  big.poster = video.poster;
  big.setAttribute("aria-label", video.getAttribute("aria-label"));
  viewer.showModal();
  big.play().catch(() => {});
}

viewer.querySelector(".viewer-close").addEventListener("click", () => viewer.close());
viewer.addEventListener("click", (event) => {
  if (event.target === viewer) viewer.close();
});
viewer.addEventListener("close", () => {
  big.pause();
  big.removeAttribute("src");
  big.load();
  for (const clip of onScreen) if (!clip.userPaused) play(clip.querySelector("video"));
});

for (const clip of clips) observer.observe(clip);

for (const button of document.querySelectorAll("[data-copy]")) {
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
    } catch {
      // No clipboard outside a secure context (a LAN address over plain HTTP): select the
      // command so a keyboard copy takes it.
      const range = document.createRange();
      range.selectNodeContents(button.previousElementSibling);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
      return;
    }
    button.classList.add("is-done");
    button.setAttribute("aria-label", "Copied");
    setTimeout(() => {
      button.classList.remove("is-done");
      button.setAttribute("aria-label", "Copy the command");
    }, 1600);
  });
}
