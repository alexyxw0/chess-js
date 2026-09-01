// Zobrist hashing: one random key per (piece, square), XORed together.
//
// JavaScript has no 64-bit integer, so the hash is kept as two 32-bit halves.
// They are combined into a single Number for use as a Map key — 21 bits from
// the high half and all 32 from the low half, which is exactly 53 bits and so
// exactly what a double can hold as an integer. A Number key is markedly
// cheaper to hash than the string this used to build on every node.
//
// The hash is maintained *incrementally*: makeMove XORs out what left a square
// and XORs in what arrived, and unmakeMove restores the saved value. The
// from-scratch `hashBoard` is kept for initialisation and, more usefully, as
// the oracle the tests check the incremental path against.

const SEED = 0x9e3779b9;

// xorshift32 — deterministic, so the same build always produces the same keys.
function* rng(seed = SEED) {
  let x = seed >>> 0;
  for (;;) {
    x ^= x << 13; x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5; x >>>= 0;
    yield x >>> 0;
  }
}

const next = rng();
const pair = () => [next.next().value, next.next().value];

// [piece code 0-15][square 0-127]
export const PIECE_KEYS = Array.from({ length: 16 }, () =>
  Array.from({ length: 128 }, pair));
export const SIDE_KEY = pair();
export const CASTLE_KEYS = Array.from({ length: 16 }, pair);
export const EP_KEYS = Array.from({ length: 128 }, pair);

/** Full recomputation. Used at setFen, and as the tests' oracle. */
export function hashParts(board) {
  let lo = 0, hi = 0;
  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) { sq += 7; continue; }
    const piece = board.squares[sq];
    if (piece === 0) continue;
    const [a, b] = PIECE_KEYS[piece][sq];
    lo ^= a; hi ^= b;
  }
  if (board.side === 1) { lo ^= SIDE_KEY[0]; hi ^= SIDE_KEY[1]; }
  const [ca, cb] = CASTLE_KEYS[board.castling];
  lo ^= ca; hi ^= cb;
  if (board.epSquare >= 0) {
    const [ea, eb] = EP_KEYS[board.epSquare];
    lo ^= ea; hi ^= eb;
  }
  return [lo >>> 0, hi >>> 0];
}

/**
 * Pack the two halves into one Number, for use as a Map key.
 * 21 bits of hi + 32 bits of lo = 53, the largest integer a double holds
 * exactly. Collisions are possible in principle and vanishingly rare in
 * practice at these table sizes.
 */
export const packKey = (lo, hi) => (hi >>> 11) * 4294967296 + (lo >>> 0);

/** Convenience: recompute and pack. Not on the hot path. */
export function hashBoard(board) {
  const [lo, hi] = hashParts(board);
  return packKey(lo, hi);
}
