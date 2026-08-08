// v1.1
// view-sections.js — SPA version of the old sections.js. Same circles,
// stars, Revision and Continue buttons. Differences:
//  - scores come from Store.completed instead of being decoded from a URL
//  - the chosen hand is written to Store instead of being put in a query
//  - navigation is a hash route change, not a full page load
//  - mount(songId) can be called many times, so everything is rebuilt
//    from scratch on each entry (stars must reflect a score just earned)
//
// v1.1: a song's own keyboardMode ("solo"/"linked", set at import time by
// import_song.py) is now actually READ — Store.keyboardMode used to stay
// on whatever the player had last picked (defaulting to "solo"), so
// opening a song that needs the full 48-95 duo range silently played
// wrong/missing notes with no explanation, looking like a bug. Now it's
// synced automatically on load, and a visible badge
// (#sections-keyboard-badge) explains why before the player hits Practice
// and gets confused.

window.ViewSections = (function () {
  const PASS_THRESHOLD = 80;

  // Song JSON says "linked"; Store/KEYBOARD_RANGES says "duo" — same
  // thing, different vocabulary from two points in the project's history.
  const SONG_TO_STORE_KEYBOARD_MODE = { solo: "solo", linked: "duo" };

  let song = null;
  let wiredTabs = false;

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

    if (pct != null) wrap.appendChild(renderStars(pct));

    return wrap;
  }

  function goToLearning(sectionId) {
    Store.sectionId = sectionId;
    Router.go(`#/song/${encodeURIComponent(Store.songId)}/${encodeURIComponent(sectionId)}`);
  }

  function render() {
    const grid = document.getElementById("section-grid");
    grid.innerHTML = "";

    song.sections.forEach((sec) => {
      const pct = Store.completed[sec.id] || 0;
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

    const nextSection = song.sections.find((sec) => (Store.completed[sec.id] || 0) < 100);
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

  function syncHandTabs() {
    document.querySelectorAll(".hand-tab").forEach((t) => {
      t.classList.toggle("active", t.dataset.hand === Store.hand);
    });
  }

  function wireHandTabs() {
    if (wiredTabs) return;
    wiredTabs = true;
    document.querySelectorAll(".hand-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        Store.hand = tab.dataset.hand;
        syncHandTabs();
      });
    });
  }

  async function mount(songId) {
    Store.songId = songId;
    wireHandTabs();
    syncHandTabs();

    document.getElementById("sections-song-title").textContent = "Loading…";
    song = await Store.loadSong(songId);
    document.getElementById("sections-song-title").textContent = song.title;

    // Match the app's active keyboard range to what this song actually
    // needs — see v1.1 note above. Falls back to "solo" for any song
    // missing the field (the two original hand-made songs predate it).
    Store.keyboardMode = SONG_TO_STORE_KEYBOARD_MODE[song.keyboardMode] || "solo";
    const badge = document.getElementById("sections-keyboard-badge");
    badge.hidden = song.keyboardMode !== "linked";

    render();
  }

  function unmount() {
    // No timers, no audio, no BLE hooks — nothing to stop.
  }

  return { mount, unmount };
})();
