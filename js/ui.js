import {
  search,
  view,
  failedDetails,
  withKnownDetails,
  findMovie,
  getVisibleMovies,
  getListMembership,
  hasMoreResults,
} from "./state.js";
import { getHistory, getMovies } from "./storage.js";

/** All DOM access lives here. API data only ever reaches the page through textContent. */

const byId = (id) => document.getElementById(id);

export const dom = {
  app: byId("app"),
  searchForm: byId("searchForm"),
  searchInput: byId("searchInput"),
  searchHint: byId("searchHint"),
  historyWrapper: byId("historyWrapper"),
  historyList: byId("searchHistory"),
  clearHistoryBtn: byId("clearHistoryBtn"),
  favoriteCount: byId("favoriteCount"),
  watchlistCount: byId("watchlistCount"),
  tabButtons: document.querySelectorAll(".tab-btn"),
  summary: byId("resultsSummary"),
  grid: byId("moviesGrid"),
  loader: byId("loader"),
  errorState: byId("errorState"),
  errorMessage: byId("errorMessage"),
  retryBtn: byId("retryBtn"),
  emptyState: byId("emptyState"),
  emptyTitle: byId("emptyTitle"),
  emptyMessage: byId("emptyMessage"),
  loadMoreWrap: byId("loadMoreWrap"),
  loadMoreBtn: byId("loadMoreBtn"),
  modal: byId("movieModal"),
  modalBody: byId("modalBody"),
  closeModal: byId("closeModal"),
  themeToggle: byId("themeToggle"),
  toastRegion: byId("toastRegion"),
};

const FALLBACK_POSTER = "./assets/no-poster.svg";
const TOAST_MS = 3000;
const MAX_TOASTS = 3;

/* ===========================
   SAFE ELEMENT HELPERS
=========================== */

/** Builds an element with textContent only, so API data can never be parsed as HTML. */
export function el(tag, { className, text, attrs } = {}, children = []) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  if (attrs) {
    Object.entries(attrs).forEach(([name, value]) => node.setAttribute(name, value));
  }
  children.forEach((child) => node.append(child));
  return node;
}

