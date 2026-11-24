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

const historyWrapper = document.getElementById("historyWrapper");
const searchHistoryContainer = document.getElementById("searchHistory");
const clearHistoryBtn = document.getElementById("clearHistoryBtn");

const toastRegion = document.getElementById("toastRegion");

const tabButtons = document.querySelectorAll(".tab-btn");

const FAVORITES_KEY = "movie_favorites";
const WATCHLIST_KEY = "movie_watchlist";
const HISTORY_KEY = "movie_search_history";
const THEME_KEY = "movie_theme";
const TAB_KEY = "movie_active_tab";

const TABS = ["movies", "favorites", "watchlist"];
const LIST_LABELS = { [FAVORITES_KEY]: "Favorites", [WATCHLIST_KEY]: "Watchlist" };

const DEFAULT_QUERY = "Avengers"; // shown on first load; not saved to Recent Searches
const MIN_QUERY_LENGTH = 2;
const MAX_QUERY_LENGTH = 100;
const SEARCH_DEBOUNCE_MS = 500;
const PAGE_SIZE = 10; // OMDb returns 10 results per page
const MAX_HISTORY = 5;
const TOAST_MS = 3000;
const DETAIL_CONCURRENCY = 3;
const FALLBACK_POSTER = "./assets/no-poster.svg";

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

function getSetting(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function setSetting(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable - the setting just won't persist */
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

function isHttpUrl(value) {
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

// Poster image that falls back to a local placeholder when OMDb has no poster
// ("N/A") or the image fails to load.
function createPoster(movie, className) {
  const hasPoster = isHttpUrl(movie.poster);

  const img = el("img", {
    className,
    attrs: {
      src: hasPoster ? movie.poster : FALLBACK_POSTER,
      alt: hasPoster ? `${movie.title} poster` : `No poster available for ${movie.title}`,
      loading: "lazy",
    },
  });

  img.addEventListener("error", () => {
    if (img.getAttribute("src") === FALLBACK_POSTER) return;
    img.setAttribute("src", FALLBACK_POSTER);
    img.alt = `No poster available for ${movie.title}`;
  });

  return img;
}

function externalLink(href, text, className) {
  return el("a", {
    className,
    text,
    attrs: { href, target: "_blank", rel: "noopener noreferrer" },
  });
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

function showToast(message, { error = false } = {}) {
  const toast = el("div", { className: error ? "toast is-error" : "toast", text: message });
  toastRegion.append(toast);

  // Keep at most three on screen.
  while (toastRegion.children.length > 3) toastRegion.firstElementChild.remove();

  setTimeout(() => toast.remove(), TOAST_MS);
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
   MOVIE DETAILS (cards + modal share one cache)
=========================== */

const detailsCache = new Map(); // id -> full movie details
const failedDetails = new Set(); // ids whose rating/genre lookup failed
const detailQueue = [];
let activeDetailRequests = 0;

// Fills the empty fields of `base` from `extra`; values `base` already has win.
function mergeMovie(base, extra) {
  return Object.fromEntries(MOVIE_FIELDS.map((field) => [field, base[field] || extra[field] || ""]));
}

function withKnownDetails(movie) {
  const known = detailsCache.get(movie.id);
  return known ? mergeMovie(movie, known) : movie;
}

function findMovie(id) {
  const found =
    search.movies.find((m) => m.id === id) ||
    getStorage(FAVORITES_KEY).find((m) => m.id === id) ||
    getStorage(WATCHLIST_KEY).find((m) => m.id === id);
  return found ? withKnownDetails(found) : null;
}

// The search endpoint has no rating or genre, so cards fetch them on demand.
// Requests are queued (a few at a time) and skipped if the card is gone.
function queueDetails(id, isNeeded) {
  return new Promise((resolve, reject) => {
    detailQueue.push({ id, isNeeded, resolve, reject });
    pumpDetailQueue();
  });
}

function pumpDetailQueue() {
  while (activeDetailRequests < DETAIL_CONCURRENCY && detailQueue.length) {
    const job = detailQueue.shift();

    if (detailsCache.has(job.id)) {
      job.resolve(detailsCache.get(job.id));
      continue;
    }
    if (!job.isNeeded()) {
      job.resolve(null);
      continue;
    }

    activeDetailRequests++;
    getMovieDetails(job.id)
      .then(job.resolve, job.reject)
      .finally(() => {
        activeDetailRequests--;
        pumpDetailQueue();
      });
  }
}

// Stores fetched details and propagates them to search results, saved lists and cards.
function applyDetails(details) {
  detailsCache.set(details.id, details);
  failedDetails.delete(details.id);

  search.movies = search.movies.map((m) => (m.id === details.id ? mergeMovie(m, details) : m));

  [FAVORITES_KEY, WATCHLIST_KEY].forEach((key) => {
    const list = getStorage(key);
    if (list.some((m) => m.id === details.id)) {
      setStorage(
        key,
        list.map((m) => (m.id === details.id ? mergeMovie(m, details) : m))
      );
    }
  });

  document.querySelectorAll(".movie-meta").forEach((node) => {
    if (node.dataset.id === details.id) renderMeta(node, details.id);
  });
}

const cardObserver =
  "IntersectionObserver" in window
    ? new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            cardObserver.unobserve(entry.target);
            enrichCard(entry.target);
          });
        },
        { rootMargin: "200px" }
      )
    : null;

function enrichCard(card) {
  const id = card.dataset.id;
  const movie = findMovie(id);
  if (!movie || movie.rating || movie.genre) return;

  queueDetails(id, () => card.isConnected)
    .then((details) => {
      if (details) applyDetails(details);
    })
    .catch((error) => {
      console.warn("Could not load rating/genre", error);
      failedDetails.add(id);
      document.querySelectorAll(".movie-meta").forEach((node) => {
        if (node.dataset.id === id) renderMeta(node, id);
      });
    });
}

// Rating and genre line on a card.
function renderMeta(node, id) {
  const movie = findMovie(id);
  node.replaceChildren();
  node.classList.remove("is-loading");

  if (movie && (movie.rating || movie.genre)) {
    if (movie.rating) node.append(el("span", { className: "movie-rating", text: `★ ${movie.rating}` }));
    if (movie.genre) node.append(el("span", { className: "movie-genre", text: movie.genre }));
  } else if (failedDetails.has(id)) {
    node.textContent = "Rating and genre unavailable";
  } else {
    node.classList.add("is-loading");
    node.textContent = "Loading rating…";
  }
}

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
  cardObserver?.disconnect();
  moviesGrid.replaceChildren();

  const state = getListState();

  movies.forEach((movie) => {
    const shown = withKnownDetails(movie);

    const meta = el("div", { className: "movie-meta", attrs: { "data-id": shown.id } });
    renderMeta(meta, shown.id);

    const card = el("article", { className: "movie-card", attrs: { "data-id": shown.id } }, [
      createPoster(shown, "movie-poster"),
      el("div", { className: "movie-content" }, [
        el("h3", { className: "movie-title", text: shown.title }),
        el("p", {
          className: "movie-info",
          text: [shown.year, shown.type].filter(Boolean).join(" · "),
        }),
        meta,
        el("div", { className: "movie-actions" }, [
          actionButton("details", "Details", shown, state),
          actionButton("favorite", "Favorite", shown, state),
          actionButton("watchlist", "Watchlist", shown, state),
        ]),
      ]),
    ]);

    moviesGrid.appendChild(card);

    if (cardObserver) cardObserver.observe(card);
    else enrichCard(card);
  });
}

