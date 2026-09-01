import test from "node:test";
import assert from "node:assert/strict";

import { Board } from "../engine/board.js";
import { moveToUci, generateLegalMoves } from "../engine/movegen.js";
import { Search, MATE, bestMove } from "../engine/search.js";
import { evaluate } from "../engine/eval.js";

const search = (fen, maxDepth = 5) =>
  new Search({ maxDepth, timeLimitMs: 20000 }).findBestMove(new Board(fen));

test("finds mate in one and scores it as mate", () => {
  const result = search("6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1", 3);
  assert.equal(moveToUci(result.move), "a1a8");
  assert.ok(result.score > MATE - 1000, `score ${result.score} is not a mate score`);
});

test("finds a forced mate in two, with the full line", () => {
  const result = search("7k/8/8/8/8/8/R7/1R5K w - - 0 1", 6);
  assert.ok(result.score > MATE - 1000, `score ${result.score} is not a mate score`);
  assert.deepEqual(result.pv, ["b1b7", "h8g8", "a2a8"]);
});

test("prefers the faster mate", () => {
  // Mate scores fold in the ply, so a mate in one outscores a mate in three.
  const fast = search("6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1", 5);
  const slow = search("7k/8/8/8/8/8/R7/1R5K w - - 0 1", 6);
  assert.ok(fast.score > slow.score);
});

test("takes a hanging rook", () => {
  assert.equal(bestMove(new Board("4k3/8/8/3r4/8/8/8/3QK3 w - - 0 1"),
                        { maxDepth: 4 }), "d1d5");
});

test("promotes to a queen when promoting wins", () => {
  assert.equal(bestMove(new Board("8/P6k/8/8/8/8/8/6K1 w - - 0 1"),
                        { maxDepth: 4 }), "a7a8q");
});

test("quiescence stops it grabbing a defended pawn", () => {
  // Nxe5 wins a pawn but loses the knight to Nxe5. A search that stopped at the
  // capture would report +1 pawn; the quiescence search sees the recapture.
  const fen = "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3";
  assert.notEqual(bestMove(new Board(fen), { maxDepth: 4 }), "f3e5");
});

test("evaluation is zero for a symmetrical position and sign-flips with the side", () => {
  assert.equal(evaluate(new Board("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1")), 0);
  const white = evaluate(new Board("4k3/8/8/8/8/8/8/R3K3 w - - 0 1"));
  const black = evaluate(new Board("4k3/8/8/8/8/8/8/R3K3 b - - 0 1"));
  assert.equal(white, -black, "evaluation is from the side to move's view");
  assert.ok(white > 0, "the side with an extra rook is better");
});

test("iterative deepening reports the depth it reached", () => {
  const result = search("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", 4);
  assert.equal(result.depth, 4);
  assert.ok(result.nodes > 0);
  assert.ok(result.pv.length > 0);
});

test("the search leaves the board untouched", () => {
  const fen = "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1";
  const board = new Board(fen);
  new Search({ maxDepth: 4 }).findBestMove(board);
  assert.equal(board.fen(), fen);
});

test("always returns a legal move", () => {
  for (const fen of [
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1",
    "r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1",
  ]) {
    const board = new Board(fen);
    const legal = generateLegalMoves(board).map(moveToUci);
    assert.ok(legal.includes(bestMove(board, { maxDepth: 3 })), fen);
  }
});

test("returns null when there are no legal moves", () => {
  assert.equal(bestMove(new Board("R5k1/5ppp/8/8/8/8/8/6K1 b - - 0 1"),
                        { maxDepth: 3 }), null);
});

test("respects its time limit", () => {
  const started = Date.now();
  new Search({ maxDepth: 99, timeLimitMs: 300 })
    .findBestMove(new Board("r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1"));
  assert.ok(Date.now() - started < 3000, "should stop well before an unbounded search");
});

test("the transposition table does not change the move it picks", () => {
  const fen = "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4";
  const withTt = new Search({ maxDepth: 4 }).findBestMove(new Board(fen));
  const tiny = new Search({ maxDepth: 4, ttSize: 1 }).findBestMove(new Board(fen));
  assert.equal(moveToUci(withTt.move), moveToUci(tiny.move));
});
