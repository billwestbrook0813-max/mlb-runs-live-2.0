# MLB Runs Tracker — Juice-Adjusted + Ticker
A Node/Express app that shows **today's MLB total runs** and a **market-based projection** using The Odds API. Projection is **live-aware** and **juice-adjusted**; includes a scoreboard ticker that auto-stops on small slates.

## Run
```bash
npm install
export ODDS_API_KEY=your_key_here   # mac/linux
# setx ODDS_API_KEY your_key_here   # windows powershell
npm start
# open http://localhost:3000
```
