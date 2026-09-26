import assert from "node:assert/strict";
import { test } from "node:test";
import { autosaveKey, readLeftovers, startAutosave, type KeyValueStore } from "../autosave";
import { useFamilyTreeStore } from "../familyTreeStore";
import { buildFamilyTree } from "../../gedcom/model";

function memoryStore() {
  const map = new Map<string, unknown>();
  const writes: unknown[] = [];
  const kv: KeyValueStore = {
    get: async (k) => map.get(k),
    set: async (k, v) => void (writes.push(v), map.set(k, v)),
    del: async (k) => void map.delete(k),
    keys: async () => [...map.keys()],
  };
  return { kv, map, writes };
}

const settle = () => new Promise((r) => setTimeout(r, 20));
const store = useFamilyTreeStore.getState;
const KEY = autosaveKey("tab-1");
const nobodyElseIsOpen = () => false;

function reset() {
  store().loadTree(buildFamilyTree([]), "tree.ged");
}

test("unsaved edits are autosaved once they settle, as GEDCOM text with the file name", async () => {
  reset();
  const { kv, map, writes } = memoryStore();
  const autosave = startAutosave(kv, "tab-1", { delayMs: 5, now: () => 1234 });
  store().addIndividual({ given: "Ada", surname: "Lovelace" });
  store().addIndividual({ given: "Byron" });
  await settle();
  autosave.stop();

  assert.equal(writes.length, 1, "debounced to one write");
  const record = (await readLeftovers(kv, nobodyElseIsOpen))[0];
  assert.equal(record?.sessionId, "tab-1");
  assert.equal(record?.fileName, "tree.ged");
  assert.equal(record?.savedAt, 1234);
  assert.match(record!.text, /1 NAME Ada \/Lovelace\//);
  assert.ok(map.has(KEY));
});

test("once the tree is saved (exported, synced, or undone back), the autosave is cleared", async () => {
  reset();
  const { kv, map } = memoryStore();
  const autosave = startAutosave(kv, "tab-1", { delayMs: 5 });
  store().addIndividual({ given: "Ada" });
  await settle();
  assert.ok(map.has(KEY));

  store().markSaved();
  await settle();
  assert.equal(map.has(KEY), false);

  store().addIndividual({ given: "Byron" });
  await settle();
  store().undo();
  await settle();
  autosave.stop();
  assert.equal(map.has(KEY), false, "undoing back to the saved tree clears it too");
});

test("a tree that starts out unsaved (restored work) is autosaved straight away", async () => {
  store().loadTree(buildFamilyTree([]), "restored.ged", [], { saved: false });
  const { kv, map } = memoryStore();
  const autosave = startAutosave(kv, "tab-1", { delayMs: 5 });
  await settle();
  autosave.stop();
  assert.ok(map.has(KEY));
});

test("after stop, nothing more is written", async () => {
  reset();
  const { kv, writes } = memoryStore();
  startAutosave(kv, "tab-1", { delayMs: 5 }).stop();
  store().addIndividual({ given: "Ada" });
  await settle();
  assert.equal(writes.length, 0);
});

test("readLeftovers ignores missing or malformed records, and other keys", async () => {
  const { kv, map } = memoryStore();
  assert.deepEqual(await readLeftovers(kv, nobodyElseIsOpen), []);
  map.set(autosaveKey("a"), "not a record");
  map.set(autosaveKey("b"), { text: 5, savedAt: 1 });
  map.set("family-tree:drive-file-ref", { text: "x", fileName: null, savedAt: 1 });
  assert.deepEqual(await readLeftovers(kv, nobodyElseIsOpen), []);
});

test("readLeftovers lists records from sessions that are no longer open, newest first", async () => {
  const { kv, map } = memoryStore();
  const record = (savedAt: number) => ({ text: "0 HEAD", fileName: null, savedAt });
  map.set(autosaveKey("closed-old"), record(1));
  map.set(autosaveKey("open"), record(3));
  map.set(autosaveKey("closed-new"), record(2));
  const open = new Set(["open"]);

  const leftovers = await readLeftovers(kv, (id) => open.has(id));
  assert.deepEqual(
    leftovers.map((l) => l.sessionId),
    ["closed-new", "closed-old"],
    "another open tab's record is its own, not a leftover",
  );
});

test("each tab keeps its own record: one tab saving doesn't delete another's unsaved work", async () => {
  reset();
  const { kv, map } = memoryStore();
  store().addIndividual({ given: "Ada" });
  await settle();
  map.set(autosaveKey("tab-2"), { text: "tab 2's work", fileName: null, savedAt: 1 });

  const autosave = startAutosave(kv, "tab-1", { delayMs: 5 });
  await settle();
  assert.ok(map.has(KEY));
  store().markSaved();
  await settle();
  autosave.stop();

  assert.equal(map.has(KEY), false);
  assert.ok(map.has(autosaveKey("tab-2")), "the other tab's record is untouched");
});

test("flush writes a pending change immediately, for when the page is being hidden", async () => {
  reset();
  const { kv, writes } = memoryStore();
  const autosave = startAutosave(kv, "tab-1", { delayMs: 10_000 });
  store().addIndividual({ given: "Ada" });
  await autosave.flush();
  assert.equal(writes.length, 1, "written by the time flush resolves");
  autosave.stop();
});
