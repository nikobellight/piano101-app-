// v1.1
// audio.js — Piano sound engine, using real sampled piano notes (Salamander
// Grand Piano via Tone.js) instead of a raw synth, so it actually sounds
// like a piano rather than a beep.
//
// v1.1: added noteAttack/noteRelease for real sustain-while-held (free
// play with a real or virtual key press). playNote() is kept as-is for
// scheduled playback where the exact duration is already known in advance
// (auto-playback demo, Practice mode).

class PianoAudio {
  constructor() {
    this.sampler = null;
    this.ready = false;
  }

  // Must be called from a user gesture (e.g. a click on Play) — browsers
  // block audio from starting on page load without one.
  async init() {
    if (this.sampler) return;
    await Tone.start();

    this.sampler = new Tone.Sampler({
      urls: {
        A0: "A0.mp3", C1: "C1.mp3", "D#1": "Ds1.mp3", "F#1": "Fs1.mp3", A1: "A1.mp3",
        C2: "C2.mp3", "D#2": "Ds2.mp3", "F#2": "Fs2.mp3", A2: "A2.mp3",
        C3: "C3.mp3", "D#3": "Ds3.mp3", "F#3": "Fs3.mp3", A3: "A3.mp3",
        C4: "C4.mp3", "D#4": "Ds4.mp3", "F#4": "Fs4.mp3", A4: "A4.mp3",
        C5: "C5.mp3", "D#5": "Ds5.mp3", "F#5": "Fs5.mp3", A5: "A5.mp3",
        C6: "C6.mp3", "D#6": "Ds6.mp3", "F#6": "Fs6.mp3", A6: "A6.mp3",
        C7: "C7.mp3", "D#7": "Ds7.mp3", "F#7": "Fs7.mp3", A7: "A7.mp3",
        C8: "C8.mp3",
      },
      release: 1,
      baseUrl: "https://tonejs.github.io/audio/salamander/",
    }).toDestination();

    await Tone.loaded();
    this.ready = true;
  }

  // Converts a MIDI note number (matching the GPP-101 protocol) into the
  // note-name format Tone.js expects, e.g. 60 -> "C4".
  noteName(midi) {
    const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    const octave = Math.floor(midi / 12) - 1;
    return names[midi % 12] + octave;
  }

  playNote(midi, durationSeconds = 0.6) {
    if (!this.ready) return;
    this.sampler.triggerAttackRelease(this.noteName(midi), durationSeconds);
  }

  // Starts a note and holds it until noteRelease() is called — for real
  // press-and-hold behaviour (free play with a real or virtual key).
  noteAttack(midi) {
    if (!this.ready) return;
    this.sampler.triggerAttack(this.noteName(midi));
  }

  noteRelease(midi) {
    if (!this.ready) return;
    this.sampler.triggerRelease(this.noteName(midi));
  }
}

window.PianoAudio = PianoAudio;
