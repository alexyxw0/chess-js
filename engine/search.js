// Negamax with alpha-beta, iterative deepening, a transposition table,
// quiescence search, and move ordering.
//
// The pruning is only as good as the move ordering: alpha-beta cuts off after
// the first move that refutes a line, so searching a likely-best move first is
// what turns an exponential tree into a tractable one. Everything in
// `orderMoves` exists for that reason and nothing else.

import { Board, KING, QUEEN, PAWN, pieceType, moveFrom, moveTo, moveCaptured,
         movePromo, moveFlags, FLAG_PROMO } from "./board.js";
import { generateMoves, generateLegalMoves, moveToUci } from "./movegen.js";
import { evaluate, PIECE_VALUE } from "./eval.js";

export const MATE = 100000;
const MATE_THRESHOLD = MATE - 1000;
const INFINITY = 1000000;

// Transposition table entry bounds.
const EXACT = 0, LOWER = 1, UPPER = 2;

const MAX_PLY = 64;

export class Search {
  // 2**18 entries. Measured: at 2**16 a depth-7 search fills and wipes the
  // table one to two times, which costs ~20% in both nodes and wall clock.
  // Nothing further is gained past 2**18 on these positions.
  constructor({ maxDepth = 4, timeLimitMs = Infinity, ttSize = 1 << 18 } = {}) {
    this.maxDepth = maxDepth;
    this.timeLimitMs = timeLimitMs;
    this.ttSize = ttSize;
    this.reset();
  }

  reset() {
    this.tt = new Map();
    // killers[ply] = two quiet moves that caused a cutoff at this ply
    this.killers = Array.from({ length: MAX_PLY }, () => [0, 0]);
    // history[from][to] — quiet moves that have historically caused cutoffs
    this.history = Array.from({ length: 128 }, () => new Int32Array(128));
    this.resetStats();
  }

  /** Counters the benchmark reads. Zeroed at the start of every search. */
  resetStats() {
    this.nodes = 0;          // interior nodes visited by negamax
    this.qnodes = 0;         // nodes visited by the quiescence search
    this.ttProbes = 0;
    this.ttHits = 0;         // probe found an entry for this position
    this.ttCutoffs = 0;      // ...and it was deep enough to return immediately
    this.cutoffs = 0;        // beta cutoffs
    this.firstMoveCutoffs = 0; // ...where the very first move searched caused it
  }

  /**
   * Best move for the side to move.
   * @returns {{move: number|null, score: number, depth: number, nodes: number,
   *            pv: string[], elapsedMs: number}}
   */
  findBestMove(board) {
    const started = Date.now();
    this.resetStats();
    this.stopped = false;
    this.deadline = started + this.timeLimitMs;

    let best = null, bestScore = 0, reached = 0;

    // Iterative deepening: each depth is cheap relative to the next, and the
    // move it returns orders the next one, which more than pays for the repeat.
    for (let depth = 1; depth <= this.maxDepth; depth++) {
      const score = this.negamax(board, depth, -INFINITY, INFINITY, 0);
      if (this.stopped && best !== null) break;

      const entry = this.tt.get(board.hashKey());
      if (entry?.move) { best = entry.move; bestScore = score; reached = depth; }

      // A forced mate is not going to be improved on by searching deeper.
      if (Math.abs(score) > MATE_THRESHOLD) break;
    }

    if (best === null) {
      const legal = generateLegalMoves(board);
      best = legal.length ? legal[0] : null;
    }

    return {
      move: best,
      score: bestScore,
      depth: reached,
      nodes: this.nodes + this.qnodes,
      stats: {
        interior: this.nodes,
        quiescence: this.qnodes,
        ttProbes: this.ttProbes,
        ttHits: this.ttHits,
        ttCutoffs: this.ttCutoffs,
        cutoffs: this.cutoffs,
        firstMoveCutoffs: this.firstMoveCutoffs,
      },
      pv: best === null ? [] : this.principalVariation(board, reached || 1),
      elapsedMs: Date.now() - started,
    };
  }

