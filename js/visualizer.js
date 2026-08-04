// v2.0
// visualizer.js — Draws falling notes on a canvas, synced to song time.
// Uses the same keyboard layout as the on-screen keyboard so each note
// lines up exactly with its physical key column. Each note is colored by
// pitch class (see note-colors.js) and tagged with its finger number.
// Also draws two boundary lines (section start/end) that scroll down
// together with the notes, so the practiced section is visually framed.
//
// v2.0: reverses v1.9's instant-hide behaviour after feedback matching
// POP Piano more closely — a played note is no longer removed. It keeps
// falling along its normal trajectory past the hit line (hitY now
// reserves fallThroughPx of room for this), rendered as a pale grey
// ghost with a big bold white finger number, until it's fallen through
// that buffer. hideNotes() is renamed markPlayed() to match; hiddenIds
// is now ghostIds. Requires each timeline entry to carry an `id` (see
// toTimeline() in view-learning.js v1.8+).
//
// v1.9: notes can now be permanently hidden by id via hideNotes() —
// called the instant Wait Mode validates a note/chord, so it disappears
// right away instead of lingering (white or coloured) for its nominal
// duration. Requires each timeline entry to carry an `id`.
//
// v1.8: reverses part of v1.7 after feedback — a note being waited for
// must keep its normal colour the whole time it sits frozen at the line,
// not turn white or vanish. It only goes white (briefly, as always) once
// it has actually been played and Wait Mode has moved past it, then
// disappears on its own a moment later like any played note does.
//
// v1.7: leadTimeMs increased
// before the first note/chord actually arrives. Also: a note that is both
// "hit" and the one Wait Mode is currently holding for now disappears
// entirely instead of sitting frozen as a solid white bar — the pulsing
// halo (drawWaitingCue) is what signals "waiting for you" now.
//
// v1.6: setWaitingNote() now accepts an ARRAY of notes, so a chord
// lights every one of its keys at once instead of only its lowest note.
//
// v1.5: adds the two pieces of visual feedback that make Wait Mode feel
// alive instead of frozen (matching what POP Piano actually does — it
// freezes on the hit line too, but never looks dead while it waits):
//   - setWaitingNote(note): the note currently being waited for gets a
//     soft pulsing halo plus slow rising motes, so the screen keeps
//     breathing while the fall is held.
//   - spark(note): a burst of particles on the key column, fired the
//     moment the correct key is hit.
// Both are purely additive — pages that never call them behave exactly
// as they did in v1.4.

