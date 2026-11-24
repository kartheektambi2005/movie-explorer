import { OMDB_API_KEY, OMDB_BASE_URL } from "./config.js";

export const REQUEST_TIMEOUT_MS = 10000;

/**
 * Error thrown by this module. `kind` tells the UI what happened:
 *   "aborted" - the caller cancelled (stale request); the UI should ignore it
 *   "timeout" - no answer within REQUEST_TIMEOUT_MS
 *   "network" - fetch failed (offline, DNS, CORS...)
 *   "http"    - non-2xx status or an unreadable response
 *   "api"     - OMDb answered with an error (bad key, daily limit...)
 */
export class ApiError extends Error {
  constructor(message, kind, cause) {
    super(message);
    this.name = "ApiError";
    this.kind = kind;
    this.cause = cause;
  }
}

export const isAborted = (error) => error instanceof ApiError && error.kind === "aborted";

/** Fields of the app's movie shape. Missing values are empty strings. */
export const MOVIE_FIELDS = [
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

// OMDb uses the literal string "N/A" for missing values.
const clean = (value) => (value && value !== "N/A" ? String(value) : "");

/** Converts an OMDb search item or detail payload into the app's movie shape. */
export function fromOmdb(raw) {
  return {
    id: clean(raw.imdbID),
    title: clean(raw.Title),
    year: clean(raw.Year),
    type: clean(raw.Type),
    poster: clean(raw.Poster),
    genre: clean(raw.Genre),
    rating: clean(raw.imdbRating),
    runtime: clean(raw.Runtime),
    plot: clean(raw.Plot),
    actors: clean(raw.Actors),
    director: clean(raw.Director),
    released: clean(raw.Released),
    awards: clean(raw.Awards),
  };
}

/**
 * One GET against OMDb with a timeout and optional caller-supplied cancel signal.
 * Resolves with the parsed JSON body, or throws an ApiError.
 */
async function request(params, { signal, timeout = REQUEST_TIMEOUT_MS } = {}) {
  if (signal?.aborted) throw new ApiError("Request cancelled", "aborted");

  const url = new URL(OMDB_BASE_URL);
  url.search = new URLSearchParams({ apikey: OMDB_API_KEY, ...params }).toString();

  const controller = new AbortController();
  let timedOut = false;

  const onCallerAbort = () => controller.abort();
  signal?.addEventListener("abort", onCallerAbort, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeout);

  try {
    const response = await fetch(url, { signal: controller.signal });

    let data = null;
    try {
      data = await response.json();
    } catch (error) {
      if (error.name === "AbortError") throw error;
      /* body is not JSON - handled below */
    }

    // OMDb reports problems like "Invalid API key!" with an HTTP 401 and a JSON body.
    if (data?.Response === "False" && data.Error && !response.ok) {
      throw new ApiError(data.Error, "api");
    }
    if (!response.ok || data === null || typeof data !== "object") {
      throw new ApiError(`The movie service returned an error (${response.status}).`, "http");
    }
    return data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (timedOut) {
      throw new ApiError("The request timed out. Check your connection and try again.", "timeout", error);
    }
    if (error.name === "AbortError") throw new ApiError("Request cancelled", "aborted", error);
    throw new ApiError("Can't reach the movie service. Check your connection and try again.", "network", error);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onCallerAbort);
  }
}

// Messages from OMDb that mean "nothing to show" rather than "something broke".
const NO_RESULT_ERRORS = new Set(["Movie not found!", "Too many results."]);

/**
 * Searches by title. OMDb returns 10 results per page.
 * @returns {{ movies: object[], total: number, message: string }}
 */
export async function searchMovies(query, { page = 1, signal } = {}) {
  const data = await request({ s: query, page: String(page) }, { signal });

  if (data.Response === "False") {
    if (NO_RESULT_ERRORS.has(data.Error)) {
      const message = data.Error === "Too many results." ? "Too many results. Try a more specific title." : "";
      return { movies: [], total: 0, message };
    }
    throw new ApiError(data.Error || "The movie service reported an error.", "api");
  }

  return {
    movies: (data.Search || []).map(fromOmdb),
    total: Number.parseInt(data.totalResults, 10) || 0,
    message: "",
  };
}

/** Fetches full details (plot, cast, runtime, rating, genre...) for one movie. */
export async function getMovieDetails(id, { signal } = {}) {
  const data = await request({ i: id, plot: "full" }, { signal });

  if (data.Response === "False") {
    throw new ApiError(data.Error || "Movie not found.", "api");
  }
  return { ...fromOmdb(data), id };
}

const MAX_PARALLEL_DETAILS = 3;
const detailQueue = [];
let activeDetailRequests = 0;

/**
 * Low-priority details lookup used to fill in card ratings: at most three requests
 * are in flight, and a queued job is skipped (resolves null) if `isNeeded()` is
 * false by the time it reaches the front (e.g. its card was scrolled away or replaced).
 */
export function queueMovieDetails(id, { isNeeded = () => true, isKnown = () => null } = {}) {
  return new Promise((resolve, reject) => {
    detailQueue.push({ id, isNeeded, isKnown, resolve, reject });
    pumpDetailQueue();
  });
}

function pumpDetailQueue() {
  while (activeDetailRequests < MAX_PARALLEL_DETAILS && detailQueue.length) {
    const job = detailQueue.shift();

    const known = job.isKnown(job.id);
    if (known) {
      job.resolve(known);
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
