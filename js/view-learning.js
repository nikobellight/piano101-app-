// v1.0
// view-learning.js — SPA version of learning.js v5.4. The gameplay logic
// (playback, Wait Mode, scoring, LED guide) is carried over UNCHANGED on
// purpose: this step is the SPA conversion, not a behaviour change. The
// two known Wait-Mode fluidity issues are still present and are the next
// task, deliberately untouched here so any regression is traceable to the
// SPA move alone.
//
// What did change:
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
  const PLAYABLE_RANGE = { start: 60, end: 83 }; // GPP-101 solo mode range
  const PASS_THRESHOLD = 80;

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
    waitPointer: 0,
    noteScores: [],
    currentWrongAttempts: 0,
    currentPressRealTime: null,
    currentTimingScore: 0,
    currentLedNote: null,
    ledTimerId: null,
    practiceBaseMs: 0,
    practiceRealStart: 0,
    practiceRafId: null,
  };

  let wiredControls = false;
  let resizeHandler = null;

  function ble() {
    return PianoBle.get();
  }

  // -------------------------------------------------------------------
  // Data helpers
  // -------------------------------------------------------------------

  function normalizeHand(h) {
    return (h || "").toString().trim().toLowerCase();
  }

  function handFilter(notes) {
    if (Store.hand === "both") return notes;
    return notes.filter((n) => normalizeHand(n.hand) === Store.hand);
  }

  function getActiveNotes() {
    let notes;
    if (Store.sectionId === "all") {
      notes = state.song.notes;
    } else {
      const sec = state.song.sections.find((s) => s.id === Store.sectionId);
      notes = sec
        ? state.song.notes.slice(sec.noteIndexStart, sec.noteIndexEnd + 1)
        : state.song.notes;
    }
    return handFilter(notes);
  }

  function toTimeline(notes, msPerBeat) {
    if (notes.length === 0) return [];
    const offsetBeat = notes[0].beat;
    return notes.map((n) => ({
      note: n.note,
      startMs: (n.beat - offsetBeat) * msPerBeat,
      durationMs: n.durationBeats * msPerBeat,
    }));
  }

  function currentMsPerBeat() {
    return 60000 / state.song.bpm;
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
      }, delay);
      state.timers.push(timer);
    }

    if (timeline.length === 0) return;
    const last = timeline[timeline.length - 1];
    const totalMs = last.startMs + last.durationMs;
    state.timers.push(setTimeout(() => stopPlayback(), leadIn + totalMs - fromMs + 400));
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

  async function startPractice() {
    pausePlayback();
    await state.audio.init();

    state.waitQueue = toTimeline(getActiveNotes(), currentMsPerBeat());
    state.waitPointer = 0;
    state.noteScores = [];
    state.currentWrongAttempts = 0;
    state.currentPressRealTime = null;
    state.practiceActive = state.waitQueue.length > 0;

    document.getElementById("practice-btn").textContent = "Stop Practice";
    document.getElementById("score-display").textContent = "";

    if (state.practiceActive) {
      state.practiceBaseMs = -state.visualizer.leadTimeMs;
      state.practiceRealStart = performance.now();
      updateNextNoteLabel();
      scheduleExpectedNoteLed();
      state.practiceRafId = requestAnimationFrame(practiceAnimationLoop);
    } else {
      document.getElementById("score-display").textContent =
        "No notes for this hand/section yet.";
    }
  }

  function stopPractice() {
    state.practiceActive = false;
    cancelAnimationFrame(state.practiceRafId);
    document.getElementById("practice-btn").textContent = "Start Practice";
    document.getElementById("next-note-display").textContent = "";
    clearExpectedNoteLed();
  }

  function practiceAnimationLoop() {
    if (!state.practiceActive) return;
    const expected = state.waitQueue[state.waitPointer];
    const elapsed = performance.now() - state.practiceRealStart;
    const currentMs = Math.min(state.practiceBaseMs + elapsed, expected.startMs);
    state.visualizer.draw(currentMs);
    state.practiceRafId = requestAnimationFrame(practiceAnimationLoop);
  }

  function updateNextNoteLabel() {
    document.getElementById("next-note-display").textContent =
      `Note ${state.waitPointer + 1} / ${state.waitQueue.length}`;
  }

  // -------------------------------------------------------------------
  // BLE guide light
  // -------------------------------------------------------------------

  function scheduleExpectedNoteLed() {
    cancelScheduledLed();
    if (!ble() || !ble().connected) return;

    const expected = state.waitQueue[state.waitPointer];
    if (!expected) return;

    const fallDurationMs = Math.max(0, expected.startMs - state.practiceBaseMs);
    state.ledTimerId = setTimeout(async () => {
      if (state.currentLedNote != null) await ble().sendLedOff(state.currentLedNote);
      await ble().sendLedOn(expected.note);
      state.currentLedNote = expected.note;
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
    if (ble() && ble().connected && state.currentLedNote != null) {
      await ble().sendLedOff(state.currentLedNote);
    }
    state.currentLedNote = null;
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
    if (abs <= 120) return 1;
    if (abs <= 250) return 0.7;
    if (abs <= 450) return 0.4;
    return 0.1;
  }

  function durationScoreFromRatio(ratio) {
    if (ratio >= 0.7 && ratio <= 1.3) return 1;
    if (ratio >= 0.5 && ratio <= 1.6) return 0.6;
    return 0.3;
  }

  function pitchScoreFromAttempts(wrongAttempts) {
    return Math.max(0, 1 - wrongAttempts / 3);
  }

  function practiceNoteOn(note) {
    const expected = state.waitQueue[state.waitPointer];
    if (!expected) return;

    if (note !== expected.note) {
      state.currentWrongAttempts++;
      state.audio.playNote(note, 0.3);
      highlightKey(note, 300, "#ff5555");
      return;
    }

    state.currentPressRealTime = performance.now();
    const fallDurationMs = Math.max(0, expected.startMs - state.practiceBaseMs);
    const freezeRealTime = state.practiceRealStart + fallDurationMs;
    state.currentTimingScore = timingScoreFromDelta(state.currentPressRealTime - freezeRealTime);

    state.audio.playNote(note, expected.durationMs / 1000);
    highlightKey(note, expected.durationMs, colorForNote(note));
  }

  function practiceNoteOff(note) {
    const expected = state.waitQueue[state.waitPointer];
    if (!expected || note !== expected.note || state.currentPressRealTime == null) return;

    const heldMs = performance.now() - state.currentPressRealTime;
    const durationScore = durationScoreFromRatio(heldMs / expected.durationMs);
    const pitchScore = pitchScoreFromAttempts(state.currentWrongAttempts);
    state.noteScores.push(pitchScore * 0.5 + state.currentTimingScore * 0.3 + durationScore * 0.2);

    state.currentPressRealTime = null;
    state.currentWrongAttempts = 0;

    state.practiceBaseMs = expected.startMs;
    state.practiceRealStart = performance.now();

    state.waitPointer++;
    if (state.waitPointer >= state.waitQueue.length) {
      finishPractice();
    } else {
      updateNextNoteLabel();
      scheduleExpectedNoteLed();
    }
  }

  function finishPractice() {
    cancelAnimationFrame(state.practiceRafId);
    state.visualizer.draw(-state.visualizer.leadTimeMs);
    clearExpectedNoteLed();

    const total = state.noteScores.length;
    const sum = state.noteScores.reduce((a, b) => a + b, 0);
    const pct = Math.round((sum / total) * 100);

    const scoreEl = document.getElementById("score-display");
    const passed = pct >= PASS_THRESHOLD;
    scoreEl.textContent = `${pct}% — ${passed ? "Section passed!" : "Try again"}`;
    scoreEl.style.color = passed ? "#57cbb3" : "#ff7a6e";

    document.getElementById("next-note-display").textContent = "";
    state.practiceActive = false;
    document.getElementById("practice-btn").textContent = "Start Practice";

    // Straight into shared state — the Sections view re-reads it on entry,
    // no URL round-trip needed any more.
    Store.recordScore(Store.sectionId, pct);
  }

  // -------------------------------------------------------------------
  // Mount / unmount
  // -------------------------------------------------------------------

  function rebuildKeyboardAndCanvas() {
    const keyboardWidth = document.getElementById("keyboard").clientWidth;
    state.layout = buildKeyboardLayout(PLAYABLE_RANGE.start, PLAYABLE_RANGE.end, keyboardWidth);
    buildKeyboardDOM(state.layout);
  }

  function wireControls() {
    if (wiredControls) return;
    wiredControls = true;
    document.getElementById("play-btn").addEventListener("click", togglePlayback);
    document.getElementById("restart-btn").addEventListener("click", restartPlayback);
    document.getElementById("practice-btn").addEventListener("click", () => {
      if (state.practiceActive) stopPractice();
      else startPractice();
    });
  }

  async function mount() {
    wireControls();

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

    resizeHandler = () => {
      rebuildKeyboardAndCanvas();
      state.visualizer.layout = state.layout;
      state.visualizer.keyByNote = {};
      for (const k of state.layout.keys) state.visualizer.keyByNote[k.note] = k;
      state.visualizer.resize();
    };
    window.addEventListener("resize", resizeHandler);
  }

  function unmount() {
    stopPractice();
    stopPlayback();
    clearExpectedNoteLed();

    // Detach gameplay only — the BLE connection itself stays up. This is
    // the behaviour the whole SPA conversion was for.
    PianoBle.detach();

    if (resizeHandler) {
      window.removeEventListener("resize", resizeHandler);
      resizeHandler = null;
    }
  }

  return { mount, unmount };
})();
