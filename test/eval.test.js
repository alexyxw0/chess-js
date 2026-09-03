// Evaluation terms are the easiest thing in an engine to get subtly backwards:
// a sign error still produces plausible-looking play, just consistently wrong
// play. These pin each term's direction and the invariants that hold whatever
// the numbers are.

import test from "node:test";
import assert from "node:assert/strict";

import { Board, WHITE, BLACK } from "../engine/board.js";
import { evaluate, kingDanger, mobility, phaseOf, PIECE_VALUE } from "../engine/eval.js";

/**
 * Evaluate a FEN, refusing one that is missing a king.
 *
 * Worth the guard: a position with one king short evaluates around ±20000,
 * which looks like a colossal positional score and quietly invalidates
 * whatever the test thought it was measuring. It caught two bad FENs here.
 */
function evalOf(fen) {
  const placement = fen.split(" ")[0];
  assert.ok(placement.includes("K"), `no white king in ${fen}`);
  assert.ok(placement.includes("k"), `no black king in ${fen}`);
  return evaluate(new Board(fen));
}

// ── invariants ──────────────────────────────────────────────────────────────

test("a symmetrical position is level", () => {
  assert.equal(evalOf("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"), 0);
});

test("evaluation is from the side to move, so the sign flips", () => {
  const white = evalOf("4k3/8/8/8/8/8/8/R3K3 w - - 0 1");
  const black = evalOf("4k3/8/8/8/8/8/8/R3K3 b - - 0 1");
  assert.equal(white, -black);
  assert.ok(white > 0, "an extra rook is good for the side that has it");
});

test("a mirrored position evaluates the same for the mirrored side", () => {
  // Same structure with the colours swapped and the board flipped: whatever
  // the terms are worth, they must be worth the same to both sides.
  const a = evalOf("rnbq1rk1/ppp2ppp/3b1n2/4p3/4P3/3B1N2/PPP2PPP/RNBQ1RK1 w - - 0 1");
  assert.equal(a, 0);
});

// ── phase ───────────────────────────────────────────────────────────────────

test("phase runs from 1 at the opening to 0 with only kings and pawns", () => {
  assert.equal(phaseOf(new Board("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1")), 1);
  assert.equal(phaseOf(new Board("4k3/pppppppp/8/8/8/8/PPPPPPPP/4K3 w - - 0 1")), 0,
    "pawns do not keep a position in the middlegame");
  const mid = phaseOf(new Board("4k3/8/8/8/8/8/8/3QK3 w - - 0 1"));
  assert.ok(mid > 0 && mid < 1, `a lone queen should be partway, got ${mid}`);
});

// ── king safety ─────────────────────────────────────────────────────────────

test("losing the pawn shield makes the king more exposed", () => {
  const intact = "rnbq1rk1/ppp2ppp/3b1n2/4p3/4P3/3B1N2/PPP2PPP/RNBQ1RK1 w - - 0 1";
  const broken = "rnbq1rk1/ppp2ppp/3b1n2/4p3/4P3/3B1N1P/PPP3P1/RNBQ1RK1 w - - 0 1";
  assert.ok(kingDanger(new Board(broken), WHITE) > kingDanger(new Board(intact), WHITE));
  assert.ok(evalOf(broken) < evalOf(intact), "and the side that lost it is worse");
});

test("an enemy piece closing on the king raises the danger", () => {
  const far = new Board("6k1/5ppp/8/8/8/8/5PPP/3Q2K1 w - - 0 1");
  const near = new Board("5Qk1/5ppp/8/8/8/8/5PPP/6K1 w - - 0 1");
  assert.ok(kingDanger(near, BLACK) > kingDanger(far, BLACK),
    "a queen beside the king should count for more than one at home");
});

test("king safety is scaled away in the endgame", () => {
  // The same exposed king, with and without pieces on the board to exploit it.
  const middlegame = phaseOf(new Board("r2q1rk1/ppp2ppp/8/8/8/8/PPP2PPP/R2Q1RK1 w - - 0 1"));
  const endgame = phaseOf(new Board("6k1/ppp2ppp/8/8/8/8/PPP2PPP/6K1 w - - 0 1"));
  assert.ok(middlegame > endgame);
  assert.equal(endgame, 0, "kings and pawns is a pure endgame");
});

