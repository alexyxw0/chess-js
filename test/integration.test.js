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
    document: {
      getElementById: () => ({
        getContext: () => noop, addEventListener() {},
        width: 1200, height: 800,
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 1200, height: 800 }),
      }),
      addEventListener() {},
      activeElement: null,
    },
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

// ── click coordinates ───────────────────────────────────────────────────────
//
// The original handler read `e.clientY / 100` directly, which assumes the
// canvas sits at the top-left of an unscrolled page and is displayed at its
// backing-store size. All three assumptions are false in the real page, and
// each one offsets every click.

function boardWithCanvas(rect) {
  const noop = new Proxy(() => {}, { get: () => noop, apply: () => undefined });
  const canvas = {
    getContext: () => noop, addEventListener() {},
    width: 1200, height: 800,
    getBoundingClientRect: () => rect,
  };
  const context = vm.createContext({
    document: { getElementById: () => canvas, addEventListener() {}, activeElement: null },
    Image: class { set src(_) {} addEventListener() {} },
    Audio: class { play() {} load() {} cloneNode() { return this; } },
    addEventListener() {}, console,
  });
  vm.runInContext(readFileSync(join(here, "..", "chess.js"), "utf8"), context);
  return context.game.board;
}

const UNSCROLLED = { left: 0, top: 0, width: 1200, height: 800 };

// Arrays built inside the vm realm carry that realm's Array.prototype, and
// deepStrictEqual compares prototypes — so copy into a host array first.
const at = (ui, clientX, clientY) => [...ui.tileAt({ clientX, clientY })];

test("clicks map to the right square when the canvas is at the origin", () => {
  const ui = boardWithCanvas(UNSCROLLED);
  assert.deepEqual(at(ui, 50, 750), [0, 0], "a1");
  assert.deepEqual(at(ui, 750, 50), [7, 7], "h8");
  assert.deepEqual(at(ui, 50, 50), [7, 0], "a8");
});

test("clicks stay correct after the page is scrolled", () => {
  // Scrolled down 300px: the canvas top is now at viewport -280.
  const ui = boardWithCanvas({ left: 20, top: -280, width: 1200, height: 800 });
  assert.deepEqual(at(ui, 70, 470), [0, 0], "a1 after scroll");
  assert.deepEqual(at(ui, 770, -230), [7, 7], "h8 after scroll");
});

test("clicks stay correct when CSS displays the canvas smaller", () => {
  // max-width:100% on a narrow window: 1200x800 shown at 600x400.
  const ui = boardWithCanvas({ left: 20, top: 20, width: 600, height: 400 });
  assert.deepEqual(at(ui, 45, 395), [0, 0], "a1 at half scale");
  assert.deepEqual(at(ui, 395, 45), [7, 7], "h8 at half scale");
});

test("the strip beside the board is not clickable", () => {
  // The canvas is 1200 wide; the board is 800. Without a guard, board[i][j]
  // is undefined out there and reading .piece throws.
  const ui = boardWithCanvas(UNSCROLLED);
  assert.deepEqual(at(ui, 1000, 400), [-1, -1]);
  assert.doesNotThrow(() => ui.selectTile({ clientX: 1000, clientY: 400 }));
});

test("every square on the board round-trips", () => {
  const ui = boardWithCanvas({ left: 37, top: -113, width: 900, height: 600 });
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      // centre of square (i, j) in canvas pixels, then to client pixels
      const cx = j * 100 + 50, cy = (7 - i) * 100 + 50;
      const clientX = 37 + cx * (900 / 1200);
      const clientY = -113 + cy * (600 / 800);
      assert.deepEqual(at(ui, clientX, clientY), [i, j], `square ${i},${j}`);
    }
  }
});
