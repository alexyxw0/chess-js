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
    window: { addEventListener() {} },
    requestAnimationFrame: (fn) => fn(),
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
    window: { addEventListener() {} },
    requestAnimationFrame: (fn) => fn(),
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
  assert.doesNotThrow(() => ui.pointerDown({ clientX: 1000, clientY: 400 }));
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

// ── drag and click, on the real board ───────────────────────────────────────
//
// A click and the start of a drag are the same press, and only the release
// tells them apart. These drive press/move/release against the real chess.js
// to check both gestures reach the same place.

const SQ = (name) => {
  const file = "abcdefgh".indexOf(name[0]);
  const rank = Number(name[1]);
  // canvas centre of that square, with the canvas at the origin, unscaled
  return { clientX: file * 100 + 50, clientY: (8 - rank) * 100 + 50 };
};

test("click-to-move: press the piece, then press the destination", () => {
  const ui = boardWithCanvas(UNSCROLLED);
  ui.pointerDown(SQ("e2"));
  ui.pointerUp(SQ("e2"));                 // released without moving: stays selected
  assert.equal(ui.focused, ui.board[1][4], "e2 is selected");
  assert.ok(ui.currentMoves.length > 0, "its moves are listed");

  ui.pointerDown(SQ("e4"));
  assert.equal(ui.moveList.length, 1, "the move was played");
  assert.equal(ui.board[3][4].piece?.constructor.name, "Pawn", "pawn is on e4");
  assert.equal(ui.board[1][4].piece, null, "e2 is empty");
});

test("drag-and-drop: press, move, release on the destination", () => {
  const ui = boardWithCanvas(UNSCROLLED);
  ui.pointerDown(SQ("d2"));
  assert.ok(ui.drag, "a piece is held");
  ui.pointerMove({ clientX: 350, clientY: 500 });
  assert.ok(ui.drag.moved, "the pointer moved");
  ui.pointerUp(SQ("d4"));

  assert.equal(ui.drag, null, "the piece was let go");
  assert.equal(ui.moveList.length, 1);
  assert.equal(ui.board[3][3].piece?.constructor.name, "Pawn", "pawn is on d4");
});

test("dropping on an illegal square plays nothing and clears the selection", () => {
  const ui = boardWithCanvas(UNSCROLLED);
  ui.pointerDown(SQ("e2"));
  ui.pointerMove({ clientX: 450, clientY: 150 });
  ui.pointerUp(SQ("e7"));                 // a black pawn, not a legal target
  assert.equal(ui.moveList.length, 0);
  assert.equal(ui.focused, null);
  assert.equal(ui.drag, null);
});

test("releasing off the board does not leave a piece stuck to the cursor", () => {
  const ui = boardWithCanvas(UNSCROLLED);
  ui.pointerDown(SQ("e2"));
  ui.pointerMove({ clientX: 1100, clientY: 400 });
  ui.pointerUp({ clientX: 1100, clientY: 400 });
  assert.equal(ui.drag, null);
  assert.equal(ui.moveList.length, 0);
});

test("an opponent piece cannot be picked up", () => {
  const ui = boardWithCanvas(UNSCROLLED);
  ui.pointerDown(SQ("e7"));               // black, on white's turn
  assert.equal(ui.drag, null);
  assert.equal(ui.focused, null);
});

test("pressing the selected piece again deselects it", () => {
  const ui = boardWithCanvas(UNSCROLLED);
  ui.pointerDown(SQ("e2"));
  ui.pointerUp(SQ("e2"));
  assert.equal(ui.focused, ui.board[1][4]);
  ui.pointerDown(SQ("e2"));
  assert.equal(ui.focused, null);
  assert.equal(ui.currentMoves.length, 0);
});

test("a drag works when the canvas is scrolled and scaled", () => {
  const ui = boardWithCanvas({ left: 20, top: -280, width: 600, height: 400 });
  const at = (name) => {
    const file = "abcdefgh".indexOf(name[0]), rank = Number(name[1]);
    return { clientX: 20 + (file * 100 + 50) * 0.5,
             clientY: -280 + ((8 - rank) * 100 + 50) * 0.5 };
  };
  ui.pointerDown(at("g1"));
  ui.pointerMove(at("f3"));
  ui.pointerUp(at("f3"));
  assert.equal(ui.moveList.length, 1);
  assert.equal(ui.board[2][5].piece?.constructor.name, "Knight");
});
