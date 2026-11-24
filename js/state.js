import { MOVIE_FIELDS } from "./api.js";
import { getMovies } from "./storage.js";

/** In-memory app state shared by main.js (writes) and ui.js (reads). */

export const TABS = ["movies", "favorites", "watchlist"];
export const PAGE_SIZE = 10; // OMDb returns 10 results per page

export const view = {
  activeTab: "movies",
};

// Everything the Movies tab needs to know about the current search.
export const search = {
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

export const detailsCache = new Map(); // id -> full movie details
export const failedDetails = new Set(); // ids whose rating/genre lookup failed

export const hasMoreResults = () =>
  view.activeTab === "movies" &&
  search.status === "ready" &&
  !search.loadingMore &&
  search.page * PAGE_SIZE < search.total;

// Fills the empty fields of `base` from `extra`; values `base` already has win.
export function mergeMovie(base, extra) {
  return Object.fromEntries(MOVIE_FIELDS.map((field) => [field, base[field] || extra[field] || ""]));
}

export function withKnownDetails(movie) {
  const known = detailsCache.get(movie.id);
  return known ? mergeMovie(movie, known) : movie;
}

export function findMovie(id) {
  const found =
    search.movies.find((m) => m.id === id) ||
    getMovies("favorites").find((m) => m.id === id) ||
    getMovies("watchlist").find((m) => m.id === id);
  return found ? withKnownDetails(found) : null;
}

/** Movies for whatever tab is open. */
export function getVisibleMovies() {
  if (view.activeTab === "favorites" || view.activeTab === "watchlist") return getMovies(view.activeTab);
  return search.movies;
}

/** Which movie ids are in each saved list. */
export function getListMembership() {
  return {
    favorites: new Set(getMovies("favorites").map((m) => m.id)),
    watchlist: new Set(getMovies("watchlist").map((m) => m.id)),
  };
}
