// Bridges the canvas UI in chess.js to the engine in engine/.
//
// The two keep separate board representations on purpose: the UI's is built
// around tiles that know how to draw themselves, the engine's is a flat 0x88
// array built for speed. Rather than force one to serve both, they talk through
// FEN in one direction and a UCI-style move string in the other — a narrow,
// testable interface that keeps rendering out of the search.

import { Board } from "./engine/board.js";
import { generateLegalMoves, moveToUci } from "./engine/movegen.js";
import { Search } from "./engine/search.js";

// One long-lived worker, so a search never blocks the board. Requests carry an
// id and late replies are dropped: take back a move mid-search and the answer
// to the position you left is no longer wanted.
let worker = null;
let nextRequestId = 1;
const pending = new Map();

function ensureWorker() {
  if (worker) return worker;
  worker = new Worker(new URL("./engine/worker.js", import.meta.url),
                      { type: "module" });
  worker.onmessage = ({ data }) => {
    const settle = pending.get(data.id);
    if (!settle) return;
    pending.delete(data.id);
    if (data.error) settle.reject(new Error(data.error));
    else settle.resolve(data.thought);
  };
  worker.onerror = (event) => {
    for (const { reject } of pending.values()) reject(new Error(event.message));
    pending.clear();
    worker = null;   // rebuilt on the next request
  };
  return worker;
}

const TYPE_LETTER = {
  Pawn: "p", Knight: "n", Bishop: "b", Rook: "r", Queen: "q", King: "k",
};
const FILES = "abcdefgh";

// The UI stores White's back rank at board[0] and counts tile.y downward from
// there, so a tile's chess rank is 8 - y, not y + 1. Getting this backwards
// produces a FEN that parses cleanly and describes a mirrored position, which
// is why the integration test plays real games rather than trusting a fixture.
const rowForRank = (rank) => rank - 1;
const rankOfTile = (tile) => 8 - tile.y;
const yForRank = (rank) => 8 - rank;

/** The UI board as a FEN string. */
export function fenFromUi(ui) {
  let placement = "";
  for (let rank = 8; rank >= 1; rank--) {      // FEN runs rank 8 down to rank 1
    let run = 0;
    for (let col = 0; col < 8; col++) {
      const piece = ui.board[rowForRank(rank)][col].piece;
      if (piece === null) { run++; continue; }
      if (run) { placement += run; run = 0; }
      const letter = TYPE_LETTER[piece.constructor.name];
      placement += piece.color === "white" ? letter.toUpperCase() : letter;
    }
    if (run) placement += run;
    if (rank > 1) placement += "/";
  }

  const side = ui.turn === 0 ? "w" : "b";

  // The UI tracks a per-piece move count rather than castling flags, so the
  // rights are derived: a right survives only while its king and rook are both
  // still on their original squares and have never moved.
  const unmoved = (rank, col, name) => {
    const piece = ui.board[rowForRank(rank)][col].piece;
    return piece !== null && piece.constructor.name === name && piece.hasMoved === 0;
  };
  let rights = "";
  if (unmoved(1, 4, "King")) {
    if (unmoved(1, 7, "Rook")) rights += "K";
    if (unmoved(1, 0, "Rook")) rights += "Q";
  }
  if (unmoved(8, 4, "King")) {
    if (unmoved(8, 7, "Rook")) rights += "k";
    if (unmoved(8, 0, "Rook")) rights += "q";
  }

  // En passant is available only immediately after a double pawn push.
  let ep = "-";
  const last = ui.lastMove;
  if (last && last.t2.piece && last.t2.piece.constructor.name === "Pawn" &&
      Math.abs(last.t2.y - last.t1.y) === 2) {
    ep = FILES[last.t2.x] + (rankOfTile(last.t1) + rankOfTile(last.t2)) / 2;
  }

  const fullmove = Math.floor(ui.moveList.length / 2) + 1;
  return `${placement} ${side} ${rights || "-"} ${ep} 0 ${fullmove}`;
}

/** Find the UI Move object matching a UCI string, or null. */
export function uiMoveFromUci(ui, uci) {
  const fromFile = FILES.indexOf(uci[0]), fromY = yForRank(Number(uci[1]));
  const toFile = FILES.indexOf(uci[2]), toY = yForRank(Number(uci[3]));

  // The promotion suffix is dropped: the UI promotes to a queen unconditionally
  // (Board.promote), so it cannot represent an underpromotion. See README.
  return ui.getAllMoves(ui.colors[ui.turn]).find((move) =>
    move.t1.x === fromFile && move.t1.y === fromY &&
    move.t2.x === toFile && move.t2.y === toY) ?? null;
}

/**
 * Ask the engine for a move in the UI's current position, off the main thread.
 * @returns {Promise<{uci, depth, nodes, score, elapsedMs, pv} | null>}
 */
export function think(ui, { maxDepth = 4, timeLimitMs = 2000 } = {}) {
  const fen = fenFromUi(ui);
  if (generateLegalMoves(new Board(fen)).length === 0) return Promise.resolve(null);

  const id = nextRequestId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ensureWorker().postMessage({ id, fen, maxDepth, timeLimitMs });
  });
}

/** Synchronous search on the calling thread. Used by the tests, which have no
 *  Worker, and as the fallback when constructing one fails. */
export function thinkSync(ui, { maxDepth = 4, timeLimitMs = 2000 } = {}) {
  const board = new Board(fenFromUi(ui));
  if (generateLegalMoves(board).length === 0) return null;
  const result = new Search({ maxDepth, timeLimitMs }).findBestMove(board);
  if (result.move === null) return null;
  return {
    uci: moveToUci(result.move), depth: result.depth, nodes: result.nodes,
    score: result.score, elapsedMs: result.elapsedMs, pv: result.pv,
  };
}

/** Compute and play the engine's reply on the UI board. */
export async function playEngineMove(ui, options) {
  const thought = await think(ui, options);
  if (thought === null) return null;

  const move = uiMoveFromUci(ui, thought.uci);
  if (move === null) {
    // The two rule implementations disagreed. Refusing to move is the right
    // failure: playing a move the UI thinks is illegal would corrupt its state.
    console.error(`engine proposed ${thought.uci}, which the UI rejects`);
    return null;
  }
  ui.movePiece(move);
  return thought;
}
