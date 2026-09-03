// Static evaluation: material, piece-square tables, and king safety.
//
// King safety is what turns a tactically sharp engine into one that plays
// *for* something. Without it there is no reason to walk a knight toward the
// enemy king, no reason to keep a pawn shield, and no reason to prise open a
// file — so the engine defends accurately and never initiates.
//
// Everything here is phase-scaled: king safety matters in a middlegame and
// stops mattering once the queens are gone, and the king itself wants to hide
// early and centralise late. A single set of numbers gets both wrong.

import { EMPTY, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, WHITE, BLACK,
         KNIGHT_OFFSETS, KING_OFFSETS, BISHOP_OFFSETS, ROOK_OFFSETS,
         pieceType, pieceColour, fileOf, rankOf, makePiece, onBoard } from "./board.js";

export const PIECE_VALUE = [0, 100, 320, 330, 500, 900, 20000];

// Read as White's view of the board, a8 at top-left. Mirrored for Black.
const PAWN_PST = [
   0,  0,  0,  0,  0,  0,  0,  0,
  50, 50, 50, 50, 50, 50, 50, 50,
  10, 10, 20, 30, 30, 20, 10, 10,
   5,  5, 10, 25, 25, 10,  5,  5,
   0,  0,  0, 20, 20,  0,  0,  0,
   5, -5,-10,  0,  0,-10, -5,  5,
   5, 10, 10,-20,-20, 10, 10,  5,
   0,  0,  0,  0,  0,  0,  0,  0,
];
const KNIGHT_PST = [
 -50,-40,-30,-30,-30,-30,-40,-50,
 -40,-20,  0,  0,  0,  0,-20,-40,
 -30,  0, 10, 15, 15, 10,  0,-30,
 -30,  5, 15, 20, 20, 15,  5,-30,
 -30,  0, 15, 20, 20, 15,  0,-30,
 -30,  5, 10, 15, 15, 10,  5,-30,
 -40,-20,  0,  5,  5,  0,-20,-40,
 -50,-40,-30,-30,-30,-30,-40,-50,
];
const BISHOP_PST = [
 -20,-10,-10,-10,-10,-10,-10,-20,
 -10,  0,  0,  0,  0,  0,  0,-10,
 -10,  0,  5, 10, 10,  5,  0,-10,
 -10,  5,  5, 10, 10,  5,  5,-10,
 -10,  0, 10, 10, 10, 10,  0,-10,
 -10, 10, 10, 10, 10, 10, 10,-10,
 -10,  5,  0,  0,  0,  0,  5,-10,
 -20,-10,-10,-10,-10,-10,-10,-20,
];
const ROOK_PST = [
   0,  0,  0,  0,  0,  0,  0,  0,
   5, 10, 10, 10, 10, 10, 10,  5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
  -5,  0,  0,  0,  0,  0,  0, -5,
   0,  0,  0,  5,  5,  0,  0,  0,
];
const QUEEN_PST = [
 -20,-10,-10, -5, -5,-10,-10,-20,
 -10,  0,  0,  0,  0,  0,  0,-10,
 -10,  0,  5,  5,  5,  5,  0,-10,
  -5,  0,  5,  5,  5,  5,  0, -5,
   0,  0,  5,  5,  5,  5,  0, -5,
 -10,  5,  5,  5,  5,  5,  0,-10,
 -10,  0,  5,  0,  0,  0,  0,-10,
 -20,-10,-10, -5, -5,-10,-10,-20,
];
// Middlegame king: stay tucked behind pawns.
const KING_MG_PST = [
 -30,-40,-40,-50,-50,-40,-40,-30,
 -30,-40,-40,-50,-50,-40,-40,-30,
 -30,-40,-40,-50,-50,-40,-40,-30,
 -30,-40,-40,-50,-50,-40,-40,-30,
 -20,-30,-30,-40,-40,-30,-30,-20,
 -10,-20,-20,-20,-20,-20,-20,-10,
  20, 20,  0,  0,  0,  0, 20, 20,
  20, 30, 10,  0,  0, 10, 30, 20,
];

// Endgame king: the opposite instinct — walk to the middle and help.
const KING_EG_PST = [
 -50,-40,-30,-20,-20,-30,-40,-50,
 -30,-20,-10,  0,  0,-10,-20,-30,
 -30,-10, 20, 30, 30, 20,-10,-30,
 -30,-10, 30, 40, 40, 30,-10,-30,
 -30,-10, 30, 40, 40, 30,-10,-30,
 -30,-10, 20, 30, 30, 20,-10,-30,
 -30,-30,  0,  0,  0,  0,-30,-30,
 -50,-30,-30,-30,-30,-30,-30,-50,
];