function actionButton(action, label, movie, state) {
  const button = el("button", {
    className: `action-btn ${action}-btn`,
    text: label,
    attrs: { type: "button", "data-action": action, "data-id": movie.id },
  });

  if (action === "details") {
    button.setAttribute("aria-label", `View details for ${movie.title}`);
  } else {
    applyActionState(button, movie, state);
  }
  return button;
}

/* ===========================
   FAVORITES / WATCHLIST
=========================== */

function getListState() {
  return {
    favorites: new Set(getStorage(FAVORITES_KEY).map((m) => m.id)),
    watchlist: new Set(getStorage(WATCHLIST_KEY).map((m) => m.id)),
  };
}

// Favorite / Watchlist buttons act as toggles: label and accessible name follow the saved state.
function applyActionState(button, movie, state) {
  const isFavorite = button.dataset.action === "favorite";
  const listName = isFavorite ? "favorites" : "watchlist";
  const inList = state[listName].has(movie.id);
  const onThisTab = activeTab === listName;

  let label = isFavorite ? "Favorite" : "Watchlist";
  if (inList) label = onThisTab ? "Remove" : isFavorite ? "Favorited" : "Added";

  button.textContent = label;
  button.classList.toggle("is-active", inList);
  button.setAttribute("aria-label", `${inList ? "Remove" : "Add"} ${movie.title} ${inList ? "from" : "to"} ${listName}`);
}

function syncActionButtons(id) {
  const state = getListState();
  const movie = findMovie(id);
  if (!movie) return;

  document.querySelectorAll(".movie-card").forEach((card) => {
    if (card.dataset.id !== id) return;
    card.querySelectorAll("button[data-action]").forEach((button) => {
      if (button.dataset.action !== "details") applyActionState(button, movie, state);
    });
  });
}

function toggleInList(key, id) {
  const list = getStorage(key);
  const index = list.findIndex((m) => m.id === id);
  const label = LIST_LABELS[key];

  const movie = findMovie(id);
  if (!movie) return;

  const removing = index !== -1;
  if (removing) list.splice(index, 1);
  else list.push(movie);

  if (!setStorage(key, list)) {
    showToast("Couldn't save: browser storage is unavailable.", { error: true });
    return;
  }

  updateCounts();
  showToast(removing ? `Removed "${movie.title}" from ${label}` : `Added "${movie.title}" to ${label}`);

  const tabKey = activeTab === "favorites" ? FAVORITES_KEY : activeTab === "watchlist" ? WATCHLIST_KEY : null;

  if (removing && tabKey === key) {
    // The card disappears from this tab: re-render and keep keyboard focus nearby.
    const position = [...moviesGrid.children].findIndex((card) => card.dataset.id === id);
    render();
    const next = moviesGrid.children[Math.min(position, moviesGrid.children.length - 1)];
    (next?.querySelector("button") ?? document.querySelector(".tab-btn.active")).focus();
  } else {
    syncActionButtons(id);
  }
}

