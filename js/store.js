// v1.0
// store.js — Shared in-memory state for the SPA, replacing what used to be
// passed between pages as URL query params (?song=&section=&hand=&completed=).
// Because the page is never reloaded, this object simply survives navigation.
//
// NOTE: still session-only, exactly like the old `completed` URL param —
// real cross-session persistence arrives with Supabase later.

window.Store = {
  songId: "ode-to-joy",
  sectionId: "all",       // "all" or a section id
  hand: "right",          // "right" | "both"
  completed: {},          // { [sectionId]: bestPct }

  // Cache of loaded song JSON, so navigating back and forth between
  // Sections and Learning doesn't re-fetch the same file every time.
  songCache: {},

  async loadSong(id) {
    if (this.songCache[id]) return this.songCache[id];
    const res = await fetch(`data/songs/${id}.json?v=${Date.now()}`, { cache: "no-store" });
    const song = await res.json();
    this.songCache[id] = song;
    return song;
  },

  recordScore(sectionId, pct) {
    if (sectionId === "all") return;
    this.completed[sectionId] = Math.max(this.completed[sectionId] || 0, pct);
  },
};
