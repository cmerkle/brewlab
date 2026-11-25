// Brew timer: "Next step now" and "Wait" move the rest of the schedule; each step keeps its duration.
import { test } from "node:test";
import assert from "node:assert/strict";

const { stepTimes, timerState, nextStepNow } = await import("../dist/shared/brew.js");
const steps = [{ label: "Bloom", atSec: 0 }, { label: "Pour 1", atSec: 45 }, { label: "Pour 2", atSec: 75 }, { label: "Drawdown", atSec: 105 }];

test("next step now starts the next step at once; the steps after it keep their durations", () => {
  let sh = nextStepNow(steps, [], 0, 30); // bloom drained at 0:30
  assert.deepEqual(stepTimes(steps, sh), [0, 30, 60, 90]);
  assert.equal(timerState(stepTimes(steps, sh), 30).idx, 1);
  sh = nextStepNow(steps, sh, 1, 50); // pour 1 drained 10 s early too
  assert.deepEqual(stepTimes(steps, sh), [0, 30, 50, 80]);
  assert.equal(timerState(stepTimes(steps, sh), 50).idx, 2);
  assert.deepEqual(nextStepNow(steps, sh, 3, 90), sh, "nothing after the last step");
});

test("wait holds the next step past its time until next step now; later steps move later", () => {
  const times = stepTimes(steps, []);
  assert.deepEqual(timerState(times, 40, 1), { idx: 0, holding: false }, "armed, not due yet");
  assert.deepEqual(timerState(times, 60, 1), { idx: 0, holding: true }, "due: held on the bloom");
  assert.deepEqual(timerState(times, 200, 1), { idx: 0, holding: true }, "held, even past every later step");
  const sh = nextStepNow(steps, [], 0, 60);
  assert.deepEqual(stepTimes(steps, sh), [0, 60, 90, 120]);
  assert.deepEqual(timerState(stepTimes(steps, sh), 60), { idx: 1, holding: false });
});
