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

// Repeating a position is scored slightly worse than not, so a winning side
// does not shuffle. Carried over from the Corner Case engine this follows.
const REP_PENALTY = 200;
const MAX_KILLERS = 5;

// Late move reductions. Move ordering already causes a cutoff on the first
// move 77-95% of the time, which means moves late in the list are very
// unlikely to be best — so search them shallower and only pay full depth if
// one surprises us. The payoff scales with ordering quality, which is why this
// is the highest-value search addition here rather than a marginal one.
// Measured, not chosen: at LMR_MIN_DEPTH 3 a depth-4 search reduced the key
// move of a mate in two to a 2-ply search, which cannot see a mate needing 3,
// and the engine played something else. Shallow searches are left exact.
const LMR_MIN_DEPTH = 5;
const LMR_MIN_MOVES = 3;    // the first few moves are searched in full
const EMPTY_KILLERS = new Set();

export class Search {
  // 2**18 entries. Measured: at 2**16 a depth-7 search fills and wipes the
  // table one to two times, which costs ~20% in both nodes and wall clock.
  // Nothing further is gained past 2**18 on these positions.
  constructor({ maxDepth = 4, timeLimitMs = Infinity, ttSize = 1 << 18,
                lmr = true } = {}) {
    this.lmr = lmr;
    this.maxDepth = maxDepth;
    this.timeLimitMs = timeLimitMs;
    this.ttSize = ttSize;
    this.reset();
  }