const TABLES = { [PAWN]: PAWN_PST, [KNIGHT]: KNIGHT_PST, [BISHOP]: BISHOP_PST,
                 [ROOK]: ROOK_PST, [QUEEN]: QUEEN_PST, [KING]: KING_MG_PST };

// A table one entry short silently shifts every square after the gap, and the
// evaluation still looks plausible. Fail loudly at load instead. (This caught a
// real 63-entry king table.)
for (const [type, table] of Object.entries({ ...TABLES, eg: KING_EG_PST })) {
  if (table.length !== 64) {
    throw new Error(`piece-square table ${type} has ${table.length} entries, expected 64`);
  }
}

// ── phase ───────────────────────────────────────────────────────────────────

// Weight of each piece toward "still a middlegame". Pawns count for nothing:
// a position with every pawn and no pieces is an endgame.
const PHASE_WEIGHT = [0, 0, 1, 1, 2, 4, 0];
const MAX_PHASE = 24;   // 4 knights + 4 bishops + 4 rooks + 2 queens

/** 1.0 at the opening, falling to 0.0 once only kings and pawns remain. */
export function phaseOf(board) {
  let phase = 0;
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) { sq += 7; continue; }
    phase += PHASE_WEIGHT[pieceType(board.squares[sq])];
  }
  return Math.min(phase, MAX_PHASE) / MAX_PHASE;
}

// ── pawn structure ──────────────────────────────────────────────────────────

// A passed pawn's value is almost all in how close it is to promoting, so this
// is indexed by rank from the owner's side. The last entry is unreachable — a
// pawn on the 8th has already promoted.
const PASSED_BONUS = [0, 8, 16, 32, 64, 110, 180, 0];
const DOUBLED_PENALTY = 18;
const ISOLATED_PENALTY = 16;

/**
 * Doubled, isolated and passed pawns for one side, in centipawns.
 *
 * Without this the evaluation cannot tell a passed pawn from any other pawn,
 * which means it plays endgames blind to the thing that usually decides them.
 *
 * One pass builds per-file counts and the frontmost pawn per file for both
 * colours; the three terms are then file lookups rather than board scans.
 */
export function pawnStructure(board, colour) {
  const us = makePiece(PAWN, colour);
  const them = makePiece(PAWN, colour ^ 1);

  const ourCount = new Int8Array(8);
  const theirCount = new Int8Array(8);
  // How far the most advanced pawn on each file has come, from its own side.
  const ourBest = new Int8Array(8).fill(-1);
  const theirBest = new Int8Array(8).fill(-1);

  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) { sq += 7; continue; }
    const piece = board.squares[sq];
    if (piece !== us && piece !== them) continue;
    const file = fileOf(sq);
    const rank = rankOf(sq);
    if (piece === us) {
      ourCount[file]++;
      const advance = colour === WHITE ? rank : 7 - rank;
      if (advance > ourBest[file]) ourBest[file] = advance;
    } else {
      theirCount[file]++;
      const advance = colour === WHITE ? rank : 7 - rank;
      // Stored from OUR point of view, so a bigger number is closer to us.
      if (theirBest[file] < 0 || advance < theirBest[file]) theirBest[file] = advance;
    }
  }

  let score = 0;
  for (let file = 0; file < 8; file++) {
    const count = ourCount[file];
    if (count === 0) continue;

    // Two pawns on a file get in each other's way; three is worse still.
    if (count > 1) score -= DOUBLED_PENALTY * (count - 1);

    // No friendly pawn on either neighbouring file: nothing can ever defend it.
    const left = file > 0 ? ourCount[file - 1] : 0;
    const right = file < 7 ? ourCount[file + 1] : 0;
    if (left === 0 && right === 0) score -= ISOLATED_PENALTY;

    // Passed: no enemy pawn on this file or its neighbours can still stop it.
    const advance = ourBest[file];
    let blocked = false;
    for (let df = -1; df <= 1 && !blocked; df++) {
      const f = file + df;
      if (f < 0 || f > 7 || theirCount[f] === 0) continue;
      // theirBest is that file's enemy pawn nearest our promotion square.
      if (theirBest[f] > advance) blocked = true;
    }
    if (!blocked) score += PASSED_BONUS[advance];
  }
  return score;
}

// ── mobility ────────────────────────────────────────────────────────────────

