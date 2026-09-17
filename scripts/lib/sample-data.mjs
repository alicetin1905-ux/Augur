/**
 * Bundled demo fixtures, shaped exactly like a response from The Odds API
 * (https://the-odds-api.com/liveapi/guides/v4/#get-odds), so refresh.mjs can
 * run the same parsing path whether the data came from the network or here.
 *
 * Used only when ODDS_API_KEY is unset, so `npm run refresh` and the first
 * deploy produce a working dashboard with no account signup required. Team
 * and league names are intentionally fictional to avoid presenting made-up
 * odds as if they were a real bookmaker's prices on a real match.
 */

const HOUR = 60 * 60 * 1000;

// [home, away, home odds, draw odds, away odds, btts-yes odds, btts-no odds] per bookmaker quote.
const FIXTURES = [
  { league: 'Riverside Premier', home: 'Riverside City', away: 'Harrow Athletic', kickoffIn: 20 * HOUR, books: [
    [2.30, 3.40, 2.90, 1.70, 2.05], [2.25, 3.50, 3.00, 1.72, 2.02], [2.35, 3.30, 2.85, 1.68, 2.08],
  ] },
  { league: 'Riverside Premier', home: 'Meadowvale United', away: 'Castlebridge Rovers', kickoffIn: 22 * HOUR, books: [
    [1.60, 4.20, 5.50, 2.10, 1.65], [1.65, 4.00, 5.20, 2.05, 1.68], [1.58, 4.30, 5.60, 2.15, 1.62],
  ] },
  { league: 'Northgate Division One', home: 'Northgate Wanderers', away: 'Ashfield Town', kickoffIn: 26 * HOUR, books: [
    [3.20, 3.30, 2.20, 1.85, 1.90], [3.10, 3.40, 2.25, 1.80, 1.95], [3.25, 3.25, 2.15, 1.88, 1.87],
  ] },
  { league: 'Northgate Division One', home: 'Fenwick Albion', away: 'Blackfriars FC', kickoffIn: 27 * HOUR, books: [
    [2.05, 3.60, 3.50, 2.30, 1.55], [2.10, 3.50, 3.40, 2.25, 1.58], [2.00, 3.70, 3.60, 2.35, 1.52],
  ] },
  { league: 'Coastal League', home: 'Southbay Mariners', away: 'Port Vale Wanderers', kickoffIn: 30 * HOUR, books: [
    [4.50, 3.80, 1.75, 1.60, 2.20], [4.30, 3.70, 1.78, 1.55, 2.25], [4.60, 3.90, 1.72, 1.62, 2.18],
  ] },
  { league: 'Coastal League', home: 'Elmhurst Rangers', away: 'Dockyard United', kickoffIn: 32 * HOUR, books: [
    [1.90, 3.50, 4.00, 1.75, 2.00], [1.95, 3.40, 3.90, 1.72, 2.05], [1.88, 3.55, 4.10, 1.78, 1.97],
  ] },
  { league: 'Highland Cup', home: 'Glenfield Thistle', away: 'Kirkbrae City', kickoffIn: 36 * HOUR, books: [
    [2.60, 3.30, 2.70, 1.95, 1.80], [2.55, 3.40, 2.75, 1.90, 1.85], [2.65, 3.25, 2.65, 1.98, 1.78],
  ] },
  { league: 'Highland Cup', home: 'Aberlour Athletic', away: 'Strathmore FC', kickoffIn: 40 * HOUR, books: [
    [1.75, 3.80, 4.60, 2.00, 1.72], [1.80, 3.70, 4.40, 1.95, 1.75], [1.72, 3.85, 4.70, 2.05, 1.70],
  ] },
  { league: 'Westford League', home: 'Westford Dynamo', away: 'Rivermouth United', kickoffIn: 44 * HOUR, books: [
    [2.90, 3.30, 2.50, 1.65, 2.10], [2.85, 3.40, 2.55, 1.62, 2.15], [2.95, 3.25, 2.45, 1.68, 2.05],
  ] },
  { league: 'Westford League', home: 'Oldbridge Town', away: 'Hartswell Rovers', kickoffIn: 48 * HOUR, books: [
    [3.60, 3.40, 2.05, 1.80, 1.92], [3.50, 3.50, 2.10, 1.75, 1.95], [3.70, 3.30, 2.00, 1.85, 1.90],
  ] },
];

export function buildSampleEvents(now = Date.now()) {
  return FIXTURES.map((f, i) => ({
    id: `sample-${i}`,
    sport_key: 'sample_soccer',
    sport_title: f.league,
    commence_time: new Date(now + f.kickoffIn).toISOString(),
    home_team: f.home,
    away_team: f.away,
    bookmakers: f.books.map((odds, j) => ({
      key: `demo-book-${j + 1}`,
      title: `Demo Book ${j + 1}`,
      markets: [
        {
          key: 'h2h',
          outcomes: [
            { name: f.home, price: odds[0] },
            { name: 'Draw', price: odds[1] },
            { name: f.away, price: odds[2] },
          ],
        },
        {
          key: 'btts',
          outcomes: [
            { name: 'Yes', price: odds[3] },
            { name: 'No', price: odds[4] },
          ],
        },
      ],
    })),
  }));
}
