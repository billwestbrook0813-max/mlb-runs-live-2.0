// server.js — Consistent projections + projected finish (same set), loud UI compatible
import express from "express";
import { fetch } from "undici";

const app = express();
const PORT = process.env.PORT || 3000;
const TZ = "America/Los_Angeles";

const PROJ_TTL_MS = 10 * 60 * 1000; // cache 10 min
const WINDOW_START_PT = 6;
const WINDOW_END_PT   = 21;
const LIVE_RECENT_MIN = 15;
const JUICE_TO_RUNS   = 0.60;

// Helpers
const fmtPT = (opts) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, ...opts });
const todayPT = () => fmtPT({ year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const hourPT = () => Number(fmtPT({ hour: "2-digit", hour12: false }).format(new Date()));
const inWindow = (h = hourPT()) => h >= WINDOW_START_PT && h < WINDOW_END_PT;
const samePTDay = (iso) => fmtPT({ year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso)) === todayPT();
const recent = (iso) => { if (!iso) return false; const ageMin = (Date.now() - new Date(iso).getTime()) / 60000; return ageMin <= LIVE_RECENT_MIN; };
const mean = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
const std  = (a) => { if (a.length < 2) return 0; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };

function americanToProb(american) {
  if (american == null) return null;
  const a = Number(american);
  if (Number.isNaN(a)) return null;
  return a < 0 ? (-a) / ((-a) + 100) : 100 / (a + 100);
}
function devigTwoWay(pOverRaw, pUnderRaw) {
  if (pOverRaw == null || pUnderRaw == null) return null;
  const sum = pOverRaw + pUnderRaw;
  if (sum <= 0) return null;
  return { pOver: pOverRaw / sum, pUnder: pUnderRaw / sum };
}
const norm = (s) => (s||"").toLowerCase().replace(/[^a-z]/g,"");

// Static
app.use(express.static("public"));
app.get("/health", (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// Actual totals
app.get("/api/total-runs", async (req, res) => {
  const date = req.query.date || todayPT();
  const url = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}&hydrate=linescore`;
  try {
    const r = await fetch(url, { headers: { "User-Agent": "SalamiSlider/1.3" } });
    if (!r.ok) throw new Error(`MLB upstream ${r.status}`);
    const data = await r.json();
    const games = data?.dates?.[0]?.games ?? [];
    let totalRuns = 0;
    for (const g of games) {
      const ls = g.linescore;
      totalRuns += (ls?.teams?.away?.runs ?? 0) + (ls?.teams?.home?.runs ?? 0);
    }
    res.json({ date, gamesCount: games.length, totalRuns, lastUpdateUtc: new Date().toISOString() });
  } catch (e) { res.status(502).json({ error: String(e) }); }
});

// ---- Shared projection computation (refactor) ----
let projCache = { ts: 0, payload: null };

async function computeProjectionPayload() {
  const now = Date.now();

  // Serve from cache if fresh
  if (projCache.payload && now - projCache.ts < PROJ_TTL_MS) {
    return projCache.payload;
  }

  // Only refresh inside window; otherwise return last cached (if any) or a window message
  if (!inWindow()) {
    if (projCache.payload) return projCache.payload;
    return { error: "Projection updates only between 09:00–21:00 PT" };
  }

  const ODDS_API_KEY = process.env.ODDS_API_KEY;
  if (!ODDS_API_KEY) {
    return { error: "Missing ODDS_API_KEY" };
  }

  const oddsUrl = new URL("https://api.the-odds-api.com/v4/sports/baseball_mlb/odds");
  oddsUrl.searchParams.set("regions", "us");
  oddsUrl.searchParams.set("markets", "totals");
  oddsUrl.searchParams.set("oddsFormat", "american");
  oddsUrl.searchParams.set("dateFormat", "iso");
  oddsUrl.searchParams.set("apiKey", ODDS_API_KEY);

  const mlbUrl = `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${todayPT()}&hydrate=linescore,team,game,flags,status`;

  const [oddsResp, mlbResp] = await Promise.allSettled([
    fetch(oddsUrl, { headers: { "User-Agent": "SalamiSlider/1.3" } }),
    fetch(mlbUrl,  { headers: { "User-Agent": "SalamiSlider/1.3" } }),
  ]);

  if (oddsResp.status !== "fulfilled" || !oddsResp.value.ok) {
    const code = oddsResp.status === "fulfilled" ? oddsResp.value.status : "FETCH_FAIL";
    return { error: `Odds API ${code}` };
  }
  if (mlbResp.status !== "fulfilled" || !mlbResp.value.ok) {
    const code = mlbResp.status === "fulfilled" ? mlbResp.value.status : "FETCH_FAIL";
    return { error: `MLB upstream ${code}` };
  }

  const events = await oddsResp.value.json();
  const mlb = await mlbResp.value.json();
  const mlbGames = (mlb?.dates?.[0]?.games ?? []).map(g => ({
    id: g.gamePk,
    home: g.teams?.home?.team?.name,
    away: g.teams?.away?.team?.name,
    homeAbb: g.teams?.home?.team?.abbreviation,
    awayAbb: g.teams?.away?.team?.abbreviation,
    state: g.status?.abstractGameState, // Preview | Live | Final
    runsNow: (g.linescore?.teams?.home?.runs ?? 0) + (g.linescore?.teams?.away?.runs ?? 0),
  }));
  const findMlb = (ev) => {
    const h = norm(ev.home_team), a = norm(ev.away_team);
    return mlbGames.find(g =>
      (norm(g.home)+norm(g.homeAbb)).includes(h.slice(0,6)) &&
      (norm(g.away)+norm(g.awayAbb)).includes(a.slice(0,6))
    ) || null;
  };

  const games = [];
  const today = todayPT();

  for (const ev of events) {
    if (!samePTDay(ev.commence_time)) continue;
    const started = new Date(ev.commence_time).getTime() <= Date.now();
    const allPts = [], allAdjPts = [], livePts = [], liveAdjPts = [];

    for (const bk of ev.bookmakers ?? []) {
      const m = (bk.markets ?? []).find(x => x.key === "totals"); if (!m) continue;
      const over  = (m.outcomes ?? []).find(o => /over/i.test(o.name));
      const under = (m.outcomes ?? []).find(o => /under/i.test(o.name));
      const pt = over?.point ?? under?.point; if (typeof pt !== "number") continue;
      const pOverRaw  = americanToProb(over?.price);
      const pUnderRaw = americanToProb(under?.price);
      const dv = devigTwoWay(pOverRaw, pUnderRaw);
      const skew = dv ? (dv.pOver - 0.5) : 0;
      const adjPoint = pt + skew * JUICE_TO_RUNS;
      allPts.push(pt); allAdjPts.push(adjPoint);
      if (started) {
        const lastUpd = m.last_update || bk.last_update || null;
        if (recent(lastUpd)) { livePts.push(pt); liveAdjPts.push(adjPoint); }
      }
    }

    const usedRaw = (started && livePts.length) ? livePts : allPts;
    const usedAdj = (started && liveAdjPts.length) ? liveAdjPts : allAdjPts;
    if (!usedRaw.length) continue;

    const mlbMatch = findMlb(ev);
    const runsNow = mlbMatch?.runsNow ?? 0;
    const mlbState = mlbMatch?.state ?? (started ? "Live" : "Preview");

    const adjMean = Number(mean(usedAdj).toFixed(2));
    const remain = adjMean - runsNow;

    games.push({
      id: ev.id,
      status: mlbState,
      commence_time: ev.commence_time,
      home_team: ev.home_team,
      away_team: ev.away_team,
      bookmakers_count: usedRaw.length,
      consensus_total: Number(mean(usedRaw).toFixed(2)),
      consensus_total_adj: adjMean,
      consensus_std: Number(std(usedRaw).toFixed(2)),
      current_runs: runsNow,
      expected_remaining_raw: Number(remain.toFixed(2)),
      expected_remaining: Number(Math.max(0, remain).toFixed(2)) // clamped for finish calc
    });
  }

  // Rollups from the SAME game set
  const sumAdjAll = Number(games.reduce((s,g)=> s + (g.consensus_total_adj ?? g.consensus_total), 0).toFixed(2));
  const projectedRuns = Number(sumAdjAll.toFixed(1)); // headline projection (consistent)

  const actualRunsToday = mlbGames.reduce((s, g) => s + (g.runsNow || 0), 0);

  const remainingExpected = Number(
    games.filter(g => g.status !== "Final").reduce((s,g)=> s + (g.expected_remaining || 0), 0).toFixed(2)
  );

  const projectedFinish = Number((actualRunsToday + remainingExpected).toFixed(2));

  const projectedStd  = Number(Math.sqrt(games.reduce((s, g) => s + (g.consensus_std ** 2 || 0), 0)).toFixed(1));
  const bandLow  = Number((projectedRuns - projectedStd).toFixed(1));
  const bandHigh = Number((projectedRuns + projectedStd).toFixed(1));

  const payload = {
    datePT: today,
    projectedRuns_raw: projectedRuns,
    projectedRuns,
    projectedStd, bandLow, bandHigh,
    gameCountUsed: games.length,
    games,
    actualRunsToday,
    remainingExpected,
    projectedFinish,
    source: "The Odds API + MLB Stats API (live-aware, juice-adjusted)",
    lastUpdateUtc: new Date().toISOString(),
    config: { windowStartPT: WINDOW_START_PT, windowEndPT: WINDOW_END_PT, cacheMinutes: PROJ_TTL_MS/60000, liveRecentMinutes: LIVE_RECENT_MIN, juiceToRuns: JUICE_TO_RUNS }
  };

  projCache = { ts: now, payload };
  return payload;
}

// Projection + finish (consistent set)
app.get("/api/projected-runs", async (_req, res) => {
  try {
    const payload = await computeProjectionPayload();
    if (payload.error) return res.status(502).json(payload);
    res.json(payload);
  } catch (e) {
    res.status(502).json({ error: String(e) });
  }
});

// NEW: the two-number endpoint (exactly what your UI needs)
app.get("/api/two-numbers", async (_req, res) => {
  try {
    const payload = await computeProjectionPayload();
    if (payload.error) return res.status(502).json(payload);
    const out = {
      datePT: payload.datePT,
      totalRunsScored: Number(payload.actualRunsToday ?? 0),           // Total number of actual runs scored so far today
      projectedSlateFinish: Number(payload.projectedFinish ?? 0),      // Actual + expected remaining (live/pre with de-vi
