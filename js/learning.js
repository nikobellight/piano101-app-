// v4.4
// learning.js — BASE + Sections + Wait Mode (Practice).
// Adds: Start/Stop Practice, advancing one note at a time driven by
// virtual keyboard clicks (BLE comes in the next step — same code path
// will handle both once wired up), a % score at the end of a section fed
// back to sections.html via the `completed` URL param, and section
// start/end boundary lines + a lead-in fall (from the previous step).
// Still no BLE, no hand illustration.

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
}

function showExpectedNote() {
  const expected = state.waitQueue[state.waitPointer];
  state.visualizer.draw(expected.startMs);
  document.getElementById("next-note-display").textContent =
    `Note ${state.waitPointer + 1} / ${state.waitQueue.length}`;
}

function handleKeyPressed(note) {
  if (!state.practiceActive) return;

  const expected = state.waitQueue[state.waitPointer];
  if (note === expected.note) {
    state.audio.playNote(note, expected.durationMs / 1000);
    highlightKey(note, expected.durationMs, colorForNote(note));

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
