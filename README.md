# MLB Runs — Live-Aware Projection
A tiny Node + Express app that shows **Total MLB Runs Today** (live) and a **Projected Total** using consensus O/U lines from **The Odds API**. When games are underway, it prefers **recently updated live totals**; otherwise it uses pre-game totals. Includes a ±1σ band and a progress bar.

## Quick Start
1) **Download** this folder and `cd` into it.
2) Create your env file:
```
cp .env.example .env
# edit .env and set ODDS_API_KEY
```
3) Install deps:
```
npm install
```
4) Run:
```
npm start
```
5) Open:
```
http://localhost:3000
```

## Notes
- Timezone is **America/Los_Angeles**.
- `/api/total-runs` uses MLB Stats API (unofficial).
- `/api/projected-runs` uses **The Odds API**, caches for **60s**, and switches to **live totals** for started games when a book has updated within the last **15 minutes**.

## Tuning
- Increase or decrease `PROJ_TTL_MS` (server) for more/less "live" feel.
- Adjust `RECENT_MINUTES` to be stricter/looser on what counts as a live line.

## Deploy
- Any Node host works (Render, Railway, Fly, etc.).
- Set `ODDS_API_KEY` in host env vars.
