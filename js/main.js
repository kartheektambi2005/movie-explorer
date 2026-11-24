import { searchMovies, getMovieDetails, queueMovieDetails, isAborted } from "./api.js";
import {
  LISTS,
  MAX_HISTORY,
  getMovies,
  saveMovies,
  getHistory,
  saveHistory,
  clearHistory,
  saveTheme,
  getSavedTab,
  saveTab,
} from "./storage.js";
import { TABS, view, search, detailsCache, failedDetails, mergeMovie, withKnownDetails, findMovie } from "./state.js";
import {
  dom,
  render,
  renderCounts,
  renderHistory,
  renderTheme,
  setActiveTabButton,
  syncActionButtons,
  refreshMeta,
  focusNearCard,
  cardPosition,
  showHint,
  showToast,
  setCardVisibleHandler,
  setModalCloseHandler,
  showModalLoading,
  showModalError,
  showModalMovie,
} from "./ui.js";
import { validateQuery, debounce } from "./utils.js";

const DEFAULT_QUERY = "Avengers"; // shown on first load; not saved to Recent Searches
const SEARCH_DEBOUNCE_MS = 500;

/* ===========================
   SEARCH FLOW (API -> state -> render)
=========================== */

// Loads one page of results. page 1 starts a new search; later pages append.
// Any request still in flight is cancelled so a slow, stale answer can never
// overwrite a newer one.
async function loadResults(query, page, { record = false } = {}) {
  search.controller?.abort();
  const controller = new AbortController();
  search.controller = controller;

  const append = page > 1;
  if (!append) {
    Object.assign(search, { query, page: 0, total: 0, movies: [], message: "" });
  }
  search.status = append ? "ready" : "loading";
  search.loadingMore = append;
  search.retry = null;
  render();

  try {
    const result = await searchMovies(query, { page, signal: controller.signal });

    search.loadingMore = false;

    if (append) {
      const known = new Set(search.movies.map((m) => m.id));
      const fresh = result.movies.filter((m) => !known.has(m.id));
      search.movies = search.movies.concat(fresh.map(withKnownDetails));
      search.page = page;
      // Nothing new came back, so stop offering "Load more".
      search.total = fresh.length ? result.total : search.movies.length;
    } else {
      search.movies = result.movies.map(withKnownDetails);
      search.page = page;
      search.total = result.total;
      search.message = result.message;
    }

    search.status = search.movies.length ? "ready" : "empty";

    if (record && search.movies.length) recordSearch(query);
  } catch (error) {
    if (isAborted(error) || controller !== search.controller) return;

    search.loadingMore = false;
    search.status = "error";
    search.errorMessage = error.message;
    search.retry = () => loadResults(query, page, { record });
    console.error(error);
  }

  render();
}

// Entry point for user-initiated and automatic searches.
// `record` saves the query to Recent Searches (explicit searches only, not typing).
function startSearch(raw, { record = false } = {}) {
  const { value, error } = validateQuery(raw);

  showHint(error);
  if (error) return;

  dom.searchInput.value = value;
  switchTab("movies");

  const sameQuery = value.toLowerCase() === search.query.toLowerCase();
  if (sameQuery && search.status === "ready") {
    // Already showing these results (e.g. the debounced search just finished).
    if (record) recordSearch(value);
    return;
  }

  loadResults(value, 1, { record });
}

function loadMore() {
  if (search.status !== "ready" || search.loadingMore) return;
  loadResults(search.query, search.page + 1);
}

const debouncedSearch = debounce((raw) => {
  const { value, error } = validateQuery(raw);
  if (error) return; // don't nag while the user is still typing
  startSearch(value);
}, SEARCH_DEBOUNCE_MS);

/* ===========================
   RECENT SEARCHES
=========================== */

function pickHistoryItem(query) {
  debouncedSearch.cancel();
  dom.searchInput.value = query;
  startSearch(query, { record: true });
}

function recordSearch(query) {
  const history = getHistory().filter((item) => item.toLowerCase() !== query.toLowerCase());
  history.unshift(query);

  saveHistory(history.slice(0, MAX_HISTORY));
  renderHistory(pickHistoryItem);
}

function clearSearchHistory() {
  clearHistory();
  renderHistory(pickHistoryItem);
  showToast("Recent searches cleared");
  dom.searchInput.focus();
}

/* ===========================
   MOVIE DETAILS (cards + modal share one cache)
=========================== */

