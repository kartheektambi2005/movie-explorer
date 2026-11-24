import { searchMovies, getMovieDetails, isAborted, fromOmdb } from "./js/api.js";

const searchForm = document.getElementById("searchForm");
const searchInput = document.getElementById("searchInput");
const searchHint = document.getElementById("searchHint");

const moviesGrid = document.getElementById("moviesGrid");

const loader = document.getElementById("loader");
const errorState = document.getElementById("errorState");
const errorMessage = document.getElementById("errorMessage");
const retryBtn = document.getElementById("retryBtn");
const emptyState = document.getElementById("emptyState");
const emptyTitle = document.getElementById("emptyTitle");
const emptyMessage = document.getElementById("emptyMessage");
const loadMoreWrap = document.getElementById("loadMoreWrap");
const loadMoreBtn = document.getElementById("loadMoreBtn");

const movieModal = document.getElementById("movieModal");
const modalBody = document.getElementById("modalBody");
const closeModal = document.getElementById("closeModal");

const themeToggle = document.getElementById("themeToggle");

const favoriteCount = document.getElementById("favoriteCount");
const watchlistCount = document.getElementById("watchlistCount");

const searchHistoryContainer = document.getElementById("searchHistory");

const tabButtons = document.querySelectorAll(".tab-btn");

const FAVORITES_KEY = "movie_favorites";
const WATCHLIST_KEY = "movie_watchlist";
const HISTORY_KEY = "movie_search_history";
const THEME_KEY = "movie_theme";

const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 100;
const SEARCH_DEBOUNCE_MS = 500;
const PAGE_SIZE = 10; // OMDb returns 10 results per page
const POSTER_PLACEHOLDER = "https://via.placeholder.com/300x450";

let activeTab = "movies";

// Everything the Movies tab needs to know about the current search.
const search = {
  query: "",
  page: 0,
  total: 0,
  movies: [],
  status: "idle", // idle | loading | ready | empty | error
  loadingMore: false,
  message: "", // reason shown for an empty result
  errorMessage: "",
  controller: null, // AbortController of the in-flight request
  retry: null, // re-runs the request that failed
};

/* ===========================
   SAFE STORAGE
=========================== */

const MOVIE_FIELDS = [
  "id",
  "title",
  "year",
  "type",
  "poster",
  "genre",
  "rating",
  "runtime",
  "plot",
  "actors",
  "director",
  "released",
  "awards",
];

// Accepts the current movie shape and the legacy OMDb shape (Title, imdbID...)
// that older versions of the app saved. Anything else is discarded.
function normalizeStored(item) {
  if (item === null || typeof item !== "object") return null;

  if (typeof item.id === "string" && item.id) {
    return Object.fromEntries(MOVIE_FIELDS.map((field) => [field, typeof item[field] === "string" ? item[field] : ""]));
  }
  if (typeof item.imdbID === "string" && item.imdbID) {
    return fromOmdb(item);
  }
  return null;
}

const normalizeString = (item) => (typeof item === "string" && item ? item : null);

// Reads a JSON array from localStorage. Never throws: unavailable storage,
// invalid JSON or the wrong shape all fall back to an empty list.
function getStorage(key, normalize = normalizeStored) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("not an array");

    return parsed.map(normalize).filter(Boolean);
  } catch (error) {
    console.warn(`Ignoring corrupted data for "${key}"`, error);
    try {
      localStorage.removeItem(key);
    } catch {
      /* storage unavailable - nothing more to do */
    }
    return [];
  }
}

function setStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.warn(`Could not save "${key}"`, error);
    return false;
  }
}

/* ===========================
   SAFE DOM HELPERS
=========================== */

// Builds an element using textContent only, so API data can never be parsed as HTML.
function el(tag, { className, text, attrs } = {}, children = []) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  if (attrs) {
    Object.entries(attrs).forEach(([name, value]) => node.setAttribute(name, value));
  }
  children.forEach((child) => node.append(child));
  return node;
}

// Only allow http(s) poster URLs coming from the API.
function posterUrl(poster) {
  try {
    const url = new URL(poster);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : POSTER_PLACEHOLDER;
  } catch {
    return POSTER_PLACEHOLDER;
  }
}

function debounce(fn, delay) {
  let timer;
  const debounced = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
  debounced.cancel = () => clearTimeout(timer);
  return debounced;
}

function showHint(message) {
  searchHint.textContent = message;
  searchHint.classList.toggle("hidden", !message);
}

/* ===========================
   SEARCH INPUT VALIDATION
=========================== */

