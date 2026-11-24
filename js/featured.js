/**
 * Movies shown in the home page banner, newest first (one slide each).
 *
 * OMDb cannot filter by country or release date, so this short list is
 * maintained by hand. To feature newer Indian releases, edit the entries below:
 * `title` and `year` must match the OMDb listing (https://www.omdbapi.com/).
 */
export const FEATURED_IN_INDIA = [
  { title: "Dhurandhar", year: "2025" },
  { title: "Kantara: A Legend Chapter 1", year: "2025" },
  { title: "Saiyaara", year: "2025" },
  { title: "Coolie", year: "2025" },
];

/** How long each banner slide stays on screen. */
export const BANNER_SLIDE_MS = 2000;
