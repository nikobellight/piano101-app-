// v1.6
// view-sections.js — SPA version of the old sections.js. Same circles,
// stars, Revision and Continue buttons. Differences:
//
// v1.6: the cumulative revision circle now renders right after the last
// phrase of the passed-in-a-row streak it covers, instead of after the
// entire phrase grid. On a long song (Clair de Lune's 28 phrases), a
// circle tacked on at the very end was easy to miss entirely — nothing
// connected it visually to the 2-3 phrases it actually reviewed. Same
// growth behavior as before (Phrases 1-2, then 1-3, then 1-4...), just
// placed where it's actually next to what it's reviewing.
//
// v1.5: per Nico, the revision system wasn't what he wanted at all —
// removed the adjacent-pair mid-revisions entirely (1+2 as one circle,
// 3+4 as a separate one, and so on) and lowered the cumulative
// revision's threshold from 3 phrases to 2, so IT is now the only
// revision mechanic below "whole song": pass phrases 1-2 and you get
// "Revision — Phrases 1-2"; pass 3 and it grows to "Phrases 1-3"; and
// so on until it's replaced by the existing "Whole song" Revision once
// everything is passed. buildMidRevisionSection() is gone along with it
// — nothing else referenced it.
//
// v1.4: two fixes —
//  1. syncHandTabs()/wireHandTabs() now query "#hand-tabs .hand-tab"
//     instead of the bare ".hand-tab" class, which was also matching
//     Browse's difficulty filter buttons (same class name, different
//     page) since the SPA keeps every view in the DOM at once. Every
//     visit to a song's Sections page was silently clearing whatever
//     difficulty filter was active on Browse.
//  2. mount() now forces Store.hand back to "right" if it's ever
//     anything other than "right" or "both" — a defensive guarantee
//     that a hand tab is always shown selected, per Nico.
//  - scores come from Store.completed instead of being decoded from a URL
//  - the chosen hand is written to Store instead of being put in a query
//  - navigation is a hash route change, not a full page load
//  - mount(songId) can be called many times, so everything is rebuilt
//    from scratch on each entry (stars must reflect a score just earned)
//
// v1.3: adds a "cumulative revision" circle — grows by one phrase every
// time another is passed, always spanning phrase 1 through the last one
// passed IN A ROW (which, thanks to existing section locking, is always
// every phrase passed so far — locking never lets you pass one out of
// order). Sits between the adjacent-pair mid-revisions (still unchanged,
// exactly 2 phrases) and the whole-song Revision (still unchanged,
// requires 100%) — a "review everything I've learned so far" option that
// slots in once there are at least 3 phrases passed in a row, so it
// doesn't just duplicate the pair revision at 2. Hidden again once every
// phrase is passed, since the whole-song Revision covers the exact same
// ground at that point. Same synthetic-section-on-song.sections caching
// technique as buildMidRevisionSection, just spanning a growing prefix
// instead of a fixed pair.
//
// v1.2: two things asked for together, both touching this file —
//   1. Section locking — a phrase is now only clickable once the
//      previous one has been passed (>= PASS_THRESHOLD). Previously
//      every circle was always clickable regardless of progress, which
//      made the "Continue" suggestion the only thing hinting at an
//      intended order.
//   2. Intermediate revision circles — for every pair of CONSECUTIVE
//      phrases that are BOTH passed, an extra "Revision" circle appears
//      combining just those two (in addition to the existing whole-song
//      Revision, which still covers everything). Built as a synthetic
//      section object pushed onto the cached song's own .sections array
//      (Store.loadSong() caches by reference, so Learning's later
//      Store.loadSong(Store.songId) call sees it too) — requires the
//      song to use beatStart/beatEnd (every import_song.py-generated
//      song does; the two original hand-made ones don't, so they simply
//      never grow revision circles, same as before this version).
//   Also: progress is now loaded FROM Supabase (Store.loadProgressFor)
//   instead of always starting empty — see store.js v1.4 and the new
//   js/supabase-client.js.

