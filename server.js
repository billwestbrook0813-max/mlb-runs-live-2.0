// server.js — MLB total runs + live-aware projection (fixed params)
import express from "express";
import { fetch } from "undici";

const app = express();
const PORT = process.env.PORT || 3000;
const TZ = "America/Los_Angeles";

// Fixed parameters
const PROJ_TTL_MS = 10 * 60 * 1000; // 10 minutes
const WINDOW_START_PT = 9;  // 9 AM PT
const WINDOW_END_PT   = 21; // 9 PM PT
const LIVE_RECENT_MIN = 15; // minutes

// Helpers
const fmtPT = (opts) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, ...opts });
const todayPT = () => fmtPT({ year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const hourPT = () => Number(fmtPT({ hour: "2-digit", hour12: false }).format(new Date()));

function isWithinWindow(h = hourPT()) {
  return h >= WINDOW_START_PT && h < WINDOW_END_PT;
}
function isSamePTDay(iso) {
  const dStr = fmtPT({ year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  return dStr === todayPT();
}
function hasRecentUpdate(iso) {
  if (!iso) return false;
  const ageMin = (Date.now() - new Date(iso).getTime()) / 60000;
  return ageMin <= LIVE_RECENT_MIN;
}
const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
const std  = (a) => {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
};

// Static
app.use(express.static("public"));

// Health
app.get("/health", (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// Actual runs (MLB Stats API)
app.get("/api/total-runs", async (req, res) => {
  const date = req.query.date || todayPT();
  const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}&hydrate=linescore`;
  try {
    const r = await fetch(url, { headers: { "User-Agent": "MLB-Runs/1.0" } });
    if (!r.ok) throw new Error(`MLB upstream ${r.status}`);
    const data = await r.json();
    const games = data?.dates?.[0]?.games ?? [];
    let totalRuns = 0;
    for (const g of games) {
      const ls = g.linescore;
      totalRuns += (ls?.teams?.away?.runs ?? 0) + (ls?.teams?.home?.runs ?? 0);
    }
    res.json({ date, gamesCount: games.length, totalRuns, lastUpdateUtc: new Date().toISOString() });
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

// Projection (Odds API, live-aware)
let projCache = { ts: 0, payload: null };

app.get("/api/projected-runs", async (_req, res) => {
  const now = Date.now();
  if (projCache.payload && now - projCache.ts < PROJ_TTL_MS) {
    return res.json(projCache.payload);
  }
  if (!isWithinWindow()) {
    if (projCache.payload) return res.json(projCache.payload);
    return res.json({ error: "Projection updates only between 09:00–21:00 PT" });
  }

  const ODDS_API_KEY = process.env.ODDS_API_KEY;
  if (!ODDS_API_KEY) return res.status(500).json({ error: "Missing ODDS_API_KEY" });

  const url = new URL("https://api.the-odds-api.com/v4/sports/baseball_mlb/odds");
  url.searchParams.set("regions", "us");
  url.searchParams.set("markets", "totals");
  url.searchParams.set("oddsFormat", "american");
  url.searchParams.set("dateFormat", "iso");
  url.searchParams.set("apiKey", ODDS_API_KEY);

  try {
    const r = await fetch(url, { headers: { "User-Agent": "MLB-Runs/1.0" } });
    if (!r.ok) throw new Error(`Odds API ${r.status}`);
    const events = await r.json();

    const games = [];
    const today = todayPT();
    for (const ev of events) {
      if (!isSamePTDay(ev.commence_time)) continue;
      const started = new Date(ev.commence_time).getTime() <= Date.now();
      const pointsAll = [], pointsLive = [];
      for (const bk of ev.bookmakers ?? []) {
        const m = (bk.markets ?? []).find(x => x.key === "totals");
        if (!m) continue;
        const over = (m.outcomes ?? []).find(o => /over/i.test(o.name));
        const under = (m.outcomes ?? []).find(o => /under/i.test(o.name));
        const pt = over?.point ?? under?.point;
        if (typeof pt !== "number") continue;
        pointsAll.push(pt);
        if (started) {
          const lastUpd = m.last_update || bk.last_update || null;
          if (hasRecentUpdate(lastUpd)) pointsLive.push(pt);
        }
      }
      const used = (started && pointsLive.length) ? pointsLive : pointsAll;
      if (!used.length) continue;
      games.push({
        id: ev.id,
        status: started ? "live-or-started" : "pre",
        commence_time: ev.commence_time,
        home_team: ev.home_team,
        away_team: ev.away_team,
        bookmakers_count: used.length,
        consensus_total: Number(mean(used).toFixed(2)),
        consensus_std: Number(std(used).toFixed(2))
      });
    }

    const projectedMean = Number(games.reduce((s, g) => s + g.consensus_total, 0).toFixed(1));
    const projectedStd  = Number(Math.sqrt(games.reduce((s, g) => s + (g.consensus_std ** 2 || 0), 0)).toFixed(1));
    const bandLow       = Number((projectedMean - projectedStd).toFixed(1));
    const bandHigh      = Number((projectedMean + projectedStd).toFixed(1));

    const payload = {
      datePT: today,
      projectedRuns: projectedMean,
      projectedStd,
      bandLow,
      bandHigh,
      gameCountUsed: games.length,
      games,
      source: "The Odds API (live-aware)",
      lastUpdateUtc: new Date().toISOString(),
      config: {
        windowStartPT: WINDOW_START_PT,
        windowEndPT: WINDOW_END_PT,
        cacheMinutes: PROJ_TTL_MS / 60000,
        liveRecentMinutes: LIVE_RECENT_MIN
      }
    };
    projCache = { ts: now, payload };
    res.json(payload);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

// Boot
app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
