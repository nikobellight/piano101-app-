// v4.0
// learning.js — SIMPLIFIED BASE.
// Rebuilt back to the version that worked, before BLE / Wait Mode /
// Sections page were layered on top and introduced regressions:
//
//  - One song, loaded via ?song= (defaults to "ode-to-joy")
//  - Auto-playback demo only: Play / Restart
//  - Virtual keyboard lights up in rhythm, real piano sound (audio.js)
//  - Falling notes synced to the same timeline (visualizer.js)
//
// No BLE, no Wait Mode/Practice, no hand illustration, no measure counter,
// no Sections page. These come back one at a time on top of this base.

const PLAYABLE_RANGE = { start: 60, end: 83 }; // GPP-101 solo mode range

const params = new URLSearchParams(window.location.search);
const songId = params.get("song") || "ode-to-joy";

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
};

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
  return notes.map((n) => ({
    note: n.note,
    startMs: n.beat * msPerBeat,
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
  const timeline = toTimeline(state.song.notes, msPerBeat);

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

  const keyboardWidth = document.getElementById("keyboard").clientWidth;
  state.layout = buildKeyboardLayout(PLAYABLE_RANGE.start, PLAYABLE_RANGE.end, keyboardWidth);
  buildKeyboardDOM(state.layout);

  const canvas = document.getElementById("visualizer");
  state.visualizer = new FallingNotesVisualizer(canvas, state.layout, song.notesColor);
  state.visualizer.setNotes(toTimeline(song.notes, currentMsPerBeat()), song.notesColor);
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
