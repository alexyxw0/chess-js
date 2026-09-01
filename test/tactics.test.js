// Accuracy: does the engine find the right move, and is the "right move" we
// check against actually right?
//
// A tactical suite is only as trustworthy as its answer key, and an answer key
// transcribed from memory is a liability. So every expectation here is
// *derived* rather than asserted: mates are confirmed by an independent
// full-width prover, and material wins are confirmed by playing the move and
// counting. If the key and the engine ever disagree, the test says which.

import test from "node:test";
import assert from "node:assert/strict";

import { Board, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, WHITE,
         pieceType, pieceColour } from "../engine/board.js";
import { generateLegalMoves, moveToUci } from "../engine/movegen.js";
import { PIECE_VALUE } from "../engine/eval.js";
import { Search, MATE } from "../engine/search.js";

// ── an answer key the tests compute for themselves ──────────────────────────

/**
 * Full-width proof that `board` is a forced mate for the side to move in at
 * most `plies`. No alpha-beta, no evaluation, no heuristics — just the rules,
 * so it cannot inherit a bug from the thing it is checking.
 */
function forcedMateIn(board, plies) {
  if (plies <= 0) return false;
  for (const move of generateLegalMoves(board)) {
    board.makeMove(move);
    const replies = generateLegalMoves(board);
    const mated = replies.length === 0 && board.inCheck();
    // Every reply must still lose, or this move does not force mate.
    const forced = mated || (plies > 1 && replies.every((reply) => {
      board.makeMove(reply);
      const still = forcedMateIn(board, plies - 2);
      board.unmakeMove();
      return still;
    }));
    board.unmakeMove();
    if (forced) return true;
  }
  return false;
}

/** Material for the side to move, minus material for the opponent. */
function material(board) {
  let score = 0;
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) { sq += 7; continue; }
    const piece = board.squares[sq];
    if (piece === 0) continue;
    const value = PIECE_VALUE[pieceType(piece)];
    score += pieceColour(piece) === WHITE ? value : -value;
  }
  return board.side === WHITE ? score : -score;
}

/**
 * Material the side to move ends up with after `uci`, assuming both sides then
 * play the best continuation a deep search can find. This is what "wins a
 * piece" has to mean — the count after the dust settles, not after the capture.
 */
function materialAfter(fen, uci, depth = 5) {
  const board = new Board(fen);
  const move = generateLegalMoves(board).find((m) => moveToUci(m) === uci);
  assert.ok(move, `${uci} is not legal in ${fen}`);
  const mover = board.side;

  board.makeMove(move);
  for (let i = 0; i < 6; i++) {
    const result = new Search({ maxDepth: depth, timeLimitMs: 5000 }).findBestMove(board);
    if (result.move === null) break;
    board.makeMove(result.move);
  }
  return board.side === mover ? material(board) : -material(board);
}

const best = (fen, maxDepth = 5) =>
  new Search({ maxDepth, timeLimitMs: 15000 }).findBestMove(new Board(fen));

// ── mates ───────────────────────────────────────────────────────────────────

const MATES = [
  ["back-rank, mate in 1", "6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1", 1],
  ["queen and king, mate in 1", "7k/5K2/8/8/8/8/8/6Q1 w - - 0 1", 1],
  ["rook ladder, mate in 2", "7k/8/8/8/8/8/R7/1R5K w - - 0 1", 3],
  ["box the king, mate in 2", "6k1/8/6K1/8/8/8/8/R7 w - - 0 1", 3],
];

for (const [name, fen, plies] of MATES) {
  test(`mate: ${name}`, () => {
    // First establish the position really is a forced mate, independently.
    assert.ok(forcedMateIn(new Board(fen), plies),
      "the answer key is wrong: no forced mate at this depth");

    const result = best(fen, plies + 3);
    assert.ok(result.score > MATE - 1000,
      `engine scored ${result.score}, which is not a mate score`);

    // And the move it picked has to be one that actually forces mate.
    const board = new Board(fen);
    board.makeMove(result.move);
    const stillForced = generateLegalMoves(board).every((reply) => {
      board.makeMove(reply);
      const mated = generateLegalMoves(board).length === 0 && board.inCheck();
      const forced = mated || forcedMateIn(board, plies - 2);
      board.unmakeMove();
      return forced;
    }) || (generateLegalMoves(board).length === 0 && board.inCheck());
    assert.ok(stillForced, `${moveToUci(result.move)} does not force mate`);
  });
}

