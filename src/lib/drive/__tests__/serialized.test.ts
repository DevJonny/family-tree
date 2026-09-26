import assert from "node:assert/strict";
import { test } from "node:test";
import { serialized } from "../serialized";

/** A run the test finishes by hand, so it can make calls while one is in flight. */
function controllableRuns() {
  const finishers: Array<(err?: Error) => void> = [];
  let active = 0;
  let maxActive = 0;
  const run = () =>
    new Promise<void>((resolve, reject) => {
      active++;
      maxActive = Math.max(maxActive, active);
      finishers.push((err) => {
        active--;
        if (err) reject(err);
        else resolve();
      });
    });
  return {
    run,
    get started() {
      return finishers.length;
    },
    get maxActive() {
      return maxActive;
    },
    finish: (i: number, err?: Error) => finishers[i](err),
  };
}

const settle = () => new Promise((r) => setImmediate(r));

test("an idle call runs straight away", async () => {
  const runs = controllableRuns();
  const call = serialized(runs.run);
  const done = call();
  assert.equal(runs.started, 1);
  runs.finish(0);
  await done;
});

test("a call during a run waits for it, then runs once more", async () => {
  const runs = controllableRuns();
  const call = serialized(runs.run);
  void call();
  const second = call();
  await settle();
  assert.equal(runs.started, 1, "no second run while the first is in flight");

  runs.finish(0);
  await settle();
  assert.equal(runs.started, 2, "the queued call runs after the first finishes");
  assert.equal(runs.maxActive, 1);

  let secondDone = false;
  void second.then(() => (secondDone = true));
  await settle();
  assert.equal(secondDone, false, "the queued call's promise waits for its own run");
  runs.finish(1);
  await second;
});

test("many calls during a run collapse into one rerun", async () => {
  const runs = controllableRuns();
  const call = serialized(runs.run);
  void call();
  const queued = [call(), call(), call()];
  runs.finish(0);
  await settle();
  assert.equal(runs.started, 2);
  runs.finish(1);
  await Promise.all(queued);
  await settle();
  assert.equal(runs.started, 2);
});

test("a failed run still lets the queued call run", async () => {
  const runs = controllableRuns();
  const call = serialized(runs.run);
  const first = call();
  const second = call();
  runs.finish(0, new Error("boom"));
  await assert.rejects(first, /boom/);
  await settle();
  assert.equal(runs.started, 2);
  runs.finish(1);
  await second;
});

test("after everything finishes, the next call runs straight away", async () => {
  const runs = controllableRuns();
  const call = serialized(runs.run);
  const first = call();
  runs.finish(0);
  await first;
  void call();
  assert.equal(runs.started, 2);
  runs.finish(1);
});
