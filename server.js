import express from "express";
import { fetch } from "undici";
import dotenv from "dotenv";
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Serve the static frontend
app.use(express.static("public"));

// Helper: YYYY-MM-DD in Pacific Time
function todayPST() {
  const now = new Date();
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric", month: "2-digit", day: "2-digit"
  }).format(now);
}

// ====== ACTUALS: MLB Stats API (unofficial) ======
app.get("/api/total-runs", async (req, res) => {
  const date = req.query.date || todayPST();
  const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}&hydrate=linescore`;
  try {
    const r = await fetch(url, { headers: { "User-Agent": "WW-MLB-Runs-Live/1.0" } });
    if (!r.ok) throw new Error(`Upstream ${r.status}`);
    const data = await r.json();
    const dates = data?.dates || [];
    const games = dates.length ? dates[0].games || [] : [];
    let totalRuns = 0;
    for (const g of games) {
      const ls = g.linescore;
      const away = ls?.teams?.away?.runs ?? 0;
      const home = ls?.teams?.home?.runs ?? 0;
      totalRuns += (away + home);
    }
    res.json({ date, gamesCount: games.length, totalRuns, lastUpdateUtc: new Date().toISOString() });
  } catch (err) {
    res.status(502).json({ error: String(err) });
  }
});

// ====== PROJECTION: The Odds API (live-aware) ======
const mean = (arr) => arr.reduce((s, x) => s + x, 0) / arr.length;
const std = (arr) => {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const v = arr.reduce((s, x) => s + (x - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(v);
};

let projCache = { ts: 0, payload: null };
const PROJ_TTL_MS = 60 * 1000; // 60s cache to keep it "live" without burning calls
const RECENT_MINUTES = 15;

function nowPTStamped(format = {}) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    ...format
  });
  return fmt.format(new Date());
}

function isSamePTDay(iso, ymd) {
  const dStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date(iso));
  return dStr === ymd;
}

function hasRecentUpdate(lastUpdateISO) {
  if (!lastUpdateISO) return false;
  const ageMin = (Date.now() - new Date(lastUpdateISO).getTime()) / 60000;
  return ageMin <= RECENT_MINUTES;
}

app.get("/api/projected-runs", async (_req, res) => {
  const now = Date.now();
  if (projCache.payload && now - projCache.ts < PROJ_TTL_MS) {
    return res.json(projCache.payload);
  }

  const ODDS_API_KEY = process.env.ODDS_API_KEY;
  if (!ODDS_API_KEY) {
    return res.status(500).json({ error: "Missing ODDS_API_KEY" });
  }

  const url = new URL("https://api.the-odds-api.com/v4/sports/baseball_mlb/odds");
  url.searchParams.set("regions", "us");
  url.searchParams.set("markets", "totals");
  url.searchParams.set("oddsFormat", "american");
  url.searchParams.set("dateFormat", "iso");
  url.searchParams.set("apiKey", ODDS_API_KEY);

  const today = todayPST();
  const nowPT = new Date(nowPTStamped());

  try {
    const r = await fetch(url, { headers: { "User-Agent": "WW-MLB-Runs-Live/1.0" } });
    if (!r.ok) throw new Error(`Odds API ${r.status}`);
    const events = await r.json();

    const games = [];
    for (const ev of events) {
      if (!isSamePTDay(ev.commence_time, today)) continue;

      // Started if commence_time <= now (PT)
      const startPT = new Date(nowPTStamped({} , new Date(ev.commence_time)));
      const started = new Date(ev.commence_time) <= nowPT;

      const pointsAll = [];
      const pointsLive = [];

      for (const bk of ev.bookmakers || []) {
        const market = (bk.markets || []).find(m => m.key === "totals");
        if (!market) continue;
        const over = (market.outcomes || []).find(o => /over/i.test(o.name));
        const under = (market.outcomes || []).find(o => /under/i.test(o.name));
        const pt = over?.point ?? under?.point;
        if (typeof pt !== "number") continue;

        pointsAll.push(pt);
        if (started) {
          const lastUpd = market.last_update || bk.last_update || null;
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
    const projectedStd = Number(Math.sqrt(games.reduce((s, g) => s + (g.consensus_std ** 2 || 0), 0)).toFixed(1));
    const bandLow = Number((projectedMean - projectedStd).toFixed(1));
    const bandHigh = Number((projectedMean + projectedStd).toFixed(1));

    const payload = {
      datePT: today,
      projectedRuns: projectedMean,
      projectedStd,
      bandLow,
      bandHigh,
      gameCountUsed: games.length,
      games,
      source: "The Odds API (live-aware)",
      lastUpdateUtc: new Date().toISOString()
    };
    projCache = { ts: now, payload };
    res.json(payload);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
  console.log(`Open http://localhost:${PORT} in your browser`);
});
