#!/usr/bin/env node
// Play the engine against itself with one evaluation term switched on and off,
// to find out whether the term is worth what it costs.
//
// A term can be correct in every direction and still lose games: every leaf it
// slows down is depth the search does not reach. Measuring nodes and
// microseconds says what a change costs; only games say what it buys.
//
// Both sides get the same time per move, so a slower evaluation pays for
// itself in shallower search — which is exactly the trade being tested.
//
// Run: node bench/match.js [--games 20] [--ms 100]

import { Board } from "../engine/board.js";
import { generateLegalMoves, moveToUci } from "../engine/movegen.js";
import { Search } from "../engine/search.js";
import { setMobility } from "../engine/eval.js";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? Number(process.argv[i + 1]) : fallback;
};
const GAMES = arg("--games", 20);
const MS = arg("--ms", 100);
const MAX_PLIES = 160;

// Deterministic engines play the same game every time, so the variety has to
// come from the openings. Each is played twice, with colours swapped, so no
// side is handed an advantage by the position itself.
const OPENINGS = [
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
  "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
  "rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
  "rnbqkbnr/ppp1pppp/8/3p4/3P4/8/PPP1PPPP/RNBQKBNR w KQkq - 0 2",
  "rnbqkbnr/pppppppp/8/8/2P5/8/PP1PPPPP/RNBQKBNR b KQkq - 0 1",
  "rnbqkb1r/pppppppp/5n2/8/3P4/8/PPP1PPPP/RNBQKBNR w KQkq - 0 2",
  "rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
  "rnbqkbnr/pppp1ppp/8/4p3/8/5N2/PPPPPPPP/RNBQKB1R b KQkq - 0 2",
  "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 3",
  "rnbqkb1r/pppp1ppp/5n2/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 0 3",
];

/** Play one game. `mobilityFor` says which side has the term enabled. */
function playGame(fen, mobilityForWhite) {
  const board = new Board(fen);
  const seen = new Map();

  for (let ply = 0; ply < MAX_PLIES; ply++) {
    const legal = generateLegalMoves(board);
    if (legal.length === 0) {
      // Checkmate scores for the other side; stalemate is a draw.
      return board.inCheck() ? (board.side === 0 ? "black" : "white") : "draw";
    }
    if (board.halfmove >= 100) return "draw";

    const key = board.hashKey();
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    if (count >= 3) return "draw";

    const whiteToMove = board.side === 0;
    setMobility(whiteToMove === mobilityForWhite);
    const result = new Search({ maxDepth: 64, timeLimitMs: MS })
      .findBestMove(board);
    if (result.move === null) return "draw";
    board.makeMove(result.move);
  }
  return "draw";
}

let withMobility = 0, withoutMobility = 0, draws = 0;
const pairs = Math.max(1, Math.round(GAMES / 2));

console.log(`${pairs * 2} games, ${MS} ms per move, colours swapped each pair\n`);
for (let i = 0; i < pairs; i++) {
  const fen = OPENINGS[i % OPENINGS.length];
  for (const mobilityForWhite of [true, false]) {
    const outcome = playGame(fen, mobilityForWhite);
    if (outcome === "draw") draws++;
    else if ((outcome === "white") === mobilityForWhite) withMobility++;
    else withoutMobility++;
    process.stdout.write(outcome === "draw" ? "." :
      ((outcome === "white") === mobilityForWhite ? "+" : "-"));
  }
}

const played = withMobility + withoutMobility + draws;
const score = (withMobility + draws / 2) / played;
console.log(`\n\n  with mobility     ${withMobility} wins`);
console.log(`  without mobility  ${withoutMobility} wins`);
console.log(`  draws             ${draws}`);
console.log(`  score for mobility ${(100 * score).toFixed(1)}%  (50% is no difference)`);
if (score > 0 && score < 1) {
  const elo = -400 * Math.log10(1 / score - 1);
  console.log(`  ~${elo >= 0 ? "+" : ""}${elo.toFixed(0)} Elo, on ${played} games — far too few to be conclusive`);
}