// Trims and collapses whitespace, then checks length. Returns { value, error }.
function validateQuery(raw) {
  const value = raw.replace(/\s+/g, " ").trim();

  if (!value) {
    return { value, error: "Type a movie title to search." };
  }
  if (value.length < MIN_QUERY_LENGTH) {
    return { value, error: `Enter at least ${MIN_QUERY_LENGTH} characters.` };
  }
  if (value.length > MAX_QUERY_LENGTH) {
    return { value, error: `Keep it under ${MAX_QUERY_LENGTH} characters.` };
  }
  return { value, error: "" };
}

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
      search.movies = search.movies.concat(fresh);
      search.page = page;
      // Nothing new came back, so stop offering "Load more".
      search.total = fresh.length ? result.total : search.movies.length;
    } else {
      search.movies = result.movies;
      search.page = page;
      search.total = result.total;
      search.message = result.message;
    }

    search.status = search.movies.length ? "ready" : "empty";

    if (record && search.movies.length) saveSearchHistory(query);
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
  if (error) return false;

  searchInput.value = value;
  switchTab("movies");

  const sameQuery = value.toLowerCase() === search.query.toLowerCase();
  if (sameQuery && search.status === "ready") {
    // Already showing these results (e.g. the debounced search just finished).
    if (record) saveSearchHistory(value);
    return true;
  }

  loadResults(value, 1, { record });
  return true;
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
   RENDERING
=========================== */

function getVisibleMovies() {
  if (activeTab === "favorites") return getStorage(FAVORITES_KEY);
  if (activeTab === "watchlist") return getStorage(WATCHLIST_KEY);
  return search.movies;
}

// Single place that decides what is on screen for the current tab and state.
function render() {
  const onMovies = activeTab === "movies";
  const movies = getVisibleMovies();

  renderMovies(movies);

  const showLoading = onMovies && (search.status === "loading" || search.loadingMore);
  const showError = onMovies && search.status === "error";
  const showEmpty = (onMovies && search.status === "empty") || (!onMovies && movies.length === 0);
  const hasMore = onMovies && search.status === "ready" && !search.loadingMore && search.page * PAGE_SIZE < search.total;

  loader.classList.toggle("hidden", !showLoading);
  errorState.classList.toggle("hidden", !showError);
  emptyState.classList.toggle("hidden", !showEmpty);
  loadMoreWrap.classList.toggle("hidden", !hasMore);

  if (showError) {
    errorMessage.textContent = search.errorMessage;
  }
  if (showEmpty) {
    renderEmpty();
  }
}

function renderEmpty() {
  if (activeTab === "favorites") {
    emptyTitle.textContent = "No favorites yet.";
    emptyMessage.textContent = "Press Favorite on a movie to save it here.";
  } else if (activeTab === "watchlist") {
    emptyTitle.textContent = "Your watchlist is empty.";
    emptyMessage.textContent = "Press Watchlist on a movie to save it for later.";
  } else {
    emptyTitle.textContent = "No movies found.";
    emptyMessage.textContent =
      search.message || `Nothing matched "${search.query}". Check the spelling or try another title.`;
  }
}

function renderMovies(movies) {
  moviesGrid.replaceChildren();

  movies.forEach((movie) => {
    const card = el("article", { className: "movie-card" }, [
      el("img", {
        className: "movie-poster",
        attrs: { src: posterUrl(movie.poster), alt: `${movie.title} poster` },
      }),
      el("div", { className: "movie-content" }, [
        el("h3", { className: "movie-title", text: movie.title }),
        el("p", { className: "movie-info", text: `Year: ${movie.year}` }),
        el("p", { className: "movie-info", text: `Type: ${movie.type}` }),
        el("p", { className: "movie-info", text: `IMDb ID: ${movie.id}` }),
        el("div", { className: "movie-actions" }, [
          actionButton("details", "Details", movie.id),
          actionButton("favorite", "Favorite", movie.id),
          actionButton("watchlist", "Watchlist", movie.id),
        ]),
      ]),
    ]);

    moviesGrid.appendChild(card);
  });
}

function actionButton(action, label, id) {
  return el("button", {
    className: `action-btn ${action}-btn`,
    text: label,
    attrs: { type: "button", "data-action": action, "data-id": id },
  });
}

/* ===========================
   FAVORITES / WATCHLIST
=========================== */

function addToList(key, movieId) {
  const list = getStorage(key);

  if (list.some((m) => m.id === movieId)) return;

  const movie = getVisibleMovies().find((m) => m.id === movieId);
  if (!movie) return;

  list.push(movie);

  setStorage(key, list);

  updateCounts();
}

function updateCounts() {
  favoriteCount.textContent = getStorage(FAVORITES_KEY).length;

  watchlistCount.textContent = getStorage(WATCHLIST_KEY).length;
}

/* ===========================
   SEARCH HISTORY
=========================== */

function saveSearchHistory(query) {
  let history = getStorage(HISTORY_KEY, normalizeString);

  history = history.filter((item) => item !== query);

  history.unshift(query);

  history = history.slice(0, 8);

  setStorage(HISTORY_KEY, history);

  renderSearchHistory();
}