  reset() {
    this.tt = new Map();
    // killers[depth] = quiet moves that caused a cutoff at this remaining
    // depth. Keyed by depth rather than ply, and capped, as in Corner Case.
    this.killers = Array.from({ length: MAX_PLY }, () => new Set());
    // history[pieceType][to] — quiet moves that have caused cutoffs before,
    // keyed by what moved and where it went rather than by origin square.
    this.history = Array.from({ length: 8 }, () => new Int32Array(128));
    // Positions on the current search path, for repetition detection.
    this.reps = new Map();
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
    this.reductions = 0;     // moves searched at reduced depth
    this.reSearches = 0;     // ...that then had to be searched in full
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
        reductions: this.reductions,
        reSearches: this.reSearches,
      },
      pv: best === null ? [] : this.principalVariation(board, reached || 1),
      elapsedMs: Date.now() - started,
    };
  }

  negamax(board, depth, alpha, beta, ply) {
    if ((this.nodes & 1023) === 0 && Date.now() > this.deadline) this.stopped = true;
    if (this.stopped && ply > 0) return alpha;

    this.nodes++;

    const alphaOrig = alpha, betaOrig = beta;
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

    // A position seen twice already on this line is a draw by repetition in
    // all but name. Scoring it slightly negative stops the side that is ahead
    // from shuffling pieces and calling it progress.
    if ((this.reps.get(hash) ?? 0) >= 2) return -REP_PENALTY;
    this.reps.set(hash, (this.reps.get(hash) ?? 0) + 1);

    const moves = this.orderMoves(board, generateMoves(board), entry?.move ?? 0, depth);

    let best = -INFINITY, bestMove = 0, legalCount = 0;
    // Reducing while in check would prune the escape squares.
    const inCheck = board.inCheck();

    for (const move of moves) {
      const quiet = !moveCaptured(move) && !(moveFlags(move) & FLAG_PROMO);
      board.makeMove(move);
      if (board.isAttacked(board.kingSquare[board.side ^ 1], board.side)) {
        board.unmakeMove();
        continue;
      }
      legalCount++;

      let score;
      const reduce = this.lmr
        && quiet
        && !inCheck
        && depth >= LMR_MIN_DEPTH
        && legalCount > LMR_MIN_MOVES
        // Killers are quiet moves already known to refute something at this
        // depth. Reducing them throws away the one piece of evidence the
        // search has that a quiet move matters.
        && !this.killers[depth].has(move)
        && !board.inCheck();          // and the move does not give check

      if (reduce) {
        // Deeper searches and later moves get reduced harder.
        const r = Math.min(depth - 2,
                           1 + Math.floor(Math.log(depth) * Math.log(legalCount) / 2));
        this.reductions++;
        // A null window: we only care whether it can beat alpha at all.
        score = -this.negamax(board, depth - 1 - r, -alpha - 1, -alpha, ply + 1);
        if (score > alpha) {
          // It surprised us, so pay for the real search.
          this.reSearches++;
          score = -this.negamax(board, depth - 1, -beta, -alpha, ply + 1);
        }
      } else {
        score = -this.negamax(board, depth - 1, -beta, -alpha, ply + 1);
      }
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
          const slot = this.killers[depth];
          if (slot.size > MAX_KILLERS) slot.clear();
          slot.add(move);
          this.history[pieceType(board.squares[moveFrom(move)])][moveTo(move)]
            += depth * depth;
        }
        break;
      }
    }

    const onPath = (this.reps.get(hash) ?? 0) - 1;
    if (onPath > 0) this.reps.set(hash, onPath); else this.reps.delete(hash);

    // No legal move: checkmate or stalemate, and the difference is whether the
    // king is currently attacked. Mate scores fold in `ply` so that a mate in
    // two is preferred to the same mate in four.
    if (legalCount === 0) {
      return board.inCheck() ? -MATE + ply : 0;
    }

    // Bounds are judged against the window as it arrived, not as the table
    // narrowed it — otherwise an entry gets labelled by a bound it never
    // actually failed against. Only store positions no longer on the path.
    if ((this.reps.get(hash) ?? 0) < 1) {
      this.store(hash, depth, best, bestMove, alphaOrig, betaOrig);
    }
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

    const inCheck = board.inCheck();
    // The window lets evaluate() skip its expensive half when this position
    // is already far outside it — which is most quiescence leaves.
    let best = evaluate(board, alpha, beta);

    // Standing pat means "I could just decline to capture" — but in check that
    // is not an option, so the score has to come from actually searching the
    // escapes. Skipping this guard lets the search believe it can sit still
    // while its king is attacked.
    if (!inCheck) {
      if (best >= beta) return best;
      if (best > alpha) alpha = best;
    } else {
      best = -INFINITY;
    }
    if (ply >= MAX_PLY - 1) return inCheck ? evaluate(board, alpha, beta) : best;

    // In check, every legal move is a candidate; otherwise only captures.
    const moves = this.orderMoves(
      board, generateMoves(board, !inCheck), 0, 0);

    let legal = 0;
    for (const move of moves) {
      board.makeMove(move);
      if (board.isAttacked(board.kingSquare[board.side ^ 1], board.side)) {
        board.unmakeMove();
        continue;
      }
      legal++;
      const score = -this.quiesce(board, -beta, -alpha, ply + 1);
      board.unmakeMove();

      // Fail-soft: return the value actually found rather than clamping to the
      // window, so the caller and the table learn something sharper.
      if (score > best) best = score;
      if (score >= beta) return best;
      if (score > alpha) alpha = score;
    }

    // In check with nothing legal is mate, and it has to be scored as mate
    // rather than as whatever the material happened to be.
    if (inCheck && legal === 0) return -MATE + ply;
    return best;
  }

  orderMoves(board, moves, ttMove, depth) {
    const killers = this.killers[depth] ?? EMPTY_KILLERS;
    const scored = moves.map((move) => {
      let score = 0;
      if (move === ttMove) score = 10_000_000;
      else {
        const victim = moveCaptured(move);
        if (victim) {
          const attacker = board.squares[moveFrom(move)];
          score = 1_000_000 +
            PIECE_VALUE[pieceType(victim)] * 16 - PIECE_VALUE[pieceType(attacker)];
        } else if (killers.has(move)) score = 900_000;
        else {
          score = this.history[pieceType(board.squares[moveFrom(move)])][moveTo(move)];
        }
        if (moveFlags(move) & FLAG_PROMO) score += PIECE_VALUE[movePromo(move)] * 16;
      }
      return { move, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.map((s) => s.move);
  }

  store(hash, depth, score, move, alphaOrig, betaOrig) {
    // Crude replacement: clear when full. A real engine buckets by index and
    // replaces the shallower entry; this keeps the table honest without one.
    if (this.tt.size >= this.ttSize) this.tt.clear();

    const bound = score <= alphaOrig ? UPPER : score >= betaOrig ? LOWER : EXACT;
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
