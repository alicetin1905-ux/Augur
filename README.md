# Augur

A dashboard that ranks upcoming football matches by the implied chance of an
**away win** and of **both teams to score (BTTS)**, computed from bookmaker
odds.

Live site: `https://alicetin1905-ux.github.io/augur/` (once the first deploy
finishes — see [Deploying](#deploying)).

## How the numbers work

Bookmaker prices always imply a bit more than 100% because their margin
("overround") is baked in. For every match, `scripts/refresh.mjs`:

1. Pulls the `h2h` (match winner) and `btts` (both teams to score) markets
   from every available bookmaker.
2. Converts each price to an implied probability (`1 / decimal odds`).
3. Removes the overround per bookmaker per market (de-vigging: divide each
   outcome by the sum of all outcomes in that market).
4. Averages the de-vigged probability across bookmakers, so one bookmaker's
   price can't skew the estimate.
5. Ranks matches by `awayWinChance × bttsYesChance` — the combined chance
   both things happen — while still showing each number on its own so you
   can sort by either one alone.

These are still just odds-implied estimates, not certainties, and nothing
here is betting advice. See the footer disclaimer on the dashboard itself.

## Data source

Odds come from [The Odds API](https://the-odds-api.com), which has a free
tier (500 requests/month). Get a key and set it as the `ODDS_API_KEY` repo
secret (Settings → Secrets and variables → Actions) to switch the dashboard
from sample data to live odds.

Without a key, `scripts/refresh.mjs` falls back to the bundled fixtures in
`scripts/lib/sample-data.mjs` — fictional teams and leagues, so the demo
never looks like a real bookmaker's numbers on a real match. This means the
dashboard works immediately after the first deploy, with no signup required.

Which leagues are queried is controlled by `ODDS_LEAGUES` (comma-separated
[sport keys](https://the-odds-api.com/sports-odds-data/soccer-odds.html),
default is the top five European leagues plus the Champions League).

## Running locally

```sh
npm run refresh   # builds docs/data/matches.json + meta.json
npm run serve     # serves docs/ at http://localhost:8080
```

Set `ODDS_API_KEY` in your shell (or a `.env` loaded by your shell) before
`npm run refresh` to pull live odds instead of sample data.

## Deploying

The GitHub Actions workflow (`.github/workflows/deploy.yml`) runs
`scripts/refresh.mjs` on a schedule, on every push to `main`, and on manual
dispatch, then publishes `docs/` to GitHub Pages. Nothing under `docs/data/`
is committed — each deploy rebuilds it fresh, so the repo doesn't grow over
time (see `.gitignore`).

To turn on Pages for this repo: Settings → Pages → Build and deployment →
Source: **GitHub Actions**.

## Architecture

Plain Node scripts + a static page, no build step or framework:

```
scripts/
  refresh.mjs       fetches odds, computes probabilities, writes docs/data/*.json
  serve.mjs         local static file server for docs/
  lib/odds.mjs       de-vigging / implied-probability math
  lib/sample-data.mjs bundled demo fixtures used when no API key is set
docs/
  index.html, styles.css, js/app.js   the dashboard itself
  data/*.json        generated snapshot (gitignored, built by CI)
```
