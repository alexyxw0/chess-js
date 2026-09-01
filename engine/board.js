// 0x88 board representation, FEN, and reversible make/unmake.
//
// A square is rank * 16 + file, so a1 = 0 and h8 = 119. The trick the layout
// buys: a square is off the board exactly when (sq & 0x88) is non-zero, so
// bounds checking during move generation is one bitwise AND instead of two
// comparisons on a decoded rank and file.

export const EMPTY = 0;
export const PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6;
export const WHITE = 0, BLACK = 1;

// piece = type | (colour << 3): white 1-6, black 9-14.
export const pieceType = (p) => p & 7;
export const pieceColour = (p) => (p >> 3) & 1;
export const makePiece = (type, colour) => type | (colour << 3);

// Castling rights, as bit flags.
export const CASTLE_WK = 1, CASTLE_WQ = 2, CASTLE_BK = 4, CASTLE_BQ = 8;

// Move flags.
export const FLAG_EP = 1, FLAG_CASTLE = 2, FLAG_DOUBLE = 4, FLAG_PROMO = 8;

// A move packs into one integer so the transposition table can store it in a
// field rather than a reference: from | to | promo | captured | flags.
export const encodeMove = (from, to, promo = 0, captured = 0, flags = 0) =>
  from | (to << 8) | (promo << 16) | (captured << 20) | (flags << 24);

export const moveFrom = (m) => m & 0xff;
export const moveTo = (m) => (m >> 8) & 0xff;
export const movePromo = (m) => (m >> 16) & 0xf;
export const moveCaptured = (m) => (m >> 20) & 0xf;
export const moveFlags = (m) => (m >> 24) & 0xf;

export const fileOf = (sq) => sq & 15;
export const rankOf = (sq) => sq >> 4;
export const onBoard = (sq) => (sq & 0x88) === 0;

const FILE_CHARS = "abcdefgh";
export const squareToAlgebraic = (sq) => FILE_CHARS[fileOf(sq)] + (rankOf(sq) + 1);
export const algebraicToSquare = (s) =>
  FILE_CHARS.indexOf(s[0]) + (Number(s[1]) - 1) * 16;

const FEN_PIECES = {
  p: makePiece(PAWN, BLACK), n: makePiece(KNIGHT, BLACK), b: makePiece(BISHOP, BLACK),
  r: makePiece(ROOK, BLACK), q: makePiece(QUEEN, BLACK), k: makePiece(KING, BLACK),
  P: makePiece(PAWN, WHITE), N: makePiece(KNIGHT, WHITE), B: makePiece(BISHOP, WHITE),
  R: makePiece(ROOK, WHITE), Q: makePiece(QUEEN, WHITE), K: makePiece(KING, WHITE),
};
// Indexed by piece type: 0 is empty, then PAWN..KING. White prints upper case.
const TYPE_CHARS = ".pnbrqk";
const pieceChar = (p) => {
  const c = TYPE_CHARS[pieceType(p)];
  return pieceColour(p) === WHITE ? c.toUpperCase() : c;
};

import { CASTLE_KEYS, EP_KEYS, PIECE_KEYS, SIDE_KEY, hashParts, packKey } from "./zobrist.js";

export const STARTING_FEN =
  "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

// Offsets, shared with movegen.
export const KNIGHT_OFFSETS = [33, 31, 18, 14, -33, -31, -18, -14];
export const KING_OFFSETS = [17, 16, 15, 1, -17, -16, -15, -1];
export const BISHOP_OFFSETS = [17, 15, -17, -15];
export const ROOK_OFFSETS = [16, 1, -16, -1];

// Castling rights are cleared when a king or rook leaves, or a rook square is
// captured on. A per-square mask handles every one of those cases with a single
// AND on both the from and to squares, so neither move nor capture needs a
// special case.
const CASTLE_MASK = new Int8Array(128).fill(15);
CASTLE_MASK[0] = 15 & ~CASTLE_WQ;      // a1 rook
CASTLE_MASK[4] = 15 & ~(CASTLE_WK | CASTLE_WQ); // e1 king
CASTLE_MASK[7] = 15 & ~CASTLE_WK;      // h1 rook
CASTLE_MASK[112] = 15 & ~CASTLE_BQ;    // a8
CASTLE_MASK[116] = 15 & ~(CASTLE_BK | CASTLE_BQ); // e8
CASTLE_MASK[119] = 15 & ~CASTLE_BK;    // h8

