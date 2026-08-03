// v1.1
// sections.js — Builds the section-select grid for a song: one circle per
// section (with a star rating), a "Revision" circle (whole song), and a
// "Continue" circle (first section not yet passed).
//
// NOTE: scores only persist for the current browsing session (passed
// between pages via the `completed` URL param) — real cross-session
// persistence will come with Supabase later.

const PASS_THRESHOLD = 80;

function parseCompleted(str) {
  const map = {};
  if (!str) return map;
  str.split(",").forEach((entry) => {
    const [id, pct] = entry.split(":");
    if (id) map[id] = Number(pct);
  });
  return map;
}

function encodeCompleted(map) {
  return Object.entries(map)
    .map(([id, pct]) => `${id}:${pct}`)
    .join(",");
}

function starsForPct(pct) {
  if (pct >= 100) return 3;
  if (pct >= PASS_THRESHOLD) return 2;
  if (pct >= 50) return 1;
  return 0;
}

function renderStars(pct) {
  const count = starsForPct(pct);
  const el = document.createElement("div");
  el.className = "stars";
  for (let i = 0; i < 3; i++) {
    const star = document.createElement("span");
    star.className = "star" + (i < count ? " filled" : "");
    star.textContent = "★";
    el.appendChild(star);
  }
  return el;
}

function buildCircle({ className, title, subtitle, pct, onClick }) {
  const wrap = document.createElement("div");
  wrap.className = "section-circle-wrap";

  const btn = document.createElement("button");
  btn.className = `section-circle ${className || ""}`.trim();
  btn.textContent = title;
  btn.addEventListener("click", onClick);
  wrap.appendChild(btn);

  if (subtitle) {
    const label = document.createElement("div");
    label.className = "section-label";
    label.textContent = subtitle;
    wrap.appendChild(label);
  }

  if (pct != null) {
    wrap.appendChild(renderStars(pct));
  }

  return wrap;
}

async function init() {
  const params = new URLSearchParams(window.location.search);
  const songId = params.get("song") || "ode-to-joy";
  const completed = parseCompleted(params.get("completed"));

  // Same cache-busting as learning.js — avoids a stale cached song file.
  const res = await fetch(`data/songs/${songId}.json?v=${Date.now()}`, { cache: "no-store" });
  const song = await res.json();

  document.getElementById("song-title").textContent = song.title;

  let selectedHand = "right";

  function goToLearning(sectionId) {
    const query = new URLSearchParams({
      song: songId,
      section: sectionId,
      hand: selectedHand,
      completed: encodeCompleted(completed),
    });
    window.location.href = `learning.html?${query.toString()}`;
  }

  function render() {
    const grid = document.getElementById("section-grid");
    grid.innerHTML = "";

    song.sections.forEach((sec) => {
      const pct = completed[sec.id] || 0;
      const noteCount = sec.noteIndexEnd - sec.noteIndexStart + 1;
      grid.appendChild(
        buildCircle({
          title: `${sec.noteIndexStart + 1}-${sec.noteIndexEnd + 1}`,
          subtitle: sec.label,
          pct,
          onClick: () => goToLearning(sec.id),
        })
      );
    });

    grid.appendChild(
      buildCircle({
        className: "revision",
        title: "Revision",
        subtitle: "Whole song",
        pct: null,
        onClick: () => goToLearning("all"),
      })
    );

    const nextSection = song.sections.find((sec) => (completed[sec.id] || 0) < 100);
    if (nextSection) {
      grid.appendChild(
        buildCircle({
          className: "continue",
          title: "Continue",
          subtitle: nextSection.label,
          pct: null,
          onClick: () => goToLearning(nextSection.id),
        })
      );
    }
  }

  document.querySelectorAll(".hand-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      selectedHand = tab.dataset.hand;
      document.querySelectorAll(".hand-tab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
    });
  });

  render();
}

document.addEventListener("DOMContentLoaded", init);
