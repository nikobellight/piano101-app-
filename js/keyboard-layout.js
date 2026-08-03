// v1.0  
// keyboard-layout.js — Computes white/black key positions for a contiguous
// MIDI note range. Shared by the on-screen keyboard (DOM) and the falling
// notes visualizer (canvas), so both always agree on column positions.

function buildKeyboardLayout(startNote, endNote, totalWidth) {
  const isBlackNote = (n) => [1, 3, 6, 8, 10].includes(n % 12);

  const whiteIndexByNote = {};
  let whiteCount = 0;
  for (let n = startNote; n <= endNote; n++) {
    if (!isBlackNote(n)) {
      whiteIndexByNote[n] = whiteCount;
      whiteCount++;
    }
  }

  const whiteWidth = totalWidth / whiteCount;
  const blackWidth = whiteWidth * 0.6;

  const keys = [];

  for (let n = startNote; n <= endNote; n++) {
    if (!isBlackNote(n)) {
      keys.push({
        note: n,
        isBlack: false,
        x: whiteIndexByNote[n] * whiteWidth,
        width: whiteWidth,
      });
    }
  }

  for (let n = startNote; n <= endNote; n++) {
    if (isBlackNote(n)) {
      const prevWhiteIndex = whiteIndexByNote[n - 1];
      keys.push({
        note: n,
        isBlack: true,
        x: (prevWhiteIndex + 1) * whiteWidth - blackWidth / 2,
        width: blackWidth,
      });
    }
  }

  return { keys, whiteWidth, blackWidth, totalWidth, whiteCount };
}

window.buildKeyboardLayout = buildKeyboardLayout;