function renderSearchHistory() {
  const history = getStorage(HISTORY_KEY, normalizeString);

  searchHistoryContainer.replaceChildren();

  history.forEach((item) => {
    const btn = el("button", {
      className: "history-item",
      text: item,
      attrs: { type: "button" },
    });

    btn.addEventListener("click", () => {
      debouncedSearch.cancel();
      searchInput.value = item;
      startSearch(item, { record: true });
    });

    searchHistoryContainer.appendChild(btn);
  });
}

/* ===========================
   THEME
=========================== */

function loadTheme() {
  let theme = null;
  try {
    theme = localStorage.getItem(THEME_KEY);
  } catch {
    /* storage unavailable - use default theme */
  }

  if (theme === "dark") {
    document.body.classList.add("dark");
    themeToggle.textContent = "☀️";
  }
}

function toggleTheme() {
  document.body.classList.toggle("dark");

  const dark = document.body.classList.contains("dark");

  try {
    localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
  } catch {
    /* storage unavailable - theme just won't persist */
  }

  themeToggle.textContent = dark ? "☀️" : "🌙";
}

/* ===========================
   MODAL
=========================== */

let detailsController = null;

function openModal() {
  movieModal.classList.remove("hidden");

  movieModal.setAttribute("aria-hidden", "false");
}

function closeMovieModal() {
  detailsController?.abort();
  detailsController = null;

  movieModal.classList.add("hidden");

  movieModal.setAttribute("aria-hidden", "true");
}

async function showDetails(id) {
  detailsController?.abort();
  const controller = new AbortController();
  detailsController = controller;

  modalBody.replaceChildren(
    el("div", { className: "modal-status", attrs: { role: "status" } }, [
      el("div", { className: "spinner", attrs: { "aria-hidden": "true" } }),
      el("span", { className: "sr-only", text: "Loading details…" }),
    ])
  );
  openModal();

  try {
    const movie = await getMovieDetails(id, { signal: controller.signal });
    if (controller !== detailsController) return;

    modalBody.replaceChildren(
      el("img", {
        className: "modal-poster",
        attrs: { src: posterUrl(movie.poster), alt: `${movie.title} poster` },
      }),
      el("div", { className: "modal-info" }, [
        el("h2", { text: movie.title }),
        detailRow("Plot", movie.plot),
        detailRow("Genre", movie.genre),
        detailRow("Runtime", movie.runtime),
        detailRow("Director", movie.director),
        detailRow("Actors", movie.actors),
        detailRow("IMDb Rating", movie.rating),
        detailRow("Release Date", movie.released),
        detailRow("Awards", movie.awards),
      ])
    );
  } catch (error) {
    if (isAborted(error) || controller !== detailsController) return;
    console.error(error);

    const retry = el("button", {
      className: "primary-btn",
      text: "Try again",
      attrs: { type: "button" },
    });
    retry.addEventListener("click", () => showDetails(id));

    modalBody.replaceChildren(
      el("div", { className: "modal-status", attrs: { role: "alert" } }, [
        el("h2", { text: "Couldn't load details." }),
        el("p", { text: error.message }),
        retry,
      ])
    );
  }
}

function detailRow(label, value) {
  return el("p", {}, [el("strong", { text: `${label}: ` }), document.createTextNode(value || "Not available")]);
}

/* ===========================
   TABS
=========================== */

function switchTab(tab) {
  activeTab = tab;

  tabButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  });

  render();
}

/* ===========================
   EVENTS
=========================== */

searchForm.addEventListener("submit", (e) => {
  e.preventDefault();

  debouncedSearch.cancel();
  startSearch(searchInput.value, { record: true });
});

searchInput.addEventListener("input", () => {
  showHint("");
  debouncedSearch(searchInput.value);
});

retryBtn.addEventListener("click", () => search.retry?.());

loadMoreBtn.addEventListener("click", loadMore);

themeToggle.addEventListener("click", toggleTheme);

closeModal.addEventListener("click", closeMovieModal);

movieModal.addEventListener("click", (e) => {
  if (e.target === movieModal) {
    closeMovieModal();
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    closeMovieModal();
  }
});

tabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    switchTab(btn.dataset.tab);
  });
});

moviesGrid.addEventListener("click", (e) => {
  const button = e.target.closest("button[data-action]");
  if (!button) return;

  const { action, id } = button.dataset;

  if (action === "details") showDetails(id);
  if (action === "favorite") addToList(FAVORITES_KEY, id);
  if (action === "watchlist") addToList(WATCHLIST_KEY, id);
});

function init() {
  loadTheme();

  updateCounts();

  renderSearchHistory();

  loadResults("Avengers", 1, { record: true });
}

init();
