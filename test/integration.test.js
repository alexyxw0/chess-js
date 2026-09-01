// Loads the real chess.js UI under a headless stub and plays engine moves
// against it. The unit tests check the adapter against a hand-built fake; this
// checks it against the actual game object, which is where a mismatch between
// the two rule implementations would actually bite.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

import { fenFromUi, uiMoveFromUci } from "../engine-adapter.js";
import { Board } from "../engine/board.js";
import { generateLegalMoves, moveToUci } from "../engine/movegen.js";
import { Search } from "../engine/search.js";

const here = dirname(fileURLToPath(import.meta.url));

/** Run chess.js with just enough of a browser to construct a game. */
function loadGame() {
  const noop = new Proxy(() => {}, { get: () => noop, apply: () => undefined });
  const context = vm.createContext({
    document: { getElementById: () => ({ getContext: () => noop, addEventListener() {} }) },
    Image: class { set src(_) {} addEventListener() {} },
    Audio: class { play() {} load() {} cloneNode() { return this; } },
    addEventListener() {},
    console,
  });
  vm.runInContext(readFileSync(join(here, "..", "chess.js"), "utf8"), context);
  return context.game;
}

test("the UI's starting position produces the canonical FEN", () => {
  const fen = fenFromUi(loadGame().board);
  assert.equal(fen.split(" ").slice(0, 4).join(" "),
               "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -");
});

test("the two move generators agree on the legal moves from the start", () => {
  const ui = loadGame().board;
  // tile.y counts down from White's back rank, so the chess rank is 8 - y.
  const name = (t) => "abcdefgh"[t.x] + (8 - t.y);
  const uiMoves = new Set(ui.getAllMoves("white").map((m) => name(m.t1) + name(m.t2)));
  const engineMoves = new Set(generateLegalMoves(new Board(fenFromUi(ui)))
    .map((m) => moveToUci(m).slice(0, 4)));   // drop promotion suffixes
  assert.deepEqual([...uiMoves].sort(), [...engineMoves].sort());
});

test("every engine move the search picks is one the UI accepts", () => {
  const ui = loadGame().board;
  // Play a short game with the engine on both sides. If the representations
  // ever drift apart, uiMoveFromUci returns null and this fails.
  for (let ply = 0; ply < 12; ply++) {
    const fen = fenFromUi(ui);
    const board = new Board(fen);
    if (generateLegalMoves(board).length === 0) break;

    const result = new Search({ maxDepth: 3, timeLimitMs: 4000 }).findBestMove(board);
    const uci = moveToUci(result.move);
    const uiMove = uiMoveFromUci(ui, uci);
    assert.ok(uiMove !== null, `UI rejected ${uci} in ${fen}`);
    ui.movePiece(uiMove);
  }
  assert.equal(ui.moveList.length, 12);
});

test("the FEN stays parseable after every ply of a played game", () => {
  const ui = loadGame().board;
  for (let ply = 0; ply < 10; ply++) {
    const fen = fenFromUi(ui);
    assert.doesNotThrow(() => new Board(fen), fen);
    const board = new Board(fen);
    const legal = generateLegalMoves(board);
    if (!legal.length) break;
    const uci = moveToUci(legal[0]);
    const uiMove = uiMoveFromUci(ui, uci);
    assert.ok(uiMove !== null, `UI rejected its own legal move ${uci}`);
    ui.movePiece(uiMove);
  }
});
