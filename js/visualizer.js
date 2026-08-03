// v1.4
// visualizer.js — Draws falling notes on a canvas, synced to song time.
// Uses the same keyboard layout as the on-screen keyboard so each note
// lines up exactly with its physical key column. Each note is colored by
// pitch class (see note-colors.js) and tagged with its finger number.
// Also draws two boundary lines (section start/end) that scroll down
// together with the notes, so the practiced section is visually framed.

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
    this.sectionBoundsMs = null; // { startMs, endMs } — set via setActiveSection()
    this.resize();
  }

  // Marks the section currently being practiced. Pass null to hide.
  setActiveSection(startMs, endMs) {
    this.sectionBoundsMs = startMs == null ? null : { startMs, endMs };
  }

  setSong(song) {
    const msPerBeat = 60000 / song.bpm;
    this.notes = song.notes.map((n) => ({
      note: n.note,
      startMs: n.beat * msPerBeat,
      durationMs: n.durationBeats * msPerBeat,
      finger: n.finger || null,
    }));
    if (song.notesColor) this.color = song.notesColor;
  }

  // Notes already converted to a ms timeline (see toTimeline() in
  // learning.js) — used when hand/section filtering has already happened
  // upstream, so this class doesn't need to know about beats/bpm at all.
  setNotes(notes, color) {
    this.notes = notes;
    if (color) this.color = color;
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

    // Section boundary lines (start/end), scrolling down with the notes
    // exactly like a note would, so they frame the section being drilled.
    if (this.sectionBoundsMs) {
      const drawBoundary = (boundaryMs, label) => {
        const fraction = (currentMs - (boundaryMs - this.leadTimeMs)) / this.leadTimeMs;
        const y = fraction * hitY;
        if (y < -20 || y > this.height + 20) return;

        ctx.strokeStyle = "rgba(255,255,255,0.55)";
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 5]);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(this.width, y);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.fillStyle = "rgba(255,255,255,0.75)";
        ctx.font = "700 10px Manrope, sans-serif";
        ctx.textAlign = "left";
        ctx.textBaseline = "bottom";
        ctx.fillText(label, 6, y - 4);
      };

      drawBoundary(this.sectionBoundsMs.startMs, "SECTION START");
      drawBoundary(this.sectionBoundsMs.endMs, "SECTION END");
    }

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
      const baseColor = colorForNote(n.note);

      if (hit) {
        ctx.fillStyle = "#ffffff";
      } else {
        const gradient = ctx.createLinearGradient(x, yTop, x, yBottom);
        gradient.addColorStop(0, lightenColor(baseColor, 0.4));
        gradient.addColorStop(1, baseColor);
        ctx.fillStyle = gradient;
      }

      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(x, yTop, w, noteHeight, 6);
      } else {
        ctx.rect(x, yTop, w, noteHeight);
      }
      ctx.fill();

      // Finger number written large directly on the bar, POP Piano style.
      if (n.finger && noteHeight > 22) {
        ctx.fillStyle = "rgba(11, 15, 28, 0.85)";
        ctx.font = "700 15px Manrope, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(n.finger), x + w / 2, yTop + noteHeight / 2);
      }
    }
  }
}

window.FallingNotesVisualizer = FallingNotesVisualizer;