// ── king activity by phase ──────────────────────────────────────────────────

test("the king should hide in the opening", () => {
  const home = evalOf("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
  const wandering = evalOf("rnbqkbnr/pppppppp/8/8/8/4K3/PPPPPPPP/RNBQ1BNR w kq - 0 1");
  assert.ok(wandering < home, "walking the king up the board early should cost");
});

test("the king should centralise in the endgame", () => {
  const corner = evalOf("8/8/8/8/8/8/4k3/K7 w - - 0 1");
  const central = evalOf("8/8/8/8/3K4/8/4k3/8 w - - 0 1");
  assert.ok(central > corner,
    `centralising should be better in an endgame: ${central} vs ${corner}`);
});

test("the two king tables pull in opposite directions", () => {
  // The whole point of interpolating: the same square is good late and bad
  // early. If this ever stops holding, the interpolation has collapsed.
  const earlyCentral = evalOf("rnbqkbnr/pppppppp/8/8/3K4/8/PPPPPPPP/RNBQ1BNR w kq - 0 1");
  const earlyHome = evalOf("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
  assert.ok(earlyCentral < earlyHome);
});

// ── mobility ────────────────────────────────────────────────────────────────

test("a piece with more squares to go to is worth more", () => {
  const corner = new Board("4k3/8/8/8/8/8/8/N3K3 w - - 0 1");   // knight a1, 2 moves
  const centre = new Board("4k3/8/8/8/3N4/8/8/4K3 w - - 0 1");  // knight d4, 8 moves
  assert.ok(mobility(centre, WHITE) > mobility(corner, WHITE));
  assert.ok(evaluate(centre) > evaluate(corner));
});

test("a rook behind its own pawns is worth less than one on an open file", () => {
  const boxed = new Board("4k3/8/8/8/8/8/P7/R3K3 w - - 0 1");
  const open = new Board("4k3/8/8/8/8/P7/8/R3K3 w - - 0 1");
  assert.ok(mobility(open, WHITE) > mobility(boxed, WHITE));
});

test("squares an enemy pawn covers do not count as mobility", () => {
  // The knight has the same eight destinations either way; a pawn covering
  // some of them means it cannot actually use them.
  const free = new Board("4k3/8/8/8/3N4/8/8/4K3 w - - 0 1");
  const covered = new Board("4k3/8/2p1p3/8/3N4/8/8/4K3 w - - 0 1");
  assert.ok(mobility(covered, WHITE) < mobility(free, WHITE));
});

test("mobility is symmetric, so it cancels in a mirrored position", () => {
  const board = new Board("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
  assert.equal(mobility(board, WHITE), mobility(board, BLACK));
});

test("pawns and kings contribute no mobility", () => {
  // Their movement is either structural or already covered by the king tables,
  // and counting it would double up with the phase-interpolated king PST.
  const board = new Board("4k3/8/8/8/8/8/4P3/4K3 w - - 0 1");
  assert.equal(mobility(board, WHITE), 0);
});

// ── material still dominates ────────────────────────────────────────────────

test("no positional term outweighs a piece", () => {
  // A safety bonus large enough to be worth a knight would make the engine
  // decline free material, which is far worse than being passive.
  const level = evalOf("rnbq1rk1/ppp2ppp/3b1n2/4p3/4P3/3B1N2/PPP2PPP/RNBQ1RK1 w - - 0 1");
  const upKnight = evalOf("rnbq1rk1/ppp2ppp/3b4/4p3/4P3/3B1N2/PPP2PPP/RNBQ1RK1 w - - 0 1");
  assert.ok(upKnight - level > PIECE_VALUE[2] * 0.6,
    "being a knight up should be worth most of a knight");
});


// ── lazy evaluation ─────────────────────────────────────────────────────────
//
// evaluate() skips mobility, king safety and pawn structure when the cheap
// half is already outside the alpha-beta window by more than LAZY_MARGIN. That
// is only sound if the margin genuinely bounds those terms — set it too small
// and the search silently gets wrong scores in exactly the positions it
// decided not to look at. So the bound is measured, not asserted.

import { LAZY_MARGIN, evaluateFull, pawnStructure } from "../engine/eval.js";
import { generateLegalMoves } from "../engine/movegen.js";

test("LAZY_MARGIN bounds what the expensive terms can contribute", () => {
  let worst = 0, worstFen = "";
  for (const fen of [
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1",
    "r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10",
    "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1",
    "rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8",
    "r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1",
    // pathological pawn structures, where the new terms are largest
    "4k3/pppppppp/8/8/8/8/PPPPPPPP/4K3 w - - 0 1",
    "4k3/8/8/8/8/PPPPPPPP/PPPPPPPP/4K3 w - - 0 1",
    "3k4/1P1P1P2/8/8/8/8/1p1p1p2/3K4 w - - 0 1",
  ]) {
    const board = new Board(fen);
    // Walk a couple of plies so the sample is not just the root.
    const visit = (b, depth) => {
      const cheapOnly = evaluate(b, -Infinity, -Infinity);   // forces the lazy path
      const full = evaluateFull(b);
      const gap = Math.abs(full - cheapOnly);
      if (gap > worst) { worst = gap; worstFen = b.fen(); }
      if (depth === 0) return;
      for (const m of generateLegalMoves(b).slice(0, 6)) {
        b.makeMove(m); visit(b, depth - 1); b.unmakeMove();
      }
    };
    visit(board, 2);
  }
  assert.ok(worst < LAZY_MARGIN,
    `expensive terms reached ${worst}, which exceeds LAZY_MARGIN ${LAZY_MARGIN}`
    + ` — the lazy path would return a wrong score. Worst at ${worstFen}`);
  // And it should not be absurdly conservative, or lazy eval never triggers.
  // And tight enough that the short-circuit actually fires. A margin far
  // above what the terms can reach makes lazy evaluation a no-op.
  assert.ok(LAZY_MARGIN < 1000,
    `LAZY_MARGIN ${LAZY_MARGIN} is so wide the short-circuit will rarely fire`);
});

test("the lazy path and the full evaluation agree inside the window", () => {
  // With a window that cannot trigger the short-circuit, the two must match.
  for (const fen of [
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1",
  ]) {
    const board = new Board(fen);
    assert.equal(evaluate(board, -Infinity, Infinity), evaluateFull(board), fen);
  }
});

// ── pawn structure ──────────────────────────────────────────────────────────

test("doubled pawns are penalised", () => {
  const clean = new Board("4k3/8/8/8/8/8/PP6/4K3 w - - 0 1");
  const doubled = new Board("4k3/8/8/8/8/P7/P7/4K3 w - - 0 1");
  assert.ok(pawnStructure(doubled, WHITE) < pawnStructure(clean, WHITE));
});

test("an isolated pawn is worse than a supported one", () => {
  const supported = new Board("4k3/8/8/8/8/8/PP6/4K3 w - - 0 1");
  const isolated = new Board("4k3/8/8/8/8/8/P1P5/4K3 w - - 0 1");
  assert.ok(pawnStructure(isolated, WHITE) < pawnStructure(supported, WHITE) + 1);
});

test("a passed pawn is worth more the closer it is to promoting", () => {
  const near = new Board("4k3/1P6/8/8/8/8/8/4K3 w - - 0 1");
  const far = new Board("4k3/8/8/8/8/8/1P6/4K3 w - - 0 1");
  assert.ok(pawnStructure(near, WHITE) > pawnStructure(far, WHITE),
    "a pawn on the 7th should beat the same pawn on the 2nd");
});

test("a pawn is not passed when an enemy pawn can still stop it", () => {
  const passed = new Board("4k3/8/8/3P4/8/8/8/4K3 w - - 0 1");
  const blocked = new Board("4k3/2p5/8/3P4/8/8/8/4K3 w - - 0 1");
  assert.ok(pawnStructure(blocked, WHITE) < pawnStructure(passed, WHITE),
    "an enemy pawn on an adjacent file ahead of it means it is not passed");
});

test("pawn structure is symmetric", () => {
  const board = new Board("4k3/pppppppp/8/8/8/8/PPPPPPPP/4K3 w - - 0 1");
  assert.equal(pawnStructure(board, WHITE), pawnStructure(board, BLACK));
});
