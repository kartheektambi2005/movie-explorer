# Movie Explorer

Search movies and series, read the details, and keep your own Favorites and Watchlist, all in the browser.
Built with plain HTML, CSS and JavaScript (ES modules) on top of the [OMDb API](https://www.omdbapi.com/).

**Live demo:** _add your Vercel URL here after the first deploy._

> **Screenshot:** _coming soon._ Add one at `docs/screenshot.png` and replace this line with
> `![Movie Explorer](docs/screenshot.png)`.

## Features

- **Home banner:** a slideshow of four recent Indian releases that advances by itself every 2 seconds. It pauses on hover, on keyboard focus and with a pause button, has clickable dots, opens the details modal, and starts paused for visitors who prefer reduced motion.
- **Search** by title with a debounced search-as-you-type, input trimming and validation, and stale requests cancelled with `AbortController`.
- **"Load more"** pagination (OMDb returns 10 results per page).
- **Every state is visible:** loading spinner, "no results", network/API error with a **Try again** button, and an invalid-search hint.
- **Cards** show poster, year, type, IMDb rating and genre, with a local fallback image when a poster is missing.
- **Details modal** with poster, plot, cast, director, runtime, IMDb rating, genres and a link to IMDb.
- **Favorites and Watchlist** with live counters, toggle buttons, remove actions and toast messages.
- **Recent searches:** the last 5, with a Clear button. The list is empty on a first visit.
- **Dark / light theme** that follows your system on the first visit, then remembers your choice (no flash on load).
- **Remembers** the selected tab and theme across reloads. Everything is stored in `localStorage` and survives corrupted data.
- **Accessible:** labelled controls, keyboard-friendly buttons, a modal with focus trap, `Esc` to close and focus restore, visible focus rings, AA colour contrast in both themes, a skip link and reduced-motion support.
- **Responsive** from 320px phones to wide desktops.

## Tech stack

| Area      | Choice                                                         |
| --------- | -------------------------------------------------------------- |
| Markup    | HTML5 (semantic landmarks, ARIA where needed)                  |
| Styling   | CSS3 with custom properties for theming, Grid and Flexbox     |
| Logic     | Vanilla JavaScript (ES2020+ modules), no frameworks or build step |
| Data      | OMDb REST API via `fetch` with timeout and `AbortController`   |
| Storage   | `localStorage` (favorites, watchlist, history, theme, tab)     |
| Hosting   | Any static host: Vercel or GitHub Pages (no build step)        |

## Project structure

```
index.html        page markup (+ tiny inline script that applies the theme before first paint)
css/
  style.css       theme tokens, layout, components
assets/           favicon and fallback poster
js/
  config.js       OMDb API key and base URL: the only place the key lives
  featured.js     the four movies in the home banner and the slide duration (edit to change them)
  banner.js       home banner slideshow (auto-advance, pause, dots)
  api.js          OMDb client: timeout, cancellation, error types, queued details lookups
  storage.js      safe localStorage reads/writes (never throws, tolerates corrupted data)
  state.js        in-memory app state and small data helpers
  ui.js           all DOM rendering, toasts, details modal (focus trap)
  utils.js        search validation and debounce
  main.js         wires events, search flow, favorites/watchlist, tabs, theme
```

## Get a free OMDb API key

1. Go to <https://www.omdbapi.com/apikey.aspx>.
2. Choose the **FREE** plan (1,000 requests per day), enter your email and submit.
3. Click the activation link in the email OMDb sends you.
4. Copy the key and paste it into [`js/config.js`](js/config.js):

   ```js
   export const OMDB_API_KEY = "your-free-key";
   ```

### About the key

This is a front-end-only app, so **the key is visible to anyone who opens DevTools**. That is unavoidable
without a backend. Keep that in mind:

- Use a **free** key that you are happy to rotate. If it is abused or leaks, request a new one and replace it in `js/config.js`.
- **Never** commit a paid or patron key.
- A key already committed stays in git history. Rotating it is the real fix.
- Cards load their rating and genre as they scroll into view (one extra request per card), so a page of
  results can use around 10 to 20 requests. Keep the 1,000/day free quota in mind.

## Change the banner movies

OMDb has no "released recently in India" filter, so the banner uses a short hand-maintained list in
[`js/featured.js`](js/featured.js). Edit the titles and years (they must match the OMDb listing) to feature newer
releases, and change `BANNER_SLIDE_MS` to change how long each slide stays (default 2000 ms). Each banner load
costs one OMDb request per slide.

## Run locally

The app uses ES modules, which browsers will not load from `file://`, so serve the folder over HTTP:

```bash
git clone https://github.com/kartheektambi2005/movie-explorer.git
cd movie-explorer

# any static server works, for example:
python -m http.server 8000
# or
npx serve .
```

Then open <http://localhost:8000>.

## Deploy

The project is plain static files with no build step, so it deploys as is. All asset paths are relative.

### Vercel

1. Push the repository to GitHub.
2. In Vercel choose **Add New, Project** and import the repository.
3. Leave **Framework Preset** as **Other**, and leave **Build Command** and **Output Directory** empty
   (Vercel serves the repository root, where `index.html` lives).
4. Click **Deploy**. Every later push to `main` redeploys automatically.

### GitHub Pages

1. Go to **Settings, Pages**, choose **Deploy from a branch**, pick `main` and `/ (root)`, then save.
2. After a minute the site is live at `https://<your-username>.github.io/movie-explorer/`.

## Credits

Movie data from the [OMDb API](https://www.omdbapi.com/). Built by Tambi Kartheek.
