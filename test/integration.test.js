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
        width: 800, height: 800,
        getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 800 }),
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
    width: 800, height: 800,
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

const UNSCROLLED = { left: 0, top: 0, width: 800, height: 800 };

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
  const ui = boardWithCanvas({ left: 20, top: -280, width: 800, height: 800 });
  assert.deepEqual(at(ui, 70, 470), [0, 0], "a1 after scroll");
  assert.deepEqual(at(ui, 770, -230), [7, 7], "h8 after scroll");
});

test("clicks stay correct when CSS displays the canvas smaller", () => {
  // max-width:100% on a narrow window: 800x800 shown at 400x400.
  const ui = boardWithCanvas({ left: 20, top: 20, width: 400, height: 400 });
  assert.deepEqual(at(ui, 45, 395), [0, 0], "a1 at half scale");
  assert.deepEqual(at(ui, 395, 45), [7, 7], "h8 at half scale");
});

test("a pointer outside the board maps to nothing and does not throw", () => {
  // pointerup is bound to the window, so releases arrive from outside the
  // canvas. Without the guard, board[i][j] is undefined and reading .piece
  // throws — which is what happened when the canvas was wider than the board.
  const ui = boardWithCanvas(UNSCROLLED);
  for (const [x, y] of [[900, 400], [-40, 400], [400, 900], [400, -40]]) {
    assert.deepEqual(at(ui, x, y), [-1, -1], `${x},${y}`);
    assert.doesNotThrow(() => ui.pointerDown({ clientX: x, clientY: y }));
    assert.doesNotThrow(() => ui.pointerUp({ clientX: x, clientY: y }));
  }
});

