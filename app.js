import { OMDB_API_KEY, OMDB_BASE_URL } from "./js/config.js";

const API_URL = `${OMDB_BASE_URL}?apikey=${OMDB_API_KEY}`;

const searchForm = document.getElementById("searchForm");
const searchInput = document.getElementById("searchInput");
const searchHint = document.getElementById("searchHint");

const moviesGrid = document.getElementById("moviesGrid");

const loader = document.getElementById("loader");
const errorState = document.getElementById("errorState");
const emptyState = document.getElementById("emptyState");

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
const POSTER_PLACEHOLDER = "https://via.placeholder.com/300x450";

let currentMovies = [];
let activeTab = "movies";

/* ===========================
   SAFE STORAGE
=========================== */

function isMovie(item) {
  return (
    item !== null &&
    typeof item === "object" &&
    typeof item.imdbID === "string" &&
    typeof item.Title === "string"
  );
}

// Reads a JSON array from localStorage. Never throws: unavailable storage,
// invalid JSON or the wrong shape all fall back to an empty list.
function getStorage(key, isValidItem = isMovie) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("not an array");

    return parsed.filter(isValidItem);
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

const isString = (item) => typeof item === "string";

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

// API values arrive as "N/A" when missing.
function clean(value) {
  return value && value !== "N/A" ? String(value) : "";
}

// Only allow http(s) poster URLs coming from the API.
function posterUrl(poster) {
  try {
    const url = new URL(clean(poster));
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : POSTER_PLACEHOLDER;
  } catch {
    return POSTER_PLACEHOLDER;
  }
}

/* ===========================
   UI HELPERS
=========================== */

function showLoader() {
  loader.classList.remove("hidden");
}

function hideLoader() {
  loader.classList.add("hidden");
}

function hideStates() {
  errorState.classList.add("hidden");
  emptyState.classList.add("hidden");
}

function showError() {
  errorState.classList.remove("hidden");
}

