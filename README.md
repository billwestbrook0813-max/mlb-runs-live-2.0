# Salami Slider — Consistent Projection Build

Salami Slider provides live and projected MLB run totals.

## Projection Algorithm

* For each MLB game scheduled today, bookmaker totals are fetched from The Odds API.
* American odds are converted to implied probabilities and adjusted for vig (0.60 runs per 100 points).
* Live games only use bookmaker lines updated within the last 15 minutes.
* Current scores from the MLB Stats API are combined with the adjusted totals to estimate expected remaining runs and the projected finish.
* Projections are cached for 10 minutes and only refreshed between 09:00–21:00 PT.

## API

* `GET /api/projected-runs` – live-aware projection with expected remaining runs and diagnostics.
* `GET /api/total-runs?date=YYYY-MM-DD` – actual runs summed for the supplied date.
* `GET /api/scoreboard?date=YYYY-MM-DD` – basic scoreboard view.
* `GET /health` – health check.

## Environment Variables

* `ODDS_API_KEY` – **required** API key for [The Odds API](https://the-odds-api.com/).
* `PORT` – optional port for the HTTP server (defaults to `3000`).

## Development

```bash
npm install
npm start
```

### Tests and Linting

```bash
npm test       # run unit tests
npm run lint   # run ESLint
```

Open http://localhost:3000 after starting the server.