// Stores fetched details and propagates them to search results, saved lists and cards.
function applyDetails(details) {
  detailsCache.set(details.id, details);
  failedDetails.delete(details.id);

  search.movies = search.movies.map((m) => (m.id === details.id ? mergeMovie(m, details) : m));

  Object.keys(LISTS).forEach((list) => {
    const movies = getMovies(list);
    if (movies.some((m) => m.id === details.id)) {
      saveMovies(
        list,
        movies.map((m) => (m.id === details.id ? mergeMovie(m, details) : m)),
      );
    }
  });

  refreshMeta(details.id);
}

// The search endpoint has no rating or genre, so cards fetch them when they scroll into view.
function enrichCard(card) {
  const id = card.dataset.id;
  const movie = findMovie(id);
  if (!movie || movie.rating || movie.genre) return;

  queueMovieDetails(id, { isNeeded: () => card.isConnected, isKnown: (key) => detailsCache.get(key) })
    .then((details) => {
      if (details) applyDetails(details);
    })
    .catch((error) => {
      console.warn("Could not load rating/genre", error);
      failedDetails.add(id);
      refreshMeta(id);
    });
}

let detailsController = null;

async function showDetails(id) {
  detailsController?.abort();
  const controller = new AbortController();
  detailsController = controller;

  const cached = detailsCache.get(id);
  if (cached) {
    showModalMovie(cached);
    return;
  }

  showModalLoading();

  try {
    const movie = await getMovieDetails(id, { signal: controller.signal });
    if (controller !== detailsController) return;

    applyDetails(movie);
    showModalMovie(movie);
  } catch (error) {
    if (isAborted(error) || controller !== detailsController) return;
    console.error(error);
    showModalError(error.message, () => showDetails(id));
  }
}

setModalCloseHandler(() => {
  detailsController?.abort();
  detailsController = null;
});

/* ===========================
   FAVORITES / WATCHLIST
=========================== */

function toggleInList(list, id) {
  const movie = findMovie(id);
  if (!movie) return;

  const movies = getMovies(list);
  const index = movies.findIndex((m) => m.id === id);
  const removing = index !== -1;

  if (removing) movies.splice(index, 1);
  else movies.push(movie);

  if (!saveMovies(list, movies)) {
    showToast("Couldn't save: browser storage is unavailable.", { error: true });
    return;
  }

  renderCounts();
  showToast(
    removing ? `Removed "${movie.title}" from ${LISTS[list].label}` : `Added "${movie.title}" to ${LISTS[list].label}`,
  );

  if (removing && view.activeTab === list) {
    // The card disappears from this tab: re-render and keep keyboard focus nearby.
    const position = cardPosition(id);
    render();
    focusNearCard(position);
  } else {
    syncActionButtons(id);
  }
}

/* ===========================
   THEME + TABS
=========================== */

function toggleTheme() {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  saveTheme(next);
  renderTheme(next);
}

function switchTab(tab) {
  view.activeTab = TABS.includes(tab) ? tab : "movies";
  saveTab(view.activeTab);

  setActiveTabButton(view.activeTab);
  render();
}

// Lazily loads the default results the first time the Movies tab is opened.
function ensureMoviesLoaded() {
  if (view.activeTab === "movies" && search.status === "idle") {
    loadResults(DEFAULT_QUERY, 1);
  }
}

/* ===========================
   EVENTS
=========================== */

dom.searchForm.addEventListener("submit", (e) => {
  e.preventDefault();

  debouncedSearch.cancel();
  startSearch(dom.searchInput.value, { record: true });
});

dom.searchInput.addEventListener("input", () => {
  showHint("");
  debouncedSearch(dom.searchInput.value);
});

dom.retryBtn.addEventListener("click", () => search.retry?.());

dom.loadMoreBtn.addEventListener("click", loadMore);

dom.clearHistoryBtn.addEventListener("click", clearSearchHistory);

dom.themeToggle.addEventListener("click", toggleTheme);

dom.tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    switchTab(btn.dataset.tab);
    ensureMoviesLoaded();
  });
});

dom.grid.addEventListener("click", (e) => {
  const button = e.target.closest("button[data-action]");
  if (!button) return;

  const { action, id } = button.dataset;

  if (action === "details") showDetails(id);
  if (action === "favorite") toggleInList("favorites", id);
  if (action === "watchlist") toggleInList("watchlist", id);
});

setCardVisibleHandler(enrichCard);

function init() {
  // The initial theme is applied by a tiny inline script in index.html (no flash);
  // this only syncs the toggle button with it.
  renderTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");

  renderCounts();
  renderHistory(pickHistoryItem);

  switchTab(getSavedTab());
  ensureMoviesLoaded();
}

init();
