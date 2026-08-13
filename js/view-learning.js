// v3.15
// view-learning.js
// v3.15: three fixes per Nico, same batch —
//  1. "Continue" after passing a phrase now jumps straight into the
//     NEXT phrase's Learning view (nextRealSectionId()), instead of
//     just going back to the Sections overview and making you click
//     again to actually start the next one.
//  2. scheduleExpectedNoteLed() now pauses ~120ms between "off" and
//     "on" when the incoming note is the same pitch as the one just
//     finished — firing them back-to-back (as everywhere else) landed
//     too close together for the physical LED to visibly blink, so a
//     repeated note looked like the light just stayed on.
//  3. Normal Play/Listen playback (schedulePlayback) now also flashes
//     the physical keyboard's LEDs in sync with the falling notes
//     (flashLed) — previously only the on-screen key lit up; the real
//     GPP-101 stayed dark outside of Wait Mode.
//
// v3.14
// view-learning.js
// v3.14: two fixes per Nico —
//  1. The very first note of an exercise no longer gets a timing score
//     at all (was: judged against practiceRealStart, the instant Start
//     Practice is clicked — nobody can see the screen, place their
//     hands, and strike a note in that same instant, so it was
//     inheriting an artificial "late" almost every time).
//  2. The wrong-key flash colour changed from red (#ff5555) to a dark
//     anthracite (#2a2e38, the same shade already used for black keys)
//     — it was too close in hue to the v3.13 red ✕ overlay, which then
//     didn't stand out. The ✕ is now the actual signal; the dark flash
//     is just a neutral "something happened here" background for it.
//
// v3.13
// view-learning.js
// v3.13: wrong-note presses now also show a red ✕ overlaid on the key
// (showWrongMark, css/learning.css v4.6's .wrong-mark), on top of the
// existing red glow — per Nico, the glow alone was ambiguous on a key
// whose own note colour is also red (C in note-colors.js).
//
// v3.12
// view-learning.js
// v3.12: the physical keyboard's guide LED now lights the instant a note
// becomes the one being waited for, instead of after a delay timed to
// the rhythmic gap since the previous note. That delay made sense for a
// real-time fall, but Wait Mode already freezes the note at the hit
// line the moment it becomes current — so the delay only ever made the
// light come on AFTER the note was already due, especially on fast
// passages (Love is Blue's eighth notes) where the gap was barely a few
// hundred ms. Per Nico: no time to see the light and press in time.
//
// v3.11
// view-learning.js
// v3.11: logs one piano101_sessions row (via Store.recordSession) at the
// end of every finished practice attempt, with the real wall-clock
// duration — pass or fail, any tempo. Unlike recordScore, this doesn't
// gate on tempoCounts(); a slow or failed run is still real practice
// time. This is the piece the Dashboard's "hours practiced" / daily
// average was missing — piano101_progress only ever tracked best
// scores, never how long anything took.
//
// v3.10
// view-learning.js
// v3.10: timing now actually matters in the score, per Nico's feedback —
// a correctly-pitched note played after a long hesitation on the frozen
// hit line was still scoring as "good" because pitch dominated at 75%
// and timingScoreFromDelta() had a coarse 4-step ladder that flattened
// out at 0.4 for anything between 350ms and 600ms late. Three changes,
// all in the timing side of scoring only — pitch logic, chords, LED,
// duration scoring untouched:
//  1. timingScoreFromDelta() is now a continuous linear decay (1.0 at
//     <=150ms, down to 0.1 at >=900ms) instead of 4 fixed steps — every
//     bit of hesitation now costs something, not just crossing a step.
//  2. scoreHeldNote()'s per-note weights shift from pitch 0.75/timing
//     0.15/duration 0.10 to pitch 0.60/timing 0.30/duration 0.10 — pitch
//     still matters most (a wrong note stays worse than a slow right
//     one), but timing is no longer drowned out.
//  3. LATE_MISTAKE_THRESHOLD_MS drops from 900ms to 600ms, so a real
//     hesitation now also triggers the section-wide LATE_PENALTY, not
//     just extreme lateness.
//
// v3.9
// view-learning.js
// v3.9: toTimeline() now prefers a note's fingerSolo over finger when
// practising a single hand (Store.hand !== "both") — see import_song.py's
// generate_solo_fingering(). The old shared "finger" was always computed
// with both hands playing together, which can pick a stretch or a note
// only reachable with the other hand's help — impossible to actually
// play when isolating one hand (reported on Clair de lune: finger 2 on a
// note that needs the left hand). Falls back to the two-hand finger for
// any note missing a solo one.
//
// v3.8
// view-learning.js
// v3.8: safety-net sync of Store.keyboardMode from the song's own
// keyboardMode field on mount — mirrors view-sections.js v1.1, in case
// this view is reached directly (deep link, browser back/forward)
// without passing through Sections first.
//
// v3.7
// view-learning.js
// v3.7: ROOT CAUSE of both the white-flash and the rejected-correct-note
// bugs, and they turn out to be the same defect seen from two sides —
// v3.4's cap in currentPracticeMs().
//
// That cap let the clock run, once a group was struck, all the way to
// the NEXT group's startMs, while the pointer still waited on the
// CURRENT group's release. Display and expectation therefore sat exactly
// one note apart, which produced:
//   (a) the white flash — visualizer.js paints a note white when
//       `currentMs >= n.startMs` and it isn't in waitingNotes. Parking
//       the clock on the next note's startMs met both conditions, so it
//       went white and STAYED white for as long as the key was held.
//   (b) the rejections — the player, quite reasonably, plays the note
//       sitting on the hit line; the game is still expecting the
//       previous one, so it's scored as a wrong key.
// Only reachable by holding a key longer than the gap to the next note
// (429ms at this song's 140bpm) — i.e. exactly the slow, sustained
// playing Nico reported, and never when playing fast. Confirmed against
// the diagnostic logs: every rejected note was the song's NEXT note, and
// the game's own note list and pointer were verified correct throughout.
//
// The fix removes the cap entirely rather than tuning it, by making the
// pointer advance on full STRIKE instead of full release. The current
// group is then always the note on the line, so the clamp target moves
// forward on its own and the display keeps falling — no cap needed, and
// the desync is impossible by construction.
//
//   - currentPracticeMs(): back to a plain clamp on the current group's
//     own beat. No unfreeze branch, no cap. groupStruckAtMs is gone.
//   - practiceNoteOn(): completes the group once every note has been
//     STRUCK ("struck at some point during this group", not "down right
//     now" — on a chord you may release one key before the last lands,
//     and that's still a played chord). A key already physically down is
//     ignored rather than scored wrong, which also stops a repeated note
//     (71 71) being validated twice by one press.
//   - completeCurrentGroup(): scores timing, stamps the group's final
//     pitch/timing marks onto its still-held notes, advances.
//   - practiceNoteOff()/state.sustaining: releases no longer drive
//     progress, they only measure the real hold — deliberately tracked
//     across group boundaries, since a key is often let go several
//     groups after its own. Duration scoring is fully preserved.
//   - flushSustainingNotes(): the section now ends on the last note's
//     press, so anything still held is scored before finalPercent().
//   - v3.5/v3.6's temporary console diagnostics removed.
//
// v3.6: v3.5's diagnostic log showed a clear pattern — every rejected
// note WAS the correct next note in the song, just compared against a
// stale expectation (groupPointer hadn't advanced past the previous
// one). Points at practiceNoteOff()'s silent `if (pressedAt == null)
// return;` — if a release is ever dropped there, the group never
// advances and the following press gets compared to the wrong group.
// Added a matching console.warn there (search "SILENTLY DROPPED") to
// catch it happening in real time and see exactly what state.pressed
// contained when it did.
//
// v3.5: re-confirmed the 1ms cap fix (Nico saw the white flash on the
// next note, staying white until release — matches the visualizer's
// `currentMs >= n.startMs` "hit" check exactly), so it's back in.
//
// Separately, an intermittent bug where a correctly-timed physical key
// press on the GPP-101 gets rejected as wrong (confirmed: real red
// flash, not just a silent miss — audio plays through the WRONG branch
// too, which is why it sounded "detected" even when rejected) has no
// found cause yet after reading ble.js/ble-shared.js/currentGroup() —
// no duplicate BLE listeners, no stale group reference found by
// inspection. Added a temporary console.warn in practiceNoteOn's reject
// branch (search "TEMP DIAGNOSTIC") printing the expected note(s) vs
// what arrived, to get real data instead of guessing a 4th time. Remove
// once the cause is found.
//
// v3.4 (re-confirmed): v3.5's 1ms cap adjustment reverted for testing —
// Nico reported notes sometimes not registering (or registering as
// wrong) on the first press, needing a second press to count, and
// wanted to isolate whether that predates the 1ms change or not. This
// build is byte-for-byte v3.4's game logic again; only the changelog
// entry differs.
//
// v3.4: the previous "no unfreezing ever" (v3.3) fixed the runaway
// scroll, but on a single sustained note it also meant the display sat
// completely still while held, even correctly — confirmed by Nico this
// isn't what he wants. The real rule (same for one hand or two): stay
// frozen at the current group's own beat until it's genuinely COMPLETE
// (every required key down — for a chord that's all of them, hands
// included, not just the first), THEN let the clock run forward again
// in real time. The one guard that was missing before (and caused the
// original jump bug) is now a cap on WHERE it's allowed to run to: never
// past the next group's own beat. If a hold runs long enough to reach
// that point, the display parks right there and waits for release
// before anything moves again — it can never scroll past unplayed
// material. Advancement itself still only happens on release (unchanged
// from v3.3/pre-v3.1), so duration scoring keeps measuring a real hold
// as before. Timing scoring moved from "first key down" to "chord fully
// down," since that's the true onset now that nothing unfreezes before
// then.
//
// v3.3: removed the "let loose once struck" behaviour entirely instead
// of trying to cap it again — v3.2's fix (cap only while genuinely
// incomplete) still let the display scroll continuously for as long as
// a note was held before the rest of the chord was completed, which is
// exactly what looked broken: notes kept falling non-stop while a key
// was held, only stopping — and landing one note too far — on release.
// currentPracticeMs() now just stays clamped to the current group's own
// beat, full stop, for as long as that group is active. No unfreezing,
// no runaway, no cap. Visually static while placing fingers on a chord;
// only moves again once the group is actually completed and
// practiceNoteOff() advances to the next one.
//
// v3.2: v3.1's STRUCK_RUNAWAY_CAP_MS applied unconditionally, which broke
// any legitimately long hold — a whole-note left-hand chord held past
// 1.5s froze the clock mid-hold, and releasing it then jumped the
// display forward past the next note or two (practiceNoteOff() re-
// anchoring to that stale frozen position). Confirmed by video: holding
// a note kept the display scrolling, and releasing it snapped ahead to
// the note AFTER the one right after the held one. currentPracticeMs()
// now only applies the cap while the group is genuinely incomplete (at
// least one required note never pressed) — a fully-engaged group (every
// note down, just sustaining) tracks real time uncapped again, like
// before v3.1.
//
// v3.1: fixed the runaway-scroll bug — once a chord's first key was
// struck, the shared clock (currentPracticeMs()) ran completely
// unbounded if the rest of the chord was never completed (wrong notes,
// unreachable stretch), scrolling the entire rest of the song past
// while the game was actually stuck waiting on that one chord. Now
// capped at STRUCK_RUNAWAY_CAP_MS (1.5s) past the struck moment —
// confirmed with a real two-keyboard "linked" range song where some
// chords span both hands.
//
// v3.0: bandeau changes re-integrated (index.html v3.0 / css/app.css
// v3.0), now that the note-timing bug is confirmed fixed. Game-logic
// functions (practiceAnimationLoop, currentPracticeMs, showCurrentGroup,
// practiceNoteOn/Off, finishPractice) are UNTOUCHED from v2.9 — only
// UI-facing code changed: updateFingerGuide() no longer references
// #finger-caption (removed from HTML again), syncHandPanels() sets the
// new #mini-hand-label, syncAccompanimentButton() drives the compact
// dot-toggle, mount()/unmount() show/hide #keyboard-mode-switch and
// #learning-shell-info (now in the app shell), and #context-subtitle
// drops the hand mention (the mini-hand-label already says it).
//
// v2.9: v2.8's fix only handled LATE presses correctly — it always
// re-anchored to lead.startMs, which caused the opposite glitch on an
// EARLY press (before the note had even reached the line): snapping it
// forward onto the line instead of letting it keep falling naturally.
// Now re-anchors to whichever is actually displayed at press time
// (Math.min of the same clamp used elsewhere) — the frozen line if
// late, or the true still-falling position if early. Either way, the
// free-running phase afterward starts exactly where the note visually
// was, with no snap in either direction.
//
// v2.8
// view-learning.js
// v2.8: fixed the "late press causes a jump forward" bug. While a note
// sits frozen waiting to be struck, practiceBaseMs+elapsed keeps growing
// silently underneath the freeze-clamp — harmless as long as it stays
// clamped, but the moment you strike LATE and the clamp lifts, that
// hidden, already-large value is suddenly exposed as a forward jump
// proportional to how long you waited. practiceNoteOn() now re-anchors
// practiceBaseMs/practiceRealStart to exactly lead.startMs (where the
// note was actually frozen) at the moment of striking — AFTER computing
// the lateness score from the original values — so the free-running
// phase always starts smoothly from the frozen position, no matter how
// late the press was.
//
// v2.7
// view-learning.js
// v2.7: per feedback, v2.6's "always frozen" shared clock was wrong —
// with it, only the just-struck note moved (via visualizer.js's
// independent ghost clock) while every OTHER still-waiting note on
// screen stayed frozen solid, which looked broken (everything should
// fall together). Restored the "unfreeze once struck" behaviour
// (state.groupStruckAtMs) so the WHOLE shared clock moves for everyone
// once the current note is struck — that part was never actually the
// bug. The real (and only) bug was practiceNoteOff() re-basing the
// clock to the group's NOMINAL beat (lead.startMs) on release instead
// of to wherever it actually was — now fixed there (uses
// currentPracticeMs(group) instead), which is what caused the backward
// snap after a long hold. visualizer.js's independent ghost clock is
// reverted too (v2.6) — no longer needed since the shared clock now
// correctly carries every note along together.
//
// v2.6: root cause finally identified — v2.5 (the "confirmed working"
// version) had the SAME jump bug all along, just not caught by a short
// test: on release, it re-based the shared clock to the group's nominal
// beat (lead.startMs), which only stayed correct because the clock had
// been allowed to run past that beat while a key was held. Removed
// state.groupStruckAtMs and the "unfreeze once struck" behaviour
// entirely — the shared clock (currentPracticeMs()) now ALWAYS stays
// frozen at the current group's own beat while waiting, full stop. A
// held note's own continued fall is entirely the visualizer's job now
// (ghostStruckAt, visualizer.js v2.5) — completely decoupled from this
// clock, so it can never race ahead of or get yanked back by it. The
// release re-basing in practiceNoteOff (practiceBaseMs = lead.startMs)
// is now a true no-op — the clock was already sitting exactly there.
//
// v2.5r: reverted the game-logic (practice/timing/animation) code back
// to the confirmed-working v2.5 behaviour, per explicit request — v2.6
// through v2.10/v2.13's attempts (release re-basing, per-group fresh
// fall-in, independent ghost clock) never fully fixed the note-jump
// glitch and in v2.13's case made it visibly worse, so rather than layer
// on yet another attempted fix, Nico asked to stop and restore the last
// version that actually worked well. Bandeau/UI elements added after
// that point (keyboard-mode switch in the app shell, mini-hand label,
// compact accompaniment toggle, #learning-shell-info) have now ALSO been
// reverted here (index.html v2.2r, css/app.css v2.1r) — syncHandPanels(),
// syncAccompanimentButton(), updateFingerGuide(), mount()/unmount() are
// back to referencing the original #finger-caption/#accompaniment-btn/
// #keyboard-mode-switch elements that exist again in that reverted HTML.
//
// v2.13
// view-learning.js
// v2.13: v2.10's per-group decoupling was necessary but not sufficient —
// it stopped there being visible AT ALL, but the shared clock still ran
// freely once struck (state.groupStruckAtMs), and that shared clock also
// drives the render position of every OTHER, unrelated note in the
// timeline. A long hold could race it far past future notes' render
// windows (making them flicker/vanish), then the next group's fresh
// fall-in would reset it — a much more visible jump than before. Ghost
// notes (visualizer.js v2.4) now fall on their OWN independent
// wall-clock timer, entirely decoupled from the shared clock — so the
// shared clock (frozenPracticeMs(), replaces currentPracticeMs()) can go
// back to simply staying frozen at the current group's beat the whole
// time it's waiting, same as the pre-v2.5 original. groupStruckAtMs is
// gone entirely; no longer needed.
//
// v2.12
// view-learning.js
// v2.12: reverted the button-label shortening from v2.11 per feedback —
// "Start Practice"/"Play"/"Restart" keep their full text, just smaller
// (index.html v2.8 undoes the compact/icon-only styling on the labels,
// keeps the buttons themselves smaller). #learning-shell-info show/hide
// (song title/subtitle/measure, now in the app shell) is unaffected.
//
// v2.11: #learning-shell-info (song title/subtitle/measure) also shown/
// hidden on mount()/unmount(), now that it lives in the app shell
// (index.html v2.7).
//
// v2.10: the REAL, architectural fix for the recurring "notes jump"
// glitch — root-caused by comparing against the file from right before
// this bug was first reported (see chat history) rather than patching
// symptoms one at a time. Every group's freeze/fall timing was being
// derived from the clock's position carried over from the PREVIOUS
// group (practiceBaseMs re-based at release) — but since v2.5 lets the
// clock run freely while a key is held, a long-enough hold could carry
// the clock PAST the next group's own freeze point before that group
// even appeared, forcing a visible snap backward the instant it did.
// v2.6 tried to fix this at the release point specifically and helped,
// but the same class of bug could still happen at the group TRANSITION
// itself.
//
// The actual fix, per the original design comment "Wait Mode has no
// continuous clock": each group (note or chord) now gets its own fresh,
// fixed-duration fall-in (leadTimeMs) the instant it becomes current
// (showCurrentGroup()), completely independent of how long the previous
// note was held. practiceNoteOff() no longer re-bases the clock for the
// NEXT group at all — only for the wind-down of the LAST group, where
// there's no "next" to hand off to. This removes the entire class of
// carry-over bug rather than special-casing another instance of it.
//
// v2.9: three changes to match index.html v2.6 / app.css v2.4.
//  1. #keyboard-mode-switch now lives in the app shell — shown on
//     mount(), hidden again on unmount(), instead of always visible.
//  2. syncAccompanimentButton() now toggles a compact dot indicator
//     (.on class + #accompaniment-state text) instead of writing the
//     whole "Accompaniment: on/off" sentence into the button.
//  3. syncHandPanels() also sets #mini-hand-label ("Right"/"Both"); the
//     hand mention is dropped from #context-subtitle's text (now just
//     the section label) since it would say the same thing twice.
//
// v2.8: struck notes are now also removed from the waiting cue
// immediately (visualizer.clearWaitingNote(), see visualizer.js v2.3) —
// fixes a leftover glitch where a held note's pulsing halo stayed glued
// to the hit line for the whole hold, even though the note itself had
// already moved on as a falling ghost.
//
// v2.7: dropped the #finger-caption text entirely from updateFingerGuide()
// — it duplicated the "Right hand" / hand-tab info already shown
// elsewhere and added no information of its own, per feedback. The
// finger-highlighting behaviour on the hand SVGs is unchanged. Pairs
// with index.html v2.4 (old .learning-topbar/.learning-header/
// .practice-hud row removed, contents folded into the sticky bar).
//
// v2.6: fixed the "notes jump backward" glitch introduced by v2.5. On
// release, the clock was re-based on the chord's own nominal beat
// (lead.startMs) — but since v2.5 lets the clock run freely while a key
// is held, that snapped the timeline backward whenever a hold lasted
// past its own beat. Now it re-bases on wherever the clock ACTUALLY is
// at release (currentPracticeMs(), shared with the animation loop) —
// no more discontinuity.
//
// v2.5: the real fix for the "freezes until you release the key" bug —
// v2.4's markPlayed()-on-press change wasn't enough on its own, because
// practiceAnimationLoop() had its OWN freeze: it clamped the whole
// animation clock to the current chord's beat until every key of that
// chord was released, so a struck-but-still-held note's fall couldn't
// advance even though it was already marked played. Now the clock stays
// frozen only while NOTHING has been struck yet (waiting cue keeps
// pulsing as before); the instant the first key of the chord goes down
// (state.groupStruckAtMs), the clock is let loose and runs at normal
// speed, so the note keeps falling/ghosting regardless of how long the
// key is held.
//
// v2.4: two changes.
//  1. Fixed a fluidity bug: a struck note is now marked played (and
//     resumes its normal/ghost fall) the INSTANT it's pressed
//     (practiceNoteOn), not on release (practiceNoteOff) as before —
//     previously a held key froze the note on the hit line for as long
//     as it stayed down.
//  2. Added Loop: a sticky-bar toggle that repeats the current section
//     indefinitely, in both Play (auto-restarts from the top when the
//     playback timer ends) and Practice (skips the full score modal —
//     which would otherwise interrupt every single pass — flashes the
//     percentage in the HUD instead, then auto-restarts after
//     LOOP_RESTART_DELAY_MS). Requires index.html v2.2+ (adds
//     #loop-btn) and css/app.css v2.1+ (.learning-sticky-bar).
//
// v2.3: Screen Wake Lock added — the screen no longer sleeps mid-practice
// on supported browsers (Chrome/Android, incl. Samsung tablets). Requested
// on mount(), released on unmount(), re-requested on visibilitychange since
// the browser silently drops the lock whenever the tab is hidden. Not
// supported on iOS Safari before 16.4 — no effect there, no crash either.
//
// v2.2: three fixes.
//  1. "2 linked" -> "2 keyboards" in the range-mismatch error message —
//     a leftover from before that label was renamed.
//  2. Solo mode's keyboard now uses duo mode's white-key count as a
//     fixed reference width (REFERENCE_WHITE_COUNT, see
//     keyboard-layout.js v1.1), instead of stretching its own smaller
//     key count to fill the container. Same key width in both modes;
//     solo is simply narrower and centered.
//  3. syncHandPanels() now fully hides the hand not being practised
//     (.hand-dock.hidden) instead of dimming it — there's no left-hand
//     part to show at all in Right-hand-only mode.
// Requires keyboard-layout.js v1.1+, app.html v2.0+, css/app.css v2.0+.
//
// v2.1: matches visualizer.js v2.0's ghost-note behaviour — a played
// note now keeps falling (grey, big bold white finger number) instead of
// vanishing instantly. Renamed the hideNotes() call to markPlayed(), and
// finishPractice()'s wind-down before the score modal now waits for
// visualizer.ghostFallDurationMs() so the last note's ghost fall is
// actually visible instead of being cut short.
//
// v2.0: finger guide retargeted at the hand-drawn SVG (app.html v1.9) —
// toggles .finger.active on <g> elements instead of positioning a badge
// over an emoji. Numbers are baked into the SVG itself now, so there is
// nothing left to position or guess here.
//
// v1.9: fixes for regressions/feedback from the flex-row hand redesign.
//  1. LED chord bug: v1.8's Promise.all fired every LED write at once —
//     the physical keyboard silently accepted only the first and dropped
//     the rest, so only one note ever lit. Reverted to sequential writes
//     (still using the no-response fast path from ble.js v1.1).
//  2. Accompaniment button hidden entirely when practising both hands —
//     there's no "other hand" left to accompany in that mode.
// Hand layout and the "2 keyboards" label fix are in app.html v1.8 and
// css/app.css v1.8, no JS changes needed for those.
//
// v1.8: three fixes from feedback on the emoji hand redesign and a live
// test run.
//  1. Finger guide now targets the emoji hand's .finger-badge elements
//     (see app.html v1.6), not the old SVG.
//  2. Every timeline entry gets a unique id (toTimeline()); startPractice
//     re-points the visualizer at the SAME array it uses for gameplay, and
//     practiceNoteOff calls visualizer.markPlayed() the instant a note or
//     chord is fully validated — it disappears right there instead of
//     lingering (white or coloured) for its nominal duration.
//  3. LATE_MISTAKE_THRESHOLD_MS: a note struck more than 600ms after its
//     freeze point now adds to the SAME section-wide mistake penalty as a
//     wrong key, on top of its low timing sub-score — a slow-but-correct
//     run can no longer pass on pitch alone.
// Requires visualizer.js v1.9+, app.html v1.6+, css/app.css v1.6+.
//
// v1.7: adds a tempo control (0.5x-1.25x). Below 1x is for learning a
// passage: the section still plays through Wait Mode normally, but the
// score modal shows "Practice run" instead of pass/fail and nothing is
// written to Store.completed. Requires store.js v1.3+ and app.html v1.5+.
//
// v1.6: hand guide now targets the redesigned single-silhouette hands
// (docked beside the keyboard, see app.html v1.4) instead of the old
// dot-row panels. And the end-of-section score is now a celebration
// modal (vertical red-to-green gauge filling to the score, big
// percentage, Practice again / Back to sections) instead of small inline
// text. Requires app.html v1.4+ and css/app.css v1.4+.
//
// v1.5
// view-learning.js
// v1.5: CHORDS. Notes landing on the same beat are now one event, not a
// sequence. Before this, a three-note left-hand chord had to be played
// one key at a time and only ever lit one key — which is what looked
// broken in two-hand mode. Now every key of the chord lights together
// (screen + physical LEDs), the keys may be struck in ANY order, and the
// chord only advances once all of them have been pressed and released.
// Timing is judged once per chord on its first key, so the natural
// spread of fingers landing isn't scored as lateness. When both hands
// share a beat the right hand is the lead: it drives the measure counter
// and the freeze point, with the left as harmony underneath.
// Also: the finger guide became a pair of hands sitting on the stage
// (bottom-left / bottom-right), able to light several fingers at once,
// with the idle hand dimmed. Requires visualizer.js v1.6+.
//
// v1.4
// view-learning.js
// v1.4: four things at once, all of which touch the same gameplay loop.
//  1. STRICTER SCORING. Pitch now weighs 0.75 (was 0.5), a single wrong
//     key on a note drops that note to 0.25 (was 0.66), and — the part
//     that actually mattered — a section-wide penalty of 25% per wrong
//     key is applied on top. Averaging alone could never make one
//     mistake count: one bad note in fifteen barely moved the mean, so
//     fumbled sections still passed. Now one mistake puts an otherwise
//     clean run under the pass mark.
//  2. BEAT-BASED SECTIONS. Sections are sliced by beat window instead of
//     by note index. Index slicing broke the moment two hands shared one
//     list; a beat window is hand-agnostic.
//  3. LEFT-HAND ACCOMPANIMENT. When practising one hand, the other plays
//     underneath — sound only, never notated, never scored. In auto
//     playback it's scheduled on the clock; in Wait Mode (which has no
//     continuous clock) chords are released as the player reaches each
//     note, so they land with the melody at whatever speed it's played.
//  4. PRACTICE HUD. Measure counter and a five-dot finger guide, the
//     active dot lit in that note's own colour. The old SVG hand was
//     dropped rather than restyled.
// Requires ode-to-joy.json v2.0+ (notesLeft + beatStart/beatEnd) and
// store.js v1.2+.
//
// v1.3: the playable MIDI range is no longer hardcoded to solo mode. A
// 1-keyboard / 2-linked selector now drives Store.keyboardMode, and the
// on-screen keyboard, the layout and the visualizer's note->column map
// are rebuilt together whenever it changes (solo = 60-83, duo = 48-95,
// per the validated GPP-101 mappings). Switching mid-exercise stops
// practice/playback first rather than moving the target under the
// player's fingers.
//
// v1.2: reverses the v1.1 "tolerance window" approach after watching how
// POP Piano actually behaves (screen recording, frame-by-frame): it DOES
// freeze strictly on the hit line and wait for the exact key — the fall
// never drifts past the line. What makes it feel alive rather than stuck
// is feedback, not motion:
//   - the held note gets a pulsing halo + drifting motes (visualizer
//     setWaitingNote / drawWaitingCue)
//   - a correct hit fires a particle burst on that key (visualizer.spark)
// So the freeze is back to strict, and the fluidity comes from the two
// cues above. Requires visualizer.js v1.5+.
// The v1.1 last-note wind-down fix is kept — the final note still gets to
// finish its fall before the score appears.
//
// v1.0 (SPA conversion) — gameplay logic carried over from learning.js
// v5.4 unchanged; only the lifecycle/plumbing below changed:
//  - reads song/section/hand from Store instead of URL query params
//  - mount()/unmount() lifecycle: entering rebuilds the keyboard, canvas
//    and visualizer; leaving stops audio, timers, animation frames and
//    LEDs, and detaches from the shared BLE instance WITHOUT disconnecting
//    it (that's the whole point of the SPA)
//  - the score is written into Store.completed rather than encoded back
//    into a URL for sections.html to read
//  - element ids that used to collide across pages are namespaced
//    (#learning-song-title, #learning-back-link)