function updateCounts() {
  favoriteCount.textContent = getStorage(FAVORITES_KEY).length;

  watchlistCount.textContent = getStorage(WATCHLIST_KEY).length;
}

/* ===========================
   SEARCH HISTORY
=========================== */

function loadHistory() {
  return getStorage(HISTORY_KEY, normalizeString).slice(0, MAX_HISTORY);
}

function saveSearchHistory(query) {
  const history = loadHistory().filter((item) => item.toLowerCase() !== query.toLowerCase());

  history.unshift(query);

  setStorage(HISTORY_KEY, history.slice(0, MAX_HISTORY));

  renderSearchHistory();
}

function renderSearchHistory() {
  const history = loadHistory();

  historyWrapper.classList.toggle("hidden", history.length === 0);
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

function clearSearchHistory() {
  try {
    localStorage.removeItem(HISTORY_KEY);
  } catch {
    /* storage unavailable - nothing to clear */
  }
  renderSearchHistory();
  showToast("Recent searches cleared");
  searchInput.focus();
}

/* ===========================
   THEME
=========================== */

function loadTheme() {
  const saved = getSetting(THEME_KEY);
  const prefersDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches;

  if (saved === "dark" || (saved === null && prefersDark)) {
    document.body.classList.add("dark");
    themeToggle.textContent = "☀️";
  }
}

function toggleTheme() {
  document.body.classList.toggle("dark");

  const dark = document.body.classList.contains("dark");

  setSetting(THEME_KEY, dark ? "dark" : "light");

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

  const cached = detailsCache.get(id);
  if (cached) {
    renderModalMovie(cached);
    openModal();
    return;
  }

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

    applyDetails(movie);
    renderModalMovie(movie);
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
        el("h2", { text: "Couldn't load details.", attrs: { id: "modalTitle" } }),
        el("p", { text: error.message }),
        retry,
      ])
    );
  }
}

function detailRow(label, value, { required = false } = {}) {
  if (!value && !required) return null;

  return el("div", { className: "detail-row" }, [
    el("h3", { text: label }),
    el("p", { text: value || "Not available" }),
  ]);
}

function renderModalMovie(movie) {
  const facts = el("div", { className: "modal-facts" });
  facts.append(
    el("span", {
      className: "rating-badge",
      text: movie.rating ? `★ ${movie.rating} / 10` : "No rating",
      attrs: { "aria-label": movie.rating ? `IMDb rating ${movie.rating} out of 10` : "No IMDb rating" },
    }),
    el("span", { text: movie.runtime || "Runtime not available" })
  );
  if (movie.released) facts.append(el("span", { text: `Released ${movie.released}` }));

  const genres = el("ul", { className: "genre-list", attrs: { "aria-label": "Genres" } });
  const genreNames = movie.genre ? movie.genre.split(",").map((g) => g.trim()) : [];
  genreNames.forEach((name) => genres.append(el("li", { text: name })));
  if (!genreNames.length) genres.append(el("li", { text: "Genre not available" }));

  const info = el("div", { className: "modal-info" }, [
    el("h2", { attrs: { id: "modalTitle" } }, [
      document.createTextNode(movie.title),
      movie.year ? el("span", { className: "modal-year", text: ` (${movie.year})` }) : "",
    ]),
    facts,
    genres,
    detailRow("Plot", movie.plot, { required: true }),
    detailRow("Cast", movie.actors, { required: true }),
    detailRow("Director", movie.director),
    detailRow("Awards", movie.awards),
  ].filter(Boolean));

  if (/^tt\d+$/.test(movie.id)) {
    info.append(externalLink(`https://www.imdb.com/title/${movie.id}/`, "View on IMDb", "imdb-link"));
  }

  modalBody.replaceChildren(createPoster(movie, "modal-poster"), info);
}

/* ===========================
   TABS
=========================== */

function switchTab(tab) {
  if (!TABS.includes(tab)) tab = "movies";
  activeTab = tab;
  setSetting(TAB_KEY, tab);

  tabButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  });

  render();
}

// Lazily loads the default results the first time the Movies tab is opened.
function ensureMoviesLoaded() {
  if (activeTab === "movies" && search.status === "idle") {
    loadResults(DEFAULT_QUERY, 1);
  }
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

clearHistoryBtn.addEventListener("click", clearSearchHistory);

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
    ensureMoviesLoaded();
  });
});

moviesGrid.addEventListener("click", (e) => {
  const button = e.target.closest("button[data-action]");
  if (!button) return;

  const { action, id } = button.dataset;

  if (action === "details") showDetails(id);
  if (action === "favorite") toggleInList(FAVORITES_KEY, id);
  if (action === "watchlist") toggleInList(WATCHLIST_KEY, id);
});

function init() {
  loadTheme();

  updateCounts();

  renderSearchHistory();

  switchTab(getSetting(TAB_KEY));

  ensureMoviesLoaded();
}

init();
