// v2.5
// view-learning.js
// v2.5: the real fix for the "freezes until you release the key" bug —
// v2.4's markPlayed()-on-press change wasn't enough on its own, because
// practiceAnimationLoop() had its OWN freeze: it clamped the whole
// animation clock to the current chord's beat until every key of that
// chord was released, so a struck-but-still-held note's fall couldn't
// advance even though it was already marked played. Now the clock stays
// frozen only while NOTHING has been struck yet (waiting cue keeps
// pulsing as before); the instant the first key of the chord goes down
// (state.groupStruckAtMs), the clock is let loose and runs at normal
// speed, so the note keeps falling/ghosting regardless of how long the
// key is held.
//
// v2.4: two changes.
//  1. Fixed a fluidity bug: a struck note is now marked played (and
//     resumes its normal/ghost fall) the INSTANT it's pressed
//     (practiceNoteOn), not on release (practiceNoteOff) as before —
//     previously a held key froze the note on the hit line for as long
//     as it stayed down.
//  2. Added Loop: a sticky-bar toggle that repeats the current section
//     indefinitely, in both Play (auto-restarts from the top when the
//     playback timer ends) and Practice (skips the full score modal —
//     which would otherwise interrupt every single pass — flashes the
//     percentage in the HUD instead, then auto-restarts after
//     LOOP_RESTART_DELAY_MS). Requires index.html v2.2+ (adds
//     #loop-btn) and css/app.css v2.1+ (.learning-sticky-bar).
//
// v2.3: Screen Wake Lock added — the screen no longer sleeps mid-practice
// on supported browsers (Chrome/Android, incl. Samsung tablets). Requested
// on mount(), released on unmount(), re-requested on visibilitychange since
// the browser silently drops the lock whenever the tab is hidden. Not
// supported on iOS Safari before 16.4 — no effect there, no crash either.
//
// v2.2: three fixes.
//  1. "2 linked" -> "2 keyboards" in the range-mismatch error message —
//     a leftover from before that label was renamed.
//  2. Solo mode's keyboard now uses duo mode's white-key count as a
//     fixed reference width (REFERENCE_WHITE_COUNT, see
//     keyboard-layout.js v1.1), instead of stretching its own smaller
//     key count to fill the container. Same key width in both modes;
//     solo is simply narrower and centered.
//  3. syncHandPanels() now fully hides the hand not being practised
//     (.hand-dock.hidden) instead of dimming it — there's no left-hand
//     part to show at all in Right-hand-only mode.
// Requires keyboard-layout.js v1.1+, app.html v2.0+, css/app.css v2.0+.
//
// v2.1: matches visualizer.js v2.0's ghost-note behaviour — a played
// note now keeps falling (grey, big bold white finger number) instead of
// vanishing instantly. Renamed the hideNotes() call to markPlayed(), and
// finishPractice()'s wind-down before the score modal now waits for
// visualizer.ghostFallDurationMs() so the last note's ghost fall is
// actually visible instead of being cut short.
//
// v2.0: finger guide retargeted at the hand-drawn SVG (app.html v1.9) —
// toggles .finger.active on <g> elements instead of positioning a badge
// over an emoji. Numbers are baked into the SVG itself now, so there is
// nothing left to position or guess here.
//
// v1.9: fixes for regressions/feedback from the flex-row hand redesign.
//  1. LED chord bug: v1.8's Promise.all fired every LED write at once —
//     the physical keyboard silently accepted only the first and dropped
//     the rest, so only one note ever lit. Reverted to sequential writes
//     (still using the no-response fast path from ble.js v1.1).
//  2. Accompaniment button hidden entirely when practising both hands —
//     there's no "other hand" left to accompany in that mode.
// Hand layout and the "2 keyboards" label fix are in app.html v1.8 and
// css/app.css v1.8, no JS changes needed for those.
//
// v1.8: three fixes from feedback on the emoji hand redesign and a live
// test run.
//  1. Finger guide now targets the emoji hand's .finger-badge elements
//     (see app.html v1.6), not the old SVG.
//  2. Every timeline entry gets a unique id (toTimeline()); startPractice
//     re-points the visualizer at the SAME array it uses for gameplay, and
//     practiceNoteOff calls visualizer.markPlayed() the instant a note or
//     chord is fully validated — it disappears right there instead of
//     lingering (white or coloured) for its nominal duration.
//  3. LATE_MISTAKE_THRESHOLD_MS: a note struck more than 600ms after its
//     freeze point now adds to the SAME section-wide mistake penalty as a
//     wrong key, on top of its low timing sub-score — a slow-but-correct
//     run can no longer pass on pitch alone.
// Requires visualizer.js v1.9+, app.html v1.6+, css/app.css v1.6+.
//
// v1.7: adds a tempo control (0.5x-1.25x). Below 1x is for learning a
// passage: the section still plays through Wait Mode normally, but the
// score modal shows "Practice run" instead of pass/fail and nothing is
// written to Store.completed. Requires store.js v1.3+ and app.html v1.5+.
//
// v1.6: hand guide now targets the redesigned single-silhouette hands
// (docked beside the keyboard, see app.html v1.4) instead of the old
// dot-row panels. And the end-of-section score is now a celebration
// modal (vertical red-to-green gauge filling to the score, big
// percentage, Practice again / Back to sections) instead of small inline
// text. Requires app.html v1.4+ and css/app.css v1.4+.
//
// v1.5
// view-learning.js
// v1.5: CHORDS. Notes landing on the same beat are now one event, not a
// sequence. Before this, a three-note left-hand chord had to be played
// one key at a time and only ever lit one key — which is what looked
// broken in two-hand mode. Now every key of the chord lights together
// (screen + physical LEDs), the keys may be struck in ANY order, and the
// chord only advances once all of them have been pressed and released.
// Timing is judged once per chord on its first key, so the natural
// spread of fingers landing isn't scored as lateness. When both hands
// share a beat the right hand is the lead: it drives the measure counter
// and the freeze point, with the left as harmony underneath.
// Also: the finger guide became a pair of hands sitting on the stage
// (bottom-left / bottom-right), able to light several fingers at once,
// with the idle hand dimmed. Requires visualizer.js v1.6+.
//
// v1.4
// view-learning.js
// v1.4: four things at once, all of which touch the same gameplay loop.
//  1. STRICTER SCORING. Pitch now weighs 0.75 (was 0.5), a single wrong
//     key on a note drops that note to 0.25 (was 0.66), and — the part
//     that actually mattered — a section-wide penalty of 25% per wrong
//     key is applied on top. Averaging alone could never make one
//     mistake count: one bad note in fifteen barely moved the mean, so
//     fumbled sections still passed. Now one mistake puts an otherwise
//     clean run under the pass mark.
//  2. BEAT-BASED SECTIONS. Sections are sliced by beat window instead of
//     by note index. Index slicing broke the moment two hands shared one
//     list; a beat window is hand-agnostic.
//  3. LEFT-HAND ACCOMPANIMENT. When practising one hand, the other plays
//     underneath — sound only, never notated, never scored. In auto
//     playback it's scheduled on the clock; in Wait Mode (which has no
//     continuous clock) chords are released as the player reaches each
//     note, so they land with the melody at whatever speed it's played.
//  4. PRACTICE HUD. Measure counter and a five-dot finger guide, the
//     active dot lit in that note's own colour. The old SVG hand was
//     dropped rather than restyled.
// Requires ode-to-joy.json v2.0+ (notesLeft + beatStart/beatEnd) and
// store.js v1.2+.
//
// v1.3: the playable MIDI range is no longer hardcoded to solo mode. A
// 1-keyboard / 2-linked selector now drives Store.keyboardMode, and the
// on-screen keyboard, the layout and the visualizer's note->column map
// are rebuilt together whenever it changes (solo = 60-83, duo = 48-95,
// per the validated GPP-101 mappings). Switching mid-exercise stops
// practice/playback first rather than moving the target under the
// player's fingers.
//
// v1.2: reverses the v1.1 "tolerance window" approach after watching how
// POP Piano actually behaves (screen recording, frame-by-frame): it DOES
// freeze strictly on the hit line and wait for the exact key — the fall
// never drifts past the line. What makes it feel alive rather than stuck
// is feedback, not motion:
//   - the held note gets a pulsing halo + drifting motes (visualizer
//     setWaitingNote / drawWaitingCue)
//   - a correct hit fires a particle burst on that key (visualizer.spark)
// So the freeze is back to strict, and the fluidity comes from the two
// cues above. Requires visualizer.js v1.5+.
// The v1.1 last-note wind-down fix is kept — the final note still gets to
// finish its fall before the score appears.
//
// v1.0 (SPA conversion) — gameplay logic carried over from learning.js
// v5.4 unchanged; only the lifecycle/plumbing below changed:
//  - reads song/section/hand from Store instead of URL query params
//  - mount()/unmount() lifecycle: entering rebuilds the keyboard, canvas
//    and visualizer; leaving stops audio, timers, animation frames and
//    LEDs, and detaches from the shared BLE instance WITHOUT disconnecting
//    it (that's the whole point of the SPA)
//  - the score is written into Store.completed rather than encoded back
//    into a URL for sections.html to read
//  - element ids that used to collide across pages are namespaced
//    (#learning-song-title, #learning-back-link)

