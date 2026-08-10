// v1.4
// view-dashboard.js
// v1.4: DEMO_STATE is gone — "Hours practiced", "Daily average", "Songs
// in progress" and "Recently played" now come from real Supabase data
// (SupabasePiano101.loadDashboardStats + loadAllProgress, both already
// used elsewhere: Browse uses loadAllProgress for its own progress bars,
// and view-learning.js now writes the piano101_sessions rows that
// loadDashboardStats reads). Switching profiles re-fetches everything
// for the newly active profile rather than swapping between two
// hardcoded objects. On any Supabase failure the stats show 0/empty —
// same fallback philosophy as Browse and Sections, never a crash.
//
// v1.3
// view-dashboard.js
// v1.3: the "Library" preview's 3 songs are now sorted alphabetically
// before slicing — songs.json is in insertion order, so this preview
// used to always show the same 3 earliest-imported songs regardless of
// what else was in the library.
//
// v1.2
// view-dashboard.js
// v1.2: fixed the profile switch never getting its active/amber state
// (or click handlers) unless the Dashboard specifically was the first
// view visited — that wiring was stuck inside mount(), which only runs
// when the Dashboard is actually mounted. It's now wired immediately
// when this script loads, regardless of starting route, since the
// profile switch lives in the persistent app shell, not just here.
//
// v1.1: the three real profiles (Nicolas / Mia / Tenzin) replace the
// Profile 1 / Profile 2 placeholders, and the greeting now uses the
// active profile's name. Tenzin starts empty, which also exercises the
// "no songs played yet" empty state.
//
// v1.0: SPA version of the old app.js. Same demo data and
// same rendering; the only real changes are (a) it's wrapped in a module
// with mount()/unmount() instead of running on DOMContentLoaded, and
// (b) library rows navigate with a hash route instead of a page load.
//
// The profile switch now lives in the persistent app shell, so it's wired
// once here rather than on every navigation.