class FallingNotesVisualizer {
  constructor(canvas, layout, color) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.layout = layout;
    this.color = color || "#f4b942";
    this.leadTimeMs = 3400; // how long a note takes to fall to the hit line — gives more time to get ready before it arrives
    this.notes = [];
    this.ghostIds = new Set();   // ids of notes already played — see markPlayed()
    this.fallThroughPx = 90;     // extra room below the hit line where a played note keeps visibly falling, greyed out, before it's gone
    this.keyByNote = {};
    for (const k of layout.keys) this.keyByNote[k.note] = k;
    this.sectionBoundsMs = null; // { startMs, endMs } — set via setActiveSection()
    this.waitingNotes = [];      // MIDI notes of the chord being waited for
    this.sparks = [];            // transient hit particles
    this.resize();
  }

  // The note(s) Wait Mode is currently holding for. Accepts a single note,
  // an array, or null. Taking an array is what lets a three-note left-hand
  // chord light all three keys at once and read as ONE event, instead of
  // three separate ones played in sequence.
  setWaitingNote(notes) {
    if (notes == null) this.waitingNotes = [];
    else this.waitingNotes = Array.isArray(notes) ? notes.slice() : [notes];
  }

  // Fires a burst of particles on a key column — called on a correct hit.
  spark(note) {
    const key = this.keyByNote[note];
    if (!key) return;
    const now = performance.now();
    const cx = key.x + key.width / 2;
    const color = colorForNote(note);

    for (let i = 0; i < 14; i++) {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.15;
      const speed = 0.10 + Math.random() * 0.20;
      this.sparks.push({
        x: cx + (Math.random() - 0.5) * key.width * 0.7,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed, // negative: upward
        born: now,
        life: 420 + Math.random() * 320,
        size: 1.6 + Math.random() * 2.4,
        color,
      });
    }
  }

  // Soft pulsing halo + slow rising motes on the held note, so a frozen
  // fall still reads as "waiting for you" rather than "app crashed".
  drawWaitingCue(hitY) {
    for (const note of this.waitingNotes) this.drawWaitingCueFor(note, hitY);
  }

  drawWaitingCueFor(note, hitY) {
    const key = this.keyByNote[note];
    if (!key) return;

    const now = performance.now();
    const color = colorForNote(note);
    const pad = key.isBlack ? 3 : 4;
    const x = key.x + pad;
    const w = key.width - pad * 2;

    // Breathing halo around the key column just above the hit line.
    const pulse = 0.5 + 0.5 * Math.sin(now / 380);
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = 0.18 + pulse * 0.3;
    ctx.shadowColor = color;
    ctx.shadowBlur = 14 + pulse * 18;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    const boxH = 46;
    if (ctx.roundRect) ctx.roundRect(x, hitY - boxH, w, boxH, 6);
    else ctx.rect(x, hitY - boxH, w, boxH);
    ctx.stroke();
    ctx.restore();

    // A few motes drifting upward out of the key, on a slow loop.
    ctx.save();
    for (let i = 0; i < 4; i++) {
      const phase = ((now / 1500) + i / 4) % 1;
      const my = hitY - phase * 70;
      const mx = x + w * (0.22 + 0.18 * i) + Math.sin(now / 400 + i) * 3;
      ctx.globalAlpha = 0.5 * (1 - phase);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(mx, my, 1.8, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Advances and paints the hit particles, dropping dead ones.
  drawSparks(hitY) {
    if (this.sparks.length === 0) return;
    const now = performance.now();
    const ctx = this.ctx;
    ctx.save();

    this.sparks = this.sparks.filter((p) => {
      const age = now - p.born;
      if (age >= p.life) return false;
      const t = age / p.life;
      // vy is negative (upward); the quadratic term is gravity pulling
      // them back down, so the burst arcs instead of flying straight out.
      const px = p.x + p.vx * age;
      const py = hitY + p.vy * age + 0.00022 * age * age;
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(px, py, p.size * (1 - t * 0.5), 0, Math.PI * 2);
      ctx.fill();
      return true;
    });

    ctx.restore();
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
    this.ghostIds = new Set();
    if (color) this.color = color;
  }

  // Marks specific notes as played, identified by the `id` toTimeline()
  // stamps on each entry. A played note is NOT removed — it keeps falling
  // along its normal trajectory past the hit line (same physics, nothing
  // special), just rendered as a pale grey ghost with its finger number
  // still legible, until it exits the fall-through buffer below the hit
  // line (see fallThroughPx / ghostFallDurationMs()).
  markPlayed(ids) {
    for (const id of ids) this.ghostIds.add(id);
  }

  // How long (ms) a ghost note needs to keep being drawn after its own
  // startMs to visibly fall all the way through fallThroughPx — used by
  // the caller to know how long to keep animating after the last note of
  // a section, so it doesn't cut off mid-fall.
  ghostFallDurationMs() {
    const hitY = this.height - 6 - this.fallThroughPx;
    if (hitY <= 0) return this.leadTimeMs * 0.2;
    return (this.fallThroughPx / hitY) * this.leadTimeMs;
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

    // Leaves fallThroughPx of room below the hit line — that's where a
    // played note keeps visibly falling as a grey ghost instead of
    // stopping dead at the line.
    const hitY = this.height - 6 - this.fallThroughPx;

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

      const isGhost = this.ghostIds.has(n.id);
      const spawnMs = n.startMs - this.leadTimeMs;

      // A ghost note keeps being drawn until it's fallen all the way
      // through the buffer below the hit line, regardless of its own
      // (possibly much shorter) nominal duration — that's what makes it
      // keep visibly descending instead of vanishing the instant it's
      // played.
      const visibilityEndMs = isGhost
        ? n.startMs + this.ghostFallDurationMs()
        : n.startMs + n.durationMs + 300;
      if (currentMs < spawnMs - 300 || currentMs > visibilityEndMs) continue;

      const fraction = (currentMs - spawnMs) / this.leadTimeMs;
      const noteHeight = Math.max(16, (n.durationMs / this.leadTimeMs) * hitY);
      const yBottom = fraction * hitY;
      const yTop = yBottom - noteHeight;

      const pad = key.isBlack ? 3 : 4;
      const x = key.x + pad;
      const w = key.width - pad * 2;

      if (isGhost) {
        // Flat, pale grey, fading a little as it falls through the
        // buffer — colour is gone, this is no longer "the note to play".
        const ghostProgress = Math.min(1, Math.max(0,
          (currentMs - n.startMs) / this.ghostFallDurationMs()
        ));
        ctx.fillStyle = `rgba(210, 214, 226, ${0.32 * (1 - ghostProgress * 0.6)})`;
      } else {
        const endMs = n.startMs + n.durationMs;
        const hit = currentMs >= n.startMs && currentMs <= endMs;

        // A note still being WAITED FOR keeps its normal colour the whole
        // time it's held at the line — it must not go white just because
        // it's frozen there. It only flashes white for this brief instant
        // once it's actually been played (right before markPlayed() turns
        // it into a ghost on the next frame).
        const isStillWaiting = this.waitingNotes.includes(n.note) && hit;
        const baseColor = colorForNote(n.note);

        if (hit && !isStillWaiting) {
          ctx.fillStyle = "#ffffff";
        } else {
          const gradient = ctx.createLinearGradient(x, yTop, x, yBottom);
          gradient.addColorStop(0, lightenColor(baseColor, 0.4));
          gradient.addColorStop(1, baseColor);
          ctx.fillStyle = gradient;
        }
      }

      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(x, yTop, w, noteHeight, 6);
      } else {
        ctx.rect(x, yTop, w, noteHeight);
      }
      ctx.fill();

      if (n.finger && isGhost) {
        // Big, bold, white with a dark outline so it stays legible over
        // the pale grey ghost bar (and whatever falls behind it).
        ctx.font = "800 22px Manrope, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.lineWidth = 3.5;
        ctx.strokeStyle = "rgba(11, 15, 28, 0.75)";
        ctx.strokeText(String(n.finger), x + w / 2, yTop + noteHeight / 2);
        ctx.fillStyle = "#ffffff";
        ctx.fillText(String(n.finger), x + w / 2, yTop + noteHeight / 2);
      } else if (n.finger && noteHeight > 22) {
        // Finger number written directly on the bar, POP Piano style.
        ctx.fillStyle = "rgba(11, 15, 28, 0.85)";
        ctx.font = "700 15px Manrope, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(n.finger), x + w / 2, yTop + noteHeight / 2);
      }
    }

    // Waiting cue and hit sparks paint on top of the notes so they read
    // clearly against the bars. Both are no-ops when unused.
    this.drawWaitingCue(hitY);
    this.drawSparks(hitY);
  }
}

window.FallingNotesVisualizer = FallingNotesVisualizer;
