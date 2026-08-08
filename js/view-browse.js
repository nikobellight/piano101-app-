// v1.0
// view-browse.js — Full library view behind the dashboard's "Browse"
// link, which previously pointed nowhere (href="#/"). Lists every song
// in data/songs.json (search by title, filter by difficulty), each
// linking straight into Sections like the dashboard's 3-song preview
// already does.
//
// Deliberately does NOT show "already played" / per-song score — that
// needs persisted progress (Supabase), which isn't wired in yet. Today's
// progress only lives for the current session, passed between pages via
// a URL param, not stored anywhere it could be read back here.

window.ViewBrowse = (function () {
  let allSongs = [];
  let searchTerm = "";
  let activeDifficulty = "all";
  let wiredControls = false;

  function matches(song) {
    const inDifficulty = activeDifficulty === "all" || song.difficulty === activeDifficulty;
    const inSearch = !searchTerm || song.title.toLowerCase().includes(searchTerm);
    return inDifficulty && inSearch;
  }

  function render() {
    const list = document.getElementById("browse-list");
    const countEl = document.getElementById("browse-count");
    const filtered = allSongs.filter(matches);

    countEl.textContent = filtered.length === allSongs.length
      ? `${allSongs.length} song${allSongs.length === 1 ? "" : "s"}`
      : `${filtered.length} of ${allSongs.length} songs`;

    list.innerHTML = "";

    if (filtered.length === 0) {
      list.innerHTML = `<div class="empty">No songs match your search.</div>`;
      return;
    }

    for (const song of filtered) {
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
      list.appendChild(row);
    }
  }

  function wireControls() {
    if (wiredControls) return;
    wiredControls = true;

    const searchInput = document.getElementById("browse-search");
    searchInput.addEventListener("input", () => {
      searchTerm = searchInput.value.trim().toLowerCase();
      render();
    });

    document.querySelectorAll("#browse-difficulty-tabs .hand-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        activeDifficulty = tab.dataset.difficulty;
        document.querySelectorAll("#browse-difficulty-tabs .hand-tab")
          .forEach((t) => t.classList.remove("active"));
        tab.classList.add("active");
        render();
      });
    });
  }

  async function mount() {
    wireControls();

    const list = document.getElementById("browse-list");
    list.innerHTML = `<div class="empty">Loading…</div>`;

    try {
      const res = await fetch("data/songs.json");
      allSongs = await res.json();
      render();
    } catch (err) {
      list.innerHTML = `<div class="empty">Library unavailable right now.</div>`;
    }
  }

  function unmount() {
    // Nothing to tear down — no timers, no BLE, no audio.
  }

  return { mount, unmount };
})();
