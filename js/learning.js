// v1.0
// learning.js — Wires together the song data, falling notes visualizer,
// on-screen keyboard, and piano audio for the Learning Mode page.
//
// NOTE: BLE / physical keyboard sync is NOT implemented yet — this step
// only validates timing, visuals, and sound with the on-screen keyboard.
// Also note: keyboard range is hardcoded to solo mode (60-83) for now;
// the 1/2-keyboard selector will plug in here later.

const SOLO_RANGE = { start: 60, end: 83 };

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

function noteName(midi) {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const octave = Math.floor(midi / 12) - 1;
  return names[midi % 12] + octave;
}

function buildKeyboardDOM(layout) {
  const container = document.getElementById("keyboard");
  container.innerHTML = "";
  container.style.position = "relative";

  // White keys first (so black keys layer visually on top)
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
}

function highlightKey(note, durationMs, color) {
  const el = document.querySelector(`.key[data-note="${note}"]`);
  if (!el) return;
  el.style.setProperty("--glow", color);
  el.classList.add("active");
  setTimeout(() => el.classList.remove("active"), Math.max(120, durationMs));
}

function clearTimers() {
  state.timers.forEach((t) => clearTimeout(t));
  state.timers = [];
}

function schedulePlayback(fromMs) {
  clearTimers();
  const msPerBeat = 60000 / state.song.bpm;
  const color = state.song.notesColor || "#f4b942";

  for (const n of state.song.notes) {
    const startMs = n.beat * msPerBeat;
    const durationMs = n.durationBeats * msPerBeat;
    if (startMs < fromMs) continue;

    const delay = startMs - fromMs;
    const timer = setTimeout(() => {
      state.audio.playNote(n.note, durationMs / 1000);
      highlightKey(n.note, durationMs, color);
    }, delay);
    state.timers.push(timer);
  }

  const lastNote = state.song.notes[state.song.notes.length - 1];
  const totalMs = lastNote.beat * msPerBeat + lastNote.durationBeats * msPerBeat;
  const stopTimer = setTimeout(() => stopPlayback(), totalMs - fromMs + 400);
  state.timers.push(stopTimer);
}

function animationLoop() {
  const elapsed = performance.now() - state.startTimestamp;
  state.visualizer.draw(elapsed);
  updateTimeDisplay(elapsed);
  state.rafId = requestAnimationFrame(animationLoop);
}

function updateTimeDisplay(elapsedMs) {
  const msPerBeat = 60000 / state.song.bpm;
  const lastNote = state.song.notes[state.song.notes.length - 1];
  const totalMs = lastNote.beat * msPerBeat + lastNote.durationBeats * msPerBeat;
  const pct = Math.min(100, Math.max(0, (elapsedMs / totalMs) * 100));
  document.getElementById("progress-fill").style.width = `${pct}%`;
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
  document.getElementById("progress-fill").style.width = "0%";
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

async function loadSong(songId) {
  const res = await fetch(`data/songs/${songId}.json`);
  const song = await res.json();
  state.song = song;

  document.getElementById("song-title").textContent = song.title;

  const canvas = document.getElementById("visualizer");
  const keyboardWidth = document.getElementById("keyboard").clientWidth;

  state.layout = buildKeyboardLayout(SOLO_RANGE.start, SOLO_RANGE.end, keyboardWidth);
  buildKeyboardDOM(state.layout);

  state.visualizer = new FallingNotesVisualizer(canvas, state.layout, song.notesColor);
  state.visualizer.setSong(song);
  state.visualizer.resize();
  state.visualizer.draw(0);
}

document.addEventListener("DOMContentLoaded", async () => {
  await loadSong("ode-to-joy");

  document.getElementById("play-btn").addEventListener("click", togglePlayback);
  document.getElementById("restart-btn").addEventListener("click", restartPlayback);

  window.addEventListener("resize", () => {
    const keyboardWidth = document.getElementById("keyboard").clientWidth;
    state.layout = buildKeyboardLayout(SOLO_RANGE.start, SOLO_RANGE.end, keyboardWidth);
    buildKeyboardDOM(state.layout);
    state.visualizer.layout = state.layout;
    state.visualizer.keyByNote = {};
    for (const k of state.layout.keys) state.visualizer.keyByNote[k.note] = k;
    state.visualizer.resize();
  });
});