export class Board {
  constructor(fen = STARTING_FEN) {
    this.squares = new Uint8Array(128);
    this.kingSquare = [-1, -1];
    this.history = [];
    this.setFen(fen);
  }

  setFen(fen) {
    const [placement, side, castling, ep, half = "0", full = "1"] = fen.trim().split(/\s+/);

    this.squares.fill(EMPTY);
    let rank = 7, file = 0;
    for (const ch of placement) {
      if (ch === "/") { rank--; file = 0; }
      else if (ch >= "1" && ch <= "8") file += Number(ch);
      else {
        const piece = FEN_PIECES[ch];
        if (piece === undefined) throw new Error(`bad FEN piece '${ch}'`);
        const sq = rank * 16 + file;
        this.squares[sq] = piece;
        if (pieceType(piece) === KING) this.kingSquare[pieceColour(piece)] = sq;
        file++;
      }
    }

    this.side = side === "w" ? WHITE : BLACK;
    this.castling =
      (castling.includes("K") ? CASTLE_WK : 0) |
      (castling.includes("Q") ? CASTLE_WQ : 0) |
      (castling.includes("k") ? CASTLE_BK : 0) |
      (castling.includes("q") ? CASTLE_BQ : 0);
    this.epSquare = ep && ep !== "-" ? algebraicToSquare(ep) : -1;
    this.halfmove = Number(half);
    this.fullmove = Number(full);
    this.history.length = 0;
    [this.hashLo, this.hashHi] = hashParts(this);
    return this;
  }

  fen() {
    let placement = "";
    for (let rank = 7; rank >= 0; rank--) {
      let run = 0;
      for (let file = 0; file < 8; file++) {
        const piece = this.squares[rank * 16 + file];
        if (piece === EMPTY) run++;
        else {
          if (run) { placement += run; run = 0; }
          placement += pieceChar(piece);
        }
      }
      if (run) placement += run;
      if (rank) placement += "/";
    }

    const rights =
      (this.castling & CASTLE_WK ? "K" : "") + (this.castling & CASTLE_WQ ? "Q" : "") +
      (this.castling & CASTLE_BK ? "k" : "") + (this.castling & CASTLE_BQ ? "q" : "");

    return [
      placement,
      this.side === WHITE ? "w" : "b",
      rights || "-",
      this.epSquare >= 0 ? squareToAlgebraic(this.epSquare) : "-",
      this.halfmove,
      this.fullmove,
    ].join(" ");
  }

  /** The position's Zobrist key, maintained incrementally. */
  hashKey() {
    return packKey(this.hashLo, this.hashHi);
  }

  /** Is `square` attacked by any piece of `byColour`? */
  isAttacked(square, byColour) {
    const sq = this.squares;

    // Pawns. A pawn on `square - 15` attacks `square` if it is white, because
    // white captures upward; hence the sign flip on colour.
    const pawn = makePiece(PAWN, byColour);
    const back = byColour === WHITE ? -1 : 1;
    for (const side of [15, 17]) {
      const from = square + side * back;
      if (onBoard(from) && sq[from] === pawn) return true;
    }

    const knight = makePiece(KNIGHT, byColour);
    for (const offset of KNIGHT_OFFSETS) {
      const from = square + offset;
      if (onBoard(from) && sq[from] === knight) return true;
    }

    const king = makePiece(KING, byColour);
    for (const offset of KING_OFFSETS) {
      const from = square + offset;
      if (onBoard(from) && sq[from] === king) return true;
    }

    // Sliders: walk outward until something blocks.
    const slide = (offsets, types) => {
      for (const offset of offsets) {
        for (let to = square + offset; onBoard(to); to += offset) {
          const piece = sq[to];
          if (piece === EMPTY) continue;
          if (pieceColour(piece) === byColour && types.includes(pieceType(piece))) return true;
          break;
        }
      }
      return false;
    };
    if (slide(BISHOP_OFFSETS, [BISHOP, QUEEN])) return true;
    if (slide(ROOK_OFFSETS, [ROOK, QUEEN])) return true;

    return false;
  }

  inCheck(colour = this.side) {
    return this.isAttacked(this.kingSquare[colour], colour ^ 1);
  }

