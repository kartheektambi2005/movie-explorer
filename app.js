

const API_KEY = "61e576a4";
const API_URL = `https://www.omdbapi.com/?apikey=${API_KEY}`;


const searchForm = document.getElementById("searchForm");
const searchInput = document.getElementById("searchInput");

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

const searchHistoryContainer =
  document.getElementById("searchHistory");

const tabButtons =
  document.querySelectorAll(".tab-btn");



const FAVORITES_KEY = "movie_favorites";
const WATCHLIST_KEY = "movie_watchlist";
const HISTORY_KEY = "movie_search_history";
const THEME_KEY = "movie_theme";



let currentMovies = [];
let activeTab = "movies";



function getStorage(key) {
  return JSON.parse(localStorage.getItem(key)) || [];
}

function setStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
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



async function searchMovies(title) {
  try {
    hideStates();
    showLoader();

    const response = await fetch(
      `${API_URL}&s=${encodeURIComponent(title)}`
    );

    const data = await response.json();

    hideLoader();

    if (data.Response === "False") {
      moviesGrid.innerHTML = "";
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

    const response = await fetch(
      `${API_URL}&i=${id}&plot=full`
    );

    const movie = await response.json();

    hideLoader();

    modalBody.innerHTML = `
      <img
        src="${movie.Poster}"
        alt="${movie.Title}"
        class="modal-poster"
      >

      <div class="modal-info">

        <h2>${movie.Title}</h2>
        <p><strong>Plot:</strong> ${movie.Plot}</p>

        <p><strong>Genre:</strong> ${movie.Genre}</p>

        <p><strong>Runtime:</strong> ${movie.Runtime}</p>

        <p><strong>Director:</strong> ${movie.Director}</p>

        <p><strong>Actors:</strong> ${movie.Actors}</p>

        <p><strong>IMDb Rating:</strong> ${movie.imdbRating}</p>

        <p><strong>Release Date:</strong> ${movie.Released}</p>

        <p><strong>Awards:</strong> ${movie.Awards}</p>

      </div>
    `;

    openModal();

  } catch (error) {
    hideLoader();
    console.error(error);
  }
}



function renderMovies(movies) {

  moviesGrid.innerHTML = "";

  movies.forEach(movie => {

    const card = document.createElement("article");

    card.className = "movie-card";

    card.innerHTML = `
      <img
        class="movie-poster"
        src="${movie.Poster !== "N/A"
          ? movie.Poster
          : "https://via.placeholder.com/300x450"
        }"
        alt="${movie.Title}"
      >

      <div class="movie-content">

        <h3 class="movie-title">
          ${movie.Title}
        </h3>

        <p class="movie-info">
          Year: ${movie.Year}
        </p>

        <p class="movie-info">
          Type: ${movie.Type}
        </p>

        <p class="movie-info">
          IMDb ID: ${movie.imdbID}
        </p>

        <div class="movie-actions">

          <button
            class="action-btn details-btn"
            data-id="${movie.imdbID}"
          >
            Details
          </button>

          <button
            class="action-btn favorite-btn"
            data-favorite="${movie.imdbID}"
          >
            Favorite
          </button>

          <button
            class="action-btn watchlist-btn"
            data-watch="${movie.imdbID}"
          >
            Watchlist
          </button>

        </div>

      </div>
    `;

    moviesGrid.appendChild(card);
  });
}



function addFavorite(movieId) {

  const favorites =
    getStorage(FAVORITES_KEY);

  const movie =
    currentMovies.find(
      m => m.imdbID === movieId
    );

  if (!movie) return;

  const exists =
    favorites.some(
      m => m.imdbID === movieId
    );

  if (exists) return;

  favorites.push(movie);

  setStorage(
    FAVORITES_KEY,
    favorites
  );

  updateCounts();
}

function renderFavorites() {

  const favorites =
    getStorage(FAVORITES_KEY);

  renderMovies(favorites);
}


function addWatchlist(movieId) {

  const watchlist =
    getStorage(WATCHLIST_KEY);

  const movie =
    currentMovies.find(
      m => m.imdbID === movieId
    );

  if (!movie) return;

  const exists =
    watchlist.some(
      m => m.imdbID === movieId
    );

  if (exists) return;

  watchlist.push(movie);

  setStorage(
    WATCHLIST_KEY,
    watchlist
  );

  updateCounts();
}

function renderWatchlist() {

  const watchlist =
    getStorage(WATCHLIST_KEY);

  renderMovies(watchlist);
}



function updateCounts() {

  favoriteCount.textContent =
    getStorage(FAVORITES_KEY).length;

  watchlistCount.textContent =
    getStorage(WATCHLIST_KEY).length;
}



function saveSearchHistory(query) {

  let history =
    getStorage(HISTORY_KEY);

  history =
    history.filter(
      item => item !== query
    );

  history.unshift(query);

  history = history.slice(0, 8);

  setStorage(
    HISTORY_KEY,
    history
  );

  renderSearchHistory();
}

function renderSearchHistory() {

  const history =
    getStorage(HISTORY_KEY);

  searchHistoryContainer.innerHTML = "";

  history.forEach(item => {

    const btn =
      document.createElement("button");

    btn.className =
      "history-item";

    btn.textContent = item;

    btn.addEventListener(
      "click",
      () => {
        searchInput.value = item;
        searchMovies(item);
      }
    );

    searchHistoryContainer.appendChild(btn);
  });
}



function loadTheme() {

  const theme =
    localStorage.getItem(THEME_KEY);

  if (theme === "dark") {
    document.body.classList.add("dark");
    themeToggle.textContent = "☀️";
  }
}

function toggleTheme() {

  document.body.classList.toggle(
    "dark"
  );

  const dark =
    document.body.classList.contains(
      "dark"
    );

  localStorage.setItem(
    THEME_KEY,
    dark ? "dark" : "light"
  );

  themeToggle.textContent =
    dark ? "☀️" : "🌙";
}



function openModal() {

  movieModal.classList.remove(
    "hidden"
  );

  movieModal.setAttribute(
    "aria-hidden",
    "false"
  );
}

function closeMovieModal() {

  movieModal.classList.add(
    "hidden"
  );

  movieModal.setAttribute(
    "aria-hidden",
    "true"
  );
}



function switchTab(tab) {

  activeTab = tab;

  tabButtons.forEach(btn => {
    btn.classList.remove("active");
  });

  document
    .querySelector(
      `[data-tab="${tab}"]`
    )
    .classList.add("active");

  if (tab === "favorites") {
    renderFavorites();
  }

  else if (tab === "watchlist") {
    renderWatchlist();
  }

  else {
    renderMovies(currentMovies);
  }
}



searchForm.addEventListener(
  "submit",
  e => {

    e.preventDefault();

    const query =
      searchInput.value.trim();

    if (!query) return;

    switchTab("movies");

    searchMovies(query);
  }
);

themeToggle.addEventListener(
  "click",
  toggleTheme
);

closeModal.addEventListener(
  "click",
  closeMovieModal
);

movieModal.addEventListener(
  "click",
  e => {

    if (
      e.target === movieModal
    ) {
      closeMovieModal();
    }
  }
);

document.addEventListener(
  "keydown",
  e => {

    if (
      e.key === "Escape"
    ) {
      closeMovieModal();
    }
  }
);

tabButtons.forEach(btn => {

  btn.addEventListener(
    "click",
    () => {

      switchTab(
        btn.dataset.tab
      );
    }
  );
});

moviesGrid.addEventListener(
  "click",
  e => {

    const detailsId =
      e.target.dataset.id;

    const favoriteId =
      e.target.dataset.favorite;

    const watchId =
      e.target.dataset.watch;

    if (detailsId) {
      getMovieDetails(
        detailsId
      );
    }

    if (favoriteId) {
      addFavorite(
        favoriteId
      );
    }

    if (watchId) {
      addWatchlist(
        watchId
      );
    }
  }
);


function init() {

  loadTheme();

  updateCounts();

  renderSearchHistory();

  searchMovies("Avengers");
}

init();