window.ViewSections = (function () {
  const PASS_THRESHOLD = 80;

  // Song JSON says "linked"; Store/KEYBOARD_RANGES says "duo" — same
  // thing, different vocabulary from two points in the project's history.
  const SONG_TO_STORE_KEYBOARD_MODE = { solo: "solo", linked: "duo" };

  let song = null;
  let wiredTabs = false;

  function starsForPct(pct) {
    if (pct >= 100) return 3;
    if (pct >= PASS_THRESHOLD) return 2;
    if (pct >= 50) return 1;
    return 0;
  }

  function renderStars(pct) {
    const count = starsForPct(pct);
    const el = document.createElement("div");
    el.className = "stars";
    for (let i = 0; i < 3; i++) {
      const star = document.createElement("span");
      star.className = "star" + (i < count ? " filled" : "");
      star.textContent = "★";
      el.appendChild(star);
    }
    return el;
  }

  function buildCircle({ className, title, subtitle, pct, locked, onClick }) {
    const wrap = document.createElement("div");
    wrap.className = "section-circle-wrap";

    const btn = document.createElement("button");
    btn.className = `section-circle ${className || ""} ${locked ? "locked" : ""}`.trim();
    if (locked) {
      const lockIcon = document.createElement("span");
      lockIcon.className = "lock-icon";
      lockIcon.textContent = "🔒";
      btn.appendChild(lockIcon);
    } else {
      btn.textContent = title;
    }
    if (locked) {
      btn.disabled = true;
      btn.title = "Pass the previous phrase first";
    } else {
      btn.addEventListener("click", onClick);
    }
    wrap.appendChild(btn);

    if (subtitle) {
      const label = document.createElement("div");
      label.className = "section-label";
      label.textContent = subtitle;
      wrap.appendChild(label);
    }

    if (pct != null && !locked) wrap.appendChild(renderStars(pct));

    return wrap;
  }

  function goToLearning(sectionId) {
    Store.sectionId = sectionId;
    Store.previewOnly = false;
    Router.go(`#/song/${encodeURIComponent(Store.songId)}/${encodeURIComponent(sectionId)}`);
  }

  function playWholeSongPreview() {
    Store.sectionId = "all";
    Store.previewOnly = true;
    Router.go(`#/song/${encodeURIComponent(Store.songId)}/all`);
  }

  // Spans phrase 1 through the last one passed in a row (realSections is
  // 0-indexed, passedCount is a count — so the last involved phrase is
  // realSections[passedCount - 1]). Caches the synthetic section on
  // song.sections by id (same trick real sections use), so Learning can
  // find it later and re-render()ing mid-session (a score just earned)
  // doesn't grow duplicate entries. Returns null if the first or last
  // involved section lacks beatStart/beatEnd (the two hand-made original
  // songs predate that field) — no revision circle is grown for those
  // rather than risk a broken beat window.
  function buildCumulativeRevisionSection(realSections, passedCount) {
    const first = realSections[0];
    const last = realSections[passedCount - 1];
    if (first.beatStart == null || last.beatEnd == null) return null;
    const id = `cumrev-${first.id}-${last.id}`;
    let existing = song.sections.find((s) => s.id === id);
    if (existing) return existing;
    const synthetic = {
      id,
      label: `Phrases 1-${passedCount}`,
      beatStart: first.beatStart,
      beatEnd: last.beatEnd,
      isSynthetic: true,
    };
    song.sections.push(synthetic);
    return synthetic;
  }

  function render() {
    const grid = document.getElementById("section-grid");
    grid.innerHTML = "";

    // Real phrases first — only these participate in locking and in
    // pairing up for intermediate revisions. song.sections may already
    // contain synthetic midrev-* entries from a previous render() in
    // this same session; keep working from the real ones only.
    const realSections = song.sections.filter((s) => !s.isSynthetic);

    const firstUnpassedIndex = realSections.findIndex((s) => !Store.isPassed(s.id));

    // How many real phrases are passed in a row from the start — always
    // a plain prefix count, since locking already prevents passing one
    // out of order (see `locked` below).
    const passedCount = firstUnpassedIndex === -1 ? realSections.length : firstUnpassedIndex;

    realSections.forEach((sec, i) => {
      const pct = Store.completed[sec.id] || 0;
      const locked = firstUnpassedIndex !== -1 && i > firstUnpassedIndex;
      grid.appendChild(
        buildCircle({
          title: `${sec.noteIndexStart + 1}-${sec.noteIndexEnd + 1}`,
          subtitle: sec.label,
          pct,
          locked,
          onClick: () => goToLearning(sec.id),
        })
      );

      // "Review everything so far" goes RIGHT HERE — immediately after
      // the last phrase of the current passed-in-a-row streak — not
      // after the whole grid. On a long song (Clair de Lune's 28
      // phrases), a circle tacked on at the very end reads as
      // disconnected from the 2-3 phrases it actually covers; sitting
      // right next to them makes the connection obvious. Grows by one
      // phrase each time another is passed: after 1-2, "Phrases 1-2";
      // after 1-2-3, "Phrases 1-3"; and so on until the whole song is
      // covered, at which point the Revision (whole song) circle below
      // takes over instead.
      const isLastOfStreak = i === passedCount - 1;
      if (isLastOfStreak && passedCount >= 2 && firstUnpassedIndex !== -1) {
        const cumulative = buildCumulativeRevisionSection(realSections, passedCount);
        if (cumulative) {
          grid.appendChild(
            buildCircle({
              className: "mid-revision",
              title: "Revision",
              subtitle: cumulative.label,
              pct: null,
              locked: false,
              onClick: () => goToLearning(cumulative.id),
            })
          );
        }
      }
    });

    // "Revision" (whole song) is meant for reviewing what's already been
    // earned, same philosophy as the mid-revision circles above — locked
    // until every real phrase is passed, not available from the start.
    const allPassed = realSections.length > 0 && firstUnpassedIndex === -1;
    grid.appendChild(
      buildCircle({
        className: "revision",
        title: "Revision",
        subtitle: "Whole song",
        pct: null,
        locked: !allPassed,
        onClick: () => goToLearning("all"),
      })
    );

    const nextSection = realSections.find((sec) => (Store.completed[sec.id] || 0) < 100);
    if (nextSection) {
      grid.appendChild(
        buildCircle({
          className: "continue",
          title: "Continue",
          subtitle: nextSection.label,
          pct: null,
          locked: false,
          onClick: () => goToLearning(nextSection.id),
        })
      );
    }
  }

  function syncHandTabs() {
    document.querySelectorAll("#hand-tabs .hand-tab").forEach((t) => {
      t.classList.toggle("active", t.dataset.hand === Store.hand);
    });
  }

  function wireHandTabs() {
    if (wiredTabs) return;
    wiredTabs = true;
    document.querySelectorAll("#hand-tabs .hand-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        Store.hand = tab.dataset.hand;
        syncHandTabs();
      });
    });
  }

  let wiredPlayButton = false;

  function wirePlayWholeSongButton() {
    if (wiredPlayButton) return;
    wiredPlayButton = true;
    document.getElementById("play-whole-song-btn").addEventListener("click", playWholeSongPreview);
  }

  async function mount(songId) {
    Store.songId = songId;

    // Defensive: guarantee "Right" is always selected, even if Store.hand
    // somehow ends up holding anything other than the two valid values —
    // never leave both tabs unhighlighted.
    if (Store.hand !== "right" && Store.hand !== "both") {
      Store.hand = "right";
    }

    wireHandTabs();
    syncHandTabs();
    wirePlayWholeSongButton();

    document.getElementById("sections-song-title").textContent = "Loading…";
    song = await Store.loadSong(songId);
    document.getElementById("sections-song-title").textContent = song.title;

    // Match the app's active keyboard range to what this song actually
    // needs — see v1.1 note above. Falls back to "solo" for any song
    // missing the field (the two original hand-made songs predate it).
    Store.keyboardMode = SONG_TO_STORE_KEYBOARD_MODE[song.keyboardMode] || "solo";
    const badge = document.getElementById("sections-keyboard-badge");
    badge.hidden = song.keyboardMode !== "linked";

    // Real progress for the active profile, from Supabase — replaces
    // whatever Store.completed held from a previous song. Resolves even
    // if Supabase is unreachable (SupabasePiano101 swallows its own
    // errors and returns {}), so this never blocks the page.
    await Store.loadProgressFor(songId);

    render();
  }

  function unmount() {
    // No timers, no audio, no BLE hooks — nothing to stop.
  }

  return { mount, unmount };
})();
