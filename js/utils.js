export const MIN_QUERY_LENGTH = 2;
export const MAX_QUERY_LENGTH = 100;

/** Trims and collapses whitespace, then checks length. Returns { value, error }. */
export function validateQuery(raw) {
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

/** Delays `fn` until `delay` ms after the last call. `.cancel()` drops a pending call. */
export function debounce(fn, delay) {
  let timer;
  const debounced = (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
  debounced.cancel = () => clearTimeout(timer);
  return debounced;
}
