import assert from "node:assert/strict";
import { test } from "node:test";
import { useFamilyTreeStore } from "../familyTreeStore";
import { buildFamilyTree } from "../../gedcom/model";
import { loadGedcom } from "../../gedcom";

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

test("updateIndividual applies an arbitrary recipe and records one undoable edit", () => {
  reset();
  const id = useFamilyTreeStore.getState().addIndividual({ given: "Ada", surname: "Lovelace" });

  useFamilyTreeStore.getState().updateIndividual(
    id,
    (draft) => {
      draft.sex = "F";
      draft.birth = { tag: "BIRT", date: "10 DEC 1815", place: "London" };
      draft.events.push({ tag: "OCCU", value: "Mathematician" });
      draft.notes.push({ text: "Wrote the first algorithm.", citations: [] });
    },
    "Fill in details",
  );

  const indi = useFamilyTreeStore.getState().tree.individuals[id];
  assert.equal(indi.sex, "F");
  assert.equal(indi.birth?.place, "London");
  assert.equal(indi.events[0].value, "Mathematician");
  assert.deepEqual(indi.notes[0], { text: "Wrote the first algorithm.", citations: [] });

  // One recipe call = one undo step, however many fields it touched.
  const state = useFamilyTreeStore.getState();
  assert.equal(state.history.undoStack.at(-1)?.label, "Fill in details");
  useFamilyTreeStore.getState().undo();
  assert.equal(useFamilyTreeStore.getState().tree.individuals[id].sex, undefined);
});

test("updateIndividual is a safe no-op for an id that doesn't exist", () => {
  reset();
  useFamilyTreeStore.getState().updateIndividual("@I999@", (draft) => {
    draft.sex = "F";
  });
  assert.equal(useFamilyTreeStore.getState().canUndo, false);
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

test("updateIndividualName rebuilds the exported NAME value instead of writing back the imported one", () => {
  useFamilyTreeStore.getState().loadFromGedcomText(
    "0 HEAD\n0 @I1@ INDI\n1 NAME George /Harlow/ Jr.\n2 GIVN George\n2 NSFX Jr.\n0 TRLR\n",
    "t.ged",
  );
  useFamilyTreeStore.getState().updateIndividualName("@I1@", 0, { given: "Georgie" });
  const exported = useFamilyTreeStore.getState().exportToGedcomText();
  assert.match(exported, /1 NAME Georgie \/Harlow\/ Jr\./);
  assert.doesNotMatch(exported, /1 NAME George /);
});

test("removeIndividual drops their CHIL sub-records so a reused id can't inherit them", () => {
  useFamilyTreeStore.getState().loadFromGedcomText(
    "0 HEAD\n0 @I1@ INDI\n1 FAMC @F1@\n0 @F1@ FAM\n1 CHIL @I1@\n2 _FREL Adopted\n0 TRLR\n",
    "t.ged",
  );
  useFamilyTreeStore.getState().removeIndividual("@I1@");
  assert.deepEqual(useFamilyTreeStore.getState().tree.families["@F1@"].memberExtra, {});
});

test("dirty means changed since the last load or save, and undoing back to it counts as saved", () => {
  reset();
  const store = useFamilyTreeStore.getState;
  assert.equal(store().dirty, false, "a freshly loaded tree is saved");

  store().addIndividual({ given: "Ada" });
  assert.equal(store().dirty, true);
  store().undo();
  assert.equal(store().dirty, false, "back at the loaded state");

  store().addIndividual({ given: "Ada" });
  store().markSaved();
  assert.equal(store().dirty, false, "exported or synced");
  store().addIndividual({ given: "Byron" });
  assert.equal(store().dirty, true);
  store().undo();
  assert.equal(store().dirty, false, "back at the saved state");
  store().undo();
  assert.equal(store().dirty, true, "before the save is unsaved too");
});

test("markSaved(tree) for a tree that has since changed leaves the newer edits unsaved", () => {
  reset();
  const store = useFamilyTreeStore.getState;
  store().addIndividual({ given: "Ada" });
  const uploaded = store().tree; // a sync starts with this tree...
  store().addIndividual({ given: "Byron" }); // ...and the user edits during the upload
  store().markSaved(uploaded);
  assert.equal(store().dirty, true);
});

test("loadTree can load a tree that isn't saved anywhere, like restored unsaved work", () => {
  reset();
  const { tree } = loadGedcom("0 HEAD\n0 @I1@ INDI\n1 NAME Ada /Lovelace/\n0 TRLR\n");
  useFamilyTreeStore.getState().loadTree(tree, "restored.ged", [], { saved: false });
  assert.equal(useFamilyTreeStore.getState().dirty, true);
  assert.equal(useFamilyTreeStore.getState().canUndo, false);
});

test("updateFamily applies a recipe to one family as one labelled, undoable edit", () => {
  reset();
  const childId = useFamilyTreeStore.getState().addIndividual();
  useFamilyTreeStore.getState().addParent(childId, "father");
  const famId = useFamilyTreeStore.getState().tree.individuals[childId].familyAsChild[0];

  useFamilyTreeStore.getState().updateFamily(
    famId,
    (draft) => {
      draft.marriage = { tag: "MARR", date: "1 JUN 1900" };
      draft.events.push({ tag: "DIV", date: "1910" });
    },
    "Edit marriage",
  );

  const state = useFamilyTreeStore.getState();
  assert.equal(state.tree.families[famId].marriage?.date, "1 JUN 1900");
  assert.equal(state.tree.families[famId].events[0].tag, "DIV");
  assert.equal(state.history.undoStack.at(-1)?.label, "Edit marriage");

  state.undo();
  assert.equal(useFamilyTreeStore.getState().tree.families[famId].marriage, undefined);
  assert.deepEqual(useFamilyTreeStore.getState().tree.families[famId].events, []);
});

test("updateFamily is a safe no-op for an id that doesn't exist", () => {
  reset();
  useFamilyTreeStore.getState().updateFamily("@F999@", (draft) => {
    draft.events.push({ tag: "DIV" });
  });
  assert.deepEqual(useFamilyTreeStore.getState().tree.families, {});
  assert.equal(useFamilyTreeStore.getState().canUndo, false);
});
