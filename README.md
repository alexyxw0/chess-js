# chess-js

Chess in the browser: full rules on a canvas, and an alpha-beta engine to play
against. No libraries, no build step, no dependencies — `npm test` runs on
Node's built-in test runner and nothing else.

**[▶ Play it](https://alexyxw0.github.io/chess-js/)** · or clone and run:

```bash
npm run serve      # prints the URL; walks past a busy port instead of failing
```

Opening `index.html` straight off disk will not work — the engine is loaded as
an ES module, and browsers refuse module imports over `file://`. It needs to be
served over http, which is all `npm run serve` does.

```
node --test test/*.test.js      # 99 tests, including 6 perft positions
```

## What's implemented

Everything the rules require, which is more than it sounds:

- **Legal move generation** — a move that would leave your own king in check is
  not offered, so pins and discovered checks fall out of the rules rather than
  being special-cased.
- **Castling**, with all four conditions: king and rook unmoved, no pieces
  between, king not currently in check, and not passing through an attacked
  square.
- **En passant**, including the one-move window in which it is legal.
- **Promotion**, and correctly *undone* on take-back — a promoted queen becomes
  a pawn again.
- **Check and checkmate** detection, with the mated king highlighted.
- **Move history** — step backwards and forwards through the whole game.
- Position setup from a FEN-style board string, so you can start from any
  arrangement (there's a commented-out endgame in `chess.js` to try).
- Sound effects distinguishing move, capture, castle and check.
- **An engine to play against** — pick a side and a depth in the side panel, or
  ask for a suggestion in a two-player game.

## The engine

`engine/` is a standalone alpha-beta searcher, independent of the UI and
testable in Node with no DOM.

| | |
|---|---|
| `board.js` | 0x88 board, FEN, reversible make/unmake, attack detection |
| `movegen.js` | pseudo-legal generation, legality filter, perft |
| `eval.js` | material + piece-square tables |
| `zobrist.js` | position hashing for the transposition table |
| `search.js` | negamax, alpha-beta, iterative deepening, quiescence, ordering |

**Representation.** A 0x88 board: square = `rank * 16 + file`, so a1 is 0 and h8
is 119. The layout buys one thing and it is worth the wasted half — a square is
off the board exactly when `sq & 0x88` is non-zero, so bounds checking inside
move generation is a single bitwise AND rather than decoding a rank and a file
and comparing both.

**Search.** Negamax with alpha-beta, wrapped in iterative deepening. Each depth
seeds the next one's move ordering, which more than repays searching the
shallow depths again, and it means the search can be stopped on a clock and
still return the best move it has.

**Ordering is where the pruning comes from.** Alpha-beta cuts off after the
first move that refutes a line, so searching a likely-best move first is what
turns an exponential tree into a tractable one. In priority order:

1. the transposition table's move for this exact position
2. captures by MVV-LVA — most valuable victim, least valuable attacker, so PxQ
   is tried before QxP
3. killer moves — quiet moves that caused a cutoff at this same ply
4. the history heuristic — quiet moves that cut off anywhere, weighted by the
   depth at which they did

**Quiescence.** At depth zero the search keeps going, but on captures only,
until the position is quiet. Without it the search stops mid-exchange and
reports material at an arbitrary moment: "I take your queen" scores brilliantly
if the search ends before the recapture. That is the horizon effect, and
quiescence is the standard answer.

### Faithful to the Corner Case engine

The search follows `ccengine.py`, the engine I wrote for a Corner Case variant
in 2026, ported to standard chess. Checking the port against the original
turned up one bug and four behaviours I had simplified away:

- **Bounds were judged against the wrong window.** The TT probe narrows
  `alpha`/`beta`, and the store was labelling entries against the *narrowed*
  values — so an entry could be recorded as a bound it never actually failed
  against. The original saves the window before the probe. Now so does this.
- **Repetition.** Positions on the current line are counted, a third occurrence
  scores `-200`, and positions still on the path are not stored in the table.
  Without it the side that is ahead will happily shuffle forever.
- **Quiescence stood pat in check.** Standing pat means "I could decline to
  capture" — not an option when your king is attacked. In check it now searches
  every legal move, not just captures, and scores mate properly.
- **Quiescence was fail-hard**, clamping returns to the window. The original is
  fail-soft, which hands the caller and the table a sharper number.
- **Killers and history keying.** Killers are a set of up to five per remaining
  depth, and history is keyed by `(piece type, destination)` incremented by
  `depth²` — as in the original, rather than by ply and origin square.

The correctness gains cost speed. In-check quiescence generating every legal
move roughly doubles quiescence nodes: kiwipete at depth 5 went from 198k nodes
to 324k. That is the right trade — the old version misevaluated any line ending
in check — but it is a real regression and the benchmark shows it.

**Transposition table.** Zobrist-hashed, storing depth, score, best move, and
whether the score is exact or a bound. JavaScript has no 64-bit integer, so the
hash is two 32-bit halves combined into a string key — slower than a real u64,
and the honest reason is that BigInt would be slower still.

### Speed and pruning, measured

`npm run bench` (or `--quick`). Node 26, Apple Silicon.

```
Move generation (perft)          6.1M nodes/sec
Search                           1.9–2.4M nodes/sec
Effective branching factor       2.2–6.6   (unpruned would be ~35)
First-move beta cutoffs          78–99%
Depth 7, four positions          2.9s total
```

The effective branching factor is the number to read. Alpha-beta's entire
advantage rests on searching a good move first: order perfectly and the tree
approaches the square root of the full one, order randomly and it is barely
better than plain minimax. An EBF in the 2–7 range against a raw ~35 says the
ordering is doing its job, and the first-move cutoff rate says the same thing
directly — the very first move tried causes the cutoff 78–99% of the time.

**What each optimisation is actually worth**, as nodes to reach depth 5:

| position | full search | no TT | no ordering |
|---|---|---|---|
| startpos | 25,040 | 32,419 | 123,597 (5×) |
| kiwipete | 198,811 | 326,096 | >111,293,578 (**>560×**) |
| endgame | 7,793 | 13,169 | 39,321 (5×) |
| midgame | 149,783 | 228,378 | >107,928,265 (**>721×**) |

Move ordering is not a micro-optimisation. On the two middlegame positions,
turning it off makes the *same depth-5 search* cost over 500× more nodes — and
those two figures are floors, because the unordered runs hit a 60-second clock
before they finished. The benchmark marks truncated runs rather than reporting
how far it got as if the search had completed.

### What profiling changed

The first working version ran at 1.2–1.4M nodes/sec. Benchmarking found two
things, and both were mine:

**The hash was recomputed from scratch at every node.** `hashBoard` looped all
64 squares per call — 0.57µs, about 84% of the cost of a full move generation,
and **22% of total search time**. It is now maintained incrementally: make
XORs out what left a square and XORs in what arrived, unmake restores the saved
value. The key also became a Number rather than a string, 21 bits of the high
half plus all 32 of the low half — exactly 53 bits, which is the largest
integer a double holds exactly.

**The transposition table was thrashing.** At the old 2¹⁶ default a depth-7
search filled the table and wiped it one to two times. 2¹⁸ stops that; nothing
further is gained beyond it.

Together, at depth 7:

| position | before | after | |
|---|---|---|---|
| startpos | 581,220 nodes / 484 ms | 581,220 / **306 ms** | 1.58× |
| kiwipete | 2,978,098 / 2,285 ms | 2,520,904 / **1,352 ms** | 1.69× |
| endgame | 55,261 / 36 ms | 55,261 / **23 ms** | 1.57× |
| midgame | 3,551,983 / 2,455 ms | 2,737,978 / **1,221 ms** | 2.01× |
| **total** | **5,260 ms** | **2,902 ms** | **1.81×** |

Where the node count is unchanged, the table was not wiping and the whole gain
is the cheaper hash. Where it fell, the larger table is also doing work.

**The cost, stated plainly: perft got 21% slower**, 7.75M to 6.10M nodes/sec.
`makeMove` now does XOR work that raw move-counting never uses, since perft
never probes the table. That is the right trade — the search is what matters
and it nearly doubled — but it is a real regression and worth knowing before
anyone quotes the perft figure.

### Proving the move generator correct

Move generation is the foundation everything else rests on, and it is easy to
get subtly wrong in a way that only shows up as bad play. So it is tested by
**perft**: count leaf nodes to a fixed depth and compare against the published
figures for six standard positions.

| position | tests | depths |
|---|---|---|
| starting position | the basics | 20 / 400 / 8,902 / 197,281 |
| kiwipete | castling, pins, a dense middlegame | 48 / 2,039 / 97,862 |
| position 3 | en passant and promotion races | 14 / 191 / 2,812 / 43,238 |
| position 4 | promotions under check | 6 / 264 / 9,467 |
| position 5 | an awkward castling/promotion tangle | 44 / 1,486 / 62,379 |
| position 6 | a quiet symmetrical middlegame | 46 / 2,079 / 89,890 |

A single mishandled en passant or castling right changes a total, and
`perftDivide` narrows a mismatch to the individual move. All six match.

Position 3 is the endgame that was already sitting commented out in `chess.js`
as a test setup — it turns out to be one of the standard perft positions.

## Two rule engines, one game

The UI and the engine keep separate board representations on purpose: the UI's
is built around tiles that know how to draw themselves, the engine's is a flat
array built for speed. Rather than force one to serve both, they talk through
`engine-adapter.js` — FEN in one direction, a UCI move string back.

That is a narrow, testable seam, and it means the engine has no idea a canvas
exists. It also means the two can disagree, so the tests check that they do
not: one asserts both generators produce the same legal moves from the starting
position, and another plays a twelve-ply game with the engine on both sides,
failing if the UI ever rejects a move the engine proposed.

**This is not hypothetical.** The first version of the adapter assumed
`board[0]` was rank 8. It is rank 1, and `tile.y` counts *down* from White's
back rank, so a tile's chess rank is `8 - y`. The bug produced a FEN that
parsed perfectly and described a mirrored position — the unit tests passed,
because the fake UI board they were built on encoded the same wrong assumption.
Only the integration test against the real `chess.js` caught it.

## The one interesting problem

Deciding whether a move is legal means answering "would this leave my king
attacked?", and answering that means actually making the move and looking.

The obvious way is to deep-copy the board, make the move on the copy, and
throw it away. That is what this did first, and it is slow: a full board copy
for every candidate move, of every piece, on every turn.

The version here **makes the move on the real board, tests, and unmakes it**:

```js
makeMove(isSimulation)    // mutate; skip drawing, sound and promotion when simulating
unmakeMove(isSimulation)  // restore the captured piece, the piece sets and the king square
```

`Move` stores what it needs to reverse itself — the captured piece, the two
tiles — and `Castle` and `EnPassant` extend it with their extra state, so every
move type undoes itself through the same interface. The `isSimulation` flag is
what keeps a hypothetical move silent: no redraw, no sound, no promotion
prompt.

Two things make this fast enough to run on every candidate move:

- **Piece sets.** The board keeps `whitePieces` / `blackPieces` as `Set`s of
  occupied tiles, so generating moves iterates the ~16 pieces in play rather
  than scanning 64 squares.
- **Tracked kings.** `whiteKing` / `blackKing` are updated as part of make and
  unmake, so a check test starts from the king's square instead of searching
  for it.

The subtle part is that make/unmake has to be *exactly* symmetric. Getting
promotion wrong here is a classic bug — the pawn promotes during a simulated
move and stays a queen after the unmake — and it is exactly the bug the commit
history records fixing.

## Layout

```
chess.js          everything: rules, rendering, input
index.html        a canvas and a script tag
chess_pieces/     12 SVG piece sprites
sounds/           move, capture, castle, check
```

Inside `chess.js`:

| | |
|---|---|
| `Tile` | one square: coordinates, occupant, its own draw |
| `Piece` → `Pawn` `Knight` `Bishop` `Rook` `Queen` `King` | per-piece pseudo-legal move generation |
| `Move` → `Castle` `EnPassant` | a reversible move; `makeMove` / `unmakeMove` |
| `Board` | game state, legality filtering, check detection, history, input |
| `Game` | holds a board |

## Tests

```bash
npm test          # 99 tests
npm run perft     # just the move-generation proofs
```

Node's built-in runner, so there is nothing to install.

| file | what it covers |
|---|---|
| `test/perft.test.js` | six standard positions against published node counts |
| `test/tactics.test.js` | mates and material tactics, against an answer key the test derives for itself |
| `test/board.test.js` | FEN round trips, castling rights, en passant, promotion, pins, and make/unmake symmetry for every legal move in six positions |
| `test/search.test.js` | mate in one and two with exact mate scores, preferring the faster mate, quiescence refusing a poisoned pawn, time limits, TT independence |
| `test/adapter.test.js` | the FEN bridge, against a fake UI board |
| `test/evalscale.test.js` | the eval bar's scale, sign conventions and mate labels |
| `test/integration.test.js` | the real `chess.js` under a headless stub: engine games, click-to-square mapping under scroll and CSS scaling, the drag/click gestures, and take-back/replay |

The make/unmake symmetry test is the one that matters most: if unmake is not an
exact inverse of make, every search result is built on corrupted state and the
symptom appears nowhere near the cause.

`tactics.test.js` is built on a principle worth stating: **a tactical suite is
only as trustworthy as its answer key, and a key transcribed from memory is a
liability.** So nothing there is asserted from recall. Mates are confirmed by an
independent full-width prover that uses only the rules — no alpha-beta, no
evaluation — so it cannot inherit a bug from the search it is checking. Material
tactics are confirmed by playing the move and counting what is left after both
sides continue. If the key and the engine ever disagree, the test reports which
one is wrong.

It also pins the strongest available claim about the heuristics: **move ordering
changes the cost, never the answer.** Ordering is a pure optimisation, so a
search with it and a search without it must choose the same move. If they ever
diverge, that is a bug, not a tuning question.

## Not implemented

- **No draw detection** — stalemate is scored as a draw inside the search, but
  the *game* only ends on checkmate. Threefold repetition, the fifty-move rule
  and insufficient material are all missing.
- **No underpromotion in the UI.** The engine generates all four promotion
  pieces and perft covers them, but `Board.promote` in `chess.js` always makes a
  queen, so the adapter drops the promotion suffix when handing a move back.
- Evaluation is material plus piece-square tables — no pawn structure, king
  safety, or mobility terms, and no endgame tables. A search this shallow gains
  far more from correct pruning than from a cleverer evaluation.
- No clock, no PGN import/export, no move list panel.

## Evaluation bar and strength controls

A bar beside the board shows the engine's evaluation, always from White's point
of view, refreshed after every move and capped shallower than the engine's own
setting so watching does not cost as much as playing.

The scale is logistic — the usual pawns-to-win-probability curve — rather than
linear. Most of a game sits inside ±200 centipawns, and on a linear bar a queen
up pegs it and stops moving. `evalscale.js` is pure and separately tested,
because a sign convention flipped between "side to move" and "White" produces a
bar that looks entirely plausible and is exactly backwards.

Depth and time cap are free-entry numbers rather than presets. Iterative
deepening stops at whichever comes first, so a high depth with a short cap
means "go as deep as you can in that time".

## Rendering and input

The board is repainted in **one pass per frame** — squares, then pieces, then
move indicators, then a dragged piece last so it floats above everything. Any
state change asks for a frame rather than painting immediately, so a move that
touches four squares still costs one redraw.

That replaced the original's per-tile drawing, which was the source of the lag:

```js
this.img.onload = function(){ ctx.drawImage(this.img, ...) }.bind(this);
this.img.src = this.piece.getStr();
```

Every repaint of every square set `img.src` and drew from an `onload` handler,
making each square an asynchronous image load. The piece arrived a frame or
more after the square under it, and a single move did that four or five times.
The twelve sprites are now decoded once at startup and blitted synchronously.

**Pieces can be dragged or clicked.** A click and the start of a drag are the
same press, and only the release tells them apart: release without moving and
the piece stays selected for a click-to-move, release over a legal square and
it lands there. Pointer release is bound to the window, so a piece dragged off
the canvas and let go does not stay stuck to the cursor. Seven tests cover the
gestures, including one on a board that is both scrolled and scaled.

**The search runs in a Web Worker.** It is a synchronous tree walk that can run
for seconds, and on the main thread the page could not repaint until it
finished — your own move would not appear until the engine had replied. The
engine has no DOM dependencies, so moving it off-thread was a message rather
than a rewrite. The board now paints your move immediately and stays draggable
while the engine thinks.

## Earlier UI fixes

**Take-back turned pieces into other pieces.** The worst bug in the project,
and one line:

```js
if (t1.piece.isPromoted == 0)     // false == 0 is true
    this.master.demote(t1);
```

`isPromoted` is `false` for a piece that started as itself and a number for one
that was promoted, counting moves since. Told apart with `==` rather than
`===`, **every** take-back demoted the moved piece to a pawn — and the demoted
pawn, now sitting on a back rank, was promoted to a queen by the next move's
promotion check. Bishops became pawns; pawns became queens. It corrupted the
engine too, since the adapter builds its FEN by reading the board's pieces.

Fixed with strict equality, and the same loose comparison in `move`/`unmove`
tightened alongside it. `checkPromotion` also stopped returning after the first
pawn it found, which would have left a second one unpromoted. Nine tests cover
rewinding now: piece identity, captures, castling, promotion round-trips, a
full-game rewind back to the starting FEN, and that the engine still agrees
with the board afterwards.

Three more the original had, all found by actually playing it:

**Clicks were offset.** `selectTile` read `e.clientY / 100` directly, which
assumes the canvas is at the top-left of an unscrolled page and displayed at
its backing-store size. All three assumptions are false in the real page:
padding and a border move it, scrolling moves it again, and `max-width: 100%`
means a displayed pixel is not a canvas pixel. `tileAt` now goes through
`getBoundingClientRect()`, which handles all three and stays right after a
resize. Five tests cover it, including one that round-trips every square on a
board that is both scrolled and scaled.

**Clicking beside the board threw.** The canvas used to be 1200 wide for an
800-wide board, and out in that strip `board[i][j]` is undefined and reading
`.piece` is a TypeError. `tileAt` returns `[-1, -1]` and the handler returns
early. The canvas is now exactly the board — the strip only existed to draw a
"Checkmate!" caption, which the panel's turn indicator reports instead — so the
settings sit directly beside the board rather than 400px past it. The guard
still earns its place: `pointerup` listens on the window, so a release can
arrive from anywhere on the page.

**Arrow keys needed the canvas focused.** They were bound to the canvas, which
only receives keys once it has focus, and the only way to focus it is to click
it — which also selects a square. They listen on the document now, with a guard
so arrows keep their normal meaning inside a form control.

## Origin

The game was written in 2023 as a from-scratch exercise: no chess library, no
rendering framework, no move generator off the shelf. The engine, the test
suite and the adapter were added in 2026. The original game logic in `chess.js`
is unchanged — the engine is wired in by wrapping `movePiece`, not by editing
it, so the 2023 code stays independently reviewable.

MIT licensed.