  makeMove(move) {
    const sq = this.squares;
    const from = moveFrom(move), to = moveTo(move), flags = moveFlags(move);
    const piece = sq[from];
    const colour = pieceColour(piece);

    this.history.push({
      move,
      castling: this.castling,
      epSquare: this.epSquare,
      halfmove: this.halfmove,
      // Restoring the saved hash on unmake is O(1) and cannot drift, which a
      // second incremental pass in reverse could.
      hashLo: this.hashLo,
      hashHi: this.hashHi,
    });

    // Everything that changes the key, XORed as it changes. XOR is its own
    // inverse, so "remove" and "add" are the same operation.
    let lo = this.hashLo, hi = this.hashHi;
    const xor = (k) => { lo ^= k[0]; hi ^= k[1]; };

    xor(SIDE_KEY);
    xor(CASTLE_KEYS[this.castling]);
    if (this.epSquare >= 0) xor(EP_KEYS[this.epSquare]);

    xor(PIECE_KEYS[piece][from]);
    xor(PIECE_KEYS[piece][to]);
    const captured = moveCaptured(move);
    if (captured && !(flags & FLAG_EP)) xor(PIECE_KEYS[captured][to]);

    sq[to] = piece;
    sq[from] = EMPTY;

    if (flags & FLAG_EP) {
      // The captured pawn is beside the destination, not on it.
      const victim = to + (colour === WHITE ? -16 : 16);
      xor(PIECE_KEYS[sq[victim]][victim]);
      sq[victim] = EMPTY;
    }
    if (flags & FLAG_PROMO) {
      const promoted = makePiece(movePromo(move), colour);
      xor(PIECE_KEYS[piece][to]);        // the pawn that arrived
      xor(PIECE_KEYS[promoted][to]);     // the piece it became
      sq[to] = promoted;
    }
    if (flags & FLAG_CASTLE) {
      // King has already moved; slide the rook over it.
      const [rookFrom, rookTo] =
        to > from ? [from + 3, from + 1] : [from - 4, from - 1];
      xor(PIECE_KEYS[sq[rookFrom]][rookFrom]);
      xor(PIECE_KEYS[sq[rookFrom]][rookTo]);
      sq[rookTo] = sq[rookFrom];
      sq[rookFrom] = EMPTY;
    }

    if (pieceType(piece) === KING) this.kingSquare[colour] = to;

    this.castling &= CASTLE_MASK[from] & CASTLE_MASK[to];
    this.epSquare = flags & FLAG_DOUBLE ? (from + to) >> 1 : -1;

    xor(CASTLE_KEYS[this.castling]);
    if (this.epSquare >= 0) xor(EP_KEYS[this.epSquare]);
    this.hashLo = lo >>> 0;
    this.hashHi = hi >>> 0;

    this.halfmove =
      pieceType(piece) === PAWN || moveCaptured(move) ? 0 : this.halfmove + 1;
    if (colour === BLACK) this.fullmove++;
    this.side ^= 1;
  }

  unmakeMove() {
    const undo = this.history.pop();
    if (!undo) throw new Error("unmakeMove with empty history");

    const sq = this.squares;
    const { move } = undo;
    const from = moveFrom(move), to = moveTo(move), flags = moveFlags(move);

    this.side ^= 1;
    const colour = this.side;
    if (colour === BLACK) this.fullmove--;

    // A promoted piece becomes a pawn again on the way back.
    sq[from] = flags & FLAG_PROMO ? makePiece(PAWN, colour) : sq[to];
    sq[to] = moveCaptured(move);

    if (flags & FLAG_EP) {
      sq[to] = EMPTY;
      sq[to + (colour === WHITE ? -16 : 16)] = makePiece(PAWN, colour ^ 1);
    }
    if (flags & FLAG_CASTLE) {
      const [rookFrom, rookTo] =
        to > from ? [from + 3, from + 1] : [from - 4, from - 1];
      sq[rookFrom] = sq[rookTo];
      sq[rookTo] = EMPTY;
    }

    if (pieceType(sq[from]) === KING) this.kingSquare[colour] = from;

    this.castling = undo.castling;
    this.epSquare = undo.epSquare;
    this.halfmove = undo.halfmove;
    this.hashLo = undo.hashLo;
    this.hashHi = undo.hashHi;
  }

  clone() {
    return new Board(this.fen());
  }
}
