#!/usr/bin/env node
/**
 * Builds the match snapshot the dashboard loads on start: upcoming football
 * fixtures ranked by the implied (de-vigged) chance of an away win and of
 * both teams to score, pulled from bookmaker odds.
 *
 * Runs in CI (and locally) rather than the browser because the odds provider
 * requires a server-side API key and doesn't send CORS headers for browser
 * fetches. The output is plain, pre-computed JSON the static page just reads.
 *
 * Output: docs/data/matches.json, docs/data/meta.json
 *
 * Data source: The Odds API (https://the-odds-api.com). Get a free key (500
 * requests/month) and set it as ODDS_API_KEY. Without a key this script
 * still runs, using the bundled sample fixtures in lib/sample-data.mjs, so
 * the dashboard works out of the box before you've signed up for anything.
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { averageFairProb, impliedProb, round1 } from './lib/odds.mjs';
import { buildSampleEvents } from './lib/sample-data.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'docs/data');

const API_KEY = process.env.ODDS_API_KEY || '';
const API_BASE = (process.env.ODDS_API_BASE || 'https://api.the-odds-api.com/v4').replace(/\/$/, '');
const REGIONS = process.env.ODDS_REGIONS || 'uk,eu';
// Sport keys as documented at https://the-odds-api.com/sports-odds-data/soccer-odds.html
const LEAGUES = (process.env.ODDS_LEAGUES || [
  'soccer_epl',
  'soccer_spain_la_liga',
  'soccer_italy_serie_a',
  'soccer_germany_bundesliga',
  'soccer_france_ligue_one',
  'soccer_uefa_champs_league',
].join(',')).split(',').map((s) => s.trim()).filter(Boolean);
const MAX_MATCHES = Number(process.env.MAX_MATCHES || 200);

const log = (...a) => console.log('[refresh]', ...a);

const retry = async (fn, tries = 3, wait = 1500) => {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < tries - 1) await new Promise((r) => setTimeout(r, wait * (i + 1)));
    }
  }
  throw lastErr;
};

async function fetchLeagueEvents(sportKey) {
  const url = `${API_BASE}/sports/${sportKey}/odds/?apiKey=${API_KEY}&regions=${REGIONS}&markets=h2h,btts&oddsFormat=decimal`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${sportKey}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/** Read the h2h and btts markets out of one bookmaker's quotes for an event. */
function bookmakerProbs(bookmaker, homeTeam, awayTeam) {
  const h2h = bookmaker.markets?.find((m) => m.key === 'h2h');
  const btts = bookmaker.markets?.find((m) => m.key === 'btts');
  let h2hProbs = null;
  if (h2h) {
    const home = h2h.outcomes.find((o) => o.name === homeTeam);
    const draw = h2h.outcomes.find((o) => o.name === 'Draw');
    const away = h2h.outcomes.find((o) => o.name === awayTeam);
    if (home && draw && away) {
      const p = [impliedProb(home.price), impliedProb(draw.price), impliedProb(away.price)];
      if (p.every(Number.isFinite)) h2hProbs = p; // [home, draw, away]
    }
  }
  let bttsProbs = null;
  if (btts) {
    const yes = btts.outcomes.find((o) => o.name === 'Yes');
    const no = btts.outcomes.find((o) => o.name === 'No');
    if (yes && no) {
      const p = [impliedProb(yes.price), impliedProb(no.price)];
      if (p.every(Number.isFinite)) bttsProbs = p; // [yes, no]
    }
  }
  return { h2hProbs, bttsProbs };
}

/** Turn one raw event (API or sample shape) into a ranked match record. */
function normalizeEvent(event) {
  const h2hSets = [];
  const bttsSets = [];
  let bookCount = 0;
  for (const bm of event.bookmakers || []) {
    const { h2hProbs, bttsProbs } = bookmakerProbs(bm, event.home_team, event.away_team);
    if (h2hProbs || bttsProbs) bookCount++;
    if (h2hProbs) h2hSets.push(h2hProbs);
    if (bttsProbs) bttsSets.push(bttsProbs);
  }
  if (h2hSets.length === 0 || bttsSets.length === 0) return null;

  const homeWinProb = averageFairProb(h2hSets, 0);
  const drawProb = averageFairProb(h2hSets, 1);
  const awayWinProb = averageFairProb(h2hSets, 2);
  const bttsYesProb = averageFairProb(bttsSets, 0);
  const bttsNoProb = averageFairProb(bttsSets, 1);
  if (!Number.isFinite(awayWinProb) || !Number.isFinite(bttsYesProb)) return null;

  return {
    id: event.id,
    league: event.sport_title || event.sport_key,
    kickoff: event.commence_time,
    home: event.home_team,
    away: event.away_team,
    homeWinPct: round1(homeWinProb),
    drawPct: round1(drawProb),
    awayWinPct: round1(awayWinProb),
    bttsYesPct: round1(bttsYesProb),
    bttsNoPct: round1(bttsNoProb),
    combinedPct: round1(awayWinProb * bttsYesProb),
    bookmakerCount: bookCount,
  };
}

async function main() {
  const sources = {};
  let rawEvents = [];
  let isSample = false;
  let fallbackReason = null;

  if (!API_KEY) {
    isSample = true;
    fallbackReason = 'ODDS_API_KEY is not set';
    rawEvents = buildSampleEvents();
    sources.sample = { ok: true, events: rawEvents.length };
  } else {
    for (const league of LEAGUES) {
      try {
        const events = await retry(() => fetchLeagueEvents(league));
        sources[league] = { ok: true, events: events.length };
        rawEvents.push(...events);
      } catch (err) {
        sources[league] = { ok: false, events: 0, error: String(err.message || err) };
        log(`WARN ${league} failed:`, err.message || err);
      }
    }
    if (rawEvents.length === 0) {
      isSample = true;
      fallbackReason = 'every league request failed, see sources for errors';
      rawEvents = buildSampleEvents();
      sources.sample = { ok: true, events: rawEvents.length };
    }
  }

  const now = Date.now();
  const matches = rawEvents
    .map(normalizeEvent)
    .filter(Boolean)
    .filter((m) => new Date(m.kickoff).getTime() > now)
    .sort((a, b) => b.combinedPct - a.combinedPct)
    .slice(0, MAX_MATCHES);

  await mkdir(OUT, { recursive: true });
  await writeFile(
    resolve(OUT, 'matches.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), isSample, matches }, null, 2),
  );
  await writeFile(
    resolve(OUT, 'meta.json'),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        isSample,
        fallbackReason,
        sources,
        totals: { matches: matches.length, leagues: Object.keys(sources).length },
      },
      null,
      2,
    ),
  );

  log(`wrote ${matches.length} matches (${isSample ? 'sample data' : 'live odds'})`);
}

main().catch((err) => {
  console.error('[refresh] fatal:', err);
  process.exit(1);
});
