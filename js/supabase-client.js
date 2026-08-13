// v1.3
// supabase-client.js — Cross-session progress persistence (piano101_
// prefixed tables — this project is shared with unrelated apps like
// "alerts"). No SDK: direct fetch() against PostgREST, since the app has
// no build step to pull in @supabase/supabase-js from npm.
//
// v1.3: fixed request() throwing on a 201-with-empty-body response (any
// plain POST) — it only ever handled 204, so every saveSession() insert
// (always a POST) was silently failing its own JSON parse and getting
// swallowed by the caller's try/catch. This is why "Hours practiced" /
// "Daily average" never moved even after RLS + grants were confirmed
// correct — nothing to do with permissions, this was a client bug.
//
// v1.2: adds saveSession() + loadDashboardStats(), replacing the
// Dashboard's old hardcoded DEMO_STATE (hours practiced, daily average,
// songs in progress, recently played) with real numbers. piano101_
// progress never tracked actual TIME spent — only best scores — so
// there was no way to compute "hours practiced" from it even once
// section scoring was wired in. piano101_sessions (new table, one row
// per finished practice attempt) fills that specific gap.
//
// v1.1: adds loadAllProgress(), used by Browse to show a per-song
// progress bar across the whole library in ONE request instead of 64
// (one per song). Synthetic mid-revision rows (section_id starting with
// "midrev-", created by view-sections.js for consecutive passed
// phrases) are excluded from the passed-count — they aren't real
// sections and would make a song's progress exceed its own
// data/songs.json sectionCount.
//
// New-format API keys (sb_publishable_...) go ONLY in the `apikey`
// header — sending them in `Authorization: Bearer` too, like the old
// anon-key convention did, gets the request rejected as an invalid JWT.
//
// Every call is wrapped to fail SILENTLY (console.warn, never throw) —
// if Supabase is unreachable, progress just stays session-only exactly
// like before this file existed. A backend hiccup should never block
// practicing.

const SUPABASE_URL = "https://wqbxylnrgdtcnxlbemdf.supabase.co";
const SUPABASE_KEY = "sb_publishable_T9dDFWDk4lB4p7mjRpkrsg_VPlzbEMK";

