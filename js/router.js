// v1.2
// router.js — Minimal hash router. Shows/hides the four view sections and
// calls mount()/unmount() on the matching view module. No page is ever
// reloaded, which is what keeps the Bluetooth connection alive.
//
// v1.2: a hashchange arriving while a previous navigation was still
// resolving used to be dropped silently — the page would keep showing
// the OLD route while the URL already said the NEW one, only fixable by
// a manual reload. Now queued (pendingRerender) and caught up the
// instant the current navigation finishes.
//
// v1.1: added #/browse (js/view-browse.js) — the dashboard's "Browse"
// link had nowhere real to go before.
//
// Routes:
//   #/                                  -> Dashboard
//   #/browse                            -> Browse (full library)
//   #/song/<songId>                     -> Sections
//   #/song/<songId>/<sectionId>         -> Learning
//
// The hand (right/both) deliberately stays out of the URL: it's a sticky
// preference held in Store, not a place you navigate to.

window.Router = (function () {
  const views = {
    dashboard: { el: null, module: null },
    browse: { el: null, module: null },
    sections: { el: null, module: null },
    learning: { el: null, module: null },
  };

  let currentName = null;
  let navigating = false;
  let pendingRerender = false;

  function parse(hash) {
    const clean = (hash || "").replace(/^#\/?/, "");
    const parts = clean.split("/").filter(Boolean);

    if (parts[0] === "song" && parts[1]) {
      const songId = decodeURIComponent(parts[1]);
      if (parts[2]) {
        return { name: "learning", songId, sectionId: decodeURIComponent(parts[2]) };
      }
      return { name: "sections", songId };
    }
    if (parts[0] === "browse") {
      return { name: "browse" };
    }
    return { name: "dashboard" };
  }

  async function render() {
    if (navigating) {
      // A hash changed while a previous navigation was still resolving
      // (Store.loadSong() fetching, etc.) — dropping it silently used to
      // leave the page showing the OLD route while the URL already said
      // the NEW one, fixable only by a manual reload. Remember it and
      // catch up the instant the current navigation finishes.
      pendingRerender = true;
      return;
    }
    navigating = true;

    try {
      const route = parse(window.location.hash);

      // Leaving a view: let it stop its timers, audio and BLE hooks.
      // Done even when re-entering the SAME view (e.g. Learning -> another
      // section of the same song), so nothing is mounted twice.
      if (currentName) {
        views[currentName].module.unmount();
      }

      Object.entries(views).forEach(([name, v]) => {
        v.el.classList.toggle("active", name === route.name);
      });

      // Mount AFTER the view is visible — the learning view measures the
      // keyboard width and canvas size, which are 0 while display:none.
      if (route.name === "sections") {
        await views.sections.module.mount(route.songId);
      } else if (route.name === "learning") {
        Store.songId = route.songId;
        Store.sectionId = route.sectionId;
        await views.learning.module.mount();
      } else if (route.name === "browse") {
        await views.browse.module.mount();
      } else {
        await views.dashboard.module.mount();
      }

      currentName = route.name;
      window.scrollTo(0, 0);
    } finally {
      navigating = false;
      // window.location.hash is re-read fresh at the top of render(), so
      // this always catches up to whatever the LATEST hash is — even if
      // several changes arrived while we were busy, they collapse into
      // one final render instead of firing once per missed change.
      if (pendingRerender) {
        pendingRerender = false;
        render();
      }
    }
  }

  function go(hash) {
    if (window.location.hash === hash) render();
    else window.location.hash = hash;
  }

  function start() {
    views.dashboard.el = document.getElementById("view-dashboard");
    views.browse.el = document.getElementById("view-browse");
    views.sections.el = document.getElementById("view-sections");
    views.learning.el = document.getElementById("view-learning");

    views.dashboard.module = window.ViewDashboard;
    views.browse.module = window.ViewBrowse;
    views.sections.module = window.ViewSections;
    views.learning.module = window.ViewLearning;

    window.addEventListener("hashchange", render);

    if (!window.location.hash) window.location.hash = "#/";
    else render();
  }

  return { start, go, parse };
})();

document.addEventListener("DOMContentLoaded", () => Router.start());
