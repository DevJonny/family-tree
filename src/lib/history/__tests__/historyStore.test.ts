import assert from "node:assert/strict";
import { test } from "node:test";
import { History } from "../historyStore";

interface TestState {
  count: number;
  items: string[];
}

test("apply records an undoable entry and updates state", () => {
  const h = new History<TestState>({ count: 0, items: [] });
  h.apply((d) => {
    d.count = 1;
    d.items.push("a");
  }, "add a");

  assert.equal(h.state.count, 1);
  assert.deepEqual(h.state.items, ["a"]);
  assert.equal(h.canUndo, true);
  assert.equal(h.canRedo, false);
});

test("undo reverts to the previous state and enables redo", () => {
  const h = new History<TestState>({ count: 0, items: [] });
  h.apply((d) => void d.items.push("a"), "add a");
  h.apply((d) => void d.items.push("b"), "add b");

  assert.deepEqual(h.state.items, ["a", "b"]);

  const undone = h.undo();
  assert.equal(undone, true);
  assert.deepEqual(h.state.items, ["a"]);
  assert.equal(h.canRedo, true);

  h.undo();
  assert.deepEqual(h.state.items, []);
  assert.equal(h.canUndo, false);
});

test("redo replays a previously undone entry", () => {
  const h = new History<TestState>({ count: 0, items: [] });
  h.apply((d) => void d.items.push("a"));
  h.undo();
  assert.deepEqual(h.state.items, []);

  const redone = h.redo();
  assert.equal(redone, true);
  assert.deepEqual(h.state.items, ["a"]);
  assert.equal(h.canRedo, false);
});

test("a new apply() after undo clears the redo stack (no redo branching)", () => {
  const h = new History<TestState>({ count: 0, items: [] });
  h.apply((d) => void d.items.push("a"));
  h.apply((d) => void d.items.push("b"));
  h.undo();
  assert.equal(h.canRedo, true);

  h.apply((d) => void d.items.push("c"));
  assert.equal(h.canRedo, false);
  assert.deepEqual(h.state.items, ["a", "c"]);
});

test("undo/redo on an empty stack is a safe no-op", () => {
  const h = new History<TestState>({ count: 0, items: [] });
  assert.equal(h.undo(), false);
  assert.equal(h.redo(), false);
});

test("a no-op recipe (no actual change) does not create a history entry", () => {
  const h = new History<TestState>({ count: 5, items: [] });
  h.apply((d) => {
    d.count = 5; // same value
  });
  assert.equal(h.canUndo, false);
});

test("reset() replaces state without creating undo history", () => {
  const h = new History<TestState>({ count: 0, items: [] });
  h.apply((d) => void d.items.push("a"));
  h.reset({ count: 99, items: ["loaded"] });

  assert.equal(h.state.count, 99);
  assert.equal(h.canUndo, false);
  assert.equal(h.canRedo, false);
});

test("subscribe() is notified on apply/undo/redo with the new state", () => {
  const h = new History<TestState>({ count: 0, items: [] });
  const seen: number[] = [];
  const unsubscribe = h.subscribe((state) => seen.push(state.count));

  h.apply((d) => void (d.count = 1));
  h.apply((d) => void (d.count = 2));
  h.undo();
  h.redo();

  assert.deepEqual(seen, [1, 2, 1, 2]);
  unsubscribe();
  h.apply((d) => void (d.count = 3));
  assert.deepEqual(seen, [1, 2, 1, 2]); // no more notifications after unsubscribe
});

test("undoing a deleted key restores it in its original position, not at the end", () => {
  // Record maps are exported in key order, so undoing a delete (a person, a
  // source) must give back the exact previous object, not re-add the key last.
  const h = new History<{ byId: Record<string, number> }>({ byId: { a: 1, b: 2, c: 3 } });
  h.apply((d) => void delete d.byId.a, "delete a");
  h.undo();
  assert.deepEqual(Object.keys(h.state.byId), ["a", "b", "c"]);

  h.redo();
  assert.deepEqual(Object.keys(h.state.byId), ["b", "c"]);
  h.undo();
  assert.deepEqual(Object.keys(h.state.byId), ["a", "b", "c"]);
});