window.ViewLearning = (function () {
  const PASS_THRESHOLD = 80;
  // Playable MIDI range is no longer hardcoded to solo mode — it comes
  // from Store.range(), driven by the 1-keyboard / 2-linked selector.

  // Extra real time (ms) the wind-down animation runs after the last note
  // of a section, so it visibly finishes its fall instead of cutting off.
  const FINISH_WINDDOWN_BUFFER_MS = 400;

  // A note struck more than this long after its freeze point counts as a
  // (softer) scoring mistake — see LATE_PENALTY near finalPercent() — on
  // top of its already-low timing sub-score. Without this, a very slow
  // but pitch-perfect run could still pass.
  const LATE_MISTAKE_THRESHOLD_MS = 900;

  // Module-wide counter so every toTimeline() call hands out unique ids,
  // even across separate calls (melody vs accompaniment, or a fresh
  // Start Practice) — see markPlayed() in visualizer.js.
  let nextTimelineId = 1;

  const state = {
    song: null,
    layout: null,
    visualizer: null,
    audio: new PianoAudio(),

    playing: false,
    startTimestamp: 0,
    pausedAtMs: 0,
    timers: [],
    rafId: null,

    practiceActive: false,
    waitQueue: [],
    groups: [],           // notes grouped by beat — a chord is one event
    groupPointer: 0,
    pressed: new Map(),   // note -> press timestamp, within current group
    released: new Set(),  // notes of the current group already scored
    accompQueue: [],
    accompPointer: 0,
    noteScores: [],
    currentWrongAttempts: 0,
    totalWrongAttempts: 0,
    totalLateHits: 0,
    currentTimingScore: 0,
    currentLedNotes: [],
    ledTimerId: null,
    practiceBaseMs: 0,
    practiceRealStart: 0,
    practiceRafId: null,
    groupStruckAtMs: null,
    loopEnabled: false,
    loopRestartTimer: null,
  };

  let wiredControls = false;
  let resizeHandler = null;
  let wakeLock = null;
  let wakeLockVisibilityHandler = null;

  // Screen wake lock — prevents the tablet/phone from sleeping mid-practice.
  // Not supported on iOS Safari before 16.4, and released automatically by
  // the browser whenever the tab is hidden — re-requested on visibilitychange
  // so it survives switching apps and coming back.
  async function requestWakeLock() {
    if (!("wakeLock" in navigator)) return;
    try {
      wakeLock = await navigator.wakeLock.request("screen");
    } catch (err) {
      wakeLock = null;
    }
  }

  function ble() {
    return PianoBle.get();
  }

  // -------------------------------------------------------------------
  // Data helpers
  // -------------------------------------------------------------------

  function normalizeHand(h) {
    return (h || "").toString().trim().toLowerCase();
  }

  // All notes of the song, both hands. notesLeft is kept as a separate
  // array in the JSON so the old non-SPA pages, which slice `notes` by
  // index, are unaffected by the left hand existing at all.
  function allNotes() {
    return [...(state.song.notes || []), ...(state.song.notesLeft || [])];
  }

  // Sections are sliced by BEAT, not by note index. Index slicing broke
  // as soon as two hands shared one list; a beat window is hand-agnostic
  // and is what makes two-hand sections possible.
  function sectionWindow() {
    if (Store.sectionId === "all") return null;
    const sec = state.song.sections.find((s) => s.id === Store.sectionId);
    if (!sec) return null;
    if (sec.beatStart != null) return { start: sec.beatStart, end: sec.beatEnd };
    // Fallback for songs not yet migrated to beat-based sections.
    const notes = state.song.notes;
    return {
      start: notes[sec.noteIndexStart].beat,
      end: notes[sec.noteIndexEnd].beat,
    };
  }

  function inWindow(note, win) {
    return !win || (note.beat >= win.start && note.beat <= win.end);
  }

  // Notes the player must actually play (notated, scored, shown falling).
  function getActiveNotes() {
    const win = sectionWindow();
    const wanted = Store.hand === "both"
      ? ["right", "left"]
      : [Store.hand];
    return allNotes()
      .filter((n) => wanted.includes(normalizeHand(n.hand)) && inWindow(n, win))
      .sort((a, b) => a.beat - b.beat || a.note - b.note);
  }

  // The OTHER hand — played underneath as sound only, never notated and
  // never scored. Empty when practising both hands (nothing is "other").
  function getAccompanimentNotes() {
    if (!Store.accompaniment || Store.hand === "both") return [];
    const other = Store.hand === "right" ? "left" : "right";
    const win = sectionWindow();
    return allNotes()
      .filter((n) => normalizeHand(n.hand) === other && inWindow(n, win))
      .sort((a, b) => a.beat - b.beat);
  }

  function toTimeline(notes, msPerBeat) {
    if (notes.length === 0) return [];
    const offsetBeat = notes[0].beat;
    return notes.map((n) => ({
      // Unique per entry, across the whole session — lets the visualizer
      // permanently hide ONE specific note the instant it's validated
      // (see markPlayed()), even if another note of the same pitch occurs
      // later in the same timeline.
      id: nextTimelineId++,
      note: n.note,
      startMs: (n.beat - offsetBeat) * msPerBeat,
      durationMs: n.durationBeats * msPerBeat,
      // Carried through so the HUD (finger guide, measure counter) and the
      // visualizer's finger labels can read them off the timeline entry.
      finger: n.finger || null,
      hand: normalizeHand(n.hand),
      beat: n.beat,
    }));
  }

  // Accompaniment shares the melody's time origin, so both line up even
  // when a section starts mid-song.
  function toAccompanimentTimeline(msPerBeat) {
    const active = getActiveNotes();
    if (active.length === 0) return [];
    const offsetBeat = active[0].beat;
    return getAccompanimentNotes().map((n) => ({
      note: n.note,
      startMs: (n.beat - offsetBeat) * msPerBeat,
      durationMs: n.durationBeats * msPerBeat,
      beat: n.beat,
    }));
  }

  // Tempo multiplies the song's own bpm: 0.5x plays at half speed (bigger
  // msPerBeat), 1.25x at 125% (smaller msPerBeat). Every timeline in the
  // view (melody, accompaniment, Wait Mode's freeze points) is built from
  // this single function, so a tempo change affects all of them together.
  function currentMsPerBeat() {
    return 60000 / (state.song.bpm * Store.tempo);
  }

  // -------------------------------------------------------------------
  // Keyboard DOM
  // -------------------------------------------------------------------

  function buildKeyboardDOM(layout) {
    const container = document.getElementById("keyboard");
    container.innerHTML = "";
    container.style.position = "relative";

    for (const key of layout.keys.filter((k) => !k.isBlack)) {
      const el = document.createElement("div");
      el.className = "key key-white";
      el.style.left = `${key.x}px`;
      el.style.width = `${key.width}px`;
      el.dataset.note = key.note;
      container.appendChild(el);
    }
    for (const key of layout.keys.filter((k) => k.isBlack)) {
      const el = document.createElement("div");
      el.className = "key key-black";
      el.style.left = `${key.x}px`;
      el.style.width = `${key.width}px`;
      el.dataset.note = key.note;
      container.appendChild(el);
    }

    container.querySelectorAll(".key").forEach((el) => {
      const note = Number(el.dataset.note);
      el.addEventListener("pointerdown", () => noteOn(note));
      el.addEventListener("pointerup", () => noteOff(note));
      el.addEventListener("pointerleave", () => noteOff(note));
      el.addEventListener("pointercancel", () => noteOff(note));
    });
  }

  function highlightKey(note, durationMs, color) {
    const el = document.querySelector(`#keyboard .key[data-note="${note}"]`);
    if (!el) return;
    el.style.setProperty("--glow", color);
    el.classList.add("active");
    setTimeout(() => el.classList.remove("active"), Math.max(120, durationMs));
  }

  // -------------------------------------------------------------------
  // Playback
  // -------------------------------------------------------------------

  function clearTimers() {
    state.timers.forEach((t) => clearTimeout(t));
    state.timers = [];
  }

  function schedulePlayback(fromMs, leadIn = 0) {
    clearTimers();
    const timeline = toTimeline(getActiveNotes(), currentMsPerBeat());

    for (const n of timeline) {
      if (n.startMs < fromMs) continue;
      const delay = leadIn + (n.startMs - fromMs);
      const timer = setTimeout(() => {
        state.audio.playNote(n.note, n.durationMs / 1000);
        highlightKey(n.note, n.durationMs, colorForNote(n.note));
        updateFingerGuide(n);
        updateMeasureCounter(n);
      }, delay);
      state.timers.push(timer);
    }

    // The other hand underneath: sound only, no key glow, no finger cue —
    // it's there to give the melody harmonic context, not to be followed.
    for (const n of toAccompanimentTimeline(currentMsPerBeat())) {
      if (n.startMs < fromMs) continue;
      const delay = leadIn + (n.startMs - fromMs);
      state.timers.push(setTimeout(() => {
        state.audio.playNote(n.note, n.durationMs / 1000);
      }, delay));
    }

    if (timeline.length === 0) return;
    const last = timeline[timeline.length - 1];
    const totalMs = last.startMs + last.durationMs;
    state.timers.push(
      setTimeout(
        () => {
          if (state.loopEnabled) restartPlayback();
          else stopPlayback();
        },
        leadIn + totalMs - fromMs + 400
      )
    );
  }

  function animationLoop() {
    const elapsed = performance.now() - state.startTimestamp;
    state.visualizer.draw(elapsed);
    state.rafId = requestAnimationFrame(animationLoop);
  }

  async function startPlayback() {
    if (state.playing) return;
    stopPractice();
    await state.audio.init();

    state.playing = true;
    document.getElementById("play-btn").textContent = "Pause";

    const leadIn = state.pausedAtMs === 0 ? state.visualizer.leadTimeMs : 0;
    state.startTimestamp = performance.now() - state.pausedAtMs + leadIn;
    schedulePlayback(state.pausedAtMs, leadIn);
    state.rafId = requestAnimationFrame(animationLoop);
  }

  function pausePlayback() {
    if (!state.playing) return;
    state.playing = false;
    state.pausedAtMs = performance.now() - state.startTimestamp;
    clearTimers();
    cancelAnimationFrame(state.rafId);
    document.getElementById("play-btn").textContent = "Play";
  }

  function stopPlayback() {
    state.playing = false;
    state.pausedAtMs = 0;
    clearTimers();
    cancelAnimationFrame(state.rafId);
    document.getElementById("play-btn").textContent = "Play";
    if (state.visualizer) state.visualizer.draw(-state.visualizer.leadTimeMs);
  }

  function togglePlayback() {
    if (state.playing) pausePlayback();
    else startPlayback();
  }

  function restartPlayback() {
    stopPlayback();
    startPlayback();
  }

  // -------------------------------------------------------------------
  // Wait Mode (Practice)
  // -------------------------------------------------------------------

  // Guard: in "Both hands" the left hand sits at MIDI 48-59, which is
  // outside the one-keyboard range (60-83). Starting practice there would
  // stall forever on the first left-hand note, because the key needed
  // simply doesn't exist on screen or on the instrument. Catch it up
  // front and say what to do instead.
  function unplayableNotes() {
    const range = Store.range();
    return getActiveNotes().filter((n) => n.note < range.start || n.note > range.end);
  }

  // Notes that land on the same beat form ONE event. Without this, a
  // three-note left-hand chord had to be played one key at a time and
  // only ever lit one key — the thing that looked most broken in
  // two-hand mode. Grouping also means both hands striking together on
  // the same beat is a single validation, which is how it's actually
  // played.
  function buildGroups(timeline) {
    const groups = [];
    for (const entry of timeline) {
      const last = groups[groups.length - 1];
      if (last && Math.abs(last[0].startMs - entry.startMs) < 1) last.push(entry);
      else groups.push([entry]);
    }
    return groups;
  }

  function currentGroup() {
    return state.groups[state.groupPointer] || null;
  }

  // The entry a group's HUD should follow. With both hands on one beat
  // the right hand carries the melody, so it drives the measure counter
  // and the fall — the left hand is harmony underneath it.
  function leadEntry(group) {
    return group.find((e) => e.hand === "right") || group[0];
  }

  async function startPractice() {
    pausePlayback();

    const blocked = unplayableNotes();
    if (blocked.length > 0) {
      const scoreEl = document.getElementById("score-display");
      scoreEl.textContent =
        `${blocked.length} note${blocked.length > 1 ? "s" : ""} of this part fall outside ` +
        `the 1-keyboard range — switch to "2 keyboards" to practise it.`;
      scoreEl.style.color = "#ff7a6e";
      return;
    }

    await state.audio.init();

    state.waitQueue = toTimeline(getActiveNotes(), currentMsPerBeat());
    state.groups = buildGroups(state.waitQueue);
    state.groupPointer = 0;
    state.pressed = new Map();   // note -> press timestamp, current group
    state.released = new Set();  // notes of the current group already scored
    state.groupStruckAtMs = null;
    state.accompQueue = toAccompanimentTimeline(currentMsPerBeat());
    state.accompPointer = 0;
    state.noteScores = [];
    state.currentWrongAttempts = 0;
    state.totalWrongAttempts = 0;
    state.totalLateHits = 0;
    state.practiceActive = state.groups.length > 0;

    // Re-point the visualizer at THIS EXACT array (same objects, same
    // ids) rather than the separate one built at mount() — markPlayed()
    // below only works because the ids it's given match what's on screen.
    state.visualizer.setNotes(state.waitQueue, state.song.notesColor);

    document.getElementById("practice-btn").textContent = "Stop Practice";
    document.getElementById("score-display").textContent = "";

    if (state.practiceActive) {
      state.practiceBaseMs = -state.visualizer.leadTimeMs;
      state.practiceRealStart = performance.now();
      showCurrentGroup();
      state.practiceRafId = requestAnimationFrame(practiceAnimationLoop);
    } else {
      document.getElementById("score-display").textContent =
        "No notes for this hand/section yet.";
    }
  }

  function stopPractice() {
    state.practiceActive = false;
    cancelAnimationFrame(state.practiceRafId);
    if (state.loopRestartTimer) {
      clearTimeout(state.loopRestartTimer);
      state.loopRestartTimer = null;
    }
    if (state.visualizer) state.visualizer.setWaitingNote(null);
    document.getElementById("practice-btn").textContent = "Start Practice";
    document.getElementById("next-note-display").textContent = "";
    updateFingerGuide(null);
    clearExpectedNoteLed();
  }

  function practiceAnimationLoop() {
    if (!state.practiceActive) return;
    const group = currentGroup();
    if (!group) return;
    const elapsed = performance.now() - state.practiceRealStart;
    // Strict freeze on the hit line — same as POP Piano — but ONLY while
    // nothing has been struck yet. The moment the first key of the
    // chord goes down (groupStruckAtMs set in practiceNoteOn), the clock
    // is let loose so the struck note keeps falling/ghosting at its
    // normal speed no matter how long the key stays held — it no longer
    // waits for the whole chord to be released.
    const currentMs = state.groupStruckAtMs != null
      ? state.practiceBaseMs + elapsed
      : Math.min(state.practiceBaseMs + elapsed, leadEntry(group).startMs);
    state.visualizer.draw(currentMs);
    state.practiceRafId = requestAnimationFrame(practiceAnimationLoop);
  }

  // Lights every key of the current chord at once, on screen and on the
  // physical keyboard's LEDs, and points the finger guide at all the
  // fingers involved.
  function showCurrentGroup() {
    const group = currentGroup();
    if (!group) return;
    state.pressed = new Map();
    state.released = new Set();
    state.currentWrongAttempts = 0;
    state.groupStruckAtMs = null;

    state.visualizer.setWaitingNote(group.map((e) => e.note));
    updateFingerGuide(group);
    updateMeasureCounter(leadEntry(group));
    updateNextNoteLabel();
    scheduleExpectedNoteLed();
  }

  function updateNextNoteLabel() {
    const group = currentGroup();
    const size = group ? group.length : 0;
    const what = size > 1 ? `Chord (${size} notes)` : "Note";
    document.getElementById("next-note-display").textContent =
      `${what} ${state.groupPointer + 1} / ${state.groups.length}`;
  }

  // -------------------------------------------------------------------
  // Practice HUD — finger guide + measure counter
  // -------------------------------------------------------------------

  // Lights the finger(s) to use next on each hand's SVG — the number is
  // baked into the SVG at build time (same coordinates as the finger
  // shape itself), so this only needs to toggle colour, never position
  // any text. Takes a single timeline entry or a whole chord.
  function updateFingerGuide(entryOrGroup) {
    const entries = entryOrGroup == null
      ? []
      : (Array.isArray(entryOrGroup) ? entryOrGroup : [entryOrGroup]);

    document.querySelectorAll(".hand-svg .finger").forEach((f) => {
      f.classList.remove("active");
      f.style.removeProperty("--finger-color");
    });

    const caption = document.getElementById("finger-caption");
    const withFinger = entries.filter((e) => e.finger);

    if (withFinger.length === 0) {
      caption.textContent = Store.hand === "both" ? "Both hands" : "Right hand";
      return;
    }

    for (const e of withFinger) {
      const hand = e.hand === "left" ? "left" : "right";
      const color = colorForNote(e.note);
      const finger = document.querySelector(
        `.hand-svg[data-hand="${hand}"] .finger[data-finger="${e.finger}"]`
      );
      if (finger) {
        finger.classList.add("active");
        finger.style.setProperty("--finger-color", color);
      }
    }

    // Describe the chord compactly: "Left 5+3+1 · Right 3".
    const byHand = { left: [], right: [] };
    for (const e of withFinger) byHand[e.hand === "left" ? "left" : "right"].push(e.finger);
    const parts = [];
    if (byHand.left.length) parts.push(`Left ${byHand.left.join("+")}`);
    if (byHand.right.length) parts.push(`Right ${byHand.right.join("+")}`);
    caption.textContent = parts.join(" · ");
  }

  function beatsPerMeasure() {
    return state.song.beatsPerMeasure || 4;
  }

  function updateMeasureCounter(entry) {
    const perMeasure = beatsPerMeasure();
    const valueEl = document.getElementById("measure-value");
    const totalEl = document.getElementById("measure-total");

    const active = getActiveNotes();
    if (active.length === 0) {
      valueEl.textContent = "–";
      totalEl.textContent = "–";
      return;
    }

    const firstBeat = active[0].beat;
    const lastBeat = active[active.length - 1].beat;
    const totalMeasures = Math.floor((lastBeat - firstBeat) / perMeasure) + 1;
    totalEl.textContent = totalMeasures;

    if (!entry) {
      valueEl.textContent = "–";
      return;
    }
    valueEl.textContent = Math.floor((entry.beat - firstBeat) / perMeasure) + 1;
  }

  // -------------------------------------------------------------------
  // BLE guide light
  // -------------------------------------------------------------------

  function scheduleExpectedNoteLed() {
    cancelScheduledLed();
    if (!ble() || !ble().connected) return;

    const group = currentGroup();
    if (!group) return;

    const fallDurationMs = Math.max(0, leadEntry(group).startMs - state.practiceBaseMs);
    state.ledTimerId = setTimeout(async () => {
      // Sequential, not Promise.all: firing several BLE writes at once
      // made the keyboard only accept the first one and silently drop
      // the rest, so only one LED ever lit up. One at a time, but each
      // using the no-response write (ble.js v1.1) to stay as fast as the
      // link allows — this is the trade-off that actually works.
      for (const n of state.currentLedNotes) await ble().sendLedOff(n);
      state.currentLedNotes = group.map((e) => e.note);
      for (const n of state.currentLedNotes) await ble().sendLedOn(n);
    }, fallDurationMs);
  }

  function cancelScheduledLed() {
    if (state.ledTimerId != null) {
      clearTimeout(state.ledTimerId);
      state.ledTimerId = null;
    }
  }

  async function clearExpectedNoteLed() {
    cancelScheduledLed();
    if (ble() && ble().connected) {
      for (const n of state.currentLedNotes) await ble().sendLedOff(n);
    }
    state.currentLedNotes = [];
  }

  // -------------------------------------------------------------------
  // Note press/release pipeline — virtual keyboard AND real GPP-101
  // -------------------------------------------------------------------

  function noteOn(note) {
    if (state.practiceActive) {
      practiceNoteOn(note);
    } else {
      state.audio.init().then(() => {
        state.audio.noteAttack(note);
        const el = document.querySelector(`#keyboard .key[data-note="${note}"]`);
        if (el) {
          el.style.setProperty("--glow", colorForNote(note));
          el.classList.add("active");
        }
      });
    }
  }

  function noteOff(note) {
    if (state.practiceActive) {
      practiceNoteOff(note);
    } else {
      state.audio.noteRelease(note);
      const el = document.querySelector(`#keyboard .key[data-note="${note}"]`);
      if (el) el.classList.remove("active");
    }
  }

  function timingScoreFromDelta(deltaMs) {
    const abs = Math.abs(deltaMs);
    if (abs <= 180) return 1;
    if (abs <= 350) return 0.7;
    if (abs <= 600) return 0.4;
    return 0.15;
  }

  function durationScoreFromRatio(ratio) {
    if (ratio >= 0.7 && ratio <= 1.3) return 1;
    if (ratio >= 0.5 && ratio <= 1.6) return 0.6;
    return 0.3;
  }

  // Per-note pitch accuracy — much harsher than before: a single wrong
  // key on a note now costs most of that note's value instead of a third.
  function pitchScoreFromAttempts(wrongAttempts) {
    if (wrongAttempts === 0) return 1;
    if (wrongAttempts === 1) return 0.25;
    return 0;
  }

  // Averaging per-note scores alone can't make one mistake matter: one
  // bad note out of fifteen barely moves the mean, so a fumbled section
  // still passed. A section-wide penalty per wrong key fixes that — one
  // mistake drops a clean run well under the pass mark, which is the
  // behaviour asked for.
  const MISTAKE_PENALTY = 0.25;
  // Being very late is real, but shouldn't hit as hard as an outright
  // wrong note — a softer section-wide penalty, on top of the low
  // per-note timing score above.
  const LATE_PENALTY = 0.12;

  // How long the score flashes in the HUD before Loop auto-restarts the
  // section — long enough to read the percentage, short enough to feel
  // like a loop rather than a pause.
  const LOOP_RESTART_DELAY_MS = 900;

  function finalPercent() {
    const total = state.noteScores.length;
    if (total === 0) return 0;
    const mean = state.noteScores.reduce((a, b) => a + b, 0) / total;
    const penalty = Math.max(
      0,
      1 - MISTAKE_PENALTY * state.totalWrongAttempts - LATE_PENALTY * state.totalLateHits
    );
    return Math.round(mean * penalty * 100);
  }

  function practiceNoteOn(note) {
    const group = currentGroup();
    if (!group) return;

    const entry = group.find((e) => e.note === note);

    // Not part of this chord, or a key already down — either way it's a
    // wrong press. Notes of the chord may be struck in ANY order.
    if (!entry || state.pressed.has(note) || state.released.has(note)) {
      state.currentWrongAttempts++;
      state.totalWrongAttempts++;
      state.audio.playNote(note, 0.3);
      highlightKey(note, 300, "#ff5555");
      return;
    }

    const now = performance.now();
    state.pressed.set(note, now);

    state.audio.playNote(note, entry.durationMs / 1000);
    highlightKey(note, entry.durationMs, colorForNote(note));
    state.visualizer.spark(note);
    // Marked played (and starts its normal/ghost fall) the instant it's
    // struck — previously this only happened on release, which froze the
    // note on the hit line for as long as the key was held down.
    state.visualizer.markPlayed([entry.id]);

    // Timing is judged once per chord, on its FIRST key — otherwise the
    // natural spread of fingers landing across a few milliseconds would
    // be scored as lateness.
    if (state.pressed.size === 1) {
      state.groupStruckAtMs = now;
      const lead = leadEntry(group);
      const fallDurationMs = Math.max(0, lead.startMs - state.practiceBaseMs);
      const freezeRealTime = state.practiceRealStart + fallDurationMs;
      const deltaMs = now - freezeRealTime;
      state.currentTimingScore = timingScoreFromDelta(deltaMs);
      // A note struck way after its freeze point counts toward its own,
      // softer penalty (LATE_PENALTY) — separate from wrong-key mistakes
      // — so consistently slow-but-correct playing scores lower without
      // being treated as harshly as a wrong note.
      if (Math.abs(deltaMs) > LATE_MISTAKE_THRESHOLD_MS) {
        state.totalLateHits++;
      }
      // Wait Mode has no continuous clock — the accompaniment is released
      // as the player reaches each chord, so it lands with the melody at
      // whatever speed the section is being played.
      flushAccompanimentUpTo(lead.startMs);
    }
  }

  function flushAccompanimentUpTo(ms) {
    while (
      state.accompPointer < state.accompQueue.length &&
      state.accompQueue[state.accompPointer].startMs <= ms
    ) {
      const chordNote = state.accompQueue[state.accompPointer];
      state.audio.playNote(chordNote.note, chordNote.durationMs / 1000);
      state.accompPointer++;
    }
  }

  function practiceNoteOff(note) {
    const group = currentGroup();
    if (!group) return;

    const pressedAt = state.pressed.get(note);
    if (pressedAt == null) return;

    const entry = group.find((e) => e.note === note);
    state.pressed.delete(note);
    state.released.add(note);

    const heldMs = performance.now() - pressedAt;
    const durationScore = durationScoreFromRatio(heldMs / entry.durationMs);
    const pitchScore = pitchScoreFromAttempts(state.currentWrongAttempts);
    // Pitch dominates: timing and duration can polish a note's score but
    // can no longer rescue one that was played wrong.
    state.noteScores.push(pitchScore * 0.75 + state.currentTimingScore * 0.15 + durationScore * 0.10);

    // The chord only counts as done once every one of its keys has been
    // struck AND let go.
    if (state.released.size < group.length) return;

    // Gone from the canvas the instant it's validated — no lingering.
    state.visualizer.markPlayed(group.map((e) => e.id));

    const lead = leadEntry(group);
    state.practiceBaseMs = lead.startMs;
    state.practiceRealStart = performance.now();

    state.groupPointer++;
    if (state.groupPointer >= state.groups.length) {
      state.visualizer.setWaitingNote(null);
      finishPractice();
    } else {
      showCurrentGroup();
    }
  }

  function finishPractice() {
    // Let the last note's ghost visibly finish falling through the
    // buffer below the hit line instead of cutting straight to the score
    // the instant it's played. state.practiceBaseMs is already the last
    // note's startMs at this point (set in practiceNoteOff), and it was
    // already marked played (visualizer.markPlayed()) there too.
    cancelAnimationFrame(state.practiceRafId);
    clearExpectedNoteLed();

    const windDownFromMs = state.practiceBaseMs;
    const windDownDurationMs = state.visualizer.ghostFallDurationMs() + FINISH_WINDDOWN_BUFFER_MS;
    const windDownStart = performance.now();

    function windDownLoop() {
      const elapsed = performance.now() - windDownStart;
      const currentMs = windDownFromMs + Math.min(elapsed, windDownDurationMs);
      state.visualizer.draw(currentMs);
      if (elapsed < windDownDurationMs) {
        state.practiceRafId = requestAnimationFrame(windDownLoop);
      } else {
        showFinalScore();
      }
    }
    windDownLoop();
  }

  function showFinalScore() {
    state.visualizer.draw(-state.visualizer.leadTimeMs);

    const pct = finalPercent();
    const passed = pct >= PASS_THRESHOLD;
    const wrongKeys = state.totalWrongAttempts;
    const lateHits = state.totalLateHits;
    const counts = tempoCounts();

    document.getElementById("next-note-display").textContent = "";
    state.practiceActive = false;
    document.getElementById("practice-btn").textContent = "Start Practice";
    updateFingerGuide(null);

    // Below 1x is for learning the passage, not for passing it — nothing
    // is written to progress, and the Sections view's stars won't move.
    if (counts) {
      Store.recordScore(Store.sectionId, pct);
    }

    // Loop: skip the full celebration modal (it would interrupt every
    // single pass) — just flash the score in the HUD and auto-restart.
    if (state.loopEnabled) {
      const scoreEl = document.getElementById("score-display");
      scoreEl.textContent = `${pct}% — looping…`;
      scoreEl.style.color = passed ? "#57cbb3" : "#ff7a6e";
      state.loopRestartTimer = setTimeout(() => {
        state.loopRestartTimer = null;
        if (state.loopEnabled) startPractice();
      }, LOOP_RESTART_DELAY_MS);
      return;
    }

    openScoreModal(pct, passed, wrongKeys, lateHits, counts);
  }

  // -------------------------------------------------------------------
  // Score celebration modal
  // -------------------------------------------------------------------

  function openScoreModal(pct, passed, wrongKeys, lateHits, counts) {
    const card = document.querySelector("#score-modal .score-modal-card");
    const mask = document.getElementById("score-gauge-mask");
    const kicker = document.getElementById("score-modal-kicker");
    const pctEl = document.getElementById("score-modal-pct");
    const detailEl = document.getElementById("score-modal-detail");
    const primaryBtn = document.getElementById("score-modal-primary");
    const secondaryBtn = document.getElementById("score-modal-secondary");

    const celebrate = counts && passed;
    card.classList.toggle("passed", celebrate);
    card.classList.toggle("failed", counts && !passed);
    card.classList.toggle("practice-run", !counts);

    if (!counts) {
      kicker.textContent = "Practice run";
    } else {
      kicker.textContent = passed ? "Section passed!" : "Almost there";
    }
    pctEl.textContent = `${pct}%`;

    const parts = [];
    if (wrongKeys > 0) parts.push(`${wrongKeys} wrong key${wrongKeys > 1 ? "s" : ""}`);
    if (lateHits > 0) parts.push(`${lateHits} late hit${lateHits > 1 ? "s" : ""}`);
    const mistakeText = parts.length === 0 ? "Clean run — no mistakes" : parts.join(", ");
    detailEl.textContent = counts
      ? mistakeText
      : `${mistakeText} — played at ${Store.tempo}x, doesn't count`;

    primaryBtn.textContent = counts ? (passed ? "Continue" : "Try again") : "Try again";
    secondaryBtn.textContent = counts ? (passed ? "Practice again" : "Back to sections") : "Back to sections";

    primaryBtn.onclick = () => {
      closeScoreModal();
      if (celebrate) Router.go(`#/song/${encodeURIComponent(Store.songId)}`);
      else startPractice();
    };
    secondaryBtn.onclick = () => {
      closeScoreModal();
      if (celebrate) startPractice();
      else Router.go(`#/song/${encodeURIComponent(Store.songId)}`);
    };

    // Gauge starts fully masked, then animates down to reveal `pct`'s
    // worth of the red-to-green track — the "filling up" effect. The
    // reflow forces the browser to apply the starting state before the
    // transition to the real height, or it would just snap with no
    // animation at all.
    mask.style.transition = "none";
    mask.style.height = "100%";
    // eslint-disable-next-line no-unused-expressions
    mask.offsetHeight;
    mask.style.transition = "";
    requestAnimationFrame(() => {
      mask.style.height = `${100 - pct}%`;
    });

    document.getElementById("score-modal").classList.remove("hidden");
  }

  function closeScoreModal() {
    document.getElementById("score-modal").classList.add("hidden");
  }

  // -------------------------------------------------------------------
  // Mount / unmount
  // -------------------------------------------------------------------

  // Duo mode (2 keyboards) is the visual reference: solo mode uses its
  // white-key count too, so a key is exactly the same width in either
  // mode — only the number of keys (and so the overall keyboard width)
  // changes. Computed once; KEYBOARD_RANGES.duo never changes at runtime.
  const REFERENCE_WHITE_COUNT = countWhiteKeys(
    window.KEYBOARD_RANGES.duo.start,
    window.KEYBOARD_RANGES.duo.end
  );

  function rebuildKeyboardAndCanvas() {
    const keyboardWidth = document.getElementById("keyboard").clientWidth;
    const range = Store.range();
    state.layout = buildKeyboardLayout(range.start, range.end, keyboardWidth, REFERENCE_WHITE_COUNT);
    buildKeyboardDOM(state.layout);
  }

  // Switching between 1 keyboard and 2 linked ones changes the number of
  // key columns, so the DOM keyboard, the layout and the visualizer's
  // note->column map all have to be rebuilt together or the falling notes
  // stop lining up with the keys.
  function applyKeyboardMode(mode) {
    if (mode === Store.keyboardMode) return;
    Store.keyboardMode = mode;
    syncKeyboardModeButtons();

    // A range change mid-exercise would move the target under the
    // player's fingers — stop cleanly first.
    stopPractice();
    stopPlayback();

    rebuildKeyboardAndCanvas();
    if (state.visualizer) {
      state.visualizer.layout = state.layout;
      state.visualizer.keyByNote = {};
      for (const k of state.layout.keys) state.visualizer.keyByNote[k.note] = k;
      state.visualizer.resize();
      state.visualizer.draw(-state.visualizer.leadTimeMs);
    }
  }

  function syncKeyboardModeButtons() {
    document.querySelectorAll(".kbmode-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.mode === Store.keyboardMode);
    });
  }

  // Scoring only counts at normal speed or faster — below 1x is for
  // learning a passage, not for passing it. See finalizeScoreCounting().
  function tempoCounts() {
    return Store.tempo >= 1;
  }

  function applyTempo(value) {
    if (value === Store.tempo) return;
    Store.tempo = value;
    syncTempoButtons();

    // Every timeline (fall speed, freeze points, accompaniment) is
    // derived from currentMsPerBeat(), which just changed — stop cleanly
    // rather than let a running practice/playback jump mid-note.
    stopPractice();
    stopPlayback();
  }

  function syncTempoButtons() {
    document.querySelectorAll(".tempo-btn").forEach((btn) => {
      btn.classList.toggle("active", Number(btn.dataset.tempo) === Store.tempo);
    });
    const note = document.getElementById("tempo-note");
    note.textContent = tempoCounts()
      ? ""
      : "Practice speed — this run won't count toward the section's score.";
  }

  function wireControls() {
    if (wiredControls) return;
    wiredControls = true;
    document.getElementById("play-btn").addEventListener("click", togglePlayback);
    document.getElementById("restart-btn").addEventListener("click", restartPlayback);
    document.getElementById("loop-btn").addEventListener("click", () => {
      state.loopEnabled = !state.loopEnabled;
      document.getElementById("loop-btn").classList.toggle("active", state.loopEnabled);
      document.getElementById("loop-btn").setAttribute("aria-pressed", String(state.loopEnabled));
    });
    document.getElementById("practice-btn").addEventListener("click", () => {
      if (state.practiceActive) stopPractice();
      else startPractice();
    });
    document.querySelectorAll(".kbmode-btn").forEach((btn) => {
      btn.addEventListener("click", () => applyKeyboardMode(btn.dataset.mode));
    });
    document.querySelectorAll(".tempo-btn").forEach((btn) => {
      btn.addEventListener("click", () => applyTempo(Number(btn.dataset.tempo)));
    });
    document.getElementById("accompaniment-btn").addEventListener("click", () => {
      Store.accompaniment = !Store.accompaniment;
      syncAccompanimentButton();
      // Rebuild the queue so a mid-session toggle takes effect immediately
      // rather than only on the next Start Practice.
      if (state.practiceActive) {
        state.accompQueue = toAccompanimentTimeline(currentMsPerBeat());
        state.accompPointer = state.accompQueue.findIndex(
          (n) => n.startMs > state.practiceBaseMs
        );
        if (state.accompPointer === -1) state.accompPointer = state.accompQueue.length;
      }
    });
  }

  // Dims the hand that isn't being practised, so the eye goes straight to
  // the one that matters.
  // The hand not being practised is fully hidden, not just dimmed — in
  // "Right hand" mode there IS no left hand part to show at all.
  function syncHandPanels() {
    document.querySelectorAll(".hand-dock").forEach((dock) => {
      const hand = dock.classList.contains("hand-dock-left") ? "left" : "right";
      const inPlay = Store.hand === "both" || hand === Store.hand;
      dock.classList.toggle("hidden", !inPlay);
    });
  }

  function syncAccompanimentButton() {
    const btn = document.getElementById("accompaniment-btn");
    // Nothing to accompany when both hands are being practised — there is
    // no "other hand" left over to play underneath.
    btn.style.display = Store.hand === "both" ? "none" : "";
    const on = Store.accompaniment;
    btn.textContent = `Accompaniment: ${on ? "on" : "off"}`;
    btn.setAttribute("aria-pressed", String(on));
    btn.classList.toggle("off", !on);
  }

  async function mount() {
    wireControls();
    syncKeyboardModeButtons();
    syncTempoButtons();
    syncAccompanimentButton();
    document.getElementById("loop-btn").classList.toggle("active", state.loopEnabled);
    document.getElementById("loop-btn").setAttribute("aria-pressed", String(state.loopEnabled));
    syncHandPanels();

    // Gameplay hooks on the shared, still-connected BLE instance.
    await PianoBle.ready;
    PianoBle.attach({ onNoteOn: noteOn, onNoteOff: noteOff });

    document.getElementById("learning-back-link").href =
      `#/song/${encodeURIComponent(Store.songId)}`;

    state.song = await Store.loadSong(Store.songId);
    document.getElementById("learning-song-title").textContent = state.song.title;

    const sectionLabel =
      Store.sectionId === "all"
        ? "Whole song"
        : (state.song.sections.find((s) => s.id === Store.sectionId) || {}).label || "Whole song";
    const handLabel = Store.hand === "both" ? "Both hands" : "Right hand";
    document.getElementById("context-subtitle").textContent = `${handLabel} — ${sectionLabel}`;

    document.getElementById("score-display").textContent = "";
    document.getElementById("next-note-display").textContent = "";
    updateFingerGuide(null);
    state.pausedAtMs = 0;

    rebuildKeyboardAndCanvas();

    const canvas = document.getElementById("visualizer");
    state.visualizer = new FallingNotesVisualizer(canvas, state.layout, state.song.notesColor);
    const activeTimeline = toTimeline(getActiveNotes(), currentMsPerBeat());
    state.visualizer.setNotes(activeTimeline, state.song.notesColor);

    if (activeTimeline.length > 0) {
      const last = activeTimeline[activeTimeline.length - 1];
      state.visualizer.setActiveSection(activeTimeline[0].startMs, last.startMs + last.durationMs);
    } else {
      state.visualizer.setActiveSection(null);
    }

    state.visualizer.resize();
    state.visualizer.draw(-state.visualizer.leadTimeMs);

    // Shows the section's total measure count before practice starts.
    updateMeasureCounter(null);

    resizeHandler = () => {
      rebuildKeyboardAndCanvas();
      state.visualizer.layout = state.layout;
      state.visualizer.keyByNote = {};
      for (const k of state.layout.keys) state.visualizer.keyByNote[k.note] = k;
      state.visualizer.resize();
    };
    window.addEventListener("resize", resizeHandler);

    requestWakeLock();
    wakeLockVisibilityHandler = () => {
      if (document.visibilityState === "visible") requestWakeLock();
    };
    document.addEventListener("visibilitychange", wakeLockVisibilityHandler);
  }

  function unmount() {
    stopPractice();
    stopPlayback();
    clearExpectedNoteLed();
    closeScoreModal();
    state.loopEnabled = false;

    // Detach gameplay only — the BLE connection itself stays up. This is
    // the behaviour the whole SPA conversion was for.
    PianoBle.detach();

    if (resizeHandler) {
      window.removeEventListener("resize", resizeHandler);
      resizeHandler = null;
    }

    if (wakeLockVisibilityHandler) {
      document.removeEventListener("visibilitychange", wakeLockVisibilityHandler);
      wakeLockVisibilityHandler = null;
    }
    if (wakeLock) {
      wakeLock.release().catch(() => {});
      wakeLock = null;
    }
  }

  return { mount, unmount };
})();
