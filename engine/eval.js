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

/** Score in centipawns from the side-to-move's point of view. */
export function evaluate(board) {
  const phase = phaseOf(board);
  let score = 0;

  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) { sq += 7; continue; }
    const piece = board.squares[sq];
    if (piece === EMPTY) continue;
    const type = pieceType(piece), colour = pieceColour(piece);
    const value = PIECE_VALUE[type] + positional(type, sq, colour, phase);
    score += colour === WHITE ? value : -value;
  }

  // King safety fades with the phase. In a king-and-pawn endgame the king is a
  // fighting piece and "danger" is meaningless; scaling it out is what lets the
  // endgame table pull the king toward the middle instead of the corner.
  if (phase > 0) {
    const white = kingDanger(board, WHITE);
    const black = kingDanger(board, BLACK);
    score += (black - white) * phase;
  }

  return Math.round(board.side === WHITE ? score : -score);
}
