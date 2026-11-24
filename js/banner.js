import { getMovieByTitle } from "./api.js";
import { FEATURED_IN_INDIA, BANNER_SLIDE_MS } from "./featured.js";
import { el, createPoster, isHttpUrl } from "./ui.js";

/**
 * Home page banner: a slideshow of recent Indian releases that advances by itself.
 * It pauses on hover and keyboard focus, when the tab is hidden, and with the
 * pause button. Users who prefer reduced motion start paused.
 */

const root = document.getElementById("banner");
const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/**
 * @param {object} handlers
 * @param {(movies: object[]) => void} handlers.onLoaded called with the fetched movies (to share the details cache)
 * @param {(id: string) => void} handlers.onDetails opens the details modal for a movie
 */
export async function initBanner({ onLoaded, onDetails }) {
  const results = await Promise.allSettled(FEATURED_IN_INDIA.map(({ title, year }) => getMovieByTitle(title, year)));
  const movies = results.filter((result) => result.status === "fulfilled" && result.value.id).map((r) => r.value);

  // Nothing to show (offline, quota used up...): drop the banner rather than show an error.
  if (!movies.length) {
    root.classList.add("hidden");
    return;
  }

  onLoaded(movies);
  mount(movies, onDetails);
}

function buildSlide(movie, index, total, onDetails) {
  const facts = [movie.rating && `★ ${movie.rating}`, movie.language, movie.genre].filter(Boolean).join("  ·  ");

  const details = el("button", {
    className: "banner-btn",
    text: "View details",
    attrs: { type: "button", "aria-label": `View details for ${movie.title}` },
  });
  details.addEventListener("click", () => onDetails(movie.id));

  const content = el("div", { className: "banner-content" }, [
    el("p", { className: "banner-tag", text: "Recent release in India" }),
    el(
      "h2",
      { className: "banner-title", text: movie.title },
      movie.year ? [el("span", { text: ` (${movie.year})` })] : [],
    ),
    el("p", { className: "banner-facts", text: facts }),
    movie.released ? el("p", { className: "banner-released", text: `Released ${movie.released}` }) : "",
    movie.plot ? el("p", { className: "banner-plot", text: movie.plot }) : "",
    details,
  ]);

  const slide = el(
    "div",
    {
      className: "banner-slide",
      attrs: { role: "group", "aria-roledescription": "slide", "aria-label": `${index + 1} of ${total}` },
    },
    [content, createPoster(movie, "banner-poster")],
  );

  // Blurred poster as the backdrop (decorative).
  if (isHttpUrl(movie.poster)) {
    slide.prepend(el("img", { className: "banner-bg", attrs: { src: movie.poster, alt: "", "aria-hidden": "true" } }));
  }
  return slide;
}

function mount(movies, onDetails) {
  const total = movies.length;
  const slides = movies.map((movie, i) => buildSlide(movie, i, total, onDetails));

  const dots = movies.map((movie, i) => {
    const dot = el("button", {
      className: "banner-dot",
      attrs: { type: "button", "aria-label": `Show slide ${i + 1}: ${movie.title}` },
    });
    dot.addEventListener("click", () => goTo(i));
    return dot;
  });

  const toggle = el("button", { className: "banner-toggle", attrs: { type: "button" } }, [
    el("span", { attrs: { "aria-hidden": "true" } }),
  ]);
  toggle.addEventListener("click", () => {
    userPaused = !userPaused;
    sync();
  });

  const track = el("div", { className: "banner-slides" }, slides);
  root.classList.remove("is-loading");
  root.replaceChildren(
    track,
    el("div", { className: "banner-controls" }, [toggle, el("div", { className: "banner-dots" }, dots)]),
  );

  let index = 0;
  let timer = null;
  let userPaused = prefersReducedMotion;
  let hovering = false;
  let focusing = false;

  const isPlaying = () => !userPaused && !hovering && !focusing && !document.hidden;

  function show(next) {
    index = (next + total) % total;

    slides.forEach((slide, i) => {
      const active = i === index;
      slide.classList.toggle("is-active", active);
      slide.inert = !active; // hidden slides must not be reachable by keyboard or screen readers
      slide.setAttribute("aria-hidden", String(!active));
    });

    dots.forEach((dot, i) => {
      dot.classList.toggle("is-active", i === index);
      if (i === index) dot.setAttribute("aria-current", "true");
      else dot.removeAttribute("aria-current");
    });
  }

  // Each (re)start waits a full slide duration, so manual navigation never gets cut short.
  function schedule() {
    clearTimeout(timer);
    if (!isPlaying()) return;

    timer = setTimeout(() => {
      show(index + 1);
      schedule();
    }, BANNER_SLIDE_MS);
  }

  function sync() {
    toggle.classList.toggle("is-paused", userPaused);
    toggle.setAttribute("aria-label", userPaused ? "Play slideshow" : "Pause slideshow");
    // Announce slide changes only when they are user-driven (not while auto-rotating).
    track.setAttribute("aria-live", userPaused ? "polite" : "off");
    schedule();
  }

  function goTo(next) {
    show(next);
    schedule();
  }

  root.addEventListener("mouseenter", () => {
    hovering = true;
    schedule();
  });
  root.addEventListener("mouseleave", () => {
    hovering = false;
    schedule();
  });
  root.addEventListener("focusin", (e) => {
    focusing = e.target.matches(":focus-visible"); // keyboard focus only; a mouse click must not freeze it
    schedule();
  });
  root.addEventListener("focusout", () => {
    focusing = false;
    schedule();
  });
  document.addEventListener("visibilitychange", schedule);

  show(0);
  sync();
}