// Centipawns per available square. The weights are roughly inverse to how many
// squares each piece can reach at best, so no one piece dominates the term: a
// knight tops out around 8 squares and a queen around 27, and without that
// scaling the queen's mobility would swamp everything else.
const MOBILITY_WEIGHT = [0, 0, 4, 3, 2, 1, 0];

// What counts as ordinary for each piece. The term scores the *difference*
// from this, not the raw count — otherwise having more pieces would score as
// mobility, which is just material counted twice, and every evaluation would
// drift upward with the side that happens to have more wood.
const MOBILITY_BASE = [0, 0, 4, 6, 7, 14, 0];

const SLIDER_RAYS = {
  [BISHOP]: BISHOP_OFFSETS,
  [ROOK]: ROOK_OFFSETS,
  [QUEEN]: KING_OFFSETS,
};

/** Is `square` covered by one of `byColour`'s pawns? */
function attackedByPawn(board, square, byColour) {
  const pawn = makePiece(PAWN, byColour);
  const back = byColour === WHITE ? -1 : 1;
  for (const side of [15, 17]) {
    const from = square + side * back;
    if (onBoard(from) && board.squares[from] === pawn) return true;
  }
  return false;
}

/**
 * How many squares a piece can actually go to.
 *
 * Squares covered by an enemy pawn do not count. A knight with eight moves
 * that all drop it in front of a pawn is not mobile, it is just surrounded —
 * and rewarding those squares would have the engine parking pieces where they
 * get kicked.
 */
function movesAvailable(board, from, piece) {
  const type = pieceType(piece), us = pieceColour(piece), them = us ^ 1;
  const sq = board.squares;
  let count = 0;

  const usable = (to) => {
    const target = sq[to];
    if (target !== EMPTY && pieceColour(target) === us) return false;
    return !attackedByPawn(board, to, them);
  };

  if (type === KNIGHT) {
    for (const offset of KNIGHT_OFFSETS) {
      const to = from + offset;
      if (onBoard(to) && usable(to)) count++;
    }
    return count;
  }

  const rays = SLIDER_RAYS[type];
  if (!rays) return 0;                       // pawns and kings are excluded
  for (const offset of rays) {
    for (let to = from + offset; onBoard(to); to += offset) {
      if (usable(to)) count++;
      if (sq[to] !== EMPTY) break;           // blocked, including by a capture
    }
  }
  return count;
}

// Mobility is the most expensive term here — it walks every slider's rays at
// every leaf. Toggleable so its worth can be measured rather than assumed;
// see bench/match.js.
let mobilityEnabled = true;
export const setMobility = (on) => { mobilityEnabled = on; };

/** Mobility for one side, in centipawns, relative to ordinary. */
export function mobility(board, colour) {
  let score = 0;
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) { sq += 7; continue; }
    const piece = board.squares[sq];
    if (piece === EMPTY || pieceColour(piece) !== colour) continue;
    const type = pieceType(piece);
    const weight = MOBILITY_WEIGHT[type];
    if (weight === 0) continue;
    score += (movesAvailable(board, sq, piece) - MOBILITY_BASE[type]) * weight;
  }
  return score;
}

// ── king safety ─────────────────────────────────────────────────────────────

// How much each enemy piece near the king is worth as a threat. A queen in the
// neighbourhood is the difference between an attack and an inconvenience.
const TROPISM = [0, 0, 3, 2, 2, 6, 0];

const SHIELD_INTACT = 12;      // per pawn directly in front of the king
const SHIELD_ADVANCED = 5;     // per pawn one square further out
const OPEN_FILE_NEAR_KING = 18;

/** Chebyshev distance, which is how a king actually travels. */
function kingDistance(a, b) {
  return Math.max(Math.abs(fileOf(a) - fileOf(b)), Math.abs(rankOf(a) - rankOf(b)));
}

/**
 * How exposed `colour`'s king is, in centipawns to subtract. Three parts:
 * enemy pieces closing in, a missing pawn shield, and open files pointing at
 * the king. Positive means "worse for the defender".
 */
