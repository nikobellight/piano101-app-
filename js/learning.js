// v5.3
// learning.js — BASE + Sections + Wait Mode + BLE + real scoring.
// v5.3 fixes:
//  - Free play now sustains real hold: noteAttack on press, noteRelease
//    on release (audio.js v1.1), instead of a fixed 0.4s pluck that
//    ignored how long the key was actually held.
//  - LED now scheduled to light exactly when the note reaches the hit
//    line (accounting for its fall time), not immediately when the
//    previous note is validated.
//  - LED off/on writes are properly awaited in sequence instead of fired
//    back-to-back, which could make the second BLE write silently fail.
//
// v5.0 changes:
//  - Note press/release is now a real noteOn(note)/noteOff(note) pipeline,
//    shared by the virtual keyboard (pointerdown/pointerup) AND the real
//    GPP-101 over BLE (ble.onNoteOn/onNoteOff) — pressing the physical
//    keyboard behaves identically to clicking on screen.
//  - Practice scoring is no longer just "right note yes/no": each note
//    blends pitch correctness, timing accuracy (early/late vs. when the
//    note reaches the hit line), and held-duration accuracy (vs. the
//    note's written length). Wrong pitch on the first attempt still
//    zeroes that note out, matching the previous behaviour.

const PLAYABLE_RANGE = { start: 60, end: 83 }; // GPP-101 solo mode range
const PASS_THRESHOLD = 80;

const params = new URLSearchParams(window.location.search);
const songId = params.get("song") || "ode-to-joy";
const sectionParam = params.get("section") || "all";
const handParam = params.get("hand") || "right";
const completedParam = params.get("completed") || "";

function parseCompleted(str) {
  const map = {};
  if (!str) return map;
  str.split(",").forEach((entry) => {
    const [id, pct] = entry.split(":");
    if (id) map[id] = Number(pct);
  });
  return map;
}

function encodeCompleted(map) {
  return Object.entries(map)
    .map(([id, pct]) => `${id}:${pct}`)
    .join(",");
}

const state = {
  song: null,
  layout: null,
  visualizer: null,
  audio: new PianoAudio(),
  ble: new GPP101(),

  selectedHand: handParam,
  sectionId: sectionParam, // "all" or a section id
  completed: parseCompleted(completedParam),

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

// ---------------------------------------------------------------------
// Data helpers
// ---------------------------------------------------------------------

function normalizeHand(h) {
  return (h || "").toString().trim().toLowerCase();
}

function handFilter(notes) {
  if (state.selectedHand === "both") return notes;
  return notes.filter((n) => normalizeHand(n.hand) === state.selectedHand);
}

function getActiveNotes() {
  let notes;
  if (state.sectionId === "all") {
    notes = state.song.notes;
  } else {
    const sec = state.song.sections.find((s) => s.id === state.sectionId);
    notes = sec ? state.song.notes.slice(sec.noteIndexStart, sec.noteIndexEnd + 1) : state.song.notes;
  }
  return handFilter(notes);
}

// ---------------------------------------------------------------------
// Keyboard DOM
// ---------------------------------------------------------------------

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
  const el = document.querySelector(`.key[data-note="${note}"]`);
  if (!el) return;
  el.style.setProperty("--glow", color);
  el.classList.add("active");
  setTimeout(() => el.classList.remove("active"), Math.max(120, durationMs));
}

// ---------------------------------------------------------------------
// Timeline helpers
// ---------------------------------------------------------------------

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

// ---------------------------------------------------------------------
// Playback
// ---------------------------------------------------------------------

function clearTimers() {
  state.timers.forEach((t) => clearTimeout(t));
  state.timers = [];
}

function schedulePlayback(fromMs, leadIn = 0) {
  clearTimers();
  const msPerBeat = currentMsPerBeat();
  const timeline = toTimeline(getActiveNotes(), msPerBeat);

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
  const stopTimer = setTimeout(() => stopPlayback(), leadIn + totalMs - fromMs + 400);
  state.timers.push(stopTimer);
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

  // Only give a fall runway on a true cold start (position 0). Resuming
  // from a mid-song pause should stay continuous with what was already
  // on screen, not jump.
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
  state.visualizer.draw(-state.visualizer.leadTimeMs);
}