test("every square on the board round-trips", () => {
  const ui = boardWithCanvas({ left: 37, top: -113, width: 600, height: 600 });
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 8; j++) {
      // centre of square (i, j) in canvas pixels, then to client pixels
      const cx = j * 100 + 50, cy = (7 - i) * 100 + 50;
      const clientX = 37 + cx * (600 / 800);
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
  ui.pointerMove({ clientX: 950, clientY: 400 });
  ui.pointerUp({ clientX: 950, clientY: 400 });
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
  const ui = boardWithCanvas({ left: 20, top: -280, width: 400, height: 400 });
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

// ── take-back and replay ────────────────────────────────────────────────────
//
// `isPromoted` is `false` for a piece that started as itself and a number for
// one that was promoted. Distinguishing them with `==` rather than `===`
// demoted every piece to a pawn on take-back — and the demoted pawn, sitting
// on a back rank, was then promoted to a queen by the next move's promotion
// check. Bishops became pawns, and pawns became queens.

function gameAt(fen_setup) {
  const ui = boardWithCanvas(UNSCROLLED);
  return ui;
}

const SQUARE = (ui, name) =>
  ui.board[Number(name[1]) - 1]["abcdefgh".indexOf(name[0])];

function play(ui, from, to) {
  const move = ui.getAllMoves(ui.colors[ui.turn])
    .find((m) => m.t1 === SQUARE(ui, from) && m.t2 === SQUARE(ui, to));
  assert.ok(move, `no legal move ${from}${to}`);
  ui.movePiece(move);
}

const LEFT = { keyCode: "37" };
const RIGHT = { keyCode: "39" };
const nameAt = (ui, sq) => SQUARE(ui, sq).piece?.constructor.name ?? null;

test("take-back does not change what a piece is", () => {
  const ui = gameAt();
  play(ui, "e2", "e4"); play(ui, "e7", "e5");
  play(ui, "f1", "c4");
  ui.takeBack(LEFT);
  assert.equal(nameAt(ui, "f1"), "Bishop");
  assert.equal(nameAt(ui, "c4"), null);
});

test("replaying forward restores the same piece", () => {
  const ui = gameAt();
  play(ui, "g1", "f3"); play(ui, "b8", "c6");
  ui.takeBack(LEFT);
  ui.forward(RIGHT);
  assert.equal(nameAt(ui, "c6"), "Knight");
});

test("a rewound piece is not promoted by the next move", () => {
  // The second half of the same bug: a piece demoted onto a back rank was
  // promoted to a queen by the promotion check on the following move.
  const ui = gameAt();
  play(ui, "e2", "e4"); play(ui, "e7", "e5");
  play(ui, "f1", "c4");
  ui.takeBack(LEFT);
  play(ui, "d2", "d4");            // any move; runs checkPromotion
  assert.equal(nameAt(ui, "f1"), "Bishop", "f1 must not have become a queen");
});

test("rewinding the whole game restores the starting position", () => {
  const ui = gameAt();
  const start = fenFromUi(ui);
  for (const [from, to] of [["e2","e4"],["e7","e5"],["g1","f3"],["b8","c6"],
                            ["f1","b5"],["g8","f6"]]) play(ui, from, to);
  for (let i = 0; i < 6; i++) ui.takeBack(LEFT);
  assert.equal(fenFromUi(ui), start);
});

test("rewinding and replaying returns to the same position", () => {
  const ui = gameAt();
  for (const [from, to] of [["d2","d4"],["d7","d5"],["c1","f4"],["b8","c6"]])
    play(ui, from, to);
  const after = fenFromUi(ui);
  for (let i = 0; i < 4; i++) ui.takeBack(LEFT);
  for (let i = 0; i < 4; i++) ui.forward(RIGHT);
  assert.equal(fenFromUi(ui), after);
});

test("taking back a capture restores the captured piece", () => {
  const ui = gameAt();
  play(ui, "e2", "e4"); play(ui, "d7", "d5");
  play(ui, "e4", "d5");                       // pawn takes pawn
  assert.equal(nameAt(ui, "d5"), "Pawn");
  ui.takeBack(LEFT);
  assert.equal(nameAt(ui, "e4"), "Pawn", "the capturer is back on e4");
  assert.equal(nameAt(ui, "d5"), "Pawn", "the captured pawn is restored");
  assert.equal(SQUARE(ui, "d5").piece.color, "black");
});

test("taking back castling puts the rook back too", () => {
  const ui = gameAt();
  for (const [from, to] of [["e2","e4"],["e7","e5"],["g1","f3"],["b8","c6"],
                            ["f1","c4"],["g8","f6"]]) play(ui, from, to);
  play(ui, "e1", "g1");                       // O-O
  assert.equal(nameAt(ui, "g1"), "King");
  assert.equal(nameAt(ui, "f1"), "Rook");
  ui.takeBack(LEFT);
  assert.equal(nameAt(ui, "e1"), "King");
  assert.equal(nameAt(ui, "h1"), "Rook");
  assert.equal(nameAt(ui, "f1"), null);
});

test("the engine still agrees with the board after a rewind", () => {
  // The corruption showed up in the engine too, because the adapter reads the
  // board's pieces to build a FEN — a demoted bishop became a pawn there too.
  const ui = gameAt();
  play(ui, "e2", "e4"); play(ui, "e7", "e5"); play(ui, "f1", "c4");
  ui.takeBack(LEFT);

  const board = new Board(fenFromUi(ui));
  const uiMoves = new Set(ui.getAllMoves(ui.colors[ui.turn]).map((m) =>
    "abcdefgh"[m.t1.x] + (8 - m.t1.y) + "abcdefgh"[m.t2.x] + (8 - m.t2.y)));
  const engineMoves = new Set(generateLegalMoves(board)
    .map((m) => moveToUci(m).slice(0, 4)));
  assert.deepEqual([...uiMoves].sort(), [...engineMoves].sort());
});

test("promotion round-trips: queen on the way forward, pawn on the way back", () => {
  // A custom setup, so the position is one move from promoting.
  const ui = boardWithCanvas(UNSCROLLED);
  const BoardClass = ui.constructor;
  const game = new BoardClass("k7/4P3/8/8/8/8/8/K7");

  const sq = (n) => game.board[Number(n[1]) - 1]["abcdefgh".indexOf(n[0])];
  const move = game.getAllMoves("white")
    .find((m) => m.t1 === sq("e7") && m.t2 === sq("e8"));
  assert.ok(move, "e7-e8 should be available");

  game.movePiece(move);
  assert.equal(sq("e8").piece.constructor.name, "Queen", "promoted");
  assert.equal(sq("e8").piece.isPromoted, 1, "and marked as promoted");

  game.takeBack(LEFT);
  assert.equal(sq("e7").piece.constructor.name, "Pawn", "demoted on take-back");
  assert.equal(sq("e7").piece.isPromoted, false, "and marked as never promoted");
  assert.equal(sq("e8").piece, null);

  game.forward(RIGHT);
  assert.equal(sq("e8").piece.constructor.name, "Queen", "promoted again");
});

test("a promoted queen that moves again is not demoted early", () => {
  const ui = boardWithCanvas(UNSCROLLED);
  const game = new ui.constructor("k7/4P3/8/8/8/8/8/K7");
  const sq = (n) => game.board[Number(n[1]) - 1]["abcdefgh".indexOf(n[0])];
  const find = (from, to) => game.getAllMoves(game.colors[game.turn])
    .find((m) => m.t1 === sq(from) && m.t2 === sq(to));

  game.movePiece(find("e7", "e8"));      // promote
  game.movePiece(find("a8", "b7"));      // black king moves
  game.movePiece(find("e8", "e4"));      // the new queen moves
  assert.equal(sq("e4").piece.constructor.name, "Queen");

  game.takeBack(LEFT);                   // undo the queen move only
  assert.equal(sq("e8").piece.constructor.name, "Queen", "still a queen");
});
