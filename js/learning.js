// v4.2
// learning.js — BASE + Sections page reconnected.
// Adds: reading ?section=&hand=&completed= from the URL (set by
// sections.js), filtering the song notes accordingly, a context subtitle,
// and a back-link that returns to sections.html. Still no BLE, no Wait
// Mode/Practice, no hand illustration — those come back in later steps.

const PLAYABLE_RANGE = { start: 60, end: 83 }; // GPP-101 solo mode range

const params = new URLSearchParams(window.location.search);
const songId = params.get("song") || "ode-to-joy";
const sectionParam = params.get("section") || "all";
const handParam = params.get("hand") || "right";
const completedParam = params.get("completed") || "";

const state = {
  song: null,
  layout: null,
  visualizer: null,
  audio: new PianoAudio(),

  selectedHand: handParam,
  sectionId: sectionParam, // "all" or a section id

  playing: false,
  startTimestamp: 0,
  pausedAtMs: 0,
  timers: [],
  rafId: null,
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
      state.audio.init().then(() => state.audio.playNote(note, 0.4));
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

  const backQuery = new URLSearchParams({ song: songId, completed: completedParam });
  document.getElementById("back-link").href = `sections.html?${backQuery.toString()}`;

  const keyboardWidth = document.getElementById("keyboard").clientWidth;
  state.layout = buildKeyboardLayout(PLAYABLE_RANGE.start, PLAYABLE_RANGE.end, keyboardWidth);
  buildKeyboardDOM(state.layout);

  const canvas = document.getElementById("visualizer");
  state.visualizer = new FallingNotesVisualizer(canvas, state.layout, song.notesColor);
  state.visualizer.setNotes(toTimeline(getActiveNotes(), currentMsPerBeat()), song.notesColor);
  state.visualizer.resize();
  state.visualizer.draw(0);
}

document.addEventListener("DOMContentLoaded", async () => {
  await loadSong(songId);

  document.getElementById("play-btn").addEventListener("click", togglePlayback);
  document.getElementById("restart-btn").addEventListener("click", restartPlayback);

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
