// The incremental hash is a shortcut, and a shortcut that drifts is worse than
// no shortcut: a wrong key silently returns another position's score from the
// transposition table, and the search plays a move it never evaluated.
//
// So it is checked against the from-scratch recomputation at every node of a
// perft walk. That covers captures, en passant, promotions, castling and
// castling-right loss in the same sweep the move generator is verified by.

import test from "node:test";
import assert from "node:assert/strict";

import { Board } from "../engine/board.js";
import { generateMoves, moveToUci } from "../engine/movegen.js";
import { hashBoard } from "../engine/zobrist.js";

const POSITIONS = [
  ["startpos", "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", 4],
  ["kiwipete", "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1", 3],
  ["en passant + promotion", "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1", 4],
  ["promotions under check", "r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1", 3],
];

/** Walk the tree, asserting the incremental key matches a recompute. */
function walk(board, depth, path = []) {
  if (depth === 0) return 0;
  let checked = 0;
  for (const move of generateMoves(board)) {
    board.makeMove(move);
    const trail = [...path, moveToUci(move)];

    assert.equal(board.hashKey(), hashBoard(board),
      `incremental hash drifted after ${trail.join(" ")}`);
    checked++;

    if (!board.isAttacked(board.kingSquare[board.side ^ 1], board.side)) {
      checked += walk(board, depth - 1, trail);
    }
    board.unmakeMove();
  }
  return checked;
}

for (const [name, fen, depth] of POSITIONS) {
  test(`incremental hash matches a recompute at every node: ${name}`, () => {
    const board = new Board(fen);
    const checked = walk(board, depth);
    assert.ok(checked > 100, `only ${checked} positions checked`);
    // And the walk has to leave the board — and its hash — exactly as found.
    assert.equal(board.fen(), fen);
    assert.equal(board.hashKey(), hashBoard(board));
  });
}

test("unmake restores the hash exactly", () => {
  const board = new Board("r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1");
  const before = board.hashKey();
  for (const move of generateMoves(board)) {
    board.makeMove(move);
    board.unmakeMove();
    assert.equal(board.hashKey(), before, `after ${moveToUci(move)}`);
  }
});

test("the same position reached two ways hashes the same", () => {
  // 1.Nf3 Nf6 2.Ng1 Ng8 returns to the start; only the move counters differ,
  // and those are not hashed. Transposition detection depends on this.
  const a = new Board();
  const play = (board, ucis) => {
    for (const uci of ucis) {
      const move = generateMoves(board).find((m) => moveToUci(m) === uci);
      assert.ok(move, uci);
      board.makeMove(move);
    }
  };
  play(a, ["g1f3", "g8f6", "f3g1", "f6g8"]);
  assert.equal(a.hashKey(), new Board().hashKey());
});

test("side to move is part of the key", () => {
  const white = new Board("4k3/8/8/8/8/8/8/4K3 w - - 0 1");
  const black = new Board("4k3/8/8/8/8/8/8/4K3 b - - 0 1");
  assert.notEqual(white.hashKey(), black.hashKey());
});

test("castling rights are part of the key", () => {
  const both = new Board("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
  const none = new Board("r3k2r/8/8/8/8/8/8/R3K2R w - - 0 1");
  assert.notEqual(both.hashKey(), none.hashKey());
});

test("the en passant square is part of the key", () => {
  const withEp = new Board("4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 2");
  const without = new Board("4k3/8/8/3pP3/8/8/8/4K3 w - - 0 2");
  assert.notEqual(withEp.hashKey(), without.hashKey());
});

test("keys stay inside the exactly-representable integer range", () => {
  const board = new Board();
  for (const move of generateMoves(board)) {
    board.makeMove(move);
    assert.ok(Number.isSafeInteger(board.hashKey()));
    board.unmakeMove();
  }
});
