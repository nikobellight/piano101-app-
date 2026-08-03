// v3.0
// learning.js — Full learning mode orchestration, now driven by the
// section-select page (sections.html) via URL params (?song=&section=&hand=&completed=)
// instead of in-page selectors.
//
//  - Normal playback (auto demo)
//  - Wait Mode (Practice): advances one note at a time, driven by real key
//    presses — either from the physical GPP-101 over BLE, or from clicking
//    the on-screen keyboard (same code path either way)
//  - Full multi-octave keyboard, with the currently playable range at full
//    opacity and the rest dimmed (matches the physical GPP-101 range)
//  - Hand illustration showing which finger to use next
//  - Measure (note) counter for the current section
//  - Percentage score, passed back to sections.html via the `completed` param
//
// NOTE: the test song only has right-hand notes for now, so "Both" behaves
// the same as "Right" until a two-hand song exists. The 1/2-keyboard BLE
// mode selector is not wired in yet — PLAYABLE_RANGE is hardcoded to solo.

const FULL_RANGE = { start: 36, end: 96 };   // C2–C7, for the full keyboard visual
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
  waitClean: [],
};

// ---------------------------------------------------------------------
// Data helpers
// ---------------------------------------------------------------------

function handFilter(notes) {
  if (state.selectedHand === "both") return notes;
  return notes.filter((n) => n.hand === state.selectedHand);
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

function toTimeline(notes, msPerBeat) {
  if (notes.length === 0) return [];
  const offsetBeat = notes[0].beat;
  return notes.map((n) => ({
    note: n.note,
    startMs: (n.beat - offsetBeat) * msPerBeat,
    durationMs: n.durationBeats * msPerBeat,
    finger: n.finger || null,
  }));
}

function currentMsPerBeat() {
  return 60000 / state.song.bpm;
}

// ---------------------------------------------------------------------
// Keyboard DOM (full range, dimmed outside the currently playable range)
// ---------------------------------------------------------------------

function buildKeyboardDOM(layout) {
  const container = document.getElementById("keyboard");
  container.innerHTML = "";
  container.style.position = "relative";

  const isPlayable = (note) => note >= PLAYABLE_RANGE.start && note <= PLAYABLE_RANGE.end;

  for (const key of layout.keys.filter((k) => !k.isBlack)) {
    const el = document.createElement("div");
    el.className = "key key-white" + (isPlayable(key.note) ? "" : " dimmed");
    el.style.left = `${key.x}px`;
    el.style.width = `${key.width}px`;
    el.dataset.note = key.note;
    container.appendChild(el);
  }
  for (const key of layout.keys.filter((k) => k.isBlack)) {
    const el = document.createElement("div");
    el.className = "key key-black" + (isPlayable(key.note) ? "" : " dimmed");
    el.style.left = `${key.x}px`;
    el.style.width = `${key.width}px`;
    el.dataset.note = key.note;
    container.appendChild(el);
  }

  container.querySelectorAll(".key").forEach((el) => {
    el.addEventListener("pointerdown", () => {
      const note = Number(el.dataset.note);
      if (state.practiceActive) {
        handleKeyPressed(note);
      } else {
        state.audio.init().then(() => state.audio.playNote(note, 0.4));
      }
    });
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
// Hand illustration
// ---------------------------------------------------------------------

function updateHandIllustration(finger, color) {
  document.querySelectorAll(".finger").forEach((el) => {
    el.classList.remove("active");
    el.style.removeProperty("--finger-color");
  });
  if (!finger) {
    document.getElementById("hand-caption").textContent = "";
    return;
  }
  const el = document.querySelector(`.finger[data-finger="${finger}"]`);
  if (el) {
    el.classList.add("active");
    el.style.setProperty("--finger-color", color || "var(--amber)");
  }
  document.getElementById("hand-caption").textContent = `Finger ${finger}`;
}

// ---------------------------------------------------------------------
// Normal (auto) playback
// ---------------------------------------------------------------------

function clearTimers() {
  state.timers.forEach((t) => clearTimeout(t));
  state.timers = [];
}

function schedulePlayback(fromMs) {
  clearTimers();
  const msPerBeat = currentMsPerBeat();
  const timeline = toTimeline(getActiveNotes(), msPerBeat);

  for (const n of timeline) {
    if (n.startMs < fromMs) continue;
    const delay = n.startMs - fromMs;
    const timer = setTimeout(() => {
      state.audio.playNote(n.note, n.durationMs / 1000);
      highlightKey(n.note, n.durationMs, colorForNote(n.note));
      updateHandIllustration(n.finger, colorForNote(n.note));
    }, delay);
    state.timers.push(timer);
  }

  if (timeline.length === 0) return;
  const last = timeline[timeline.length - 1];
  const totalMs = last.startMs + last.durationMs;
  const stopTimer = setTimeout(() => stopPlayback(), totalMs - fromMs + 400);
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

  state.startTimestamp = performance.now() - state.pausedAtMs;
  schedulePlayback(state.pausedAtMs);
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
  state.visualizer.draw(0);
  updateHandIllustration(null);
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

function updateMeasureCounter(current, total) {
  document.getElementById("measure-counter").textContent = `${current} / ${total}`;
}

async function startPractice() {
  pausePlayback();
  await state.audio.init();

  const msPerBeat = 60000 / state.song.bpm;
  state.waitQueue = toTimeline(getActiveNotes(), msPerBeat);
  state.waitPointer = 0;
  state.waitClean = state.waitQueue.map(() => true);
  state.practiceActive = state.waitQueue.length > 0;

  document.getElementById("practice-btn").textContent = "Stop Practice";
  document.getElementById("score-display").textContent = "";

  if (state.practiceActive) {
    showExpectedNote();
  } else {
    document.getElementById("score-display").textContent =
      "No notes for this hand/section yet.";
  }
}

function stopPractice() {
  state.practiceActive = false;
  document.getElementById("practice-btn").textContent = "Start Practice";
  document.getElementById("next-note-display").textContent = "";
  updateHandIllustration(null);
}

function showExpectedNote() {
  const expected = state.waitQueue[state.waitPointer];
  state.visualizer.draw(expected.startMs);
  updateMeasureCounter(state.waitPointer + 1, state.waitQueue.length);
  updateHandIllustration(expected.finger, colorForNote(expected.note));

  const label = document.getElementById("next-note-display");
  label.textContent = expected.finger ? `Next: finger ${expected.finger}` : "Next note";
}

function handleKeyPressed(note) {
  if (!state.practiceActive) return;

  const expected = state.waitQueue[state.waitPointer];
  if (note === expected.note) {
    state.audio.playNote(note, expected.durationMs / 1000);
    highlightKey(note, expected.durationMs, colorForNote(note));
    if (state.ble.connected) {
      state.ble.sendLedOn(note);
      setTimeout(() => state.ble.sendLedOff(note), 250);
    }

    state.waitPointer++;
    if (state.waitPointer >= state.waitQueue.length) {
      finishPractice();
    } else {
      showExpectedNote();
    }
  } else {
    state.waitClean[state.waitPointer] = false;
    highlightKey(note, 300, "#ff5555");
  }
}

function finishPractice() {
  const total = state.waitClean.length;
  const clean = state.waitClean.filter(Boolean).length;
  const pct = Math.round((clean / total) * 100);

  const scoreEl = document.getElementById("score-display");
  const passed = pct >= PASS_THRESHOLD;
  scoreEl.textContent = `${pct}% — ${passed ? "Section passed!" : "Try again"}`;
  scoreEl.style.color = passed ? "#57cbb3" : "#ff7a6e";

  document.getElementById("next-note-display").textContent = "";
  state.practiceActive = false;
  document.getElementById("practice-btn").textContent = "Start Practice";
  updateHandIllustration(null);

  if (state.sectionId !== "all") {
    state.completed[state.sectionId] = Math.max(state.completed[state.sectionId] || 0, pct);
    updateBackLink();
  }
}

function updateBackLink() {
  const query = new URLSearchParams({
    song: songId,
    completed: encodeCompleted(state.completed),
  });
  document.getElementById("back-link").href = `sections.html?${query.toString()}`;
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

      state.ble.onNoteOn = (note) => handleKeyPressed(note);
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
  const res = await fetch(`data/songs/${id}.json`);
  const song = await res.json();
  state.song = song;

  document.getElementById("song-title").textContent = song.title;

  const sectionLabel =
    state.sectionId === "all"
      ? "Whole song"
      : (song.sections.find((s) => s.id === state.sectionId) || {}).label || "Whole song";
  const handLabel = state.selectedHand === "both" ? "Both hands" : "Right hand";
  document.getElementById("context-subtitle").textContent = `${handLabel} — ${sectionLabel}`;

  const canvas = document.getElementById("visualizer");
  const keyboardWidth = document.getElementById("keyboard").clientWidth;

  state.layout = buildKeyboardLayout(FULL_RANGE.start, FULL_RANGE.end, keyboardWidth);
  buildKeyboardDOM(state.layout);

  state.visualizer = new FallingNotesVisualizer(canvas, state.layout, song.notesColor);
  state.visualizer.setNotes(toTimeline(getActiveNotes(), currentMsPerBeat()), song.notesColor);
  state.visualizer.resize();
  state.visualizer.draw(0);

  updateMeasureCounter("–", getActiveNotes().length);
  updateBackLink();
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
    state.layout = buildKeyboardLayout(FULL_RANGE.start, FULL_RANGE.end, keyboardWidth);
    buildKeyboardDOM(state.layout);
    state.visualizer.layout = state.layout;
    state.visualizer.keyByNote = {};
    for (const k of state.layout.keys) state.visualizer.keyByNote[k.note] = k;
    state.visualizer.resize();
  });
});
