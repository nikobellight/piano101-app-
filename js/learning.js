// v2.0
// learning.js — Full learning mode orchestration:
//  - Normal playback (auto demo, unchanged core from earlier versions)
//  - Wait Mode (Practice): advances one note at a time, driven entirely by
//    real key presses — either from the physical GPP-101 over BLE, or from
//    clicking the on-screen keyboard (same code path either way)
//  - Section selection with start/end boundary lines on the visualizer
//  - Hand selection (Right/Left/Both) — filters which notes are active
//  - Loop + speed control (normal playback)
//  - Percentage score per section, gating progression to the next one
//
// NOTE: the test song only has right-hand notes for now, so selecting
// "Left" will show an empty section until a two-hand song exists.

const SOLO_RANGE = { start: 60, end: 83 };
const PASS_THRESHOLD = 80; // % required to unlock the next section

const state = {
  song: null,
  layout: null,
  visualizer: null,
  audio: new PianoAudio(),
  ble: new GPP101(),

  selectedHand: "right",
  selectedSectionIndex: null, // null = whole song
  speedMultiplier: 1,
  loopEnabled: false,

  // Normal (auto) playback
  playing: false,
  startTimestamp: 0,
  pausedAtMs: 0,
  timers: [],
  rafId: null,

  // Wait Mode (Practice)
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
  if (state.selectedSectionIndex == null) {
    notes = state.song.notes;
  } else {
    const sec = state.song.sections[state.selectedSectionIndex];
    notes = state.song.notes.slice(sec.noteIndexStart, sec.noteIndexEnd + 1);
  }
  return handFilter(notes);
}

// Converts beat-based notes into a millisecond timeline starting at 0,
// regardless of which section was selected.
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

  // Clicking/tapping the virtual keyboard behaves exactly like a real key
  // press — same code path as a BLE note-on from the physical GPP-101.
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
// Normal (auto) playback
// ---------------------------------------------------------------------

function clearTimers() {
  state.timers.forEach((t) => clearTimeout(t));
  state.timers = [];
}

function currentMsPerBeat() {
  return 60000 / state.song.bpm / state.speedMultiplier;
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
  const stopTimer = setTimeout(() => {
    if (state.loopEnabled) {
      restartPlayback();
    } else {
      stopPlayback();
    }
  }, totalMs - fromMs + 400);
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
// Wait Mode (Practice) — driven entirely by real key presses
// ---------------------------------------------------------------------

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
}

function showExpectedNote() {
  const expected = state.waitQueue[state.waitPointer];
  state.visualizer.draw(expected.startMs);
  const label = document.getElementById("next-note-display");
  label.textContent = expected.finger
    ? `Next: finger ${expected.finger}`
    : "Next note";
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

  if (state.loopEnabled) {
    setTimeout(() => startPractice(), 900);
  }
}

// ---------------------------------------------------------------------
// Controls: hand / section / speed / loop / BLE
// ---------------------------------------------------------------------

function setActiveButton(groupSelector, activeEl) {
  document.querySelectorAll(groupSelector).forEach((el) => el.classList.remove("active"));
  activeEl.classList.add("active");
}

function refreshSectionBoundaries() {
  if (state.selectedSectionIndex == null) {
    state.visualizer.setActiveSection(null, null);
    return;
  }
  const msPerBeat = currentMsPerBeat();
  const timeline = toTimeline(getActiveNotes(), msPerBeat);
  if (timeline.length === 0) {
    state.visualizer.setActiveSection(null, null);
    return;
  }
  const last = timeline[timeline.length - 1];
  state.visualizer.setActiveSection(0, last.startMs + last.durationMs);
}

function buildSectionSelector() {
  const container = document.getElementById("section-selector");
  container.innerHTML = "";

  const wholeBtn = document.createElement("button");
  wholeBtn.className = "chip active";
  wholeBtn.textContent = "Whole song";
  wholeBtn.addEventListener("click", () => {
    state.selectedSectionIndex = null;
    setActiveButton("#section-selector .chip", wholeBtn);
    refreshSectionBoundaries();
  });
  container.appendChild(wholeBtn);

  state.song.sections.forEach((sec, idx) => {
    const btn = document.createElement("button");
    btn.className = "chip";
    btn.textContent = sec.label;
    btn.addEventListener("click", () => {
      state.selectedSectionIndex = idx;
      setActiveButton("#section-selector .chip", btn);
      refreshSectionBoundaries();
    });
    container.appendChild(btn);
  });
}

function wireHandSelector() {
  document.querySelectorAll("#hand-selector .chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.selectedHand = btn.dataset.hand;
      setActiveButton("#hand-selector .chip", btn);
    });
  });
}

function wireSpeedSelector() {
  document.querySelectorAll("#speed-selector .chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.speedMultiplier = Number(btn.dataset.speed);
      setActiveButton("#speed-selector .chip", btn);
      refreshSectionBoundaries();
    });
  });
}

function wireLoopToggle() {
  const btn = document.getElementById("loop-toggle");
  btn.addEventListener("click", () => {
    state.loopEnabled = !state.loopEnabled;
    btn.classList.toggle("active", state.loopEnabled);
  });
}

function wireBleButton() {
  const btn = document.getElementById("ble-connect-btn");
  const status = document.getElementById("ble-status");

  if (!navigator.bluetooth) {
    status.textContent = "Web Bluetooth not supported in this browser.";
    btn.disabled = true;
    return;
  }

  btn.addEventListener("click", async () => {
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
  state.visualizer.setNotes(toTimeline(getActiveNotes(), currentMsPerBeat()), song.notesColor);
  state.visualizer.resize();
  state.visualizer.draw(0);

  buildSectionSelector();
}

document.addEventListener("DOMContentLoaded", async () => {
  await loadSong("ode-to-joy");

  document.getElementById("play-btn").addEventListener("click", togglePlayback);
  document.getElementById("restart-btn").addEventListener("click", restartPlayback);
  document.getElementById("practice-btn").addEventListener("click", () => {
    if (state.practiceActive) {
      stopPractice();
    } else {
      startPractice();
    }
  });

  wireHandSelector();
  wireSpeedSelector();
  wireLoopToggle();
  wireBleButton();

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
