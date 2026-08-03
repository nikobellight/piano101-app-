// v1.1
// note-colors.js — Fixed color per pitch class (as specified by Nico),
// shared by the falling notes visualizer and the on-screen keyboard
// highlight, so a given note always lights the same color everywhere.
// Black keys take the color of the white key that follows them.

const NOTE_COLORS = [
  "#e5484d", // C  - red
  "#f2872a", // C# - orange (same as D)
  "#f2872a", // D  - orange
  "#f2c94a", // D# - yellow (same as E)
  "#f2c94a", // E  - yellow
  "#3fd0c9", // F  - cyan
  "#4fb8f0", // F# - sky blue (same as G)
  "#4fb8f0", // G  - sky blue
  "#4d79f0", // G# - blue (same as A)
  "#4d79f0", // A  - blue
  "#9d5ce8", // A# - violet (same as B)
  "#9d5ce8", // B  - violet
];

function colorForNote(midi) {
  return NOTE_COLORS[((midi % 12) + 12) % 12];
}

// Blends a hex color toward white by `amount` (0-1) — used to build the
// top-to-bottom gradient on each falling note.
function lightenColor(hex, amount) {
  const num = parseInt(hex.slice(1), 16);
  const r = Math.min(255, (num >> 16) + Math.round((255 - (num >> 16)) * amount));
  const g = Math.min(255, ((num >> 8) & 0xff) + Math.round((255 - ((num >> 8) & 0xff)) * amount));
  const b = Math.min(255, (num & 0xff) + Math.round((255 - (num & 0xff)) * amount));
  return `rgb(${r}, ${g}, ${b})`;
}

window.colorForNote = colorForNote;
window.lightenColor = lightenColor;