function showEmpty() {
  emptyState.classList.remove("hidden");
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
   API
=========================== */

async function searchMovies(title) {
  try {
    hideStates();
    showLoader();

    const response = await fetch(`${API_URL}&s=${encodeURIComponent(title)}`);

    const data = await response.json();

    hideLoader();

    if (data.Response === "False" || !Array.isArray(data.Search)) {
      currentMovies = [];
      moviesGrid.replaceChildren();
      showEmpty();
      return;
    }

    currentMovies = data.Search;

    renderMovies(currentMovies);

    saveSearchHistory(title);
  } catch (error) {
    hideLoader();
    showError();
    console.error(error);
  }
}

async function getMovieDetails(id) {
  try {
    showLoader();

    const response = await fetch(`${API_URL}&i=${encodeURIComponent(id)}&plot=full`);

    const movie = await response.json();

    hideLoader();

    if (movie.Response === "False") {
      throw new Error(movie.Error || "Movie not found");
    }

    modalBody.replaceChildren(
      el("img", {
        className: "modal-poster",
        attrs: { src: posterUrl(movie.Poster), alt: `${clean(movie.Title)} poster` },
      }),
      el("div", { className: "modal-info" }, [
        el("h2", { text: clean(movie.Title) }),
        detailRow("Plot", movie.Plot),
        detailRow("Genre", movie.Genre),
        detailRow("Runtime", movie.Runtime),
        detailRow("Director", movie.Director),
        detailRow("Actors", movie.Actors),
        detailRow("IMDb Rating", movie.imdbRating),
        detailRow("Release Date", movie.Released),
        detailRow("Awards", movie.Awards),
      ])
    );

    openModal();
  } catch (error) {
    hideLoader();
    console.error(error);
  }
}

function detailRow(label, value) {
  return el("p", {}, [el("strong", { text: `${label}: ` }), document.createTextNode(clean(value) || "Not available")]);
}

/* ===========================
   RENDERING
=========================== */

function renderMovies(movies) {
  moviesGrid.replaceChildren();

  movies.forEach((movie) => {
    const card = el("article", { className: "movie-card" }, [
      el("img", {
        className: "movie-poster",
        attrs: { src: posterUrl(movie.Poster), alt: `${clean(movie.Title)} poster` },
      }),
      el("div", { className: "movie-content" }, [
        el("h3", { className: "movie-title", text: clean(movie.Title) }),
        el("p", { className: "movie-info", text: `Year: ${clean(movie.Year)}` }),
        el("p", { className: "movie-info", text: `Type: ${clean(movie.Type)}` }),
        el("p", { className: "movie-info", text: `IMDb ID: ${clean(movie.imdbID)}` }),
        el("div", { className: "movie-actions" }, [
          el("button", {
            className: "action-btn details-btn",
            text: "Details",
            attrs: { type: "button", "data-id": movie.imdbID },
          }),
          el("button", {
            className: "action-btn favorite-btn",
            text: "Favorite",
            attrs: { type: "button", "data-favorite": movie.imdbID },
          }),
          el("button", {
            className: "action-btn watchlist-btn",
            text: "Watchlist",
            attrs: { type: "button", "data-watch": movie.imdbID },
          }),
        ]),
      ]),
    ]);

    moviesGrid.appendChild(card);
  });
}

/* ===========================
   FAVORITES / WATCHLIST
=========================== */

function addFavorite(movieId) {
  const favorites = getStorage(FAVORITES_KEY);

  const movie = currentMovies.find((m) => m.imdbID === movieId);

  if (!movie) return;

  if (favorites.some((m) => m.imdbID === movieId)) return;

  favorites.push(movie);

  setStorage(FAVORITES_KEY, favorites);

  updateCounts();
}

function renderFavorites() {
  renderMovies(getStorage(FAVORITES_KEY));
}

function addWatchlist(movieId) {
  const watchlist = getStorage(WATCHLIST_KEY);

  const movie = currentMovies.find((m) => m.imdbID === movieId);

  if (!movie) return;

  if (watchlist.some((m) => m.imdbID === movieId)) return;

  watchlist.push(movie);

  setStorage(WATCHLIST_KEY, watchlist);

  updateCounts();
}

function renderWatchlist() {
  renderMovies(getStorage(WATCHLIST_KEY));
}

function updateCounts() {
  favoriteCount.textContent = getStorage(FAVORITES_KEY).length;

  watchlistCount.textContent = getStorage(WATCHLIST_KEY).length;
}

/* ===========================
   SEARCH HISTORY
=========================== */

function saveSearchHistory(query) {
  let history = getStorage(HISTORY_KEY, isString);

  history = history.filter((item) => item !== query);

  history.unshift(query);

  history = history.slice(0, 8);

  setStorage(HISTORY_KEY, history);

  renderSearchHistory();
}

function renderSearchHistory() {
  const history = getStorage(HISTORY_KEY, isString);

  searchHistoryContainer.replaceChildren();

  history.forEach((item) => {
    const btn = el("button", {
      className: "history-item",
      text: item,
      attrs: { type: "button" },
    });

    btn.addEventListener("click", () => {
      searchInput.value = item;
      runSearch(item);
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

function openModal() {
  movieModal.classList.remove("hidden");

  movieModal.setAttribute("aria-hidden", "false");
}

function closeMovieModal() {
  movieModal.classList.add("hidden");

  movieModal.setAttribute("aria-hidden", "true");
}

/* ===========================
   TABS
=========================== */

function switchTab(tab) {
  activeTab = tab;

  tabButtons.forEach((btn) => {
    btn.classList.remove("active");
  });

  document.querySelector(`[data-tab="${tab}"]`).classList.add("active");

  if (tab === "favorites") {
    renderFavorites();
  } else if (tab === "watchlist") {
    renderWatchlist();
  } else {
    renderMovies(currentMovies);
  }
}

/* ===========================
   EVENTS
=========================== */

// Validates the raw text, shows a hint when invalid, otherwise searches.
function runSearch(raw) {
  const { value, error } = validateQuery(raw);

  showHint(error);
  if (error) return;

  searchInput.value = value;
  switchTab("movies");
  searchMovies(value);
}

searchForm.addEventListener("submit", (e) => {
  e.preventDefault();

  runSearch(searchInput.value);
});

searchInput.addEventListener("input", () => showHint(""));

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
  const detailsId = e.target.dataset.id;

  const favoriteId = e.target.dataset.favorite;

  const watchId = e.target.dataset.watch;

  if (detailsId) {
    getMovieDetails(detailsId);
  }

  if (favoriteId) {
    addFavorite(favoriteId);
  }

  if (watchId) {
    addWatchlist(watchId);
  }
});

function init() {
  loadTheme();

  updateCounts();

  renderSearchHistory();

  searchMovies("Avengers");
}

init();
