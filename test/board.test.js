import test from "node:test";
import assert from "node:assert/strict";

import { Board, STARTING_FEN, WHITE, BLACK, KING, PAWN,
         CASTLE_WK, CASTLE_WQ, CASTLE_BK, CASTLE_BQ,
         pieceType, squareToAlgebraic, algebraicToSquare } from "../engine/board.js";
import { generateLegalMoves, moveToUci, moveFromUci } from "../engine/movegen.js";

const FENS = [
  STARTING_FEN,
  "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1",
  "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1",
  "r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1",
  "rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8",
  "4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2",
];

test("FEN survives a round trip", () => {
  for (const fen of FENS) assert.equal(new Board(fen).fen(), fen);
});

test("square names convert both ways", () => {
  for (const name of ["a1", "h1", "a8", "h8", "e4", "d5"]) {
    assert.equal(squareToAlgebraic(algebraicToSquare(name)), name);
  }
  assert.equal(algebraicToSquare("a1"), 0);
  assert.equal(algebraicToSquare("h8"), 119);
});

test("king squares are tracked from the FEN", () => {
  const board = new Board(STARTING_FEN);
  assert.equal(squareToAlgebraic(board.kingSquare[WHITE]), "e1");
  assert.equal(squareToAlgebraic(board.kingSquare[BLACK]), "e8");
});

// The single most valuable invariant in the engine: if unmake is not an exact
// inverse of make, every search result is built on corrupted state, and the
// symptom shows up far from the cause.
test("unmake restores the position exactly, for every legal move", () => {
  for (const fen of FENS) {
    const board = new Board(fen);
    for (const move of generateLegalMoves(board)) {
      board.makeMove(move);
      board.unmakeMove();
      assert.equal(board.fen(), fen, `after ${moveToUci(move)} from ${fen}`);
    }
  }
});

test("unmake restores the position after a two-move sequence", () => {
  const board = new Board(STARTING_FEN);
  for (const first of generateLegalMoves(board)) {
    board.makeMove(first);
    const afterFirst = board.fen();
    for (const second of generateLegalMoves(board)) {
      board.makeMove(second);
      board.unmakeMove();
      assert.equal(board.fen(), afterFirst);
    }
    board.unmakeMove();
    assert.equal(board.fen(), STARTING_FEN);
  }
});

test("castling moves the rook as well as the king", () => {
  const board = new Board("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
  board.makeMove(moveFromUci(board, "e1g1"));
  assert.equal(board.fen().split(" ")[0], "r3k2r/8/8/8/8/8/8/R4RK1");
  board.unmakeMove();
  assert.equal(board.fen(), "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");

  board.makeMove(moveFromUci(board, "e1c1"));
  assert.equal(board.fen().split(" ")[0], "r3k2r/8/8/8/8/8/8/2KR3R");
});

test("moving a rook forfeits only that side's rights", () => {
  const board = new Board("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
  board.makeMove(moveFromUci(board, "h1g1"));
  assert.equal(board.castling & CASTLE_WK, 0, "king-side right is gone");
  assert.ok(board.castling & CASTLE_WQ, "queen-side right survives");
  assert.ok(board.castling & CASTLE_BK, "black is untouched");
});

test("capturing a rook on its home square forfeits that right", () => {
  // The mask is applied to the destination square too, so a capture clears
  // the victim's rights without a special case.
  const board = new Board("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
  board.makeMove(moveFromUci(board, "a1a8"));
  assert.equal(board.castling & CASTLE_BQ, 0);
  assert.ok(board.castling & CASTLE_BK);
});

test("a double pawn push sets the en passant square, and one move clears it", () => {
  const board = new Board(STARTING_FEN);
  board.makeMove(moveFromUci(board, "e2e4"));
  assert.equal(squareToAlgebraic(board.epSquare), "e3");
  board.makeMove(moveFromUci(board, "b8c6"));
  assert.equal(board.epSquare, -1);
});

test("en passant removes the pawn beside the destination", () => {
  const board = new Board("4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2");
  board.makeMove(moveFromUci(board, "e5d6"));
  assert.equal(board.fen().split(" ")[0], "4k3/8/3P4/8/8/8/8/4K3");
  board.unmakeMove();
  assert.equal(board.fen(), "4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2");
});

test("promotion offers all four pieces and unmakes back to a pawn", () => {
  const board = new Board("8/P6k/8/8/8/8/8/6K1 w - - 0 1");
  const promotions = generateLegalMoves(board)
    .map(moveToUci).filter((u) => u.startsWith("a7a8"));
  assert.deepEqual(promotions.sort(), ["a7a8b", "a7a8n", "a7a8q", "a7a8r"]);

  board.makeMove(moveFromUci(board, "a7a8q"));
  assert.equal(board.fen().split(" ")[0], "Q7/7k/8/8/8/8/8/6K1");
  board.unmakeMove();
  assert.equal(pieceType(board.squares[algebraicToSquare("a7")]), PAWN);
});

test("a pinned piece cannot move", () => {
  // The white bishop on e2 is pinned to the king on e1 by the rook on e8.
  const board = new Board("4r3/8/8/8/8/8/4B3/4K3 w - - 0 1");
  const moves = generateLegalMoves(board).map(moveToUci);
  assert.ok(!moves.some((m) => m.startsWith("e2")), `bishop moved: ${moves}`);
});

test("checkmate and stalemate are both zero-move, told apart by inCheck", () => {
  const mate = new Board("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1");
  const stalemate = new Board("7k/5Q2/8/8/8/8/8/6K1 b - - 0 1");
  for (const b of [mate, stalemate]) assert.equal(generateLegalMoves(b).length, 0);

  const realMate = new Board("6k1/5ppp/8/8/8/8/8/R5K1 b - - 0 1");
  realMate.setFen("R5k1/5ppp/8/8/8/8/8/6K1 b - - 0 1");
  assert.equal(generateLegalMoves(realMate).length, 0);
  assert.ok(realMate.inCheck(), "back-rank mate is check");
  assert.ok(!stalemate.inCheck(), "stalemate is not check");
});
