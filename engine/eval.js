// Static evaluation: material plus piece-square tables.
//
// Deliberately simple. A search this shallow gains far more from correct
// pruning and move ordering than from a clever evaluation, and a wrong
// evaluation term is much harder to notice than a wrong search.

import { EMPTY, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, WHITE,
         pieceType, pieceColour, fileOf, rankOf } from "./board.js";

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
const KING_PST = [
 -30,-40,-40,-50,-50,-40,-40,-30,
 -30,-40,-40,-50,-50,-40,-40,-30,
 -30,-40,-40,-50,-50,-40,-40,-30,
 -30,-40,-40,-50,-50,-40,-40,-30,
 -20,-30,-30,-40,-40,-30,-30,-20,
 -10,-20,-20,-20,-20,-20,-20,-10,
  20, 20,  0,  0,  0,  0, 20, 20,
  20, 30, 10,  0,  0, 10, 30, 20,
];

const TABLES = { [PAWN]: PAWN_PST, [KNIGHT]: KNIGHT_PST, [BISHOP]: BISHOP_PST,
                 [ROOK]: ROOK_PST, [QUEEN]: QUEEN_PST, [KING]: KING_PST };

// A table one entry short silently shifts every square after the gap, and the
// evaluation still looks plausible. Fail loudly at load instead. (This caught a
// real 63-entry king table.)
for (const [type, table] of Object.entries(TABLES)) {
  if (table.length !== 64) {
    throw new Error(`piece-square table ${type} has ${table.length} entries, expected 64`);
  }
}

/** Table lookup for a 0x88 square, flipped for Black. */
function positional(type, square, colour) {
  const rank = rankOf(square), file = fileOf(square);
  const index = colour === WHITE ? (7 - rank) * 8 + file : rank * 8 + file;
  return TABLES[type][index];
}

/** Score in centipawns from the side-to-move's point of view. */
export function evaluate(board) {
  let score = 0;
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) { sq += 7; continue; }
    const piece = board.squares[sq];
    if (piece === EMPTY) continue;
    const type = pieceType(piece), colour = pieceColour(piece);
    const value = PIECE_VALUE[type] + positional(type, sq, colour);
    score += colour === WHITE ? value : -value;
  }
  return board.side === WHITE ? score : -score;
}
