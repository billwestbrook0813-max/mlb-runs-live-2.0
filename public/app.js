// Fetch + Render client for loud sports‑bar UI
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const fmt = (n) => (typeof n === "number" ? n.toLocaleString("en-US", {maximumFractionDigits:1}) : n);

async function fetchJSON(url){
  const r = await fetch(url, { cache: "no-store" });
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

function renderTotals(data){
  $("#projectedRuns").textContent = fmt(data.projectedRuns);
  $("#projectedFinish").textContent = fmt(data.projectedFinish);
  $("#actualRunsToday").textContent = fmt(data.actualRunsToday);
  $("#remainingExpected").textContent = fmt(data.remainingExpected);
  $("#gamesUsed").textContent = `${data.gameCountUsed || 0} games used`;
  $("#datePT").textContent = data.datePT || "--";
  $("#lastUpdate").textContent = new Date(data.lastUpdateUtc || Date.now()).toLocaleTimeString();

  const low = data.bandLow ?? 0, high = data.bandHigh ?? 0;
  $("#bandLow").textContent = fmt(low);
  $("#bandHigh").textContent = fmt(high);
  const span = Math.max(1, high - low);
  const pos = Math.min(100, Math.max(0, ((data.projectedRuns - low) / span) * 100));
  $("#bandFill").style.width = pos + "%";

  // Build ticker text from games
  const ti = $("#tickerInner");
  const items = data.games.map(g => {
    const st = g.status || "Preview";
    const cls = `ticker__state ticker__state--${st}`;
    return `<div class="ticker__item"><span class="${cls}">${st}</span><b>${g.away_team}</b> @ <b>${g.home_team}</b><span>${fmt(g.current_runs)} runs</span><span>exp rem ${fmt(g.expected_remaining)}</span></div>`;
  });
  ti.innerHTML = items.concat(items).join(" • ");
}

function renderScoreboard(board){
  const grid = $("#grid");
  grid.innerHTML = "";
  const frag = document.createDocumentFragment();
  for (const it of board.items){
    const card = document.createElement("article");
    card.className = "card";
    card.innerHTML = `
      <div class="card__head">
        <div class="v-team"><span>${it.away}</span> @ <span>${it.home}</span></div>
        <div class="v-score">${it.as}–${it.hs}</div>
      </div>
      <div class="card__body">
        <div class="badge"> ${it.tag || it.state} </div>
        <div class="state state--${it.state || ""}">${it.state}</div>
      </div>
    `;
    frag.appendChild(card);
  }
  grid.appendChild(frag);
}

async function pull(){
  try{
    const [proj, board] = await Promise.all([
      fetchJSON("/api/projected-runs"),
      fetchJSON("/api/scoreboard")
    ]);
    renderTotals(proj);
    renderScoreboard(board);
  }catch(e){
    console.error(e);
  }
}

pull();
setInterval(pull, 30_000);
