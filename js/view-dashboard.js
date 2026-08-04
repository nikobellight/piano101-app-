// v1.1
// view-dashboard.js
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
  const DEMO_STATE = {
    activeProfile: 1,
    profiles: {
      1: {
        name: "Nicolas",
        hoursPracticed: 12.5,
        avgMinutesPerDay: 22,
        recentSongs: [
          { name: "Ode to Joy", when: "Today", progress: 80, color: "#4f9c8a" },
          { name: "Für Elise (excerpt)", when: "Yesterday", progress: 45, color: "#c9a227" },
        ],
      },
      2: {
        name: "Mia",
        hoursPracticed: 3.2,
        avgMinutesPerDay: 9,
        recentSongs: [
          { name: "Ode to Joy", when: "3 days ago", progress: 20, color: "#4f9c8a" },
        ],
      },
      3: {
        name: "Tenzin",
        hoursPracticed: 0,
        avgMinutesPerDay: 0,
        recentSongs: [],
      },
    },
  };

  let initialized = false;

  function renderStats(profile) {
    document.getElementById("stat-hours").textContent = profile.hoursPracticed.toFixed(1);
    document.getElementById("stat-avg").textContent = profile.avgMinutesPerDay;
    document.getElementById("stat-songs").textContent = profile.recentSongs.length;
  }

  function renderRecentSongs(profile) {
    const container = document.getElementById("recent-list");
    container.innerHTML = "";

    if (profile.recentSongs.length === 0) {
      container.innerHTML = `<div class="empty">No songs played yet. Head to the library to get started.</div>`;
      return;
    }

    for (const song of profile.recentSongs) {
      const row = document.createElement("div");
      row.className = "song-row";
      row.innerHTML = `
        <span class="song-dot" style="background:${song.color}; color:${song.color}"></span>
        <div class="song-info">
          <div class="song-name">${song.name}</div>
          <div class="song-meta">${song.when}</div>
        </div>
        <div class="progress-track">
          <div class="progress-fill" style="width:${song.progress}%; background:${song.color}"></div>
        </div>
      `;
      container.appendChild(row);
    }
  }

  function renderLibraryPreview(songs) {
    const container = document.getElementById("library-preview");
    container.innerHTML = "";
    for (const song of songs.slice(0, 3)) {
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

  function setActiveProfile(id) {
    DEMO_STATE.activeProfile = id;
    document.querySelectorAll(".profile-btn").forEach((btn) => {
      btn.classList.toggle("active", Number(btn.dataset.profile) === id);
    });
    const profile = DEMO_STATE.profiles[id];
    const greeting = document.querySelector("#view-dashboard .greeting");
    if (greeting) greeting.textContent = `Hi ${profile.name} 👋`;
    renderStats(profile);
    renderRecentSongs(profile);
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

  async function mount() {
    if (initialized) return;
    initialized = true;

    spawnMarqueeNotes();

    document.querySelectorAll(".profile-btn").forEach((btn) => {
      btn.addEventListener("click", () => setActiveProfile(Number(btn.dataset.profile)));
    });

    setActiveProfile(DEMO_STATE.activeProfile);

    try {
      const res = await fetch("data/songs.json");
      renderLibraryPreview(await res.json());
    } catch (err) {
      document.getElementById("library-preview").innerHTML =
        `<div class="empty">Library unavailable right now.</div>`;
    }
  }

  function unmount() {
    // Nothing to tear down — the dashboard has no timers or listeners
    // that would misbehave while hidden.
  }

  return { mount, unmount };
})();
