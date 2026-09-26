import assert from "node:assert/strict";
import { test } from "node:test";
import { AUTOSAVE_KEY, readAutosave, startAutosave, type KeyValueStore } from "../autosave";
import { useFamilyTreeStore } from "../familyTreeStore";
import { buildFamilyTree } from "../../gedcom/model";

function memoryStore() {
  const map = new Map<string, unknown>();
  const writes: unknown[] = [];
  const kv: KeyValueStore = {
    get: async (k) => map.get(k),
    set: async (k, v) => void (writes.push(v), map.set(k, v)),
    del: async (k) => void map.delete(k),
  };
  return { kv, map, writes };
}

const settle = () => new Promise((r) => setTimeout(r, 20));
const store = useFamilyTreeStore.getState;

function reset() {
  store().loadTree(buildFamilyTree([]), "tree.ged");
}

test("unsaved edits are autosaved once they settle, as GEDCOM text with the file name", async () => {
  reset();
  const { kv, map, writes } = memoryStore();
  const autosave = startAutosave(kv, { delayMs: 5, now: () => 1234 });
  store().addIndividual({ given: "Ada", surname: "Lovelace" });
  store().addIndividual({ given: "Byron" });
  await settle();
  autosave.stop();

  assert.equal(writes.length, 1, "debounced to one write");
  const record = await readAutosave(kv);
  assert.equal(record?.fileName, "tree.ged");
  assert.equal(record?.savedAt, 1234);
  assert.match(record!.text, /1 NAME Ada \/Lovelace\//);
  assert.ok(map.has(AUTOSAVE_KEY));
});

test("once the tree is saved (exported, synced, or undone back), the autosave is cleared", async () => {
  reset();
  const { kv, map } = memoryStore();
  const autosave = startAutosave(kv, { delayMs: 5 });
  store().addIndividual({ given: "Ada" });
  await settle();
  assert.ok(map.has(AUTOSAVE_KEY));

  store().markSaved();
  await settle();
  assert.equal(map.has(AUTOSAVE_KEY), false);

  store().addIndividual({ given: "Byron" });
  await settle();
  store().undo();
  await settle();
  autosave.stop();
  assert.equal(map.has(AUTOSAVE_KEY), false, "undoing back to the saved tree clears it too");
});

test("a tree that starts out unsaved (restored work) is autosaved straight away", async () => {
  store().loadTree(buildFamilyTree([]), "restored.ged", [], { saved: false });
  const { kv, map } = memoryStore();
  const autosave = startAutosave(kv, { delayMs: 5 });
  await settle();
  autosave.stop();
  assert.ok(map.has(AUTOSAVE_KEY));
});

test("after stop, nothing more is written", async () => {
  reset();
  const { kv, writes } = memoryStore();
  startAutosave(kv, { delayMs: 5 }).stop();
  store().addIndividual({ given: "Ada" });
  await settle();
  assert.equal(writes.length, 0);
});

test("readAutosave ignores missing or malformed records", async () => {
  const { kv, map } = memoryStore();
  assert.equal(await readAutosave(kv), null);
  map.set(AUTOSAVE_KEY, "not a record");
  assert.equal(await readAutosave(kv), null);
  map.set(AUTOSAVE_KEY, { text: 5, savedAt: 1 });
  assert.equal(await readAutosave(kv), null);
});

test("flush writes a pending change immediately, for when the page is being hidden", async () => {
  reset();
  const { kv, writes } = memoryStore();
  const autosave = startAutosave(kv, { delayMs: 10_000 });
  store().addIndividual({ given: "Ada" });
  autosave.flush();
  autosave.stop();
  await settle();
  assert.equal(writes.length, 1);
});