export function isHttpUrl(value) {
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

// Poster image that falls back to a local placeholder when OMDb has no poster
// ("N/A") or the image fails to load.
export function createPoster(movie, className) {
  const hasPoster = isHttpUrl(movie.poster);

  const img = el("img", {
    className,
    attrs: {
      src: hasPoster ? movie.poster : FALLBACK_POSTER,
      alt: hasPoster ? `${movie.title} poster` : `No poster available for ${movie.title}`,
      width: "300",
      height: "450",
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

/* ===========================
   SMALL MESSAGES
=========================== */

export function showHint(message) {
  dom.searchHint.textContent = message;
  dom.searchHint.classList.toggle("hidden", !message);
}

export function showToast(message, { error = false } = {}) {
  const toast = el("div", { className: error ? "toast is-error" : "toast", text: message });
  dom.toastRegion.append(toast);

  while (dom.toastRegion.children.length > MAX_TOASTS) dom.toastRegion.firstElementChild.remove();

  setTimeout(() => toast.remove(), TOAST_MS);
}

/* ===========================
   RESULTS (grid + states)
=========================== */

let onCardVisible = () => {};

/** main.js registers what to do when a card scrolls into view (load its rating/genre). */
export function setCardVisibleHandler(handler) {
  onCardVisible = handler;
}

const cardObserver =
  "IntersectionObserver" in window
    ? new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            cardObserver.unobserve(entry.target);
            onCardVisible(entry.target);
          });
        },
        { rootMargin: "200px" },
      )
    : null;

/** Single place that decides what is on screen for the current tab and state. */
export function render() {
  const onMovies = view.activeTab === "movies";
  const movies = getVisibleMovies();

  renderCards(movies);

  const showLoading = onMovies && (search.status === "loading" || search.loadingMore);
  const showError = onMovies && search.status === "error";
  const showEmpty = (onMovies && search.status === "empty") || (!onMovies && movies.length === 0);

  dom.loader.classList.toggle("hidden", !showLoading);
  dom.errorState.classList.toggle("hidden", !showError);
  dom.emptyState.classList.toggle("hidden", !showEmpty);
  dom.loadMoreWrap.classList.toggle("hidden", !hasMoreResults());

  if (showError) dom.errorMessage.textContent = search.errorMessage;
  if (showEmpty) renderEmpty();

  renderSummary(movies.length);
}

function renderSummary(shown) {
  let text = "";

  if (view.activeTab === "movies") {
    if (search.status === "ready" || (search.status === "loading" && search.loadingMore)) {
      text = `Showing ${shown} of ${search.total} results for "${search.query}"`;
    }
  } else if (shown) {
    text = `${shown} ${shown === 1 ? "movie" : "movies"} in your ${view.activeTab}`;
  }

  dom.summary.textContent = text;
  dom.summary.classList.toggle("hidden", !text);
}

function renderEmpty() {
  if (view.activeTab === "favorites") {
    dom.emptyTitle.textContent = "No favorites yet.";
    dom.emptyMessage.textContent = "Press Favorite on a movie to save it here.";
  } else if (view.activeTab === "watchlist") {
    dom.emptyTitle.textContent = "Your watchlist is empty.";
    dom.emptyMessage.textContent = "Press Watchlist on a movie to save it for later.";
  } else {
    dom.emptyTitle.textContent = "No movies found.";
    dom.emptyMessage.textContent =
      search.message || `Nothing matched "${search.query}". Check the spelling or try another title.`;
  }
}

function renderCards(movies) {
  cardObserver?.disconnect();
  dom.grid.replaceChildren();

  const membership = getListMembership();

  movies.forEach((movie) => {
    const shown = withKnownDetails(movie);

    const meta = el("div", { className: "movie-meta", attrs: { "data-id": shown.id } });
    renderMeta(meta, shown.id);

    const card = el("article", { className: "movie-card", attrs: { "data-id": shown.id } }, [
      createPoster(shown, "movie-poster"),
      el("div", { className: "movie-content" }, [
        el("h3", { className: "movie-title", text: shown.title }),
        el("p", { className: "movie-info", text: [shown.year, shown.type].filter(Boolean).join(" · ") }),
        meta,
        el("div", { className: "movie-actions" }, [
          actionButton("details", "Details", shown, membership),
          actionButton("favorite", "Favorite", shown, membership),
          actionButton("watchlist", "Watchlist", shown, membership),
        ]),
      ]),
    ]);

    dom.grid.appendChild(card);

    if (cardObserver) cardObserver.observe(card);
    else onCardVisible(card);
  });
}

function actionButton(action, label, movie, membership) {
  const button = el("button", {
    className: `action-btn ${action}-btn`,
    text: label,
    attrs: { type: "button", "data-action": action, "data-id": movie.id },
  });

  if (action === "details") {
    button.setAttribute("aria-label", `View details for ${movie.title}`);
  } else {
    applyActionState(button, movie, membership);
  }
  return button;
}

// Favorite / Watchlist buttons act as toggles: label and accessible name follow the saved state.
function applyActionState(button, movie, membership) {
  const isFavorite = button.dataset.action === "favorite";
  const listName = isFavorite ? "favorites" : "watchlist";
  const inList = membership[listName].has(movie.id);

  let label = isFavorite ? "Favorite" : "Watchlist";
  if (inList) label = view.activeTab === listName ? "Remove" : isFavorite ? "Favorited" : "Added";

  button.textContent = label;
  button.classList.toggle("is-active", inList);

  // The accessible name starts with the visible text (WCAG "label in name") and adds the movie.
  const name =
    inList && view.activeTab === listName
      ? `Remove ${movie.title} from ${listName}`
      : `${label}: ${inList ? "remove" : "add"} ${movie.title}`;
  button.setAttribute("aria-label", name);
}

/** Refreshes the Favorite/Watchlist buttons of one movie without re-rendering the grid. */
export function syncActionButtons(id) {
  const movie = findMovie(id);
  if (!movie) return;

  const membership = getListMembership();

  dom.grid.querySelectorAll(".movie-card").forEach((card) => {
    if (card.dataset.id !== id) return;
    card.querySelectorAll("button[data-action]").forEach((button) => {
      if (button.dataset.action !== "details") applyActionState(button, movie, membership);
    });
  });
}

// Rating and genre line of a card.
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

/** Updates the rating/genre line of every card showing this movie. */
export function refreshMeta(id) {
  dom.grid.querySelectorAll(".movie-meta").forEach((node) => {
    if (node.dataset.id === id) renderMeta(node, id);
  });
}

/** After a card is removed from a list tab, keep keyboard focus on a nearby control. */
export function focusNearCard(position) {
  const cards = dom.grid.children;
  const next = cards[Math.min(position, cards.length - 1)];
  (next?.querySelector("button") ?? document.querySelector(".tab-btn.active")).focus();
}

export function cardPosition(id) {
  return [...dom.grid.children].findIndex((card) => card.dataset.id === id);
}

/* ===========================
   HEADER / TABS / HISTORY / THEME
=========================== */

export function renderCounts() {
  dom.favoriteCount.textContent = getMovies("favorites").length;
  dom.watchlistCount.textContent = getMovies("watchlist").length;
}

export function setActiveTabButton(tab) {
  dom.tabButtons.forEach((btn) => {
    const active = btn.dataset.tab === tab;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-pressed", String(active));
  });
}

export function renderHistory(onPick) {
  const history = getHistory();

  dom.historyWrapper.classList.toggle("hidden", history.length === 0);
  dom.historyList.replaceChildren();

  history.forEach((query) => {
    const btn = el("button", {
      className: "history-item",
      text: query,
      attrs: { type: "button", "aria-label": `Search again: ${query}` },
    });
    btn.addEventListener("click", () => onPick(query));
    dom.historyList.appendChild(btn);
  });
}

export function renderTheme(theme) {
  const dark = theme === "dark";
  document.documentElement.dataset.theme = theme;
  dom.themeToggle.textContent = dark ? "☀️" : "🌙";
  dom.themeToggle.setAttribute("aria-label", dark ? "Switch to light theme" : "Switch to dark theme");
}

/* ===========================
   DETAILS MODAL (focus trap, Esc, focus restore)
=========================== */

let lastFocused = null;
let onModalClose = () => {};

/** main.js registers cleanup to run when the modal closes (cancel the pending request). */
export function setModalCloseHandler(handler) {
  onModalClose = handler;
}

export const isModalOpen = () => !dom.modal.classList.contains("hidden");

function openModal() {
  if (!isModalOpen()) {
    lastFocused = document.activeElement;
    dom.modal.classList.remove("hidden");
    dom.modal.setAttribute("aria-hidden", "false");
    dom.app.inert = true; // background is unreachable for keyboard and screen readers
    document.body.classList.add("modal-open");
  }
  keepFocusInsideModal();
}

export function closeModal() {
  if (!isModalOpen()) return;

  dom.modal.classList.add("hidden");
  dom.modal.setAttribute("aria-hidden", "true");
  dom.app.inert = false;
  document.body.classList.remove("modal-open");

  onModalClose();

  const target = lastFocused?.isConnected ? lastFocused : document.querySelector(".tab-btn.active");
  lastFocused = null;
  target?.focus();
}

// Content swaps can remove the focused button (e.g. "Try again"); never let focus fall to <body>.
function keepFocusInsideModal() {
  if (!dom.modal.contains(document.activeElement)) dom.closeModal.focus();
}

function modalFocusables() {
  return [...dom.modal.querySelectorAll('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')];
}

dom.modal.addEventListener("keydown", (e) => {
  if (e.key !== "Tab") return;

  const items = modalFocusables();
  const first = items[0];
  const last = items[items.length - 1];

  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && isModalOpen()) closeModal();
});

