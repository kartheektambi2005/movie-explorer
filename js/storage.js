import { fromOmdb, MOVIE_FIELDS } from "./api.js";

/** All localStorage access lives here. Nothing in this module throws. */

const KEYS = {
  favorites: "movie_favorites",
  watchlist: "movie_watchlist",
  history: "movie_search_history",
  theme: "movie_theme",
  tab: "movie_active_tab",
};

export const MAX_HISTORY = 5;

/** The two saved movie lists. */
export const LISTS = {
  favorites: { key: KEYS.favorites, label: "Favorites" },
  watchlist: { key: KEYS.watchlist, label: "Watchlist" },
};

// Accepts the current movie shape and the legacy OMDb shape (Title, imdbID...)
// that older versions of the app saved. Anything else is discarded.
function normalizeMovie(item) {
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

// Reads a JSON array. Unavailable storage, invalid JSON or the wrong shape all
// fall back to an empty list (and corrupted data is dropped).
function readArray(key, normalize) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("not an array");

    return parsed.map(normalize).filter(Boolean);
  } catch (error) {
    console.warn(`Ignoring corrupted data for "${key}"`, error);
    remove(key);
    return [];
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (error) {
    console.warn(`Could not save "${key}"`, error);
    return false;
  }
}

function remove(key) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* storage unavailable - nothing to remove */
  }
}

function read(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** @param {"favorites"|"watchlist"} list */
export const getMovies = (list) => readArray(LISTS[list].key, normalizeMovie);

/** @returns {boolean} false when the browser refused the write */
export const saveMovies = (list, movies) => write(LISTS[list].key, JSON.stringify(movies));

export const getHistory = () => readArray(KEYS.history, normalizeString).slice(0, MAX_HISTORY);

export const saveHistory = (queries) => write(KEYS.history, JSON.stringify(queries.slice(0, MAX_HISTORY)));

export const clearHistory = () => remove(KEYS.history);

export const saveTheme = (theme) => write(KEYS.theme, theme);

export const getSavedTab = () => read(KEYS.tab);

export const saveTab = (tab) => write(KEYS.tab, tab);
