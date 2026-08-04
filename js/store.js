// v1.2
// store.js — Shared in-memory state for the SPA, replacing what used to be
// passed between pages as URL query params (?song=&section=&hand=&completed=).
// Because the page is never reloaded, this object simply survives navigation.
//
// v1.2: adds accompaniment (on/off) and PASS_THRESHOLD, which both the
// Sections view (star ratings, section locking) and the Learning view
// (pass/fail message) need to agree on.
//
// v1.1: adds keyboardMode + KEYBOARD_RANGES — the 1-keyboard / 2-linked
// selector, using the MIDI ranges validated on the real GPP-101 hardware
// (solo = 60-83, two linked keyboards = 48-95). Kept here rather than in
// the Learning view so the choice survives navigating away and back.
//
// NOTE: still session-only, exactly like the old `completed` URL param —
// real cross-session persistence arrives with Supabase later.

// Validated GPP-101 mappings — do not re-derive.
window.KEYBOARD_RANGES = {
  solo: { start: 60, end: 83 },  // one keyboard
  duo:  { start: 48, end: 95 },  // two keyboards linked
};

window.PASS_THRESHOLD = 80;

window.Store = {
  songId: "ode-to-joy",
  sectionId: "all",       // "all" or a section id
  hand: "right",          // "right" | "both"
  keyboardMode: "solo",   // "solo" | "duo"
  accompaniment: true,    // play the other hand underneath, sound only
  completed: {},          // { [sectionId]: bestPct }

  range() {
    return window.KEYBOARD_RANGES[this.keyboardMode] || window.KEYBOARD_RANGES.solo;
  },

  isPassed(sectionId) {
    return (this.completed[sectionId] || 0) >= window.PASS_THRESHOLD;
  },

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
