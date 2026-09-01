// Wires the engine controls in index.html to the game in chess.js.
//
// chess.js is a classic script that puts `game` on the window; this is a module
// that reads it. Keeping them separate means the engine can be tested in Node
// with no DOM, which is the whole reason the adapter talks FEN.

import { playEngineMove, think } from "./engine-adapter.js";
import { evalDisplay } from "./evalscale.js";

const statusEl = document.getElementById("status");
const depthEl = document.getElementById("depth");
const budgetEl = document.getElementById("budget");
const hintButton = document.getElementById("hint");
const turnEl = document.getElementById("turn");
const evalFill = document.getElementById("evalFill");
const evalText = document.getElementById("evalText");

/** Read the strength controls, clamped to what the inputs advertise. */
const clamp = (value, lo, hi, fallback) =>
  Number.isFinite(value) ? Math.min(hi, Math.max(lo, value)) : fallback;

const options = () => ({
  maxDepth: Math.round(clamp(Number(depthEl.value), 1, 99, 4)),
  timeLimitMs: Math.round(clamp(Number(budgetEl.value), 0.1, 600, 2) * 1000),
});

// Evaluating after every move should not cost as much as playing one, so the
// bar is capped shallower than the engine's own setting.
const EVAL_MAX_DEPTH = 4;
const EVAL_TIME_MS = 1000;
const evalOptions = () => {
  const { maxDepth, timeLimitMs } = options();
  return { maxDepth: Math.min(maxDepth, EVAL_MAX_DEPTH),
           timeLimitMs: Math.min(timeLimitMs, EVAL_TIME_MS) };
};

/** Which colour the engine plays: 0 white, 1 black, or null for two players. */
let engineSide = null;

for (const radio of document.querySelectorAll("input[name=mode]")) {
  radio.addEventListener("change", () => {
    engineSide = radio.value === "human" ? null
               : radio.value === "white" ? 0 : 1;
    say(engineSide === null ? "Two players." : "Engine to move when it is its turn.");
    maybeMove();
  });
}

hintButton.addEventListener("click", async () => {
  hintButton.disabled = true;
  say("Thinking\u2026");
  try {
    const thought = await think(window.game.board, options());
    say(thought === null ? "No legal moves." : describe(thought, "Suggestion"));
  } finally {
    hintButton.disabled = false;
  }
});

function say(text) { statusEl.textContent = text; }

// ── evaluation bar ──────────────────────────────────────────────────────────

let evalRequest = 0;

function showEval(scoreForSideToMove) {
  const ui = window.game?.board;
  if (!ui) return;
  const { fraction, label } = evalDisplay(scoreForSideToMove, ui.turn === 0);
  evalFill.style.height = `${(100 * fraction).toFixed(1)}%`;
  evalText.textContent = label;
}

/** Ask for a shallow evaluation of the current position and update the bar. */
async function refreshEval() {
  const ui = window.game?.board;
  if (!ui) return;
  const ticket = ++evalRequest;
  try {
    const thought = await think(ui, evalOptions());
    if (ticket !== evalRequest) return;   // a newer position superseded this
    if (thought) showEval(thought.score);
  } catch {
    /* the bar is decoration; a failed eval should not surface as an error */
  }
}

/** Whose move it is, whether they are in check, and whether the game is over. */
function showTurn() {
  const ui = window.game?.board;
  if (!ui) return;
  const white = ui.turn === 0;
  const over = ui.getAllMoves(ui.colors[ui.turn]).length === 0;

  turnEl.style.setProperty("--side", white ? "#e8e4dc" : "#2b2b28");
  turnEl.classList.toggle("check", ui.checked && !over);

  if (over) {
    turnEl.textContent = ui.checked
      ? `Checkmate — ${white ? "Black" : "White"} wins`
      : "Stalemate — draw";
  } else {
    turnEl.textContent = `${white ? "White" : "Black"} to move`
      + (ui.checked ? " — in check" : "");
  }
}

function describe(thought, label) {
  // Scores are centipawns from the side to move's view; show them from White's
  // so the sign does not flip every ply.
  const white = window.game.board.turn === 0 ? thought.score : -thought.score;
  const pawns = (white / 100).toFixed(2);
  return [
    `${label}: ${thought.uci}`,
    `depth ${thought.depth}   ${thought.nodes.toLocaleString()} nodes   ${thought.elapsedMs} ms`,
    `eval ${white > 0 ? "+" : ""}${pawns} (White)`,
    thought.pv.length > 1 ? `line ${thought.pv.join(" ")}` : "",
  ].filter(Boolean).join("\n");
}

let thinking = false;

async function maybeMove() {
  const ui = window.game?.board;
  if (!ui || thinking || engineSide === null || ui.turn !== engineSide) return;

  thinking = true;
  say("Thinking\u2026");
  try {
    // The search runs in a worker, so this await does not block the board: your
    // own move is already painted and the pieces stay draggable while it thinks.
    const thought = await playEngineMove(ui, options());
    if (thought === null) {
      say("No legal moves — the game is over.");
    } else {
      say(describe(thought, "Played"));
      showEval(-thought.score);   // scored before the move; now it is the other side
    }
  } catch (error) {
    say(`Engine error: ${error.message}`);
  } finally {
    thinking = false;
  }
}

// chess.js owns the click handling and has no move event, so wrap movePiece to
// learn when the position changed. Wrapping rather than editing keeps the
// original game logic untouched and independently reviewable.
const original = window.game.board.movePiece.bind(window.game.board);
window.game.board.movePiece = function (move) {
  original(move);
  showTurn();
  // Let the board paint your move before the engine is asked for a reply.
  // The search is off-thread now, but the request itself still has to wait for
  // a frame or the "Thinking…" line and the moved piece land together.
  requestAnimationFrame(() => {
    maybeMove();
    if (engineSide === null || window.game.board.turn !== engineSide) refreshEval();
  });
};

// History keys rewind the position without going through movePiece, so the
// indicator has to follow them too.
document.addEventListener("keydown", () => requestAnimationFrame(() => {
  showTurn();
  refreshEval();
}));

// Re-evaluate when the strength controls change, so the bar reflects the
// setting actually in use.
for (const input of [depthEl, budgetEl]) {
  input.addEventListener("change", () => refreshEval());
}

showTurn();
refreshEval();