function togglePlayback() {
  if (state.playing) {
    pausePlayback();
  } else {
    startPlayback();
  }
}

function restartPlayback() {
  stopPlayback();
  startPlayback();
}

// ---------------------------------------------------------------------
// Wait Mode (Practice)
// ---------------------------------------------------------------------

async function startPractice() {
  pausePlayback();
  await state.audio.init();

  const msPerBeat = currentMsPerBeat();
  state.waitQueue = toTimeline(getActiveNotes(), msPerBeat);
  state.waitPointer = 0;
  state.noteScores = [];
  state.currentWrongAttempts = 0;
  state.currentPressRealTime = null;
  state.practiceActive = state.waitQueue.length > 0;

  document.getElementById("practice-btn").textContent = "Stop Practice";
  document.getElementById("score-display").textContent = "";

  if (state.practiceActive) {
    // Give the first note the same fall runway as auto-playback, then the
    // gated loop takes over (falls, then holds at the hit line).
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
  // Falls in real time toward the note's hit time, then holds there —
  // doesn't advance further until the correct key is pressed.
  const currentMs = Math.min(state.practiceBaseMs + elapsed, expected.startMs);
  state.visualizer.draw(currentMs);
  state.practiceRafId = requestAnimationFrame(practiceAnimationLoop);
}

function updateNextNoteLabel() {
  document.getElementById("next-note-display").textContent =
    `Note ${state.waitPointer + 1} / ${state.waitQueue.length}`;
}

// ---------------------------------------------------------------------
// BLE guide light — lights the NEXT note exactly when it reaches the hit
// line (not the moment the previous note is validated, which was too
// early), with off/on writes properly sequenced so the second write
// doesn't collide with the first still in flight over BLE.
// ---------------------------------------------------------------------

function scheduleExpectedNoteLed() {
  cancelScheduledLed();
  if (!state.ble.connected) return;

  const expected = state.waitQueue[state.waitPointer];
  if (!expected) return;

  const fallDurationMs = Math.max(0, expected.startMs - state.practiceBaseMs);
  state.ledTimerId = setTimeout(async () => {
    if (state.currentLedNote != null) {
      await state.ble.sendLedOff(state.currentLedNote);
    }
    await state.ble.sendLedOn(expected.note);
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
  if (state.ble.connected && state.currentLedNote != null) {
    await state.ble.sendLedOff(state.currentLedNote);
  }
  state.currentLedNote = null;
}

// ---------------------------------------------------------------------
// Note press/release pipeline — shared by the virtual keyboard and BLE
// ---------------------------------------------------------------------

function noteOn(note) {
  if (state.practiceActive) {
    practiceNoteOn(note);
  } else {
    state.audio.init().then(() => {
      state.audio.noteAttack(note);
      const el = document.querySelector(`.key[data-note="${note}"]`);
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
    const el = document.querySelector(`.key[data-note="${note}"]`);
    if (el) el.classList.remove("active");
  }
}

// Timing accuracy: how close the press was to the moment the note
// actually reached the hit line (0 = late/early beyond recognition, 1 = spot on).
function timingScoreFromDelta(deltaMs) {
  const abs = Math.abs(deltaMs);
  if (abs <= 120) return 1;
  if (abs <= 250) return 0.7;
  if (abs <= 450) return 0.4;
  return 0.1;
}

// Duration accuracy: how close the held time was to the note's written length.
function durationScoreFromRatio(ratio) {
  if (ratio >= 0.7 && ratio <= 1.3) return 1;
  if (ratio >= 0.5 && ratio <= 1.6) return 0.6;
  return 0.3;
}

// Pitch accuracy: each wrong attempt on this note lowers its ceiling —
// 0 wrong = 1.0, 1 wrong = 0.66, 2 wrong = 0.33, 3+ wrong = 0. Unlike a
// simple pass/fail flag, hammering random keys before finally landing on
// the right one no longer scores the same as getting it first try.
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

  // Correct pitch: record the press time and how early/late it was
  // relative to the moment the note reached the hit line.
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
  const noteScore = pitchScore * 0.5 + state.currentTimingScore * 0.3 + durationScore * 0.2;
  state.noteScores.push(noteScore);

  state.currentPressRealTime = null;
  state.currentWrongAttempts = 0;

  // Resume the fall from exactly where it was held, toward the next note.
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

  if (state.sectionId !== "all") {
    state.completed[state.sectionId] = Math.max(state.completed[state.sectionId] || 0, pct);
    updateBackLink();
  }
}

function updateBackLink() {
  const backQuery = new URLSearchParams({
    song: songId,
    completed: encodeCompleted(state.completed),
  });
  document.getElementById("back-link").href = `sections.html?${backQuery.toString()}`;
}

// ---------------------------------------------------------------------
// BLE
// ---------------------------------------------------------------------

function wireBleButton() {
  const btn = document.getElementById("ble-connect-btn");
  const status = document.getElementById("ble-status");

  if (!navigator.bluetooth) {
    status.textContent = "Web Bluetooth not supported in this browser.";
    btn.disabled = true;
    return;
  }

  btn.addEventListener("click", async () => {
    if (state.ble.connected) {
      state.ble.disconnect();
      return;
    }
    try {
      status.textContent = "Connecting…";
      const name = await state.ble.connect();
      status.textContent = `Connected: ${name}`;
      btn.textContent = "Disconnect";

      // The real keyboard now drives the exact same pipeline as the
      // virtual keyboard — free play and Practice scoring both just work.
      state.ble.onNoteOn = (note) => noteOn(note);
      state.ble.onNoteOff = (note) => noteOff(note);
      state.ble.onDisconnected = () => {
        status.textContent = "Disconnected";
        btn.textContent = "Connect Keyboard";
      };
    } catch (err) {
      status.textContent = "Connection cancelled or failed.";
    }
  });
}

// ---------------------------------------------------------------------
// Song loading
// ---------------------------------------------------------------------

async function loadSong(id) {
  const res = await fetch(`data/songs/${id}.json?v=${Date.now()}`, { cache: "no-store" });
  const song = await res.json();
  state.song = song;

  document.getElementById("song-title").textContent = song.title;

  const sectionLabel =
    state.sectionId === "all"
      ? "Whole song"
      : (song.sections.find((s) => s.id === state.sectionId) || {}).label || "Whole song";
  const handLabel = state.selectedHand === "both" ? "Both hands" : "Right hand";
  document.getElementById("context-subtitle").textContent = `${handLabel} — ${sectionLabel}`;

  updateBackLink();

  const keyboardWidth = document.getElementById("keyboard").clientWidth;
  state.layout = buildKeyboardLayout(PLAYABLE_RANGE.start, PLAYABLE_RANGE.end, keyboardWidth);
  buildKeyboardDOM(state.layout);

  const canvas = document.getElementById("visualizer");
  state.visualizer = new FallingNotesVisualizer(canvas, state.layout, song.notesColor);
  const activeTimeline = toTimeline(getActiveNotes(), currentMsPerBeat());
  state.visualizer.setNotes(activeTimeline, song.notesColor);

  if (activeTimeline.length > 0) {
    const last = activeTimeline[activeTimeline.length - 1];
    state.visualizer.setActiveSection(activeTimeline[0].startMs, last.startMs + last.durationMs);
  }

  state.visualizer.resize();
  state.visualizer.draw(-state.visualizer.leadTimeMs);
}

document.addEventListener("DOMContentLoaded", async () => {
  await loadSong(songId);

  document.getElementById("play-btn").addEventListener("click", togglePlayback);
  document.getElementById("restart-btn").addEventListener("click", restartPlayback);
  document.getElementById("practice-btn").addEventListener("click", () => {
    if (state.practiceActive) {
      stopPractice();
    } else {
      startPractice();
    }
  });

  wireBleButton();

  window.addEventListener("resize", () => {
    const keyboardWidth = document.getElementById("keyboard").clientWidth;
    state.layout = buildKeyboardLayout(PLAYABLE_RANGE.start, PLAYABLE_RANGE.end, keyboardWidth);
    buildKeyboardDOM(state.layout);
    state.visualizer.layout = state.layout;
    state.visualizer.keyByNote = {};
    for (const k of state.layout.keys) state.visualizer.keyByNote[k.note] = k;
    state.visualizer.resize();
  });
});