window.ViewDashboard = (function () {
  // Store/Supabase use text ids (piano101_profiles.id); the dashboard's
  // buttons use the numeric 1/2/3 that was already there before Supabase.
  const PROFILE_ID_TO_STORE_ID = { 1: "nicolas", 2: "mia", 3: "tenzin" };
  const PROFILE_NAMES = { 1: "Nicolas", 2: "Mia", 3: "Tenzin" };

  let activeProfile = 1;
  let allSongs = []; // cached songs.json, fetched once in mount()
  let dashboardInitialized = false;
  let statsRequestToken = 0; // guards against a slow fetch from a
                              // previously-active profile landing after
                              // a faster switch to a different one

  function formatRelativeDate(isoString) {
    const then = new Date(isoString);
    const diffDays = Math.floor((Date.now() - then.getTime()) / (1000 * 60 * 60 * 24));
    if (diffDays <= 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    return `${diffDays} days ago`;
  }

  function renderStats(stats) {
    document.getElementById("stat-hours").textContent = stats.hoursPracticed.toFixed(1);
    document.getElementById("stat-avg").textContent = Math.round(stats.avgMinutesPerDay);
    document.getElementById("stat-songs").textContent = stats.songsInProgressCount;
  }

  function renderRecentSongs(stats, progressBySong) {
    const container = document.getElementById("recent-list");
    container.innerHTML = "";

    if (stats.recentSongIds.length === 0) {
      container.innerHTML = `<div class="empty">No songs played yet. Head to the library to get started.</div>`;
      return;
    }

    for (const { songId, lastPlayedAt } of stats.recentSongIds.slice(0, 5)) {
      const song = allSongs.find((s) => s.id === songId);
      if (!song) continue; // song removed from the library since it was played

      const passed = progressBySong[songId] || 0;
      const total = song.sectionCount || 0;
      const pct = total > 0 ? Math.round((passed / total) * 100) : 0;

      const row = document.createElement("a");
      row.className = "song-row";
      row.href = `#/song/${encodeURIComponent(songId)}`;
      row.style.textDecoration = "none";
      row.style.color = "inherit";
      row.innerHTML = `
        <span class="song-dot" style="background:${song.notesColor}; color:${song.notesColor}"></span>
        <div class="song-info">
          <div class="song-name">${song.title}</div>
          <div class="song-meta">${formatRelativeDate(lastPlayedAt)}</div>
        </div>
        <div class="progress-track">
          <div class="progress-fill" style="width:${pct}%; background:${song.notesColor}"></div>
        </div>
      `;
      container.appendChild(row);
    }
  }

  function renderLibraryPreview(songs) {
    const container = document.getElementById("library-preview");
    container.innerHTML = "";
    // Same reasoning as view-browse.js: songs.json is in insertion
    // order, not alphabetical — sorting first means this 3-song preview
    // isn't always just "whichever 3 happened to be imported earliest".
    const sorted = [...songs].sort((a, b) => a.title.localeCompare(b.title));
    for (const song of sorted.slice(0, 3)) {
      const row = document.createElement("a");
      row.className = "song-row";
      row.href = `#/song/${encodeURIComponent(song.id)}`;
      row.style.textDecoration = "none";
      row.style.color = "inherit";
      row.innerHTML = `
        <span class="song-dot" style="background:${song.notesColor}; color:${song.notesColor}"></span>
        <div class="song-info">
          <div class="song-name">${song.title}</div>
          <div class="song-meta">${song.difficulty}</div>
        </div>
      `;
      container.appendChild(row);
    }
  }

  // Fetches and renders everything Supabase-backed for the currently
  // active profile — stats, and the recently-played list's progress
  // bars. Guarded by statsRequestToken so a slow request from a profile
  // the person has since switched away from can't overwrite what's on
  // screen with stale data.
  async function loadAndRenderStats() {
    const profileId = PROFILE_ID_TO_STORE_ID[activeProfile];
    const myToken = ++statsRequestToken;

    document.getElementById("stat-hours").textContent = "–";
    document.getElementById("stat-avg").textContent = "–";
    document.getElementById("stat-songs").textContent = "–";
    document.getElementById("recent-list").innerHTML = "";

    const [stats, progressBySong] = await Promise.all([
      window.SupabasePiano101.loadDashboardStats(profileId),
      window.SupabasePiano101.loadAllProgress(profileId),
    ]);

    if (myToken !== statsRequestToken) return; // superseded by a newer switch

    renderStats(stats);
    renderRecentSongs(stats, progressBySong);
  }

  function setActiveProfile(id) {
    activeProfile = id;
    Store.profileId = PROFILE_ID_TO_STORE_ID[id] || "nicolas";
    document.querySelectorAll(".profile-btn").forEach((btn) => {
      btn.classList.toggle("active", Number(btn.dataset.profile) === id);
    });
    const greeting = document.querySelector("#view-dashboard .greeting");
    if (greeting) greeting.textContent = `Hi ${PROFILE_NAMES[id] || "there"} 👋`;
    loadAndRenderStats();
  }

  function spawnMarqueeNotes() {
    const lane = document.getElementById("marquee-lane");
    if (lane.childElementCount > 0) return; // only once — the DOM persists
    const colors = ["#4f9c8a", "#c9a227", "#c1584b", "#f1ede4"];

    for (let i = 0; i < 14; i++) {
      const dot = document.createElement("span");
      dot.className = "marquee-note";
      dot.style.top = `${20 + Math.random() * 180}px`;
      dot.style.background = colors[i % colors.length];
      dot.style.color = colors[i % colors.length];
      dot.style.animationDuration = `${9 + Math.random() * 10}s`;
      dot.style.animationDelay = `${-Math.random() * 12}s`;
      lane.appendChild(dot);
    }
  }

  // Wired IMMEDIATELY when this script runs — not inside mount(). The
  // profile switch lives in the persistent app shell, visible on every
  // view, so it can't wait for the Dashboard specifically to be visited
  // first. Previously it only got wired/highlighted inside mount(), so
  // landing directly on Sections or Learning (as most navigation does)
  // meant no profile button ever got its active/amber state at all.
  document.querySelectorAll(".profile-btn").forEach((btn) => {
    btn.addEventListener("click", () => setActiveProfile(Number(btn.dataset.profile)));
  });
  setActiveProfile(activeProfile);

  async function mount() {
    spawnMarqueeNotes();

    if (!dashboardInitialized) {
      dashboardInitialized = true;
      try {
        const res = await fetch("data/songs.json");
        allSongs = await res.json();
        renderLibraryPreview(allSongs);
      } catch (err) {
        document.getElementById("library-preview").innerHTML =
          `<div class="empty">Library unavailable right now.</div>`;
      }
    }

    // Re-fetch stats every time the Dashboard is (re-)entered, not just
    // once — a section passed in Learning, then navigating back here,
    // should show the update rather than a stale first-mount snapshot.
    loadAndRenderStats();
  }

  function unmount() {
    // Nothing to tear down — the dashboard has no timers or listeners
    // that would misbehave while hidden.
  }

  return { mount, unmount };
})();
