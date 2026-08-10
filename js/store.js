// v1.5
// store.js — Shared in-memory state for the SPA, replacing what used to be
// passed between pages as URL query params (?song=&section=&hand=&completed=).
// Because the page is never reloaded, this object simply survives navigation.
//
// v1.5: adds recordSession(), called by the Learning view at the end of
// every finished practice attempt — separate from recordScore() because
// it tracks something Store.completed never did: actual TIME spent.
// Fire-and-forget, same as recordScore()'s Supabase write; the Dashboard
// reads this back via SupabasePiano101.loadDashboardStats().
//
// v1.4: adds profileId (persistent-storage-ready — see supabase-client.js)
// and hooks recordScore() to also persist via Supabase, in addition to
// keeping Store.completed as the fast, synchronous in-memory copy the UI
// already reads directly. Store.completed is now populated FROM Supabase
// on song load (view-sections.js) rather than always starting empty.
//
// v1.3: adds tempo (0.5 / 0.75 / 1 / 1.25) and TEMPO_OPTIONS. Practising
// below 1x is meant for learning a passage, not for scoring it — the
// Learning view checks tempo before recording a section as passed.
//
// v1.2: adds accompaniment (on/off) and PASS_THRESHOLD, which both the
// Sections view (star ratings, section locking) and the Learning view
// (pass/fail message) need to agree on.
//
// v1.1: adds keyboardMode + KEYBOARD_RANGES — the 1-keyboard / 2-linked
// selector, using the MIDI ranges validated on the real GPP-101 hardware
// (solo = 60-83, two linked keyboards = 48-95). Kept here rather than in
// the Learning view so the choice survives navigating away and back.

// Validated GPP-101 mappings — do not re-derive.
window.KEYBOARD_RANGES = {
  solo: { start: 60, end: 83 },  // one keyboard
  duo:  { start: 48, end: 95 },  // two keyboards linked
};

window.PASS_THRESHOLD = 80;
window.TEMPO_OPTIONS = [0.5, 0.75, 1, 1.25];

window.Store = {
  songId: "ode-to-joy",
  sectionId: "all",       // "all" or a section id
  hand: "right",          // "right" | "both"
  keyboardMode: "solo",   // "solo" | "duo"
  accompaniment: true,    // play the other hand underneath, sound only
  tempo: 1,               // one of TEMPO_OPTIONS — below 1 doesn't score
  profileId: "nicolas",   // "nicolas" | "mia" | "tenzin" — matches
                           // piano101_profiles.id in Supabase
  previewOnly: false,     // true only via Sections' "Listen to the whole
                           // song" button — Learning hides Start Practice
                           // entirely so it's a pure listen-along, never
                           // a scored attempt at unearned material
  completed: {},          // { [sectionId]: bestPct } — in-memory copy for
                           // the current song, loaded from Supabase by
                           // view-sections.js on mount (see loadProgressFor)

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

  // Populates this.completed from Supabase for the given song, under the
  // currently active profile. Called once per Sections mount — failures
  // are swallowed inside SupabasePiano101 itself, so this always
  // resolves (worst case: completed stays whatever it already was).
  //
  // Merges (Math.max per section) rather than overwriting outright: a
  // score just earned updates this.completed synchronously in
  // recordScore() below, while its write to Supabase happens in the
  // background, unawaited. Navigate back to Sections fast enough and
  // this fetch can land before that write does — overwriting would
  // briefly show the OLD score right after passing a phrase.
  async loadProgressFor(songId) {
    const fetched = await window.SupabasePiano101.loadProgress(this.profileId, songId);
    const merged = { ...fetched };
    if (this.songId === songId) {
      for (const [sectionId, pct] of Object.entries(this.completed)) {
        merged[sectionId] = Math.max(merged[sectionId] || 0, pct);
      }
    }
    this.completed = merged;
  },

  recordScore(sectionId, pct) {
    if (sectionId === "all") return;
    const improved = pct > (this.completed[sectionId] || 0);
    this.completed[sectionId] = Math.max(this.completed[sectionId] || 0, pct);
    // Fire-and-forget: the UI already reflects the score synchronously
    // via this.completed above, regardless of whether the network write
    // succeeds. recordScore() itself stays synchronous on purpose — no
    // caller needs to await it.
    if (improved) {
      window.SupabasePiano101.saveProgress(this.profileId, this.songId, sectionId, pct);
    }
  },

  // Logs one finished practice attempt's real duration — pass or fail,
  // any tempo, "all" section included (unlike recordScore, which skips
  // "all" since whole-song revision never earns a score). Fire-and-forget,
  // same reasoning as recordScore().
  recordSession(sectionId, durationSeconds) {
    window.SupabasePiano101.saveSession(this.profileId, this.songId, sectionId, durationSeconds);
  },
};
