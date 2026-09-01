import test from "node:test";
import assert from "node:assert/strict";

import { MATE_THRESHOLD, barFraction, evalDisplay } from "../evalscale.js";

test("an even position is half the bar", () => {
  assert.equal(barFraction(0), 0.5);
});

test("the scale is monotonic and bounded", () => {
  let previous = 0;
  for (let cp = -2000; cp <= 2000; cp += 50) {
    const f = barFraction(cp);
    assert.ok(f > previous, `not increasing at ${cp}`);
    assert.ok(f > 0 && f < 1, `out of range at ${cp}`);
    previous = f;
  }
});

test("small edges stay visible, large ones saturate gently", () => {
  // The point of the logistic: a pawn should move the bar noticeably, and a
  // queen should not peg it so hard that further gains are invisible.
  assert.ok(barFraction(100) - 0.5 > 0.07, "a pawn barely registers");
  assert.ok(barFraction(900) < 0.995, "a queen pegs the bar completely");
  assert.ok(barFraction(900) > barFraction(400), "still ordered up there");
});

test("the scale is symmetric about zero", () => {
  for (const cp of [50, 200, 700]) {
    assert.ok(Math.abs(barFraction(cp) + barFraction(-cp) - 1) < 1e-12);
  }
});

test("scores are flipped into White's view when Black is to move", () => {
  // +300 for the side to move, with Black to move, is -300 for White.
  const black = evalDisplay(300, false);
  assert.equal(black.white, -300);
  assert.ok(black.fraction < 0.5);
  assert.equal(black.label, "-3.0");

  const white = evalDisplay(300, true);
  assert.equal(white.white, 300);
  assert.ok(white.fraction > 0.5);
  assert.equal(white.label, "3.0");
});

test("a mate for White fills the bar; a mate against it empties it", () => {
  const forWhite = evalDisplay(MATE_THRESHOLD + 500, true);
  assert.equal(forWhite.fraction, 1);
  assert.equal(forWhite.label, "M");

  const againstWhite = evalDisplay(MATE_THRESHOLD + 500, false);
  assert.equal(againstWhite.fraction, 0);
  assert.equal(againstWhite.label, "-M");
});

test("labels read as pawns to one decimal", () => {
  assert.equal(evalDisplay(0, true).label, "0.0");
  assert.equal(evalDisplay(155, true).label, "1.6");
  assert.equal(evalDisplay(-1250, true).label, "-12.5");
});
