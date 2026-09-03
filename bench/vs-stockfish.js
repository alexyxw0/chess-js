#!/usr/bin/env node
// Play this engine against Stockfish and turn the result into an Elo estimate.
//
// Self-play tells you whether a change helped; it cannot tell you how strong
// the engine is, because both sides share every weakness. Stockfish can be
// pinned to a target rating (UCI_LimitStrength + UCI_Elo), so a match against
// it converts "61.7% against myself" into a number on the same scale everyone
// else uses.
//
// Run: node bench/vs-stockfish.js --elo 1400 --games 20 --movetime 200

import { spawn } from "node:child_process";
import { Board } from "../engine/board.js";
import { generateLegalMoves, moveToUci } from "../engine/movegen.js";
import { Search } from "../engine/search.js";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const ELO = Number(arg("--elo", 1400));
const GAMES = Number(arg("--games", 20));
const MOVETIME = Number(arg("--movetime", 200));
const MAX_PLIES = Number(arg("--max-plies", 200));
const BIN = arg("--engine", "stockfish");
// Fixed search depth is a far more interpretable handicap than UCI_Elo.
// UCI_LimitStrength does not make Stockfish think less — measured, it still
// searches 13 plies at every setting from 1320 to 2800 and simply chooses
// worse moves. Beating that says nothing transferable about strength. Capping
// its *depth* produces a claim that means something: "at 200 ms a move, this
// engine holds its own against Stockfish searching N plies."
const SF_DEPTH = Number(arg("--sf-depth", 0));

// Openings so two deterministic engines do not replay one game. Each is played
// twice with colours swapped, so no result is an artefact of the position.
const OPENINGS = [
  "", "e2e4", "d2d4", "g1f3", "c2c4", "e2e4 e7e5", "d2d4 d7d5",
  "e2e4 c7c5", "g1f3 g8f6", "d2d4 g8f6",
];

class Uci {
  constructor(bin) {
    this.proc = spawn(bin, [], { stdio: ["pipe", "pipe", "ignore"] });
    this.buffer = "";
    this.waiters = [];
    this.proc.stdout.on("data", (chunk) => {
      this.buffer += chunk.toString();
      let nl;
      while ((nl = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, nl).trim();
        this.buffer = this.buffer.slice(nl + 1);
        this.waiters = this.waiters.filter((w) => !w(line));
      }
    });
  }

  send(cmd) { this.proc.stdin.write(cmd + "\n"); }

  /** Resolve on the first line satisfying `match`. */
  expect(match) {
    return new Promise((resolve) => {
      this.waiters.push((line) => {
        if (!match(line)) return false;
        resolve(line);
        return true;
      });
    });
  }

  async ready() {
    this.send("uci");
    await this.expect((l) => l === "uciok");
    if (!SF_DEPTH) {
      this.send("setoption name UCI_LimitStrength value true");
      this.send(`setoption name UCI_Elo value ${ELO}`);
    }
    this.send("setoption name Threads value 1");
    this.send("isready");
    await this.expect((l) => l === "readyok");
  }

  async bestMove(moves) {
    this.send("position startpos" + (moves.length ? " moves " + moves.join(" ") : ""));
    this.send(SF_DEPTH ? `go depth ${SF_DEPTH}` : `go movetime ${MOVETIME}`);
    const line = await this.expect((l) => l.startsWith("bestmove"));
    return line.split(/\s+/)[1];
  }

  quit() { this.send("quit"); this.proc.kill(); }
}

/** Replay a move list onto a board. */
function replay(moves) {
  const board = new Board();
  for (const uci of moves) {
    const move = generateLegalMoves(board).find((m) => moveToUci(m) === uci
      || moveToUci(m).slice(0, 4) === uci);
    if (!move) return null;
    board.makeMove(move);
  }
  return board;
}

async function playGame(sf, opening, weArePlayingWhite) {
  const moves = opening ? opening.split(" ") : [];
  const seen = new Map();

  for (let ply = moves.length; ply < MAX_PLIES; ply++) {
    const board = replay(moves);
    if (!board) return { result: "error", moves };

    const legal = generateLegalMoves(board);
    if (legal.length === 0) {
      if (!board.inCheck()) return { result: "draw", moves };
      const loserIsWhite = board.side === 0;
      return { result: loserIsWhite === weArePlayingWhite ? "loss" : "win", moves };
    }
    if (board.halfmove >= 100) return { result: "draw", moves };
    const key = board.hashKey();
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    if (n >= 3) return { result: "draw", moves };

    const ourTurn = (board.side === 0) === weArePlayingWhite;
    let uci;
    if (ourTurn) {
      const result = new Search({ maxDepth: 64, timeLimitMs: MOVETIME })
        .findBestMove(board);
      if (result.move === null) return { result: "draw", moves };
      uci = moveToUci(result.move);
    } else {
      uci = await sf.bestMove(moves);
      if (!uci || uci === "(none)") return { result: "draw", moves };
    }
    moves.push(uci);
  }
  return { result: "draw", moves };
}

const sf = new Uci(BIN);
await sf.ready();

let win = 0, loss = 0, draw = 0;
const pairs = Math.max(1, Math.round(GAMES / 2));
const handicap = SF_DEPTH ? `depth ${SF_DEPTH}` : `UCI_Elo ${ELO}`;
console.log(`chess-js (${MOVETIME} ms/move) vs Stockfish (${handicap}), `
  + `${pairs * 2} games, colours swapped\n`);

for (let i = 0; i < pairs; i++) {
  for (const asWhite of [true, false]) {
    const { result } = await playGame(sf, OPENINGS[i % OPENINGS.length], asWhite);
    if (result === "win") { win++; process.stdout.write("+"); }
    else if (result === "loss") { loss++; process.stdout.write("-"); }
    else { draw++; process.stdout.write("="); }
  }
}
sf.quit();

const played = win + loss + draw;
const score = (win + draw / 2) / played;
console.log(`\n\n  +${win} -${loss} =${draw}   score ${(100 * score).toFixed(1)}%`);
if (SF_DEPTH) {
  console.log(`  vs Stockfish capped at ${SF_DEPTH} plies`);
} else if (score > 0 && score < 1) {
  const delta = -400 * Math.log10(1 / score - 1);
  console.log(`  performance vs a ${ELO} opponent: ~${(ELO + delta).toFixed(0)} Elo`
    + `  (${delta >= 0 ? "+" : ""}${delta.toFixed(0)})`);
} else {
  console.log(`  ${score === 1 ? "won every game" : "lost every game"} — `
    + `the estimate needs an opponent closer in strength`);
}
console.log(`  n=${played}: the 95% interval on a score is roughly `
  + `+/-${(100 * 1.96 * Math.sqrt(0.25 / played)).toFixed(0)} points, so treat this as a bracket`);
