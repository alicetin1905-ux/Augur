const state = {
  matches: [],
  meta: null,
  leagues: new Set(),
  activeLeague: 'all',
  search: '',
  sort: 'combined',
  minCombined: 0,
  sortDir: -1,
};

const $ = (id) => document.getElementById(id);

async function load() {
  setStatus('loading…', null);
  try {
    const [matchesRes, metaRes] = await Promise.all([
      fetch(`data/matches.json?_=${Date.now()}`),
      fetch(`data/meta.json?_=${Date.now()}`),
    ]);
    if (!matchesRes.ok) throw new Error(`matches.json: HTTP ${matchesRes.status}`);
    const matchesJson = await matchesRes.json();
    state.meta = metaRes.ok ? await metaRes.json() : null;
    state.matches = matchesJson.matches || [];
    state.leagues = new Set(state.matches.map((m) => m.league));
    renderChips();
    render();
    setStatus(`updated ${timeAgo(matchesJson.generatedAt)}`, 'ok');
    $('sampleBanner').hidden = !matchesJson.isSample;
  } catch (err) {
    setStatus(`failed to load data: ${err.message}`, 'err');
    $('matchBody').innerHTML = `<tr><td colspan="10" class="empty">Could not load match data. Run "npm run refresh" locally, or wait for the next CI deploy.</td></tr>`;
  }
}

function setStatus(text, kind) {
  $('statusText').textContent = text;
  const dot = $('statusDot');
  dot.className = 'dot' + (kind ? ` ${kind}` : '');
}

function timeAgo(iso) {
  if (!iso) return 'unknown time';
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function fmtKickoff(iso) {
  const d = new Date(iso);
  const diffH = (d.getTime() - Date.now()) / 3600000;
  const abs = d.toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' });
  const rel = diffH < 1 ? 'soon' : diffH < 24 ? `in ${Math.round(diffH)}h` : `in ${Math.round(diffH / 24)}d`;
  return `${abs} · ${rel}`;
}

function renderChips() {
  const box = $('leagueChips');
  const leagues = ['all', ...Array.from(state.leagues).sort()];
  box.innerHTML = leagues
    .map((l) => `<button class="chip${l === state.activeLeague ? ' active' : ''}" data-league="${escapeAttr(l)}">${l === 'all' ? 'All leagues' : escapeHtml(l)}</button>`)
    .join('');
  box.querySelectorAll('.chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.activeLeague = btn.dataset.league;
      renderChips();
      render();
    });
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

function filtered() {
  const q = state.search.trim().toLowerCase();
  return state.matches.filter((m) => {
    if (state.activeLeague !== 'all' && m.league !== state.activeLeague) return false;
    if (m.combinedPct < state.minCombined) return false;
    if (q && !(`${m.home} ${m.away} ${m.league}`.toLowerCase().includes(q))) return false;
    return true;
  });
}

function sortKeyFn(key) {
  return {
    combined: (m) => m.combinedPct,
    away: (m) => m.awayWinPct,
    btts: (m) => m.bttsYesPct,
    home: (m) => m.homeWinPct,
    draw: (m) => m.drawPct,
    kickoff: (m) => -new Date(m.kickoff).getTime(),
  }[key] || ((m) => m.combinedPct);
}

function render() {
  const rows = filtered();
  const key = sortKeyFn(state.sort);
  rows.sort((a, b) => (key(a) - key(b)) * state.sortDir);

  // Highlight the strongest quarter of the currently visible rows, rather
  // than a fixed threshold that would mean different things per league mix.
  const sortedByCombined = [...rows].sort((a, b) => b.combinedPct - a.combinedPct);
  const hotCutoffIdx = Math.max(0, Math.ceil(sortedByCombined.length * 0.25) - 1);
  const hotCutoff = sortedByCombined.length ? sortedByCombined[hotCutoffIdx].combinedPct : Infinity;

  $('rowCount').textContent = `${rows.length} match${rows.length === 1 ? '' : 'es'}`;

  $('matchBody').innerHTML = rows.length
    ? rows
        .map((m) => `
          <tr class="${m.combinedPct >= hotCutoff && m.combinedPct > 0 ? 'hot' : ''}">
            <td>${fmtKickoff(m.kickoff)}</td>
            <td>${escapeHtml(m.league)}</td>
            <td>${escapeHtml(m.home)}</td>
            <td>${escapeHtml(m.away)}</td>
            <td class="num">${fmtPct(m.homeWinPct)}</td>
            <td class="num">${fmtPct(m.drawPct)}</td>
            <td class="num">${fmtPct(m.awayWinPct)}</td>
            <td class="num">${fmtPct(m.bttsYesPct)}</td>
            <td class="num combined">${fmtPct(m.combinedPct)}</td>
            <td class="num">${m.bookmakerCount}</td>
          </tr>`)
        .join('')
    : `<tr><td colspan="10" class="empty">No matches match the current filters.</td></tr>`;

  const totalMatches = state.matches.length;
  $('tMatches').textContent = totalMatches;
  $('tLeagues').textContent = state.leagues.size;
  $('tTopCombined').textContent = totalMatches ? fmtPct(Math.max(...state.matches.map((m) => m.combinedPct))) : '—';
  const in24h = state.matches.filter((m) => (new Date(m.kickoff).getTime() - Date.now()) / 3600000 <= 24).length;
  $('tSoon').textContent = in24h;
}

function fmtPct(v) { return Number.isFinite(v) ? `${v.toFixed(1)}%` : '—'; }

function initTheme() {
  let theme = 'dark';
  try { theme = localStorage.getItem('augur-theme') || 'dark'; } catch {}
  document.documentElement.dataset.theme = theme;
  $('themeBtn').textContent = theme === 'dark' ? 'Light' : 'Dark';
}

$('themeBtn').addEventListener('click', () => {
  const cur = document.documentElement.dataset.theme;
  const next = cur === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  $('themeBtn').textContent = next === 'dark' ? 'Light' : 'Dark';
  try { localStorage.setItem('augur-theme', next); } catch {}
});

$('refreshBtn').addEventListener('click', load);
$('search').addEventListener('input', (e) => { state.search = e.target.value; render(); });
$('sort').addEventListener('change', (e) => { state.sort = e.target.value; render(); });
$('minCombined').addEventListener('change', (e) => { state.minCombined = Number(e.target.value); render(); });

document.querySelectorAll('th[data-sort]').forEach((th) => {
  th.addEventListener('click', () => {
    const key = th.dataset.sort;
    if (state.sort === key) state.sortDir *= -1;
    else { state.sort = key; state.sortDir = -1; }
    render();
  });
});

initTheme();
load();
setInterval(load, 5 * 60 * 1000);
