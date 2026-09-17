/**
 * Odds math: converting bookmaker prices into fair (de-vigged) probabilities.
 *
 * A bookmaker's quoted prices always imply more than 100% because their
 * margin ("overround") is baked in. Dividing each outcome's implied
 * probability by the sum across all outcomes in that market removes the
 * margin and leaves a fair estimate of the true chance.
 */

/** Decimal odds -> implied probability, e.g. 2.50 -> 0.40. */
export function impliedProb(decimalOdds) {
  if (!Number.isFinite(decimalOdds) || decimalOdds <= 1) return null;
  return 1 / decimalOdds;
}

/** Remove the bookmaker's overround from a set of implied probabilities for one market. */
export function devig(probs) {
  const sum = probs.reduce((a, b) => a + b, 0);
  if (!(sum > 0)) return probs.map(() => null);
  return probs.map((p) => p / sum);
}

/**
 * Average the fair (de-vigged) probability of one outcome across several
 * bookmakers, so a single quoted price can't dominate the estimate.
 *
 * @param {number[][]} marketsProbs - one array of implied probs per bookmaker,
 *   in the same outcome order every time.
 * @param {number} outcomeIndex - which outcome to read out after de-vigging.
 */
export function averageFairProb(marketsProbs, outcomeIndex) {
  const fair = marketsProbs
    .map((probs) => devig(probs)[outcomeIndex])
    .filter((p) => Number.isFinite(p));
  if (fair.length === 0) return null;
  return fair.reduce((a, b) => a + b, 0) / fair.length;
}

export const round1 = (p) => (Number.isFinite(p) ? Math.round(p * 1000) / 10 : null);