window.SupabasePiano101 = (function () {
  async function request(path, options = {}) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      ...options,
      headers: {
        "apikey": SUPABASE_KEY,
        "Content-Type": "application/json",
        ...options.headers,
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Supabase ${res.status}: ${body}`);
    }
    // PostgREST returns an EMPTY body on more than just 204 — a plain
    // POST (no Prefer: return=representation, which nothing here sets)
    // comes back 201 Created with nothing to read. The old `if (status
    // === 204) return null` missed that case entirely: res.json() on an
    // empty 201 body throws a JSON parse error, which every caller's
    // try/catch swallows into a silent console.warn — every single
    // saveSession() insert (always a POST, no PATCH path) was failing
    // this way, which is the real reason the Dashboard never updated.
    const text = await res.text();
    if (!text) return null;
    return JSON.parse(text);
  }

  // Returns { [sectionId]: bestScore } for one profile+song, or {} on
  // any failure (network down, RLS misconfigured, table not created
  // yet) — the app just falls back to session-only progress.
  async function loadProgress(profileId, songId) {
    try {
      const rows = await request(
        `piano101_progress?profile_id=eq.${encodeURIComponent(profileId)}` +
        `&song_id=eq.${encodeURIComponent(songId)}` +
        `&select=section_id,best_score`
      );
      const out = {};
      for (const row of rows) out[row.section_id] = row.best_score;
      return out;
    } catch (err) {
      console.warn("[Piano101] loadProgress failed, staying session-only:", err);
      return {};
    }
  }

  // Upserts the best score for one profile+song+section. Never lowers an
  // existing best score — mirrors Store.recordScore()'s own
  // Math.max(), just persisted.
  async function saveProgress(profileId, songId, sectionId, pct) {
    try {
      const existing = await request(
        `piano101_progress?profile_id=eq.${encodeURIComponent(profileId)}` +
        `&song_id=eq.${encodeURIComponent(songId)}` +
        `&section_id=eq.${encodeURIComponent(sectionId)}` +
        `&select=id,best_score`
      );

      if (existing.length > 0) {
        const row = existing[0];
        if (pct <= row.best_score) return; // not an improvement, nothing to write
        await request(`piano101_progress?id=eq.${row.id}`, {
          method: "PATCH",
          body: JSON.stringify({ best_score: pct, last_played_at: new Date().toISOString() }),
        });
      } else {
        await request("piano101_progress", {
          method: "POST",
          body: JSON.stringify({
            profile_id: profileId,
            song_id: songId,
            section_id: sectionId,
            best_score: pct,
          }),
        });
      }
    } catch (err) {
      console.warn("[Piano101] saveProgress failed, score stays session-only:", err);
    }
  }

  // Returns { [songId]: passedSectionCount } across the WHOLE library for
  // one profile, in a single request — used by Browse so it doesn't have
  // to fetch progress song-by-song (64 requests) just to draw a progress
  // bar. Only counts real sections (best_score >= PASS_THRESHOLD, id not
  // starting with "midrev-"); Browse then divides by each song's
  // data/songs.json `sectionCount` to get a percentage. Returns {} on any
  // failure, same fallback philosophy as loadProgress/saveProgress.
  async function loadAllProgress(profileId) {
    try {
      const rows = await request(
        `piano101_progress?profile_id=eq.${encodeURIComponent(profileId)}` +
        `&best_score=gte.${window.PASS_THRESHOLD}` +
        `&select=song_id,section_id`
      );
      const out = {};
      for (const row of rows) {
        if (row.section_id.startsWith("midrev-")) continue;
        out[row.song_id] = (out[row.song_id] || 0) + 1;
      }
      return out;
    } catch (err) {
      console.warn("[Piano101] loadAllProgress failed, Browse shows no progress:", err);
      return {};
    }
  }

  // Fire-and-forget: logs one finished practice attempt (pass or fail,
  // any tempo — it's real time spent practicing either way) so the
  // Dashboard can later compute real hours/day-average from it. Never
  // awaited by the caller, same philosophy as saveProgress.
  async function saveSession(profileId, songId, sectionId, durationSeconds) {
    try {
      await request("piano101_sessions", {
        method: "POST",
        body: JSON.stringify({
          profile_id: profileId,
          song_id: songId,
          section_id: sectionId,
          duration_seconds: durationSeconds,
        }),
      });
    } catch (err) {
      console.warn("[Piano101] saveSession failed, dashboard stats stay stale:", err);
    }
  }

  // Everything the Dashboard needs for one profile, in 2 parallel
  // requests: total practiced time + daily average (from
  // piano101_sessions), and which songs to list under "Recently played"
  // (from piano101_progress's last_played_at, deduped to one entry per
  // song — PostgREST has no GROUP BY here, so the dedup happens in JS).
  // "Songs in progress" is just the count of distinct songs touched at
  // all, same list. Returns all-zero/empty on any failure, so the
  // Dashboard has something sane to render rather than nothing.
  async function loadDashboardStats(profileId) {
    try {
      const [sessions, progress] = await Promise.all([
        request(`piano101_sessions?profile_id=eq.${encodeURIComponent(profileId)}&select=duration_seconds,played_at`),
        request(`piano101_progress?profile_id=eq.${encodeURIComponent(profileId)}&select=song_id,last_played_at`),
      ]);

      const totalSeconds = sessions.reduce((sum, s) => sum + s.duration_seconds, 0);
      const distinctDays = new Set(sessions.map((s) => (s.played_at || "").slice(0, 10))).size;

      const lastPlayedBySong = {};
      for (const row of progress) {
        const prev = lastPlayedBySong[row.song_id];
        if (!prev || row.last_played_at > prev) {
          lastPlayedBySong[row.song_id] = row.last_played_at;
        }
      }
      const recentSongIds = Object.entries(lastPlayedBySong)
        .sort((a, b) => (a[1] < b[1] ? 1 : -1))
        .map(([songId, lastPlayedAt]) => ({ songId, lastPlayedAt }));

      return {
        hoursPracticed: totalSeconds / 3600,
        avgMinutesPerDay: distinctDays > 0 ? totalSeconds / 60 / distinctDays : 0,
        songsInProgressCount: recentSongIds.length,
        recentSongIds,
      };
    } catch (err) {
      console.warn("[Piano101] loadDashboardStats failed, dashboard shows zeros:", err);
      return { hoursPracticed: 0, avgMinutesPerDay: 0, songsInProgressCount: 0, recentSongIds: [] };
    }
  }

  return { loadProgress, saveProgress, loadAllProgress, saveSession, loadDashboardStats };
})();
