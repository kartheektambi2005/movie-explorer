# Movie Explorer

Search movies, read details, and keep your own Favorites and Watchlist, all in the browser.
Plain HTML, CSS and JavaScript (ES modules) on top of the [OMDb API](https://www.omdbapi.com/). No build step.

**Live demo:** _add your Vercel URL here after the first deploy_

> **Screenshot:** _coming soon._ Save one as `docs/screenshot.png` and replace this line with `![Movie Explorer](docs/screenshot.png)`.

## Features

- **Home banner:** 4 recent Indian releases that change by themselves every 2 seconds (pause button, dots, "View details").
- **Search** with debounced typing, input validation, "Load more" pagination and cancelled stale requests.
- **Clear states:** loading spinner, no results, error with a retry button, invalid-search hint.
- **Cards** with poster, year, rating and genre (fallback image when a poster is missing).
- **Details modal:** poster, plot, cast, runtime, IMDb rating, genre.
- **Favorites and Watchlist:** add or remove, toast messages, live counters.
- **Recent searches:** last 5, with a Clear button.
- **Dark/light theme** and the selected tab are remembered.
- **Accessible and responsive:** keyboard friendly, focus trap in the modal, AA contrast, works from 320px up.

## What changed (from the original version)

| Step | Summary |
| --- | --- |
| Security | API key moved to one config file; API data is shown with `textContent` (no HTML injection); search input validated; `localStorage` reads can't crash on bad data. |
| Data handling | One API module with timeout and `async/await`; every loading/error/empty state is visible; debounce, request cancellation and "Load more". |
| UI and features | Rating and genre on cards instead of the IMDb ID; full details modal; favorites/watchlist removal with toasts; remembered tab and theme; poster fallback. |
| Quality | Code split into small ES modules; keyboard and screen-reader support; light and dark contrast fixed; page title, description and favicon. |
| Banner | Auto-advancing home banner of recent Indian releases. |

## Project structure

```
index.html          page markup
css/style.css       theme and layout
assets/             favicon and fallback poster
js/
  config.js         OMDb API key (the only place it lives)
  featured.js       banner movies and slide duration
  api.js            OMDb requests (timeout, cancellation, errors)
  storage.js        safe localStorage access
  state.js          in-memory app state
  ui.js             all DOM rendering and the modal
  banner.js         home banner slideshow
  utils.js          search validation and debounce
  main.js           wires everything together
```

## Setup

1. **Get a free OMDb key** at <https://www.omdbapi.com/apikey.aspx> (choose FREE, then activate it from the email).
2. Put it in [`js/config.js`](js/config.js):

   ```js
   export const OMDB_API_KEY = "your-free-key";
   ```

3. Serve the folder over HTTP (ES modules don't load from `file://`):

   ```bash
   python -m http.server 8000
   ```

   Open <http://localhost:8000>.

> **About the key:** in a front-end app the key is visible to anyone. Use a free key you can rotate and never commit a paid one.
> A key that was already committed stays in git history, so rotate it if it leaks.
> The banner and card ratings use extra requests (about 4 plus 10 per page of results), so keep the free 1,000 per day in mind.

## Change the banner movies

OMDb can't filter by country or release date, so the banner uses a hand-kept list in [`js/featured.js`](js/featured.js).
Edit the titles and years (they must match OMDb) to feature newer releases. `BANNER_SLIDE_MS` sets the slide time (default 2000).

## Deploy

The project is static files with relative paths, so it deploys as is.

- **Vercel:** import the GitHub repo, set **Framework Preset** to **Other**, leave Build Command and Output Directory empty, then Deploy.
- **GitHub Pages:** Settings, Pages, deploy from branch `main` and `/ (root)`.

## Credits

Movie data from the [OMDb API](https://www.omdbapi.com/). Built by Tambi Kartheek.
