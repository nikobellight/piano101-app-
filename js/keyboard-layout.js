// v1.1  
// keyboard-layout.js — Computes white/black key positions for a contiguous
// MIDI note range. Shared by the on-screen keyboard (DOM) and the falling
// notes visualizer (canvas), so both always agree on column positions.
//
// v1.1: optional `referenceWhiteCount` fixes the WIDTH of a white key
// regardless of how many keys are actually in this layout — solo mode
// (14 white keys) now renders keys at the exact same width as duo mode
// (28 white keys) by passing duo's white-key count as the reference,
// instead of stretching its own, smaller key count to fill the full
// container width (which made 1-keyboard mode look bloated and
// disproportionate, with barely any visible difference between short
// and long notes). The resulting layout is narrower than the container
// and centered within it (xOffset below) — still fully responsive, since
// it's still a function of the container's rendered width at any given
// moment, just divided by a fixed reference count instead of its own.

function buildKeyboardLayout(startNote, endNote, containerWidth, referenceWhiteCount) {
  const isBlackNote = (n) => [1, 3, 6, 8, 10].includes(n % 12);

  const whiteIndexByNote = {};
  let whiteCount = 0;
  for (let n = startNote; n <= endNote; n++) {
    if (!isBlackNote(n)) {
      whiteIndexByNote[n] = whiteCount;
      whiteCount++;
    }
  }

  const refCount = referenceWhiteCount || whiteCount;
  const whiteWidth = containerWidth / refCount;
  const blackWidth = whiteWidth * 0.6;
  const layoutWidth = whiteCount * whiteWidth;
  // Centers a narrower-than-container layout (e.g. solo mode sized off
  // duo's reference) — a no-op (0) whenever refCount === whiteCount.
  const xOffset = (containerWidth - layoutWidth) / 2;

  const keys = [];

  for (let n = startNote; n <= endNote; n++) {
    if (!isBlackNote(n)) {
      keys.push({
        note: n,
        isBlack: false,
        x: whiteIndexByNote[n] * whiteWidth + xOffset,
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
        x: (prevWhiteIndex + 1) * whiteWidth - blackWidth / 2 + xOffset,
        width: blackWidth,
      });
    }
  }

  return { keys, whiteWidth, blackWidth, totalWidth: containerWidth, whiteCount, layoutWidth, xOffset };
}

// Counts white keys in a MIDI range — used to derive a fixed reference
// key width (see buildKeyboardLayout's referenceWhiteCount) without
// duplicating the black-key logic wherever that count is needed.
function countWhiteKeys(startNote, endNote) {
  const isBlackNote = (n) => [1, 3, 6, 8, 10].includes(n % 12);
  let count = 0;
  for (let n = startNote; n <= endNote; n++) {
    if (!isBlackNote(n)) count++;
  }
  return count;
}

window.buildKeyboardLayout = buildKeyboardLayout;
window.countWhiteKeys = countWhiteKeys;