  negamax(board, depth, alpha, beta, ply) {
    if ((this.nodes & 1023) === 0 && Date.now() > this.deadline) this.stopped = true;
    if (this.stopped && ply > 0) return alpha;

    this.nodes++;

    const alphaOrig = alpha;
    const hash = board.hashKey();
    const entry = this.tt.get(hash);
    this.ttProbes++;
    if (entry) this.ttHits++;

    if (entry && entry.depth >= depth && ply > 0) {
      if (entry.bound === EXACT) { this.ttCutoffs++; return entry.score; }
      if (entry.bound === LOWER) alpha = Math.max(alpha, entry.score);
      else if (entry.bound === UPPER) beta = Math.min(beta, entry.score);
      if (alpha >= beta) { this.ttCutoffs++; return entry.score; }
    }

    if (depth === 0) return this.quiesce(board, alpha, beta, ply);

    const moves = this.orderMoves(board, generateMoves(board), entry?.move ?? 0, ply);

    let best = -INFINITY, bestMove = 0, legalCount = 0;

    for (const move of moves) {
      board.makeMove(move);
      if (board.isAttacked(board.kingSquare[board.side ^ 1], board.side)) {
        board.unmakeMove();
        continue;
      }
      legalCount++;
      const score = -this.negamax(board, depth - 1, -beta, -alpha, ply + 1);
      board.unmakeMove();

      if (score > best) { best = score; bestMove = move; }
      if (score > alpha) alpha = score;
      if (alpha >= beta) {
        this.cutoffs++;
        // Ordering quality: a cutoff on the first move searched means the
        // ordering guessed right. This ratio is the number to watch — it is
        // what decides how much of the tree alpha-beta actually prunes.
        if (legalCount === 1) this.firstMoveCutoffs++;
        // A quiet move that causes a cutoff is worth trying early next time.
        if (!moveCaptured(move) && !(moveFlags(move) & FLAG_PROMO)) {
          const slot = this.killers[ply];
          if (slot[0] !== move) { slot[1] = slot[0]; slot[0] = move; }
          this.history[moveFrom(move)][moveTo(move)] += depth * depth;
        }
        break;
      }
    }

    // No legal move: checkmate or stalemate, and the difference is whether the
    // king is currently attacked. Mate scores fold in `ply` so that a mate in
    // two is preferred to the same mate in four.
    if (legalCount === 0) {
      return board.inCheck() ? -MATE + ply : 0;
    }

    this.store(hash, depth, best, bestMove, alphaOrig, beta);
    return best;
  }

  /**
   * Search captures only, until the position is quiet.
   *
   * Without this the search stops mid-exchange and reports the material count
   * at an arbitrary moment — "I take your queen" scores brilliantly if the
   * search ends before the recapture. This is the horizon effect, and
   * quiescence is the standard answer to it.
   */
  quiesce(board, alpha, beta, ply) {
    this.qnodes++;

    // Standing pat: not being forced to capture is itself an option.
    const standPat = evaluate(board);
    if (standPat >= beta) return beta;
    if (standPat > alpha) alpha = standPat;
    if (ply >= MAX_PLY - 1) return alpha;

    const captures = this.orderMoves(board, generateMoves(board, true), 0, ply);

    for (const move of captures) {
      board.makeMove(move);
      if (board.isAttacked(board.kingSquare[board.side ^ 1], board.side)) {
        board.unmakeMove();
        continue;
      }
      const score = -this.quiesce(board, -beta, -alpha, ply + 1);
      board.unmakeMove();

      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }
    return alpha;
  }

  /**
   * Order moves best-guess-first. The ranking, highest priority downward:
   *   1. the transposition table's move for this position
   *   2. captures by MVV-LVA — grab the most valuable victim with the least
   *      valuable attacker, so QxP is tried after PxQ
   *   3. killer moves — quiet moves that caused a cutoff at this same ply
   *   4. the history heuristic — quiet moves that cut off anywhere, weighted
   *      by the depth at which they did
   */
  orderMoves(board, moves, ttMove, ply) {
    const [killer1, killer2] = this.killers[ply];
    const scored = moves.map((move) => {
      let score = 0;
      if (move === ttMove) score = 10_000_000;
      else {
        const victim = moveCaptured(move);
        if (victim) {
          const attacker = board.squares[moveFrom(move)];
          score = 1_000_000 +
            PIECE_VALUE[pieceType(victim)] * 16 - PIECE_VALUE[pieceType(attacker)];
        } else if (move === killer1) score = 900_000;
        else if (move === killer2) score = 800_000;
        else score = this.history[moveFrom(move)][moveTo(move)];
        if (moveFlags(move) & FLAG_PROMO) score += PIECE_VALUE[movePromo(move)] * 16;
      }
      return { move, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.map((s) => s.move);
  }

  store(hash, depth, score, move, alphaOrig, beta) {
    // Crude replacement: clear when full. A real engine buckets by index and
    // replaces the shallower entry; this keeps the table honest without one.
    if (this.tt.size >= this.ttSize) this.tt.clear();

    const bound = score <= alphaOrig ? UPPER : score >= beta ? LOWER : EXACT;
    const existing = this.tt.get(hash);
    if (!existing || existing.depth <= depth) {
      this.tt.set(hash, { depth, score, move, bound });
    }
  }

  /** Walk the transposition table to recover the line the search believes in. */
  principalVariation(board, maxLength) {
    const line = [];
    const played = [];
    for (let i = 0; i < maxLength; i++) {
      const entry = this.tt.get(board.hashKey());
      if (!entry?.move) break;
      const legal = generateLegalMoves(board);
      if (!legal.includes(entry.move)) break;
      line.push(moveToUci(entry.move));
      board.makeMove(entry.move);
      played.push(true);
    }
    while (played.pop()) board.unmakeMove();
    return line;
  }
}

/** Convenience wrapper: best move for a position, as UCI. */
export function bestMove(board, options) {
  const result = new Search(options).findBestMove(board);
  return result.move === null ? null : moveToUci(result.move);
}