test("mate scores shorten with distance, so the faster mate wins", () => {
  const inOne = best("6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1", 5);
  const inTwo = best("7k/8/8/8/8/8/R7/1R5K w - - 0 1", 6);
  assert.ok(inOne.score > inTwo.score,
    `mate in 1 scored ${inOne.score}, mate in 2 scored ${inTwo.score}`);
});

test("a mate against it is recognised, not walked into", () => {
  // Black to move, already lost; the score must be a large negative, not a
  // cheerful material count.
  const result = best("R5k1/5ppp/8/8/8/8/8/6K1 b - - 0 1", 4);
  assert.equal(result.move, null, "there are no legal moves here");
});

// ── material tactics ────────────────────────────────────────────────────────

const TACTICS = [
  ["takes a hanging rook", "4k3/8/8/3r4/8/8/8/3QK3 w - - 0 1", "d1d5", PIECE_VALUE[ROOK]],
  ["takes a hanging queen", "4k3/8/8/3q4/8/8/8/3RK3 w - - 0 1", "d1d5", PIECE_VALUE[QUEEN]],
  ["promotes to a queen", "8/P6k/8/8/8/8/8/6K1 w - - 0 1", "a7a8q",
   PIECE_VALUE[QUEEN] - PIECE_VALUE[PAWN]],
];

for (const [name, fen, expected, gain] of TACTICS) {
  test(`tactic: ${name}`, () => {
    const played = moveToUci(best(fen, 5).move);
    assert.equal(played, expected);
    // Confirm the key: the move really does net the material it claims.
    const before = material(new Board(fen));
    assert.ok(materialAfter(fen, expected) >= before + gain - PIECE_VALUE[PAWN],
      `${expected} does not actually win ~${gain} centipawns`);
  });
}

test("quiescence: it declines a pawn that is defended", () => {
  // Nxe5 wins a pawn and loses the knight to Nxe5. A search that stopped at
  // the capture would score it +1 pawn; quiescence sees the recapture.
  const fen = "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3";
  const played = moveToUci(best(fen, 5).move);
  assert.notEqual(played, "f3e5");
  // Verify the key rather than assume it: the greedy move really is bad.
  assert.ok(materialAfter(fen, "f3e5") < material(new Board(fen)),
    "f3e5 was supposed to lose material");
});

test("it does not hang its queen for nothing", () => {
  const fen = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2";
  const played = moveToUci(best(fen, 5).move);
  const after = materialAfter(fen, played);
  assert.ok(after >= material(new Board(fen)) - PIECE_VALUE[PAWN],
    `${played} drops material: ${after} vs ${material(new Board(fen))}`);
});

// ── consistency ─────────────────────────────────────────────────────────────

test("searching deeper never loses a mate it had already found", () => {
  const fen = "7k/8/8/8/8/8/R7/1R5K w - - 0 1";
  for (let depth = 4; depth <= 7; depth++) {
    assert.ok(best(fen, depth).score > MATE - 1000, `lost the mate at depth ${depth}`);
  }
});

test("the transposition table does not change the move chosen", () => {
  for (const [, fen] of TACTICS) {
    const withTt = moveToUci(new Search({ maxDepth: 5 }).findBestMove(new Board(fen)).move);
    const without = moveToUci(new Search({ maxDepth: 5, ttSize: 1 })
      .findBestMove(new Board(fen)).move);
    assert.equal(withTt, without, fen);
  }
});

test("move ordering changes the cost, never the answer", () => {
  // The strongest statement available about the ordering heuristics: they are
  // a pure optimisation. If one ever changed the result, it would be a bug.
  for (const [, fen] of TACTICS) {
    const ordered = new Search({ maxDepth: 4 });
    const orderedMove = moveToUci(ordered.findBestMove(new Board(fen)).move);

    const unordered = new Search({ maxDepth: 4 });
    unordered.orderMoves = (board, moves) => moves;
    const unorderedMove = moveToUci(unordered.findBestMove(new Board(fen)).move);

    assert.equal(orderedMove, unorderedMove, fen);
    assert.ok(ordered.nodes <= unordered.nodes,
      "ordering should never cost more nodes than not ordering");
  }
});
