#!/usr/bin/env node
// Speed benchmark. Answers four questions, in order of how much they matter:
//
//   1. How fast is the raw move generator?      (perft nodes/sec)
//   2. How fast does the search run?            (nodes/sec, time to depth)
//   3. How well is it pruning?                  (effective branching factor,
//                                                first-move cutoff rate)
//   4. Do the optimisations actually pay?       (TT and ordering, on vs off)
//
// Question 3 is the one that decides everything else. Alpha-beta's whole
// advantage rests on searching a good move first: with perfect ordering the
// tree is the square root of the full one, with random ordering it is barely
// better than plain minimax. The first-move cutoff rate measures that directly.
//
// Run: node bench/bench.js [--quick]

import { Board } from "../engine/board.js";
import { perft, generateMoves } from "../engine/movegen.js";
import { Search } from "../engine/search.js";

const QUICK = process.argv.includes("--quick");

const POSITIONS = [
  ["startpos", "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"],
  ["kiwipete", "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1"],
  ["endgame",  "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1"],
  ["midgame",  "r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10"],
];

const fmt = (n) => n.toLocaleString("en-US");
const pct = (a, b) => (b ? `${((100 * a) / b).toFixed(1)}%` : "—");

function time(fn) {
  const t0 = process.hrtime.bigint();
  const value = fn();
  return { value, ms: Number(process.hrtime.bigint() - t0) / 1e6 };
}

function section(title) {
  console.log(`\n${title}\n${"─".repeat(title.length)}`);
}

// ── 1. move generation ──────────────────────────────────────────────────────
function benchPerft() {
  section("Move generation (perft)");
  console.log("  position     depth        nodes        ms       nodes/sec");
  let totalNodes = 0, totalMs = 0;
  for (const [name, fen] of POSITIONS) {
    const depth = QUICK ? 3 : (name === "startpos" ? 5 : 4);
    const board = new Board(fen);
    const { value: nodes, ms } = time(() => perft(board, depth));
    totalNodes += nodes; totalMs += ms;
    console.log(`  ${name.padEnd(12)} ${String(depth).padStart(5)} ${fmt(nodes).padStart(12)}`
      + ` ${ms.toFixed(0).padStart(9)} ${fmt(Math.round(nodes / (ms / 1000))).padStart(15)}`);
  }
  console.log(`  ${"overall".padEnd(12)} ${"".padStart(5)} ${fmt(totalNodes).padStart(12)}`
    + ` ${totalMs.toFixed(0).padStart(9)} ${fmt(Math.round(totalNodes / (totalMs / 1000))).padStart(15)}`);
}

// ── 2 & 3. search speed, and how well it prunes ─────────────────────────────
function benchSearch() {
  section("Search: speed, growth, and pruning quality");
  const maxDepth = QUICK ? 5 : 7;

  for (const [name, fen] of POSITIONS) {
    console.log(`\n  ${name}`);
    console.log("    depth      nodes  (quiesce)        ms      nodes/sec    EBF   1st-move cutoff   TT hit");
    let previous = 0;
    for (let depth = 1; depth <= maxDepth; depth++) {
      const search = new Search({ maxDepth: depth, timeLimitMs: 60_000 });
      const { value: result, ms } = time(() => search.findBestMove(new Board(fen)));
      const s = result.stats;
      // Effective branching factor: how many times bigger each ply is than the
      // last. Unpruned this would be ~35; alpha-beta with good ordering pulls
      // it toward the square root of that, around 6.
      const ebf = previous ? (result.nodes / previous).toFixed(2) : "—";
      previous = result.nodes;
      console.log(
        `    ${String(depth).padStart(5)} ${fmt(result.nodes).padStart(10)}`
        + ` ${("(" + fmt(s.quiescence) + ")").padStart(11)}`
        + ` ${ms.toFixed(0).padStart(9)} ${fmt(Math.round(result.nodes / (ms / 1000))).padStart(14)}`
        + ` ${String(ebf).padStart(6)}`
        + ` ${pct(s.firstMoveCutoffs, s.cutoffs).padStart(17)}`
        + ` ${pct(s.ttHits, s.ttProbes).padStart(8)}`);
    }
  }
}

// ── 4. do the optimisations pay for themselves? ─────────────────────────────
function benchAblation() {
  section("Ablation: what each optimisation is worth");
  const depth = QUICK ? 4 : 5;
  const CAP_MS = 60_000;
  console.log(`  Nodes to reach depth ${depth}. Lower is better.\n`);
  console.log("    position     full search       no TT     no ordering   ordering cost");

  // A run that hits the clock reports how far it got, not what the search
  // costs — so the count is a floor and has to be marked as one. Reporting a
  // truncated number as a completed one would understate the very effect the
  // row exists to measure.
  const run = (fen, configure) => {
    const search = new Search({ maxDepth: depth, timeLimitMs: CAP_MS });
    if (configure) configure(search);
    const result = search.findBestMove(new Board(fen));
    return {
      nodes: search.nodes + search.qnodes,
      truncated: result.depth < depth,
    };
  };

  let anyTruncated = false;
  for (const [name, fen] of POSITIONS) {
    const full = run(fen);
    // ttSize 1 makes the table clear on every store, so it never returns a hit.
    const noTt = run(fen, (s) => { s.ttSize = 1; });
    // Replace ordering with generation order to isolate what it buys.
    const noOrder = run(fen, (s) => { s.orderMoves = (board, moves) => moves; });

    anyTruncated ||= noOrder.truncated;
    const mark = (r) => fmt(r.nodes) + (r.truncated ? "+" : "");
    const ratio = noOrder.nodes / full.nodes;
    console.log(`    ${name.padEnd(12)} ${mark(full).padStart(11)}`
      + ` ${mark(noTt).padStart(11)}`
      + ` ${mark(noOrder).padStart(15)}`
      + ` ${((noOrder.truncated ? ">" : "") + ratio.toFixed(0) + "x").padStart(14)}`);
  }
  console.log("\n  'ordering cost' is how many times more nodes the same search visits");
  console.log("  with move ordering switched off — the price of guessing badly.");
  if (anyTruncated) {
    console.log(`  '+' marks a run stopped by the ${CAP_MS / 1000}s clock before reaching`);
    console.log("  the target depth, so its node count is a floor and its ratio a lower bound.");
  }
}

console.log(`chess-js engine benchmark${QUICK ? "  (quick)" : ""}`);
console.log(`node ${process.version}`);
benchPerft();
benchSearch();
benchAblation();
console.log();
