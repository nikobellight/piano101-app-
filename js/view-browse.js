// v1.2
// view-browse.js — Full library view behind the dashboard's "Browse"
// link, which previously pointed nowhere (href="#/"). Lists every song
// in data/songs.json (search by title, filter by difficulty), each
// linking straight into Sections like the dashboard's 3-song preview
// already does.
//
// v1.2: each row now shows a progress bar — passed sections (score >=
// PASS_THRESHOLD) out of that song's sectionCount (added to
// data/songs.json), for the currently active profile. Progress is
// fetched in ONE request via SupabasePiano101.loadAllProgress(), in
// parallel with songs.json, so Browse doesn't do 64 fetches just to
// draw bars. Reuses the .progress-track/.progress-fill classes already
// in style.css (same ones the dashboard's Recently Played list uses).
//
// v1.1: sorted alphabetically by title on load — songs.json is in
// insertion order (whenever each song happened to be imported/added),
// not alphabetical, so newly added songs used to just appear wherever
// they'd been appended to the file instead of where you'd look for them.

window.ViewBrowse = (function () {
  let allSongs = [];
  let progressBySong = {}; // { [songId]: passedSectionCount }, from Supabase
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
      const passed = progressBySong[song.id] || 0;
      const total = song.sectionCount || 0;
      const pct = total > 0 ? Math.round((passed / total) * 100) : 0;

      const row = document.createElement("a");
      row.className = "song-row";
      row.href = `#/song/${encodeURIComponent(song.id)}`;
      row.style.textDecoration = "none";
      row.style.color = "inherit";
      row.innerHTML = `
        <span class="song-dot" style="background:${song.notesColor}; color:${song.notesColor}"></span>
        <div class="song-info">
          <div class="song-name">${song.title}</div>
          <div class="song-meta">${song.difficulty}${total > 0 ? ` · ${passed}/${total} sections` : ""}</div>
        </div>
        ${total > 0 ? `
        <div class="progress-track">
          <div class="progress-fill" style="width:${pct}%; background:${song.notesColor}"></div>
        </div>
        ` : ""}
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
      const [songsRes, progress] = await Promise.all([
        fetch("data/songs.json"),
        window.SupabasePiano101.loadAllProgress(Store.profileId),
      ]);
      allSongs = await songsRes.json();
      progressBySong = progress;
      // songs.json is in insertion order (whenever each song was
      // imported/added), not alphabetical — sorting here means a song
      // like "Love is Blue" shows up between "Liebestraum" and "Maple
      // Leaf Rag" instead of wherever it happened to be appended.
      allSongs.sort((a, b) => a.title.localeCompare(b.title));
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