dom.modal.addEventListener("click", (e) => {
  if (e.target === dom.modal) closeModal();
});

dom.closeModal.addEventListener("click", closeModal);

export function showModalLoading() {
  dom.modalBody.replaceChildren(
    el("div", { className: "modal-status", attrs: { role: "status" } }, [
      el("div", { className: "spinner", attrs: { "aria-hidden": "true" } }),
      el("span", { className: "sr-only", text: "Loading details…" }),
    ]),
  );
  openModal();
}

export function showModalError(message, onRetry) {
  const retry = el("button", { className: "primary-btn", text: "Try again", attrs: { type: "button" } });
  retry.addEventListener("click", onRetry);

  dom.modalBody.replaceChildren(
    el("div", { className: "modal-status", attrs: { role: "alert" } }, [
      el("h2", { text: "Couldn't load details.", attrs: { id: "modalTitle" } }),
      el("p", { text: message }),
      retry,
    ]),
  );
  openModal();
}

function detailRow(label, value, { required = false } = {}) {
  if (!value && !required) return null;

  return el("div", { className: "detail-row" }, [
    el("h3", { text: label }),
    el("p", { text: value || "Not available" }),
  ]);
}

export function showModalMovie(movie) {
  const facts = el("div", { className: "modal-facts" }, [
    el("span", {
      className: "rating-badge",
      text: movie.rating ? `★ ${movie.rating} / 10` : "No rating",
      attrs: { "aria-label": movie.rating ? `IMDb rating ${movie.rating} out of 10` : "No IMDb rating" },
    }),
    el("span", { text: movie.runtime || "Runtime not available" }),
  ]);
  if (movie.released) facts.append(el("span", { text: `Released ${movie.released}` }));

  const genres = el("ul", { className: "genre-list", attrs: { "aria-label": "Genres" } });
  const names = movie.genre ? movie.genre.split(",").map((g) => g.trim()) : ["Genre not available"];
  names.forEach((name) => genres.append(el("li", { text: name })));

  const title = el("h2", { attrs: { id: "modalTitle" } }, [document.createTextNode(movie.title)]);
  if (movie.year) title.append(el("span", { className: "modal-year", text: ` (${movie.year})` }));

  const info = el(
    "div",
    { className: "modal-info" },
    [
      title,
      facts,
      genres,
      detailRow("Plot", movie.plot, { required: true }),
      detailRow("Cast", movie.actors, { required: true }),
      detailRow("Director", movie.director),
      detailRow("Awards", movie.awards),
    ].filter(Boolean),
  );

  if (/^tt\d+$/.test(movie.id)) {
    info.append(externalLink(`https://www.imdb.com/title/${movie.id}/`, "View on IMDb", "imdb-link"));
  }

  dom.modalBody.replaceChildren(createPoster(movie, "modal-poster"), info);
  openModal();
}
