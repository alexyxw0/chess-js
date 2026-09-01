// Turning a score into a bar. Pure, so the sign conventions can be pinned by
// tests — getting one backwards produces a bar that looks plausible and is
// exactly wrong.

export const MATE_THRESHOLD = 99000;

/**
 * Centipawns to White's share of the bar, 0..1.
 *
 * A linear scale is useless: most of a game sits inside ±200 centipawns, and
 * being a queen up would peg the bar and stop moving. This is the usual
 * logistic pawns-to-win-probability curve, so small edges stay visible and
 * large ones saturate gently.
 */
export const barFraction = (cp) => 1 / (1 + Math.pow(10, -cp / 400));

/**
 * Score as the bar should present it.
 * @param {number} scoreForSideToMove score from the moving side's point of view
 * @param {boolean} whiteToMove
 * @returns {{fraction: number, label: string, white: number}}
 */
export function evalDisplay(scoreForSideToMove, whiteToMove) {
  // The engine reports from the side to move; the bar is always White's view.
  const white = whiteToMove ? scoreForSideToMove : -scoreForSideToMove;

  if (Math.abs(white) > MATE_THRESHOLD) {
    return { white, fraction: white > 0 ? 1 : 0, label: white > 0 ? "M" : "-M" };
  }
  return { white, fraction: barFraction(white), label: (white / 100).toFixed(1) };
}
