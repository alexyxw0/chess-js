// Pseudo-legal move generation, filtered to legal by make/unmake.
//
// Generating pseudo-legal moves and discarding the ones that leave your own
// king attacked is slower per move than computing pins up front, but it is far
// harder to get subtly wrong — and correctness here is not negotiable, because
// every search result rests on it. The perft suite in test/ is what proves it.

import {
  Board, EMPTY, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, WHITE, BLACK,
  CASTLE_WK, CASTLE_WQ, CASTLE_BK, CASTLE_BQ,
  FLAG_EP, FLAG_CASTLE, FLAG_DOUBLE, FLAG_PROMO,
  KNIGHT_OFFSETS, KING_OFFSETS, BISHOP_OFFSETS, ROOK_OFFSETS,
  encodeMove, moveFrom, moveTo, movePromo,
  pieceType, pieceColour, makePiece, onBoard, rankOf,
  squareToAlgebraic,
} from "./board.js";

const PROMOTION_PIECES = [QUEEN, ROOK, BISHOP, KNIGHT];

const SLIDER_OFFSETS = {
  [BISHOP]: BISHOP_OFFSETS,
  [ROOK]: ROOK_OFFSETS,
  [QUEEN]: KING_OFFSETS,
};

/**
 * Every pseudo-legal move for the side to move.
 * @param {Board} board
 * @param {boolean} capturesOnly quiescence search only wants captures and promotions
 */
export function generateMoves(board, capturesOnly = false) {
  const moves = [];
  const sq = board.squares;
  const us = board.side, them = us ^ 1;

  const push = (from, to, promo = 0, flags = 0) =>
    moves.push(encodeMove(from, to, promo, sq[to], flags));

  for (let from = 0; from < 128; from++) {
    if (from & 0x88) { from += 7; continue; }  // skip the off-board half of each rank
    const piece = sq[from];
    if (piece === EMPTY || pieceColour(piece) !== us) continue;
    const type = pieceType(piece);

    if (type === PAWN) {
      const forward = us === WHITE ? 16 : -16;
      const startRank = us === WHITE ? 1 : 6;
      const promoRank = us === WHITE ? 7 : 0;

      const one = from + forward;
      if (!capturesOnly && onBoard(one) && sq[one] === EMPTY) {
        if (rankOf(one) === promoRank) {
          for (const promo of PROMOTION_PIECES) push(from, one, promo, FLAG_PROMO);
        } else {
          push(from, one);
          const two = one + forward;
          if (rankOf(from) === startRank && sq[two] === EMPTY) {
            push(from, two, 0, FLAG_DOUBLE);
          }
        }
      }

      for (const side of [-1, 1]) {
        const to = from + forward + side;
        if (!onBoard(to)) continue;
        const target = sq[to];
        if (target !== EMPTY && pieceColour(target) === them) {
          if (rankOf(to) === promoRank) {
            for (const promo of PROMOTION_PIECES) push(from, to, promo, FLAG_PROMO);
          } else push(from, to);
        } else if (to === board.epSquare) {
          // The captured pawn is not on `to`, so encode it explicitly.
          moves.push(encodeMove(from, to, 0, makePiece(PAWN, them), FLAG_EP));
        }
      }
      continue;
    }

    if (type === KNIGHT || type === KING) {
      const offsets = type === KNIGHT ? KNIGHT_OFFSETS : KING_OFFSETS;
      for (const offset of offsets) {
        const to = from + offset;
        if (!onBoard(to)) continue;
        const target = sq[to];
        if (target !== EMPTY && pieceColour(target) === us) continue;
        if (capturesOnly && target === EMPTY) continue;
        push(from, to);
      }
      continue;
    }

    for (const offset of SLIDER_OFFSETS[type]) {
      for (let to = from + offset; onBoard(to); to += offset) {
        const target = sq[to];
        if (target === EMPTY) {
          if (!capturesOnly) push(from, to);
          continue;
        }
        if (pieceColour(target) === them) push(from, to);
        break;
      }
    }
  }

  if (!capturesOnly) generateCastles(board, moves);
  return moves;
}

function generateCastles(board, moves) {
  const sq = board.squares;
  const us = board.side, them = us ^ 1;
  const king = us === WHITE ? 4 : 116;
  const kingSide = us === WHITE ? CASTLE_WK : CASTLE_BK;
  const queenSide = us === WHITE ? CASTLE_WQ : CASTLE_BQ;

  if (!(board.castling & (kingSide | queenSide))) return;
  // Castling out of check is illegal, and this is the cheapest place to rule it out.
  if (board.isAttacked(king, them)) return;

  if (board.castling & kingSide &&
      sq[king + 1] === EMPTY && sq[king + 2] === EMPTY &&
      !board.isAttacked(king + 1, them)) {
    // The king's destination is checked by the normal legality filter.
    moves.push(encodeMove(king, king + 2, 0, 0, FLAG_CASTLE));
  }

  if (board.castling & queenSide &&
      sq[king - 1] === EMPTY && sq[king - 2] === EMPTY && sq[king - 3] === EMPTY &&
      !board.isAttacked(king - 1, them)) {
    moves.push(encodeMove(king, king - 2, 0, 0, FLAG_CASTLE));
  }
}

/** Pseudo-legal moves that do not leave our own king attacked. */
export function generateLegalMoves(board, capturesOnly = false) {
  const legal = [];
  for (const move of generateMoves(board, capturesOnly)) {
    board.makeMove(move);
    if (!board.isAttacked(board.kingSquare[board.side ^ 1], board.side)) {
      legal.push(move);
    }
    board.unmakeMove();
  }
  return legal;
}

/** Long algebraic notation, e.g. "e2e4", "e7e8q". */
export function moveToUci(move) {
  const promo = movePromo(move);
  return squareToAlgebraic(moveFrom(move)) + squareToAlgebraic(moveTo(move)) +
    (promo ? ".pnbrqk"[promo] : "");
}

/** Find the legal move matching a UCI string, or null. */
export function moveFromUci(board, uci) {
  return generateLegalMoves(board).find((m) => moveToUci(m) === uci) ?? null;
}

/** Count leaf nodes at `depth`. The standard correctness test for a generator. */
export function perft(board, depth) {
  if (depth === 0) return 1;
  let nodes = 0;
  for (const move of generateMoves(board)) {
    board.makeMove(move);
    if (!board.isAttacked(board.kingSquare[board.side ^ 1], board.side)) {
      nodes += depth === 1 ? 1 : perft(board, depth - 1);
    }
    board.unmakeMove();
  }
  return nodes;
}

/** Per-move node counts at the root — how you find *which* move is miscounted. */
export function perftDivide(board, depth) {
  const out = new Map();
  for (const move of generateLegalMoves(board)) {
    board.makeMove(move);
    out.set(moveToUci(move), depth === 1 ? 1 : perft(board, depth - 1));
    board.unmakeMove();
  }
  return out;
}
