// v1.0
// visualizer.js — Draws falling notes on a canvas, synced to song time.
// Uses the same keyboard layout as the on-screen keyboard so each note
// lines up exactly with its physical key column.

class FallingNotesVisualizer {
  constructor(canvas, layout, color) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.layout = layout;
    this.color = color || "#f4b942";
    this.leadTimeMs = 2200; // how long a note takes to fall to the hit line
    this.notes = [];
    this.keyByNote = {};
    for (const k of layout.keys) this.keyByNote[k.note] = k;
    this.resize();
  }

  setSong(song) {
    const msPerBeat = 60000 / song.bpm;
    this.notes = song.notes.map((n) => ({
      note: n.note,
      startMs: n.beat * msPerBeat,
      durationMs: n.durationBeats * msPerBeat,
    }));
    if (song.notesColor) this.color = song.notesColor;
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.width = rect.width;
    this.height = rect.height;
  }

  draw(currentMs) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);

    const hitY = this.height - 6;

    // Column guides (subtle) so falling notes read against a grid.
    ctx.strokeStyle = "rgba(255,255,255,0.04)";
    ctx.lineWidth = 1;
    for (const key of this.layout.keys) {
      if (key.isBlack) continue;
      ctx.beginPath();
      ctx.moveTo(key.x, 0);
      ctx.lineTo(key.x, this.height);
      ctx.stroke();
    }

    // Hit line
    ctx.strokeStyle = "rgba(244,185,66,0.55)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, hitY);
    ctx.lineTo(this.width, hitY);
    ctx.stroke();

    for (const n of this.notes) {
      const key = this.keyByNote[n.note];
      if (!key) continue;

      const spawnMs = n.startMs - this.leadTimeMs;
      const endMs = n.startMs + n.durationMs;
      if (currentMs < spawnMs - 300 || currentMs > endMs + 300) continue;

      const fraction = (currentMs - spawnMs) / this.leadTimeMs;
      const noteHeight = Math.max(16, (n.durationMs / this.leadTimeMs) * hitY);
      const yBottom = fraction * hitY;
      const yTop = yBottom - noteHeight;

      const pad = key.isBlack ? 3 : 4;
      const x = key.x + pad;
      const w = key.width - pad * 2;

      const hit = currentMs >= n.startMs && currentMs <= endMs;
      ctx.fillStyle = hit ? "#ffffff" : this.color;
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(x, yTop, w, noteHeight, 6);
      } else {
        ctx.rect(x, yTop, w, noteHeight);
      }
      ctx.fill();
    }
  }
}

window.FallingNotesVisualizer = FallingNotesVisualizer;