export function kingDanger(board, colour) {
  const kingSq = board.kingSquare[colour];
  if (kingSq < 0) return 0;
  const enemy = colour ^ 1;
  const kingFile = fileOf(kingSq);
  let danger = 0;

  // Enemy pieces closing in. Distance 1 is worth the full weight, and it falls
  // away to nothing by distance 6 — far enough that a piece has to actually
  // commit to the attack before it scores.
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) { sq += 7; continue; }
    const piece = board.squares[sq];
    if (piece === EMPTY || pieceColour(piece) !== enemy) continue;
    const weight = TROPISM[pieceType(piece)];
    if (weight === 0) continue;
    const d = kingDistance(sq, kingSq);
    if (d < 6) danger += weight * (6 - d);
  }

  // Pawn shield, on the king's file and its neighbours.
  const forward = colour === WHITE ? 16 : -16;
  const ownPawn = makePiece(PAWN, colour);
  const enemyPawn = makePiece(PAWN, enemy);
  for (let df = -1; df <= 1; df++) {
    const file = kingFile + df;
    if (file < 0 || file > 7) continue;

    const near = kingSq + forward + df;
    const far = kingSq + 2 * forward + df;
    if (onBoard(near) && board.squares[near] === ownPawn) danger -= SHIELD_INTACT;
    else if (onBoard(far) && board.squares[far] === ownPawn) danger -= SHIELD_ADVANCED;
    else danger += SHIELD_INTACT;   // nothing covering this file at all

    // A file with no pawn of either colour on it is a road to the king.
    let hasPawn = false;
    for (let rank = 0; rank < 8 && !hasPawn; rank++) {
      const piece = board.squares[rank * 16 + file];
      if (piece === ownPawn || piece === enemyPawn) hasPawn = true;
    }
    if (!hasPawn) danger += OPEN_FILE_NEAR_KING;
  }

  return danger;
}

/** Table index for a 0x88 square, flipped so Black reads the same table. */
function pstIndex(square, colour) {
  const rank = rankOf(square), file = fileOf(square);
  return colour === WHITE ? (7 - rank) * 8 + file : rank * 8 + file;
}

function positional(type, square, colour, phase) {
  const index = pstIndex(square, colour);
  if (type !== KING) return TABLES[type][index];
  // The king's table is interpolated: hide early, centralise late.
  return KING_MG_PST[index] * phase + KING_EG_PST[index] * (1 - phase);
}

/** Material and piece-square tables only — the cheap half of the evaluation. */
function materialAndPosition(board, phase) {
  let score = 0;
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) { sq += 7; continue; }
    const piece = board.squares[sq];
    if (piece === EMPTY) continue;
    const type = pieceType(piece), colour = pieceColour(piece);
    const value = PIECE_VALUE[type] + positional(type, sq, colour, phase);
    score += colour === WHITE ? value : -value;
  }
  return score;
}

// The expensive half is clamped to this, which is what makes lazy evaluation
// *sound* rather than merely usually-right. Sampling 279,725 positions gave a
// median of 21 and a maximum of 491 — but a sample is not a bound: eight
// passed pawns on the seventh rank would contribute 8 x 180 = 1440 by
// themselves. Clamping caps it by construction, and costs nothing real, since
// a positional score past a rook is not information the search can use.
const POSITIONAL_CLAMP = 300;

/** Mobility, king safety and pawn structure — the expensive half, clamped. */
function positionalTerms(board, phase) {
  let score = 0;
  if (phase > 0) {
    score += (kingDanger(board, BLACK) - kingDanger(board, WHITE)) * phase;
  }
  if (mobilityEnabled) score += mobility(board, WHITE) - mobility(board, BLACK);
  score += pawnStructure(board, WHITE) - pawnStructure(board, BLACK);
  return Math.max(-POSITIONAL_CLAMP, Math.min(POSITIONAL_CLAMP, score));
}

// Skip the expensive half when the cheap score is outside the window by more
// than this. Sound because positionalTerms cannot exceed the clamp; the small
// headroom absorbs rounding.
export const LAZY_MARGIN = POSITIONAL_CLAMP + 20;

/**
 * Score in centipawns from the side-to-move's point of view.
 *
 * Pass the current alpha/beta window and positions already far outside it skip
 * the expensive half. Most evaluations happen at quiescence leaves in
 * positions that are already hopeless, and those never needed mobility or king
 * safety computed to be rejected.
 */
export function evaluate(board, alpha = -Infinity, beta = Infinity) {
  const phase = phaseOf(board);
  const cheap = materialAndPosition(board, phase);
  const sided = board.side === WHITE ? cheap : -cheap;

  if (sided - LAZY_MARGIN >= beta || sided + LAZY_MARGIN <= alpha) {
    return Math.round(sided);
  }

  const full = cheap + positionalTerms(board, phase);
  return Math.round(board.side === WHITE ? full : -full);
}

/** The full evaluation, never short-circuited. Used by the tests. */
export function evaluateFull(board) {
  const phase = phaseOf(board);
  const score = materialAndPosition(board, phase) + positionalTerms(board, phase);
  return Math.round(board.side === WHITE ? score : -score);
}
