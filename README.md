# The Salami Slider — Final Bundle

Includes:
- Updated `public/index.html` with header logos, Projected Live (Final Game), and Projected Total logic.
- `public/assets/juice-junkies-logo.png` and `public/assets/salami-slider-logo.png` (user-supplied).
- Original `package.json` and `server.js`.

## Usage

1. Place your Odds API key in the environment variable `ODDS_API_KEY`.
2. Install dependencies and run:
   ```bash
   npm install
   npm start
   ```
3. Visit http://localhost:3000

## Notes

- Projected Total is computed as (Actual – Live Final Actual) + Projected Final.
- The “final game” is chosen as the last remaining non-final game; extend TEAM_MAP as needed.
