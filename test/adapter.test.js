// The adapter is where the UI's tile board and the engine's 0x88 board can
// silently disagree, so it is worth testing on its own. These build a minimal
// stand-in for the UI board — no canvas, no DOM — matching only the shape
// `fenFromUi` reads.

import test from "node:test";
import assert from "node:assert/strict";

import { fenFromUi } from "../engine-adapter.js";
import { Board, STARTING_FEN } from "../engine/board.js";

const NAMES = { p: "Pawn", n: "Knight", b: "Bishop", r: "Rook", q: "Queen", k: "King" };

/**
 * Build a fake UI board from a FEN placement field, mirroring chess.js exactly:
 * board[0] is White's back rank, and a tile's chess rank is 8 - y.
 * `moved` entries are square names, e.g. "h1", so the tests read as chess.
 */
function fakeUi(placement, { turn = 0, moved = [], lastMove = null, moveList = [] } = {}) {
  const board = Array.from({ length: 8 }, (_, row) =>
    Array.from({ length: 8 }, (_, col) => ({ x: col, y: 7 - row, piece: null })));

  placement.split("/").forEach((rankStr, index) => {
    const rank = 8 - index;              // FEN starts at rank 8
    const row = rank - 1;                // ...which is board row 7
    let col = 0;
    for (const ch of rankStr) {
      if (ch >= "1" && ch <= "8") { col += Number(ch); continue; }
      const lower = ch.toLowerCase();
      board[row][col].piece = {
        color: ch === lower ? "black" : "white",
        hasMoved: moved.includes("abcdefgh"[col] + rank) ? 1 : 0,
        constructor: { name: NAMES[lower] },
      };
      col++;
    }
  });

  return { board, turn, lastMove, moveList, colors: ["white", "black"] };
}

/** A tile stand-in at a square name, e.g. tile("e4"). */
const tile = (name, pieceName = null) => ({
  x: "abcdefgh".indexOf(name[0]),
  y: 8 - Number(name[1]),
  piece: pieceName ? { constructor: { name: pieceName } } : null,
});

test("the starting position round-trips through the engine's parser", () => {
  const fen = fenFromUi(fakeUi("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR"));
  assert.equal(fen, STARTING_FEN);
  assert.equal(new Board(fen).fen(), STARTING_FEN);
});

test("side to move follows the UI's turn counter", () => {
  const ui = fakeUi("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR", { turn: 1 });
  assert.equal(fenFromUi(ui).split(" ")[1], "b");
});

test("castling rights are derived from per-piece move counts", () => {
  const placement = "r3k2r/8/8/8/8/8/8/R3K2R";
  assert.equal(fenFromUi(fakeUi(placement)).split(" ")[2], "KQkq");

  // h1 rook has moved -> white loses only the king side
  assert.equal(fenFromUi(fakeUi(placement, { moved: ["h1"] })).split(" ")[2], "Qkq");

  // white king has moved -> white loses both
  assert.equal(fenFromUi(fakeUi(placement, { moved: ["e1"] })).split(" ")[2], "kq");
});

test("a missing rook forfeits its right even with nothing marked as moved", () => {
  assert.equal(fenFromUi(fakeUi("r3k3/8/8/8/8/8/8/R3K2R")).split(" ")[2], "KQq");
});

test("no castling rights renders as a dash", () => {
  assert.equal(fenFromUi(fakeUi("4k3/8/8/8/8/8/8/4K3")).split(" ")[2], "-");
});

test("a double pawn push sets the en passant square behind the pawn", () => {
  const ui = fakeUi("rnbqkbnr/pppp1ppp/8/4p3/8/8/PPPPPPPP/RNBQKBNR", {
    turn: 0,
    lastMove: { t1: tile("e7"), t2: tile("e5", "Pawn") },
  });
  assert.equal(fenFromUi(ui).split(" ")[3], "e6");
});

test("a single pawn push sets no en passant square", () => {
  const ui = fakeUi("rnbqkbnr/pppp1ppp/4p3/8/8/8/PPPPPPPP/RNBQKBNR", {
    turn: 0,
    lastMove: { t1: tile("e7"), t2: tile("e6", "Pawn") },
  });
  assert.equal(fenFromUi(ui).split(" ")[3], "-");
});

test("a knight move sets no en passant square", () => {
  const ui = fakeUi("rnbqkbnr/pppppppp/8/8/8/5N2/PPPPPPPP/RNBQKB1R", {
    turn: 1,
    lastMove: { t1: tile("g1"), t2: tile("f3", "Knight") },
  });
  assert.equal(fenFromUi(ui).split(" ")[3], "-");
});

test("empty ranks collapse to digits the way FEN requires", () => {
  const fen = fenFromUi(fakeUi("8/8/8/4k3/8/8/8/4K3"));
  assert.equal(fen.split(" ")[0], "8/8/8/4k3/8/8/8/4K3");
});

test("every generated FEN is one the engine accepts", () => {
  for (const placement of [
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR",
    "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R",
    "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8",
  ]) {
    const fen = fenFromUi(fakeUi(placement));
    assert.doesNotThrow(() => new Board(fen), fen);
    assert.equal(new Board(fen).fen().split(" ")[0], placement);
  }
});
