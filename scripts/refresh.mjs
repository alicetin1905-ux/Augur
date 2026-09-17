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
 *
 * The main /odds endpoint only serves h2h/spreads/totals — "additional"
 * markets like btts are only available per event via /events/{id}/odds
 * (see https://the-odds-api.com/liveapi/guides/v4/#get-event-odds), so this
 * makes one call per league for fixtures + h2h, then one call per upcoming
 * event for btts. EVENTS_PER_LEAGUE caps that fan-out to stay within the
 * free tier's monthly quota.
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
  'soccer_germany_bundesliga2',
  'soccer_france_ligue_one',
  'soccer_turkey_super_league',
  'soccer_uefa_champs_league',
].join(',')).split(',').map((s) => s.trim()).filter(Boolean);
const MAX_MATCHES = Number(process.env.MAX_MATCHES || 200);
// Each event needs its own request for the btts market, so this bounds the
// fan-out per league to keep a refresh within the free-tier monthly quota.
const EVENTS_PER_LEAGUE = Number(process.env.EVENTS_PER_LEAGUE || 8);
const CONCURRENCY = Number(process.env.CONCURRENCY || 4);

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

/** Run tasks with bounded concurrency, tolerating individual failures. */
async function pool(items, worker, limit = CONCURRENCY) {
  const out = [];
  let i = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try {
        out[idx] = await worker(items[idx], idx);
      } catch (err) {
        out[idx] = null;
      }
    }
  });
  await Promise.all(runners);
  return out;
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url.split('?')[0]}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/** Fixtures + match-winner odds for a league — the only markets the main endpoint serves. */
async function fetchLeagueH2h(sportKey) {
  return fetchJson(`${API_BASE}/sports/${sportKey}/odds/?apiKey=${API_KEY}&regions=${REGIONS}&markets=h2h&oddsFormat=decimal`);
}

/** The btts market for one event — only available through the per-event endpoint. */
async function fetchEventBtts(sportKey, eventId) {
  return fetchJson(`${API_BASE}/sports/${sportKey}/events/${eventId}/odds/?apiKey=${API_KEY}&regions=${REGIONS}&markets=btts&oddsFormat=decimal`);
}

/** Read the h2h market out of one bookmaker's quotes for an event. */
function h2hProbsFor(bookmaker, homeTeam, awayTeam) {
  const h2h = bookmaker.markets?.find((m) => m.key === 'h2h');
  if (!h2h) return null;
  const home = h2h.outcomes.find((o) => o.name === homeTeam);
  const draw = h2h.outcomes.find((o) => o.name === 'Draw');
  const away = h2h.outcomes.find((o) => o.name === awayTeam);
  if (!home || !draw || !away) return null;
  const p = [impliedProb(home.price), impliedProb(draw.price), impliedProb(away.price)];
  return p.every(Number.isFinite) ? p : null; // [home, draw, away]
}

/** Read the btts market out of one bookmaker's quotes for an event. */
function bttsProbsFor(bookmaker) {
  const btts = bookmaker.markets?.find((m) => m.key === 'btts');
  if (!btts) return null;
  const yes = btts.outcomes.find((o) => o.name === 'Yes');
  const no = btts.outcomes.find((o) => o.name === 'No');
  if (!yes || !no) return null;
  const p = [impliedProb(yes.price), impliedProb(no.price)];
  return p.every(Number.isFinite) ? p : null; // [yes, no]
}

/** Combine one event's h2h response with its btts response into a ranked match record. */
function normalizeEvent(event, bttsEvent) {
  const h2hSets = [];
  const bttsSets = [];
  const bookmakerKeys = new Set();
  for (const bm of event.bookmakers || []) {
    const probs = h2hProbsFor(bm, event.home_team, event.away_team);
    if (probs) { h2hSets.push(probs); bookmakerKeys.add(bm.key); }
  }
  for (const bm of bttsEvent?.bookmakers || []) {
    const probs = bttsProbsFor(bm);
    if (probs) { bttsSets.push(probs); bookmakerKeys.add(bm.key); }
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
    bookmakerCount: bookmakerKeys.size,
  };
}

async function main() {
  const sources = {};
  let matches = [];
  let isSample = false;
  let fallbackReason = null;
  const now = Date.now();

  if (!API_KEY) {
    isSample = true;
    fallbackReason = 'ODDS_API_KEY is not set';
    const sampleEvents = buildSampleEvents();
    matches = sampleEvents.map((e) => normalizeEvent(e, e)).filter(Boolean);
    sources.sample = { ok: true, events: sampleEvents.length };
  } else {
    for (const league of LEAGUES) {
      try {
        const events = (await retry(() => fetchLeagueH2h(league)))
          .filter((e) => new Date(e.commence_time).getTime() > now)
          .sort((a, b) => new Date(a.commence_time) - new Date(b.commence_time))
          .slice(0, EVENTS_PER_LEAGUE);

        const bttsEvents = await pool(events, (e) => retry(() => fetchEventBtts(league, e.id), 2));
        const leagueMatches = events.map((e, i) => normalizeEvent(e, bttsEvents[i])).filter(Boolean);

        sources[league] = { ok: true, events: leagueMatches.length };
        matches.push(...leagueMatches);
      } catch (err) {
        sources[league] = { ok: false, events: 0, error: String(err.message || err) };
        log(`WARN ${league} failed:`, err.message || err);
      }
    }
    if (matches.length === 0) {
      isSample = true;
      fallbackReason = 'every league returned no usable odds, see sources for errors';
      const sampleEvents = buildSampleEvents();
      matches = sampleEvents.map((e) => normalizeEvent(e, e)).filter(Boolean);
      sources.sample = { ok: true, events: sampleEvents.length };
    }
  }

  matches = matches.sort((a, b) => b.combinedPct - a.combinedPct).slice(0, MAX_MATCHES);

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