window.ViewLearning = (function () {
  const PASS_THRESHOLD = 80;
  // Playable MIDI range is no longer hardcoded to solo mode — it comes
  // from Store.range(), driven by the 1-keyboard / 2-linked selector.

  // Extra real time (ms) the wind-down animation runs after the last note
  // of a section, so it visibly finishes its fall instead of cutting off.
  const FINISH_WINDDOWN_BUFFER_MS = 400;

  // A note struck more than this long after its freeze point counts as a
  // (softer) scoring mistake — see LATE_PENALTY near finalPercent() — on
  // top of its already-low timing sub-score. Without this, a very slow
  // but pitch-perfect run could still pass.
  const LATE_MISTAKE_THRESHOLD_MS = 600;

  // Module-wide counter so every toTimeline() call hands out unique ids,
  // even across separate calls (melody vs accompaniment, or a fresh
  // Start Practice) — see markPlayed() in visualizer.js.
  let nextTimelineId = 1;

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

    practiceActive: false,
    waitQueue: [],
    groups: [],           // notes grouped by beat — a chord is one event
    groupPointer: 0,
    // Notes of the CURRENT group that have been struck at least once.
    // Entries are never removed on release — a chord where one key is
    // let go before the others land is still a completed chord.
    struck: new Set(),
    // Keys physically held RIGHT NOW, across group boundaries:
    // note -> { pressedAt, entry, pitchScore, timingScore }.
    // Independent of groupPointer on purpose — a note can (and often
    // does) stay held after its group has already advanced, and its real
    // hold duration must still be measurable when it's finally released.
    sustaining: new Map(),
    accompQueue: [],
    accompPointer: 0,
    noteScores: [],
    currentWrongAttempts: 0,
    totalWrongAttempts: 0,
    totalLateHits: 0,
    currentTimingScore: 0,
    currentLedNotes: [],
    ledTimerId: null,
    practiceBaseMs: 0,
    practiceRealStart: 0,
    sessionStartRealTime: 0,
    practiceRafId: null,
    loopEnabled: false,
    loopRestartTimer: null,
  };

  let wiredControls = false;
  let resizeHandler = null;
  let wakeLock = null;
  let wakeLockVisibilityHandler = null;

  // Screen wake lock — prevents the tablet/phone from sleeping mid-practice.
  // Not supported on iOS Safari before 16.4, and released automatically by
  // the browser whenever the tab is hidden — re-requested on visibilitychange
  // so it survives switching apps and coming back.
  async function requestWakeLock() {
    if (!("wakeLock" in navigator)) return;
    try {
      wakeLock = await navigator.wakeLock.request("screen");
    } catch (err) {
      wakeLock = null;
    }
  }

  function ble() {
    return PianoBle.get();
  }

  // -------------------------------------------------------------------
  // Data helpers
  // -------------------------------------------------------------------

  function normalizeHand(h) {
    return (h || "").toString().trim().toLowerCase();
  }

  // All notes of the song, both hands. notesLeft is kept as a separate
  // array in the JSON so the old non-SPA pages, which slice `notes` by
  // index, are unaffected by the left hand existing at all.
  function allNotes() {
    return [...(state.song.notes || []), ...(state.song.notesLeft || [])];
  }

  // Sections are sliced by BEAT, not by note index. Index slicing broke
  // as soon as two hands shared one list; a beat window is hand-agnostic
  // and is what makes two-hand sections possible.
  function sectionWindow() {
    if (Store.sectionId === "all") return null;
    const sec = state.song.sections.find((s) => s.id === Store.sectionId);
    if (!sec) return null;
    if (sec.beatStart != null) return { start: sec.beatStart, end: sec.beatEnd };
    // Fallback for songs not yet migrated to beat-based sections.
    const notes = state.song.notes;
    return {
      start: notes[sec.noteIndexStart].beat,
      end: notes[sec.noteIndexEnd].beat,
    };
  }

  function inWindow(note, win) {
    return !win || (note.beat >= win.start && note.beat <= win.end);
  }

  // Notes the player must actually play (notated, scored, shown falling).
  function getActiveNotes() {
    const win = sectionWindow();
    const wanted = Store.hand === "both"
      ? ["right", "left"]
      : [Store.hand];
    return allNotes()
      .filter((n) => wanted.includes(normalizeHand(n.hand)) && inWindow(n, win))
      .sort((a, b) => a.beat - b.beat || a.note - b.note);
  }

  // The OTHER hand — played underneath as sound only, never notated and
  // never scored. Empty when practising both hands (nothing is "other").
  function getAccompanimentNotes() {
    if (!Store.accompaniment || Store.hand === "both") return [];
    const other = Store.hand === "right" ? "left" : "right";
    const win = sectionWindow();
    return allNotes()
      .filter((n) => normalizeHand(n.hand) === other && inWindow(n, win))
      .sort((a, b) => a.beat - b.beat);
  }

  function toTimeline(notes, msPerBeat) {
    if (notes.length === 0) return [];
    const offsetBeat = notes[0].beat;
    return notes.map((n) => ({
      // Unique per entry, across the whole session — lets the visualizer
      // permanently hide ONE specific note the instant it's validated
      // (see markPlayed()), even if another note of the same pitch occurs
      // later in the same timeline.
      id: nextTimelineId++,
      note: n.note,
      startMs: (n.beat - offsetBeat) * msPerBeat,
      durationMs: n.durationBeats * msPerBeat,
      // Carried through so the HUD (finger guide, measure counter) and the
      // visualizer's finger labels can read them off the timeline entry.
      // In single-hand mode, prefer fingerSolo (computed with that hand
      // playing ALONE — see import_song.py) over finger (computed for the
      // two hands together, which can assume a stretch or a note held by
      // the other hand that's simply impossible to reach solo). Falls
      // back to the two-hand finger when a note has no solo fingering
      // (pianoplayer doesn't always assign one, or the song predates this
      // field entirely) rather than showing nothing.
      finger: (Store.hand !== "both" && n.fingerSolo != null) ? n.fingerSolo : (n.finger || null),
      hand: normalizeHand(n.hand),
      beat: n.beat,
    }));
  }

  // Accompaniment shares the melody's time origin, so both line up even
  // when a section starts mid-song.
  function toAccompanimentTimeline(msPerBeat) {
    const active = getActiveNotes();
    if (active.length === 0) return [];
    const offsetBeat = active[0].beat;
    return getAccompanimentNotes().map((n) => ({
      note: n.note,
      startMs: (n.beat - offsetBeat) * msPerBeat,
      durationMs: n.durationBeats * msPerBeat,
      beat: n.beat,
    }));
  }

  // Tempo multiplies the song's own bpm: 0.5x plays at half speed (bigger
  // msPerBeat), 1.25x at 125% (smaller msPerBeat). Every timeline in the
  // view (melody, accompaniment, Wait Mode's freeze points) is built from
  // this single function, so a tempo change affects all of them together.
  function currentMsPerBeat() {
    return 60000 / (state.song.bpm * Store.tempo);
  }

  // -------------------------------------------------------------------
  // Keyboard DOM
  // -------------------------------------------------------------------

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
      const note = Number(el.dataset.note);
      el.addEventListener("pointerdown", () => noteOn(note));
      el.addEventListener("pointerup", () => noteOff(note));
      el.addEventListener("pointerleave", () => noteOff(note));
      el.addEventListener("pointercancel", () => noteOff(note));
    });
  }

  function highlightKey(note, durationMs, color) {
    const el = document.querySelector(`#keyboard .key[data-note="${note}"]`);
    if (!el) return;
    el.style.setProperty("--glow", color);
    el.classList.add("active");
    setTimeout(() => el.classList.remove("active"), Math.max(120, durationMs));
  }

  // Physical-keyboard equivalent of highlightKey() — used by normal
  // Play/Listen playback, which previously only ever lit the on-screen
  // key. Wait Mode's LED handling (scheduleExpectedNoteLed) is separate
  // and unaffected: that one waits for a press before moving on; this
  // one just flashes in sync with the timeline, on its own timer.
  function flashLed(note, durationMs) {
    if (!ble() || !ble().connected) return;
    ble().sendLedOn(note);
    setTimeout(() => ble().sendLedOff(note), Math.max(120, durationMs));
  }

  // A red ✕ overlaid ON the key, separate from highlightKey()'s red glow
  // — per Nico, the glow alone reads as ambiguous on a key whose OWN
  // note colour is also red (C is #e5484d in note-colors.js), so a wrong
  // C could look like nothing happened. The ✕ is a shape, not a colour,
  // so it stays unmistakable regardless of which key it lands on.
  function showWrongMark(note, durationMs) {
    const el = document.querySelector(`#keyboard .key[data-note="${note}"]`);
    if (!el) return;
    const mark = document.createElement("div");
    mark.className = "wrong-mark";
    mark.innerHTML =
      '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">' +
      '<line x1="4" y1="4" x2="20" y2="20" />' +
      '<line x1="20" y1="4" x2="4" y2="20" />' +
      "</svg>";
    el.appendChild(mark);
    setTimeout(() => mark.remove(), durationMs);
  }

  // -------------------------------------------------------------------
  // Playback
  // -------------------------------------------------------------------

  function clearTimers() {
    state.timers.forEach((t) => clearTimeout(t));
    state.timers = [];
  }

  function schedulePlayback(fromMs, leadIn = 0) {
    clearTimers();
    const timeline = toTimeline(getActiveNotes(), currentMsPerBeat());

    for (const n of timeline) {
      if (n.startMs < fromMs) continue;
      const delay = leadIn + (n.startMs - fromMs);
      const timer = setTimeout(() => {
        state.audio.playNote(n.note, n.durationMs / 1000);
        highlightKey(n.note, n.durationMs, colorForNote(n.note));
        updateFingerGuide(n);
        updateMeasureCounter(n);
        flashLed(n.note, n.durationMs);
      }, delay);
      state.timers.push(timer);
    }

    // The other hand underneath: sound only, no key glow, no finger cue —
    // it's there to give the melody harmonic context, not to be followed.
    for (const n of toAccompanimentTimeline(currentMsPerBeat())) {
      if (n.startMs < fromMs) continue;
      const delay = leadIn + (n.startMs - fromMs);
      state.timers.push(setTimeout(() => {
        state.audio.playNote(n.note, n.durationMs / 1000);
      }, delay));
    }

    if (timeline.length === 0) return;
    const last = timeline[timeline.length - 1];
    const totalMs = last.startMs + last.durationMs;
    state.timers.push(
      setTimeout(
        () => {
          if (state.loopEnabled) restartPlayback();
          else stopPlayback();
        },
        leadIn + totalMs - fromMs + 400
      )
    );
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

    const leadIn = state.pausedAtMs === 0 ? state.visualizer.leadTimeMs : 0;
    state.startTimestamp = performance.now() - state.pausedAtMs + leadIn;
    schedulePlayback(state.pausedAtMs, leadIn);
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
    if (state.visualizer) state.visualizer.draw(-state.visualizer.leadTimeMs);
  }

  function togglePlayback() {
    if (state.playing) pausePlayback();
    else startPlayback();
  }

  function restartPlayback() {
    stopPlayback();
    startPlayback();
  }

  // -------------------------------------------------------------------
  // Wait Mode (Practice)
  // -------------------------------------------------------------------

  // Guard: in "Both hands" the left hand sits at MIDI 48-59, which is
  // outside the one-keyboard range (60-83). Starting practice there would
  // stall forever on the first left-hand note, because the key needed
  // simply doesn't exist on screen or on the instrument. Catch it up
  // front and say what to do instead.
  function unplayableNotes() {
    const range = Store.range();
    return getActiveNotes().filter((n) => n.note < range.start || n.note > range.end);
  }

  // Notes that land on the same beat form ONE event. Without this, a
  // three-note left-hand chord had to be played one key at a time and
  // only ever lit one key — the thing that looked most broken in
  // two-hand mode. Grouping also means both hands striking together on
  // the same beat is a single validation, which is how it's actually
  // played.
  function buildGroups(timeline) {
    const groups = [];
    for (const entry of timeline) {
      const last = groups[groups.length - 1];
      if (last && Math.abs(last[0].startMs - entry.startMs) < 1) last.push(entry);
      else groups.push([entry]);
    }
    return groups;
  }

  function currentGroup() {
    return state.groups[state.groupPointer] || null;
  }

  // The entry a group's HUD should follow. With both hands on one beat
  // the right hand carries the melody, so it drives the measure counter
  // and the fall — the left hand is harmony underneath it.
  function leadEntry(group) {
    return group.find((e) => e.hand === "right") || group[0];
  }

  async function startPractice() {
    pausePlayback();

    const blocked = unplayableNotes();
    if (blocked.length > 0) {
      const scoreEl = document.getElementById("score-display");
      scoreEl.textContent =
        `${blocked.length} note${blocked.length > 1 ? "s" : ""} of this part fall outside ` +
        `the 1-keyboard range — switch to "2 keyboards" to practise it.`;
      scoreEl.style.color = "#ff7a6e";
      return;
    }

    await state.audio.init();

    state.waitQueue = toTimeline(getActiveNotes(), currentMsPerBeat());
    state.groups = buildGroups(state.waitQueue);
    state.groupPointer = 0;
    state.struck = new Set();     // notes of the current group already hit
    state.sustaining = new Map(); // keys physically held right now
    state.accompQueue = toAccompanimentTimeline(currentMsPerBeat());
    state.accompPointer = 0;
    state.noteScores = [];
    state.currentWrongAttempts = 0;
    state.totalWrongAttempts = 0;
    state.totalLateHits = 0;
    state.practiceActive = state.groups.length > 0;

    // Re-point the visualizer at THIS EXACT array (same objects, same
    // ids) rather than the separate one built at mount() — markPlayed()
    // below only works because the ids it's given match what's on screen.
    state.visualizer.setNotes(state.waitQueue, state.song.notesColor);

    document.getElementById("practice-btn").textContent = "Stop Practice";
    document.getElementById("score-display").textContent = "";

    if (state.practiceActive) {
      state.practiceBaseMs = -state.visualizer.leadTimeMs;
      state.practiceRealStart = performance.now();
      // Separate from practiceRealStart above — that one gets re-based
      // per note/group for the falling-note physics (see currentPracticeMs
      // and the release re-basing this file's header comments describe).
      // sessionStartRealTime stays fixed for the whole attempt, so
      // showFinalScore() can measure real elapsed wall-clock time.
      state.sessionStartRealTime = performance.now();
      showCurrentGroup();
      state.practiceRafId = requestAnimationFrame(practiceAnimationLoop);
    } else {
      document.getElementById("score-display").textContent =
        "No notes for this hand/section yet.";
    }
  }

  function stopPractice() {
    state.practiceActive = false;
    // Dropped, not scored: a section abandoned half-way shouldn't feed
    // partial holds into the next run's noteScores.
    state.sustaining = new Map();
    state.struck = new Set();
    cancelAnimationFrame(state.practiceRafId);
    if (state.loopRestartTimer) {
      clearTimeout(state.loopRestartTimer);
      state.loopRestartTimer = null;
    }
    if (state.visualizer) state.visualizer.setWaitingNote(null);
    document.getElementById("practice-btn").textContent = "Start Practice";
    document.getElementById("next-note-display").textContent = "";
    updateFingerGuide(null);
    clearExpectedNoteLed();
  }

  function practiceAnimationLoop() {
    if (!state.practiceActive) return;
    const group = currentGroup();
    if (!group) return;
    state.visualizer.draw(currentPracticeMs(group));
    state.practiceRafId = requestAnimationFrame(practiceAnimationLoop);
  }

  // The shared clock, positioning EVERY note on screen (waiting AND
  // already-played alike). It simply runs forward in real time, clamped
  // to the CURRENT group's own beat — the note being waited for reaches
  // the hit line and holds there, and nothing on screen ever gets ahead
  // of it.
  //
  // There is no "unfreeze once struck" branch any more, and no cap: the
  // group pointer now advances the moment a group is fully struck (see
  // completeCurrentGroup), so the clamp target itself moves forward and
  // the display keeps falling naturally. That's what removes the v3.4
  // desync — the clamp used to sit on the NEXT group's startMs while the
  // pointer still waited on the current one, so (a) the next note met
  // visualizer.js's `hit` test and went white while it wasn't the
  // waiting note, and (b) the player, quite reasonably, played the note
  // sitting on the line and got it rejected. Both symptoms, one cause.
  function currentPracticeMs(group) {
    const elapsed = performance.now() - state.practiceRealStart;
    return Math.min(state.practiceBaseMs + elapsed, leadEntry(group).startMs);
  }

  // Lights every key of the current chord at once, on screen and on the
  // physical keyboard's LEDs, and points the finger guide at all the
  // fingers involved.
  function showCurrentGroup() {
    const group = currentGroup();
    if (!group) return;
    state.struck = new Set();
    state.currentWrongAttempts = 0;

    state.visualizer.setWaitingNote(group.map((e) => e.note));
    updateFingerGuide(group);
    updateMeasureCounter(leadEntry(group));
    updateNextNoteLabel();
    scheduleExpectedNoteLed();
  }

  function updateNextNoteLabel() {
    const group = currentGroup();
    const size = group ? group.length : 0;
    const what = size > 1 ? `Chord (${size} notes)` : "Note";
    document.getElementById("next-note-display").textContent =
      `${what} ${state.groupPointer + 1} / ${state.groups.length}`;
  }

  // -------------------------------------------------------------------
  // Practice HUD — finger guide + measure counter
  // -------------------------------------------------------------------

  // Lights the finger(s) to use next on each hand's SVG — the number is
  // baked into the SVG at build time (same coordinates as the finger
  // shape itself), so this only needs to toggle colour, never position
  // any text. Takes a single timeline entry or a whole chord.
  function updateFingerGuide(entryOrGroup) {
    const entries = entryOrGroup == null
      ? []
      : (Array.isArray(entryOrGroup) ? entryOrGroup : [entryOrGroup]);

    document.querySelectorAll(".hand-svg .finger").forEach((f) => {
      f.classList.remove("active");
      f.style.removeProperty("--finger-color");
    });

    const withFinger = entries.filter((e) => e.finger);
    if (withFinger.length === 0) return;

    for (const e of withFinger) {
      const hand = e.hand === "left" ? "left" : "right";
      const color = colorForNote(e.note);
      const finger = document.querySelector(
        `.hand-svg[data-hand="${hand}"] .finger[data-finger="${e.finger}"]`
      );
      if (finger) {
        finger.classList.add("active");
        finger.style.setProperty("--finger-color", color);
      }
    }

  }

  function beatsPerMeasure() {
    return state.song.beatsPerMeasure || 4;
  }

  function updateMeasureCounter(entry) {
    const perMeasure = beatsPerMeasure();
    const valueEl = document.getElementById("measure-value");
    const totalEl = document.getElementById("measure-total");

    const active = getActiveNotes();
    if (active.length === 0) {
      valueEl.textContent = "–";
      totalEl.textContent = "–";
      return;
    }

    const firstBeat = active[0].beat;
    const lastBeat = active[active.length - 1].beat;
    const totalMeasures = Math.floor((lastBeat - firstBeat) / perMeasure) + 1;
    totalEl.textContent = totalMeasures;

    if (!entry) {
      valueEl.textContent = "–";
      return;
    }
    valueEl.textContent = Math.floor((entry.beat - firstBeat) / perMeasure) + 1;
  }

  // -------------------------------------------------------------------
  // BLE guide light
  // -------------------------------------------------------------------

  // Lights the LED(s) for the current group IMMEDIATELY — Wait Mode
  // already freezes the note at the hit line the instant we start
  // waiting for it (see currentPracticeMs), so any delay here only ever
  // makes the physical light come on AFTER the note was already due,
  // leaving no time to react. The previous version scheduled this after
  // fallDurationMs (the rhythmic gap since the last note), which made
  // sense for a real-time fall but not for Wait Mode's indefinite wait.
  async function scheduleExpectedNoteLed() {
    cancelScheduledLed();
    if (!ble() || !ble().connected) return;

    const group = currentGroup();
    if (!group) return;

    const newNotes = group.map((e) => e.note);
    // A repeated note (same pitch as the group just finished) needs a
    // deliberate pause between "off" and back "on" — firing them right
    // after each other (as we do for every other case) lands close
    // enough together that the physical LED never visibly blinks, so it
    // just looks like it stayed lit and hides that there were two
    // separate notes to play.
    const repeated = newNotes.some((n) => state.currentLedNotes.includes(n));

    // Sequential, not Promise.all: firing several BLE writes at once
    // made the keyboard only accept the first one and silently drop
    // the rest, so only one LED ever lit up. One at a time, but each
    // using the no-response write (ble.js v1.1) to stay as fast as the
    // link allows — this is the trade-off that actually works.
    for (const n of state.currentLedNotes) await ble().sendLedOff(n);
    if (repeated) await new Promise((resolve) => setTimeout(resolve, 120));
    state.currentLedNotes = newNotes;
    for (const n of state.currentLedNotes) await ble().sendLedOn(n);
  }

  function cancelScheduledLed() {
    if (state.ledTimerId != null) {
      clearTimeout(state.ledTimerId);
      state.ledTimerId = null;
    }
  }

  async function clearExpectedNoteLed() {
    cancelScheduledLed();
    if (ble() && ble().connected) {
      for (const n of state.currentLedNotes) await ble().sendLedOff(n);
    }
    state.currentLedNotes = [];
  }

  // -------------------------------------------------------------------
  // Note press/release pipeline — virtual keyboard AND real GPP-101
  // -------------------------------------------------------------------

  function noteOn(note) {
    if (state.practiceActive) {
      practiceNoteOn(note);
    } else {
      state.audio.init().then(() => {
        state.audio.noteAttack(note);
        const el = document.querySelector(`#keyboard .key[data-note="${note}"]`);
        if (el) {
          el.style.setProperty("--glow", colorForNote(note));
          el.classList.add("active");
        }
      });
    }
  }

  function noteOff(note) {
    if (state.practiceActive) {
      practiceNoteOff(note);
    } else {
      state.audio.noteRelease(note);
      const el = document.querySelector(`#keyboard .key[data-note="${note}"]`);
      if (el) el.classList.remove("active");
    }
  }

  // Continuous linear decay instead of fixed steps — every bit of
  // hesitation costs something, not just crossing a step boundary.
  // Full score up to 150ms off (natural hand/eye margin), decaying
  // smoothly down to a floor of 0.1 by 900ms off.
  function timingScoreFromDelta(deltaMs) {
    const abs = Math.abs(deltaMs);
    const GRACE_MS = 150;
    const FLOOR_AT_MS = 900;
    const FLOOR_SCORE = 0.1;
    if (abs <= GRACE_MS) return 1;
    if (abs >= FLOOR_AT_MS) return FLOOR_SCORE;
    const t = (abs - GRACE_MS) / (FLOOR_AT_MS - GRACE_MS);
    return 1 - t * (1 - FLOOR_SCORE);
  }

  function durationScoreFromRatio(ratio) {
    if (ratio >= 0.7 && ratio <= 1.3) return 1;
    if (ratio >= 0.5 && ratio <= 1.6) return 0.6;
    return 0.3;
  }

  // Per-note pitch accuracy — much harsher than before: a single wrong
  // key on a note now costs most of that note's value instead of a third.
  function pitchScoreFromAttempts(wrongAttempts) {
    if (wrongAttempts === 0) return 1;
    if (wrongAttempts === 1) return 0.25;
    return 0;
  }

  // Averaging per-note scores alone can't make one mistake matter: one
  // bad note out of fifteen barely moves the mean, so a fumbled section
  // still passed. A section-wide penalty per wrong key fixes that — one
  // mistake drops a clean run well under the pass mark, which is the
  // behaviour asked for.
  const MISTAKE_PENALTY = 0.25;
  // Being very late is real, but shouldn't hit as hard as an outright
  // wrong note — a softer section-wide penalty, on top of the low
  // per-note timing score above.
  const LATE_PENALTY = 0.12;

  // How long the score flashes in the HUD before Loop auto-restarts the
  // section — long enough to read the percentage, short enough to feel
  // like a loop rather than a pause.
  const LOOP_RESTART_DELAY_MS = 900;

  function finalPercent() {
    const total = state.noteScores.length;
    if (total === 0) return 0;
    const mean = state.noteScores.reduce((a, b) => a + b, 0) / total;
    const penalty = Math.max(
      0,
      1 - MISTAKE_PENALTY * state.totalWrongAttempts - LATE_PENALTY * state.totalLateHits
    );
    return Math.round(mean * penalty * 100);
  }

  function practiceNoteOn(note) {
    const group = currentGroup();
    if (!group) return;

    // A key that is already physically down cannot be pressed again, so
    // a second noteOn for it is a stray duplicate from the link, not a
    // real strike. Ignoring it silently (rather than scoring it as a
    // wrong note) also stops a repeated note in the score — 71 71 — from
    // being validated twice by a single physical press.
    if (state.sustaining.has(note)) return;

    const entry = group.find((e) => e.note === note);

    // Not part of this chord, or a note of it already struck during this
    // group — either way it's a wrong press. Notes of a chord may be
    // struck in ANY order.
    if (!entry || state.struck.has(note)) {
      state.currentWrongAttempts++;
      state.totalWrongAttempts++;
      state.audio.playNote(note, 0.3);
      highlightKey(note, 300, "#2a2e38");
      showWrongMark(note, 300);
      return;
    }

    const now = performance.now();
    state.struck.add(note);
    state.sustaining.set(note, {
      pressedAt: now,
      entry,
      pitchScore: null,
      timingScore: null,
    });

    state.audio.playNote(note, entry.durationMs / 1000);
    highlightKey(note, entry.durationMs, colorForNote(note));
    state.visualizer.spark(note);
    // Marked played (and starts its normal/ghost fall) the instant it's
    // struck — previously this only happened on release, which froze the
    // note on the hit line for as long as the key was held down.
    state.visualizer.markPlayed([entry.id]);

    // A group is complete once every one of its notes has been STRUCK —
    // not "is down right now": on a chord you may well let one key go
    // before the last one lands, and that is still a played chord.
    //
    // Crucially, completion no longer waits for release. The pointer
    // moves on immediately, so what sits on the hit line is always what
    // the game is asking for. Holding a key past its beat then simply
    // means "held too long": the display runs on to the next note and
    // waits there for you to play it.
    if (group.every((e) => state.struck.has(e.note))) {
      completeCurrentGroup(group, now);
    }
  }

  // Scores a completed group's timing, releases any accompaniment due by
  // then, re-anchors the clock and moves on to the next group.
  function completeCurrentGroup(group, now) {
    const lead = leadEntry(group);
    const fallDurationMs = Math.max(0, lead.startMs - state.practiceBaseMs);
    const freezeRealTime = state.practiceRealStart + fallDurationMs;
    const deltaMs = now - freezeRealTime;
    // The very first note of the exercise has nothing to be "on time"
    // relative to — freezeRealTime traces back to practiceRealStart,
    // stamped the instant Start Practice is clicked, and no one can see
    // the screen, place their hands, and strike a note in that same
    // instant. Timing only starts meaning something from the 2nd note.
    const isFirstNote = state.groupPointer === 0;
    state.currentTimingScore = isFirstNote ? 1 : timingScoreFromDelta(deltaMs);
    // A note struck way after its freeze point counts toward its own,
    // softer penalty (LATE_PENALTY) — separate from wrong-key mistakes —
    // so consistently slow-but-correct playing scores lower without
    // being treated as harshly as a wrong note.
    if (!isFirstNote && Math.abs(deltaMs) > LATE_MISTAKE_THRESHOLD_MS) {
      state.totalLateHits++;
    }

    // Stamp this group's pitch/timing marks onto every one of its notes
    // that is still held. They are final now, but the key may not be let
    // go until several groups later — by which point currentWrongAttempts
    // and currentTimingScore describe a different group entirely.
    const pitchScore = pitchScoreFromAttempts(state.currentWrongAttempts);
    for (const e of group) {
      const held = state.sustaining.get(e.note);
      if (held) {
        held.pitchScore = pitchScore;
        held.timingScore = state.currentTimingScore;
      }
    }

    // Wait Mode has no continuous clock — the accompaniment is released
    // as the player reaches each chord, so it lands with the melody at
    // whatever speed the section is being played.
    flushAccompanimentUpTo(lead.startMs);

    // Gone from the canvas the instant it's validated — no lingering.
    state.visualizer.markPlayed(group.map((e) => e.id));

    // Re-anchor the clock to wherever it is ACTUALLY displayed right now,
    // not to the group's nominal beat: an early press must not snap the
    // note forward onto the line, and a late one must not snap it back.
    state.practiceBaseMs = currentPracticeMs(group);
    state.practiceRealStart = performance.now();

    state.groupPointer++;
    if (state.groupPointer >= state.groups.length) {
      state.visualizer.setWaitingNote(null);
      finishPractice();
    } else {
      showCurrentGroup();
    }
  }

  function flushAccompanimentUpTo(ms) {
    while (
      state.accompPointer < state.accompQueue.length &&
      state.accompQueue[state.accompPointer].startMs <= ms
    ) {
      const chordNote = state.accompQueue[state.accompPointer];
      state.audio.playNote(chordNote.note, chordNote.durationMs / 1000);
      state.accompPointer++;
    }
  }

  // Releases drive nothing now — they exist purely to measure how long a
  // note was really held, which is what its duration score is built on.
  // Deliberately independent of groupPointer: by the time a key is let
  // go, its group may be several notes back.
  function practiceNoteOff(note) {
    const held = state.sustaining.get(note);
    // No matching press on record: a duplicate noteOff from the link, or
    // the tail of a press that was rejected as a wrong note. Nothing to
    // score, and nothing waiting on it.
    if (!held) return;

    state.sustaining.delete(note);
    scoreHeldNote(held, performance.now());
  }

  // Turns one finished hold into a note score. pitch/timing were frozen
  // when the note's group completed (completeCurrentGroup); the fallbacks
  // only ever apply to a key let go before its group was finished.
  function scoreHeldNote(held, releasedAt) {
    const heldMs = releasedAt - held.pressedAt;
    const durationScore = durationScoreFromRatio(heldMs / held.entry.durationMs);
    const pitchScore = held.pitchScore != null
      ? held.pitchScore
      : pitchScoreFromAttempts(state.currentWrongAttempts);
    const timingScore = held.timingScore != null
      ? held.timingScore
      : state.currentTimingScore;

    // Pitch still matters most — a wrong note stays worse than a slow
    // right one — but timing now has real weight (was 0.15) instead of
    // being drowned out by pitch's old 0.75.
    state.noteScores.push(pitchScore * 0.60 + timingScore * 0.30 + durationScore * 0.10);
  }

  // Any key still down when the section ends still deserves its duration
  // score — without this, the last note of a section would score nothing
  // at all, since the section now finishes on its PRESS, not its release.
  function flushSustainingNotes() {
    const now = performance.now();
    for (const held of state.sustaining.values()) scoreHeldNote(held, now);
    state.sustaining = new Map();
  }

  function finishPractice() {
    // Let the last note's ghost visibly finish falling through the
    // buffer below the hit line instead of cutting straight to the score
    // the instant it's played. state.practiceBaseMs is already the last
    // note's startMs at this point (set in practiceNoteOff), and it was
    // already marked played (visualizer.markPlayed()) there too.
    cancelAnimationFrame(state.practiceRafId);
    clearExpectedNoteLed();

    const windDownFromMs = state.practiceBaseMs;
    const windDownDurationMs = state.visualizer.ghostFallDurationMs() + FINISH_WINDDOWN_BUFFER_MS;
    const windDownStart = performance.now();

    function windDownLoop() {
      const elapsed = performance.now() - windDownStart;
      const currentMs = windDownFromMs + Math.min(elapsed, windDownDurationMs);
      state.visualizer.draw(currentMs);
      if (elapsed < windDownDurationMs) {
        state.practiceRafId = requestAnimationFrame(windDownLoop);
      } else {
        showFinalScore();
      }
    }
    windDownLoop();
  }

  function showFinalScore() {
    state.visualizer.draw(-state.visualizer.leadTimeMs);

    // The section now ends on the last note's PRESS, so that note (and
    // any other key still down) hasn't been scored yet. Do it before
    // finalPercent() reads noteScores. Holding through the wind-down
    // means heldMs is still a fair measure of the real hold.
    flushSustainingNotes();

    const pct = finalPercent();
    const passed = pct >= PASS_THRESHOLD;
    const wrongKeys = state.totalWrongAttempts;
    const lateHits = state.totalLateHits;
    const counts = tempoCounts();

    document.getElementById("next-note-display").textContent = "";
    state.practiceActive = false;
    document.getElementById("practice-btn").textContent = "Start Practice";
    updateFingerGuide(null);

    // Below 1x is for learning the passage, not for passing it — nothing
    // is written to progress, and the Sections view's stars won't move.
    if (counts) {
      Store.recordScore(Store.sectionId, pct);
    }

    // Unlike recordScore above, session time is logged regardless of
    // tempo or pass/fail — a slow practice run or a failed attempt is
    // still real time spent practicing, and should count toward the
    // Dashboard's "hours practiced" / daily average.
    const durationSeconds = Math.round((performance.now() - state.sessionStartRealTime) / 1000);
    if (durationSeconds > 0) {
      Store.recordSession(Store.sectionId, durationSeconds);
    }

    // Loop: skip the full celebration modal (it would interrupt every
    // single pass) — just flash the score in the HUD and auto-restart.
    if (state.loopEnabled) {
      const scoreEl = document.getElementById("score-display");
      scoreEl.textContent = `${pct}% — looping…`;
      scoreEl.style.color = passed ? "#57cbb3" : "#ff7a6e";
      state.loopRestartTimer = setTimeout(() => {
        state.loopRestartTimer = null;
        if (state.loopEnabled) startPractice();
      }, LOOP_RESTART_DELAY_MS);
      return;
    }

    openScoreModal(pct, passed, wrongKeys, lateHits, counts);
  }

  // -------------------------------------------------------------------
  // Score celebration modal
  // -------------------------------------------------------------------

  // The next REAL phrase after the one just finished (never a synthetic
  // mid-revision/cumulative-revision/whole-song entry — those don't have
  // a single well-defined "next"). Real phrases keep their original
  // song.sections order; synthetic ones are always appended after them
  // (see view-sections.js), so filtering them out preserves phrase
  // order correctly. Returns null if we're not currently on a real
  // phrase, or if the one just passed was already the last.
  function nextRealSectionId() {
    const real = state.song.sections.filter((s) => !s.isSynthetic);
    const idx = real.findIndex((s) => s.id === Store.sectionId);
    if (idx === -1 || idx + 1 >= real.length) return null;
    return real[idx + 1].id;
  }

  function openScoreModal(pct, passed, wrongKeys, lateHits, counts) {
    const card = document.querySelector("#score-modal .score-modal-card");
    const mask = document.getElementById("score-gauge-mask");
    const kicker = document.getElementById("score-modal-kicker");
    const pctEl = document.getElementById("score-modal-pct");
    const detailEl = document.getElementById("score-modal-detail");
    const primaryBtn = document.getElementById("score-modal-primary");
    const secondaryBtn = document.getElementById("score-modal-secondary");

    const celebrate = counts && passed;
    card.classList.toggle("passed", celebrate);
    card.classList.toggle("failed", counts && !passed);
    card.classList.toggle("practice-run", !counts);

    if (!counts) {
      kicker.textContent = "Practice run";
    } else {
      kicker.textContent = passed ? "Section passed!" : "Almost there";
    }
    pctEl.textContent = `${pct}%`;

    const parts = [];
    if (wrongKeys > 0) parts.push(`${wrongKeys} wrong key${wrongKeys > 1 ? "s" : ""}`);
    if (lateHits > 0) parts.push(`${lateHits} late hit${lateHits > 1 ? "s" : ""}`);
    const mistakeText = parts.length === 0 ? "Clean run — no mistakes" : parts.join(", ");
    detailEl.textContent = counts
      ? mistakeText
      : `${mistakeText} — played at ${Store.tempo}x, doesn't count`;

    primaryBtn.textContent = counts ? (passed ? "Continue" : "Try again") : "Try again";
    secondaryBtn.textContent = counts ? (passed ? "Practice again" : "Back to sections") : "Back to sections";

    primaryBtn.onclick = () => {
      closeScoreModal();
      if (celebrate) {
        const nextId = nextRealSectionId();
        Router.go(
          nextId
            ? `#/song/${encodeURIComponent(Store.songId)}/${encodeURIComponent(nextId)}`
            : `#/song/${encodeURIComponent(Store.songId)}`
        );
      } else {
        startPractice();
      }
    };
    secondaryBtn.onclick = () => {
      closeScoreModal();
      if (celebrate) startPractice();
      else Router.go(`#/song/${encodeURIComponent(Store.songId)}`);
    };

    // Gauge starts fully masked, then animates down to reveal `pct`'s
    // worth of the red-to-green track — the "filling up" effect. The
    // reflow forces the browser to apply the starting state before the
    // transition to the real height, or it would just snap with no
    // animation at all.
    mask.style.transition = "none";
    mask.style.height = "100%";
    // eslint-disable-next-line no-unused-expressions
    mask.offsetHeight;
    mask.style.transition = "";
    requestAnimationFrame(() => {
      mask.style.height = `${100 - pct}%`;
    });

    document.getElementById("score-modal").classList.remove("hidden");
  }

  function closeScoreModal() {
    document.getElementById("score-modal").classList.add("hidden");
  }

  // -------------------------------------------------------------------
  // Mount / unmount
  // -------------------------------------------------------------------

  // Duo mode (2 keyboards) is the visual reference: solo mode uses its
  // white-key count too, so a key is exactly the same width in either
  // mode — only the number of keys (and so the overall keyboard width)
  // changes. Computed once; KEYBOARD_RANGES.duo never changes at runtime.
  const REFERENCE_WHITE_COUNT = countWhiteKeys(
    window.KEYBOARD_RANGES.duo.start,
    window.KEYBOARD_RANGES.duo.end
  );

  function rebuildKeyboardAndCanvas() {
    const keyboardWidth = document.getElementById("keyboard").clientWidth;
    const range = Store.range();
    state.layout = buildKeyboardLayout(range.start, range.end, keyboardWidth, REFERENCE_WHITE_COUNT);
    buildKeyboardDOM(state.layout);
  }

  // Switching between 1 keyboard and 2 linked ones changes the number of
  // key columns, so the DOM keyboard, the layout and the visualizer's
  // note->column map all have to be rebuilt together or the falling notes
  // stop lining up with the keys.
  function applyKeyboardMode(mode) {
    if (mode === Store.keyboardMode) return;
    Store.keyboardMode = mode;
    syncKeyboardModeButtons();

    // A range change mid-exercise would move the target under the
    // player's fingers — stop cleanly first.
    stopPractice();
    stopPlayback();

    rebuildKeyboardAndCanvas();
    if (state.visualizer) {
      state.visualizer.layout = state.layout;
      state.visualizer.keyByNote = {};
      for (const k of state.layout.keys) state.visualizer.keyByNote[k.note] = k;
      state.visualizer.resize();
      state.visualizer.draw(-state.visualizer.leadTimeMs);
    }
  }

  function syncKeyboardModeButtons() {
    document.querySelectorAll(".kbmode-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.mode === Store.keyboardMode);
    });
  }

  // Scoring only counts at normal speed or faster — below 1x is for
  // learning a passage, not for passing it. See finalizeScoreCounting().
  function tempoCounts() {
    return Store.tempo >= 1;
  }

  function applyTempo(value) {
    if (value === Store.tempo) return;
    Store.tempo = value;
    syncTempoButtons();

    // Every timeline (fall speed, freeze points, accompaniment) is
    // derived from currentMsPerBeat(), which just changed — stop cleanly
    // rather than let a running practice/playback jump mid-note.
    stopPractice();
    stopPlayback();
  }

  function syncTempoButtons() {
    document.querySelectorAll(".tempo-btn").forEach((btn) => {
      btn.classList.toggle("active", Number(btn.dataset.tempo) === Store.tempo);
    });
    const note = document.getElementById("tempo-note");
    note.textContent = tempoCounts()
      ? ""
      : "Practice speed — this run won't count toward the section's score.";
  }

  function wireControls() {
    if (wiredControls) return;
    wiredControls = true;
    document.getElementById("play-btn").addEventListener("click", togglePlayback);
    document.getElementById("restart-btn").addEventListener("click", restartPlayback);
    document.getElementById("loop-btn").addEventListener("click", () => {
      state.loopEnabled = !state.loopEnabled;
      document.getElementById("loop-btn").classList.toggle("active", state.loopEnabled);
      document.getElementById("loop-btn").setAttribute("aria-pressed", String(state.loopEnabled));
    });
    document.getElementById("practice-btn").addEventListener("click", () => {
      if (state.practiceActive) stopPractice();
      else startPractice();
    });
    document.querySelectorAll(".kbmode-btn").forEach((btn) => {
      btn.addEventListener("click", () => applyKeyboardMode(btn.dataset.mode));
    });
    document.querySelectorAll(".tempo-btn").forEach((btn) => {
      btn.addEventListener("click", () => applyTempo(Number(btn.dataset.tempo)));
    });
    document.getElementById("accompaniment-btn").addEventListener("click", () => {
      Store.accompaniment = !Store.accompaniment;
      syncAccompanimentButton();
      // Rebuild the queue so a mid-session toggle takes effect immediately
      // rather than only on the next Start Practice.
      if (state.practiceActive) {
        state.accompQueue = toAccompanimentTimeline(currentMsPerBeat());
        state.accompPointer = state.accompQueue.findIndex(
          (n) => n.startMs > state.practiceBaseMs
        );
        if (state.accompPointer === -1) state.accompPointer = state.accompQueue.length;
      }
    });
  }

  // Dims the hand that isn't being practised, so the eye goes straight to
  // the one that matters.
  // The hand not being practised is fully hidden, not just dimmed — in
  // "Right hand" mode there IS no left hand part to show at all.
  function syncHandPanels() {
    document.querySelectorAll(".hand-dock").forEach((dock) => {
      const hand = dock.classList.contains("hand-dock-left") ? "left" : "right";
      const inPlay = Store.hand === "both" || hand === Store.hand;
      dock.classList.toggle("hidden", !inPlay);
    });
    const label = document.getElementById("mini-hand-label");
    if (label) label.textContent = Store.hand === "both" ? "Both" : "Right";
  }

  function syncAccompanimentButton() {
    const btn = document.getElementById("accompaniment-btn");
    // Nothing to accompany when both hands are being practised — there is
    // no "other hand" left over to play underneath.
    btn.style.display = Store.hand === "both" ? "none" : "";
    const on = Store.accompaniment;
    document.getElementById("accompaniment-state").textContent = on ? "On" : "Off";
    btn.setAttribute("aria-pressed", String(on));
    btn.classList.toggle("on", on);
  }

  async function mount() {
    wireControls();
    syncKeyboardModeButtons();
    syncTempoButtons();
    syncAccompanimentButton();
    document.getElementById("loop-btn").classList.toggle("active", state.loopEnabled);
    document.getElementById("loop-btn").setAttribute("aria-pressed", String(state.loopEnabled));
    syncHandPanels();
    // Preview-only entry (Sections' "Listen to the whole song" button) —
    // a pure listen-along, so Practice has no place here at all. Hidden
    // rather than disabled: a disabled-but-visible button would still
    // invite the "why can't I click this" question this feature exists
    // to avoid in the first place.
    document.getElementById("practice-btn").classList.toggle("hidden", Store.previewOnly);
    // The keyboard-mode switch and song title/subtitle/measure now live
    // in the persistent app shell — only relevant while actually in the
    // Learning view, so hidden the rest of the time.
    document.getElementById("keyboard-mode-switch").classList.remove("hidden");
    document.getElementById("learning-shell-info").classList.remove("hidden");

    // Gameplay hooks on the shared, still-connected BLE instance.
    await PianoBle.ready;
    PianoBle.attach({ onNoteOn: noteOn, onNoteOff: noteOff });

    document.getElementById("learning-back-link").href =
      `#/song/${encodeURIComponent(Store.songId)}`;

    state.song = await Store.loadSong(Store.songId);
    document.getElementById("learning-song-title").textContent = state.song.title;

    // Safety net for landing here directly (deep link, browser back/
    // forward) without passing through Sections' mount(), which is where
    // this normally gets synced from the song's own data.
    const SONG_TO_STORE_KEYBOARD_MODE = { solo: "solo", linked: "duo" };
    if (state.song.keyboardMode) {
      Store.keyboardMode = SONG_TO_STORE_KEYBOARD_MODE[state.song.keyboardMode] || "solo";
    }

    const sectionLabel =
      Store.sectionId === "all"
        ? "Whole song"
        : (state.song.sections.find((s) => s.id === Store.sectionId) || {}).label || "Whole song";
    // Hand isn't repeated here — the mini-hand label right next to the
    // hand illustration already says it, so this would just say the
    // same thing twice.
    document.getElementById("context-subtitle").textContent = sectionLabel;

    document.getElementById("score-display").textContent = "";
    document.getElementById("next-note-display").textContent = "";
    updateFingerGuide(null);
    state.pausedAtMs = 0;

    rebuildKeyboardAndCanvas();

    const canvas = document.getElementById("visualizer");
    state.visualizer = new FallingNotesVisualizer(canvas, state.layout, state.song.notesColor);
    const activeTimeline = toTimeline(getActiveNotes(), currentMsPerBeat());
    state.visualizer.setNotes(activeTimeline, state.song.notesColor);

    if (activeTimeline.length > 0) {
      const last = activeTimeline[activeTimeline.length - 1];
      state.visualizer.setActiveSection(activeTimeline[0].startMs, last.startMs + last.durationMs);
    } else {
      state.visualizer.setActiveSection(null);
    }

    state.visualizer.resize();
    state.visualizer.draw(-state.visualizer.leadTimeMs);

    // Shows the section's total measure count before practice starts.
    updateMeasureCounter(null);

    resizeHandler = () => {
      rebuildKeyboardAndCanvas();
      state.visualizer.layout = state.layout;
      state.visualizer.keyByNote = {};
      for (const k of state.layout.keys) state.visualizer.keyByNote[k.note] = k;
      state.visualizer.resize();
    };
    window.addEventListener("resize", resizeHandler);

    requestWakeLock();
    wakeLockVisibilityHandler = () => {
      if (document.visibilityState === "visible") requestWakeLock();
    };
    document.addEventListener("visibilitychange", wakeLockVisibilityHandler);
  }

  function unmount() {
    stopPractice();
    stopPlayback();
    clearExpectedNoteLed();
    closeScoreModal();
    state.loopEnabled = false;
    document.getElementById("keyboard-mode-switch").classList.add("hidden");
    document.getElementById("learning-shell-info").classList.add("hidden");

    // Detach gameplay only — the BLE connection itself stays up. This is
    // the behaviour the whole SPA conversion was for.
    PianoBle.detach();

    if (resizeHandler) {
      window.removeEventListener("resize", resizeHandler);
      resizeHandler = null;
    }

    if (wakeLockVisibilityHandler) {
      document.removeEventListener("visibilitychange", wakeLockVisibilityHandler);
      wakeLockVisibilityHandler = null;
    }
    if (wakeLock) {
      wakeLock.release().catch(() => {});
      wakeLock = null;
    }
  }

  return { mount, unmount };
})();
