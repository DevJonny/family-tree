import assert from "node:assert/strict";
import { test } from "node:test";
import { useFamilyTreeStore } from "../familyTreeStore";
import { buildFamilyTree } from "../../gedcom/model";

// The store wraps a single module-level History instance, so each test
// resets to a known-empty state via loadTree() (which itself is a
// non-undoable reset) to stay isolated from the others.
function reset() {
  useFamilyTreeStore.getState().loadTree(buildFamilyTree([]));
}

test("addIndividual creates a person and records an undoable edit", () => {
  reset();
  const id = useFamilyTreeStore.getState().addIndividual({ given: "Ada", surname: "Lovelace" });

  const state = useFamilyTreeStore.getState();
  assert.equal(state.tree.individuals[id]?.names[0]?.given, "Ada");
  assert.equal(state.canUndo, true);
  assert.equal(state.canRedo, false);
});

test("addParent links a new person as father via a shared FAM record", () => {
  reset();
  const childId = useFamilyTreeStore.getState().addIndividual({ given: "Child", surname: "One" });
  const fatherId = useFamilyTreeStore.getState().addParent(childId, "father", { given: "Dad", surname: "One" });

  const { tree } = useFamilyTreeStore.getState();
  const child = tree.individuals[childId];
  const father = tree.individuals[fatherId];
  assert.equal(child.familyAsChild.length, 1);
  assert.equal(father.familyAsSpouse[0], child.familyAsChild[0]);

  const fam = tree.families[child.familyAsChild[0]];
  assert.equal(fam.husband, fatherId);
  assert.deepEqual(fam.children, [childId]);
});

test("addParent for father then mother reuses the same FAM record instead of forking", () => {
  reset();
  const childId = useFamilyTreeStore.getState().addIndividual({ given: "Child", surname: "One" });
  useFamilyTreeStore.getState().addParent(childId, "father", { given: "Dad", surname: "One" });
  useFamilyTreeStore.getState().addParent(childId, "mother", { given: "Mom", surname: "One" });

  const { tree } = useFamilyTreeStore.getState();
  const child = tree.individuals[childId];
  assert.equal(child.familyAsChild.length, 1, "should not create a second FAM record for the same child");

  const fam = tree.families[child.familyAsChild[0]];
  assert.ok(fam.husband && fam.wife, "both parents should be on the one family record");
});

test("undo/redo unwinds and replays a multi-step addParent edit as a whole", () => {
  reset();
  const childId = useFamilyTreeStore.getState().addIndividual({ given: "Child", surname: "One" });
  useFamilyTreeStore.getState().addParent(childId, "father", { given: "Dad", surname: "One" });

  assert.equal(Object.keys(useFamilyTreeStore.getState().tree.individuals).length, 2);

  useFamilyTreeStore.getState().undo();
  const afterUndo = useFamilyTreeStore.getState();
  assert.equal(Object.keys(afterUndo.tree.individuals).length, 1, "father should be gone");
  assert.equal(afterUndo.tree.individuals[childId].familyAsChild.length, 0, "and the FAMC link with it");

  useFamilyTreeStore.getState().redo();
  const afterRedo = useFamilyTreeStore.getState();
  assert.equal(Object.keys(afterRedo.tree.individuals).length, 2);
  assert.equal(afterRedo.tree.individuals[childId].familyAsChild.length, 1);
});

test("removeIndividual detaches them from any family they were part of", () => {
  reset();
  const childId = useFamilyTreeStore.getState().addIndividual({ given: "Child", surname: "One" });
  const fatherId = useFamilyTreeStore.getState().addParent(childId, "father", { given: "Dad", surname: "One" });

  useFamilyTreeStore.getState().removeIndividual(fatherId);

  const { tree } = useFamilyTreeStore.getState();
  const famId = tree.individuals[childId].familyAsChild[0];
  assert.equal(tree.families[famId].husband, undefined);
  assert.equal(tree.individuals[fatherId], undefined);
});

test("undoTo(entryId) lands on the state right after that edit, like clicking a point in history", () => {
  reset();
  const id1 = useFamilyTreeStore.getState().addIndividual({ given: "One" });
  useFamilyTreeStore.getState().addIndividual({ given: "Two" });
  useFamilyTreeStore.getState().addIndividual({ given: "Three" });

  // undoStack is oldest-first, so index 0 is the "add One" edit. Jumping
  // to it should *keep* One (that edit is still applied) and undo
  // everything after it.
  const firstEntryId = useFamilyTreeStore.getState().history.undoStack[0].id;
  useFamilyTreeStore.getState().undoTo(firstEntryId);

  const state = useFamilyTreeStore.getState();
  assert.deepEqual(Object.keys(state.tree.individuals), [id1]);
  assert.equal(state.history.redoStack.length, 2, "Two and Three should now be redo-able");
});

test("redoTo(entryId) replays forward up to and including a chosen edit in one call", () => {
  reset();
  useFamilyTreeStore.getState().addIndividual({ given: "One" });
  useFamilyTreeStore.getState().addIndividual({ given: "Two" });
  useFamilyTreeStore.getState().addIndividual({ given: "Three" });
  useFamilyTreeStore.getState().undo();
  useFamilyTreeStore.getState().undo();
  useFamilyTreeStore.getState().undo();
  assert.equal(Object.keys(useFamilyTreeStore.getState().tree.individuals).length, 0);

  // redoStack stores entries most-recently-undone-first ([Three, Two, One]),
  // so the *last* element is "One" — the earliest edit and the first one
  // that would be replayed if you pressed redo repeatedly.
  const redoStack = useFamilyTreeStore.getState().history.redoStack;
  const firstToRedoEntryId = redoStack[redoStack.length - 1].id; // "One"
  useFamilyTreeStore.getState().redoTo(firstToRedoEntryId);

  const state = useFamilyTreeStore.getState();
  assert.equal(Object.keys(state.tree.individuals).length, 1, "only One should have been replayed");
  assert.equal(state.history.redoStack.length, 2, "Two and Three remain available to redo");
});

test("loadTree via loadFromGedcomText resets history (a file load is not undoable)", () => {
  reset();
  useFamilyTreeStore.getState().addIndividual({ given: "One" });
  assert.equal(useFamilyTreeStore.getState().canUndo, true);

  useFamilyTreeStore.getState().loadFromGedcomText("0 HEAD\n1 CHAR UTF-8\n0 TRLR\n", "test.ged");

  const state = useFamilyTreeStore.getState();
  assert.equal(state.canUndo, false);
  assert.equal(state.canRedo, false);
  assert.equal(Object.keys(state.tree.individuals).length, 0);
});
