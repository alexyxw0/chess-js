# chess-js

Chess in the browser: full rules on a canvas, and an alpha-beta engine to play
against. No libraries, no build step — `npm test` runs on Node's built-in test
runner and nothing else.

**[▶ Play it](https://alexyxw0.github.io/chess-js/)** · or clone and run:

```bash
npm run serve      # prints the URL; walks past a busy port
npm test           # 122 tests
npm run bench      # perft, search speed, ablations
```

Opening `index.html` off disk will not work — the engine loads as an ES module,
and browsers refuse module imports over `file://`.

## The game

Complete rules, written from scratch:

- **Legal move generation** — a move that would leave your own king in check is
  never offered, so pins and discovered checks fall out of the rules.
- **Castling** with all four conditions, **en passant**, **promotion** (undone
  correctly on take-back), **check and checkmate** detection.
- **Move history** — step backwards and forwards through the game.
- Position setup from a FEN-style board string.
- Drag a piece or click it and click a destination; both gestures work.
- An evaluation bar, and free-entry depth and time-cap controls.

Legality is tested by making the move on the real board and unmaking it, rather
than by copying the board. `Move` stores what it needs to reverse itself, and
`Castle` and `EnPassant` extend it, so every move type undoes through one
interface. The board keeps piece sets and tracked king squares, so move
generation iterates the pieces in play and a check test starts from the king.

## The engine

`engine/` is a standalone searcher, independent of the UI and testable in Node
with no DOM.

| | |
|---|---|
| `board.js` | 0x88 board, FEN, reversible make/unmake, attack detection |
| `movegen.js` | pseudo-legal generation, legality filter, perft |
| `eval.js` | material, piece-square tables, mobility, king safety, pawn structure |
| `zobrist.js` | incrementally-updated position hashing |
| `search.js` | negamax, alpha-beta, iterative deepening, quiescence, ordering |

**Board.** 0x88: square = `rank * 16 + file`, so a square is off the board
exactly when `sq & 0x88` is non-zero — bounds checking is one bitwise AND.

**Search.** Negamax with alpha-beta, iterative deepening, late move reductions,
and a Zobrist-hashed transposition table. Move ordering, in priority order: the
table's move for this position, captures by MVV-LVA, killer moves, then the
history heuristic. At depth zero the search continues on captures only until the
position is quiet, so it cannot stop mid-exchange and report material at an
arbitrary moment.

**Evaluation.** Material and piece-square tables, plus mobility (weighted
inversely to each piece's maximum reach, and scored relative to ordinary rather
than raw, so it does not double-count material), king safety (piece proximity,
pawn shield, open files) and pawn structure (doubled, isolated, and rank-scaled
passed pawns). All of it is scaled by a game phase running from 1.0 at the
opening to 0.0 once only kings and pawns remain — which also interpolates the
king's own table between hiding early and centralising late.

The expensive half is skipped when the cheap half is already outside the
alpha-beta window. That is sound because those terms are clamped, so the margin
bounds them by construction rather than by assumption.

## Performance

`npm run bench`. Node 26, Apple Silicon.

**Move generation** is verified by perft against published node counts for the
six standard test positions — a single mishandled en passant or castling right
changes a total. All six match, at **6.1M nodes/sec**.

**Search depth reached**, by time budget:

| position | 200 ms | 1 s |
|---|---|---|
| opening | 7 | 9 |
| kiwipete | 4 | 6 |
| middlegame | 5 | 7 |
| endgame | 10 | 13 |

**Against Stockfish 18**, 60 games with colours swapped, this engine at 200 ms a
move against Stockfish restricted to a fixed search depth:

| Stockfish depth | score |
|---|---|
| 4 plies | 58% |
| 5 plies | 46% |
| 6 plies | 29% |
| 8 plies | 13% |

Parity sits at 4–5 plies. Stockfish reaches those depths in ~11 ms, so the
comparison is depth-for-depth and not speed-for-speed. At 12 games a rung the
95% interval is ±28 score points; `bench/vs-stockfish.js --games 40` narrows it.

**Pruning quality.** Effective branching factor 3–6 against roughly 35
unpruned, with the first move tried causing 77–95% of cutoffs. `npm run bench`
also reports an ablation with move ordering disabled, and with the transposition
table disabled.

## Tests

```bash
npm test          # 122 tests
npm run perft     # just the move-generation proofs
```

| file | covers |
|---|---|
| `test/perft.test.js` | six standard positions against published node counts |
| `test/board.test.js` | FEN round trips, castling rights, en passant, promotion, pins, and make/unmake symmetry for every legal move |
| `test/search.test.js` | mates with exact mate scores, preferring the faster mate, quiescence declining a poisoned pawn, time limits |
| `test/eval.test.js` | each evaluation term's direction, phase scaling, the lazy-evaluation bound |
| `test/tactics.test.js` | mates and material tactics against an answer key the test derives for itself |
| `test/zobrist.test.js` | the incremental hash against a full recomputation at every node of a perft walk |
| `test/adapter.test.js` | the FEN bridge between UI and engine |
| `test/integration.test.js` | the real `chess.js` under a headless stub: engine games, click-to-square mapping under scroll and scaling, drag gestures, take-back |

Two are load-bearing. **Make/unmake symmetry**: if unmake is not an exact
inverse of make, every search result is built on corrupted state and the symptom
appears nowhere near the cause. **The incremental hash against a full
recomputation**: a drifting key silently returns another position's score from
the table, and the engine plays a move it never evaluated.

`test/tactics.test.js` derives its own answer key rather than asserting one:
mates are confirmed by an independent full-width prover that uses only the
rules, and material tactics by playing the move and counting what survives.

## Architecture note

The UI and the engine keep separate board representations — the UI's is built
around tiles that draw themselves, the engine's is a flat array built for speed.
They talk through `engine-adapter.js`: FEN one way, a UCI move string back. The
engine therefore has no idea a canvas exists, and runs in a Web Worker so the
board stays interactive while it thinks.

Two rule implementations can disagree, so the tests check that they do not: one
asserts both generators produce the same legal moves, and another plays a
twelve-ply game with the engine on both sides, failing if the UI ever rejects a
move the engine proposed.

## Not implemented

- **No draw detection at the game level.** Stalemate and repetition are scored
  inside the search, but the game only ends on checkmate. Threefold repetition,
  the fifty-move rule and insufficient material are missing.
- **No underpromotion in the UI.** The engine generates all four promotion
  pieces and perft covers them, but the UI always promotes to a queen.
- No opening book, no endgame tables.
- Evaluation has no bishop-pair or rook-on-open-file terms, and king safety is
  distance-based rather than a true attacker count on the king zone.

MIT licensed.
