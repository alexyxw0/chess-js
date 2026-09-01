// The search, on its own thread.
//
// It is a synchronous tree walk that can run for seconds, and on the main
// thread that means the page cannot repaint or handle a pointer event until it
// finishes — the board would freeze on your own move and only catch up once
// the reply arrived. The engine has no DOM dependencies at all, which is what
// makes moving it here a matter of a message rather than a rewrite.

import { Board } from "./board.js";
import { moveToUci } from "./movegen.js";
import { Search } from "./search.js";

self.onmessage = ({ data }) => {
  const { id, fen, maxDepth, timeLimitMs } = data;
  try {
    const result = new Search({ maxDepth, timeLimitMs })
      .findBestMove(new Board(fen));
    self.postMessage(result.move === null ? { id, thought: null } : {
      id,
      thought: {
        uci: moveToUci(result.move),
        depth: result.depth,
        nodes: result.nodes,
        score: result.score,
        elapsedMs: result.elapsedMs,
        pv: result.pv,
      },
    });
  } catch (error) {
    self.postMessage({ id, error: String(error && error.stack || error) });
  }
};
