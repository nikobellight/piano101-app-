// v1.1
// supabase-client.js — Cross-session progress persistence (piano101_
// prefixed tables — this project is shared with unrelated apps like
// "alerts"). No SDK: direct fetch() against PostgREST, since the app has
// no build step to pull in @supabase/supabase-js from npm.
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
    // 204 No Content (e.g. a PATCH without Prefer: return=representation)
    if (res.status === 204) return null;
    return res.json();
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

  return { loadProgress, saveProgress, loadAllProgress };
})();
