import assert from "node:assert/strict";
import { test } from "node:test";
import { useFamilyTreeStore } from "../familyTreeStore";
import { isNoteLink, newSource, nextFreeId, privateCopyOf, promoteToSource } from "../../gedcom";

const store = () => useFamilyTreeStore.getState();

function load(...lines: string[]) {
  store().loadFromGedcomText(["0 HEAD", "1 CHAR UTF-8", ...lines, "0 TRLR", ""].join("\n"), "test.ged");
}

test("adding and editing citations on facts exports them in place, and undo takes them back out", () => {
  load(
    "0 @I1@ INDI",
    "1 BIRT",
    "2 DATE 1822",
    "1 DEAT",
    "2 SOUR @S1@",
    "3 PAGE old page",
    "0 @S1@ SOUR",
    "1 TITL Parish register",
  );

  store().updateIndividual(
    "@I1@",
    (d) => {
      d.birth!.citations = [{ sourceId: "@S1@", page: "Baptisms 1822, entry 9", quality: 3, notes: [] }];
      d.death!.citations![0].page = "Burials 1905, entry 2";
    },
    "Cite parish register",
  );

  const out = store().exportToGedcomText();
  assert.match(out, /1 BIRT\r\n2 DATE 1822\r\n2 SOUR @S1@\r\n3 PAGE Baptisms 1822, entry 9\r\n3 QUAY 3\r\n/);
  assert.match(out, /1 DEAT\r\n2 SOUR @S1@\r\n3 PAGE Burials 1905, entry 2\r\n/);
  assert.doesNotMatch(out, /old page/);

  store().undo();
  const undone = store().exportToGedcomText();
  assert.match(undone, /1 BIRT\r\n2 DATE 1822\r\n1 DEAT\r\n2 SOUR @S1@\r\n3 PAGE old page\r\n/);
});

test("updateTree edits tree-wide records as one labelled, undoable step", () => {
  load("0 @S1@ SOUR", "1 TITL Parish register", "0 @N1@ NOTE Old shared text.");

  store().updateTree((d) => {
    d.sources["@S1@"].title = "Parish register of St Mary";
    d.notes["@N1@"].text = "New shared text.";
  }, "Edit source");

  assert.equal(store().tree.sources["@S1@"].title, "Parish register of St Mary");
  assert.equal(store().tree.notes["@N1@"].text, "New shared text.");
  assert.equal(store().history.undoStack.at(-1)?.label, "Edit source");

  store().undo();
  assert.equal(store().tree.sources["@S1@"].title, "Parish register");
  assert.equal(store().tree.notes["@N1@"].text, "Old shared text.");
});

test("a private copy of a shared note replaces the link with an independent inline note", () => {
  load(
    "0 @I1@ INDI",
    "1 NOTE @N1@",
    "0 @I2@ INDI",
    "1 NOTE @N1@",
    "0 @N1@ NOTE Shared research.",
    "1 SOUR @S1@",
    "2 PAGE p. 1",
    "1 RIN 7",
    "0 @S1@ SOUR",
  );

  store().updateIndividual(
    "@I1@",
    (d) => void (d.notes[0] = privateCopyOf(store().tree.notes["@N1@"])),
    "Make private copy of note",
  );
  store().updateIndividual(
    "@I1@",
    (d) => {
      const note = d.notes[0];
      if (!isNoteLink(note)) note.text = "Reworded for Robert only.";
    },
    "Edit note",
  );

  assert.equal(store().tree.notes["@N1@"].text, "Shared research.", "the shared record is untouched");
  assert.deepEqual(store().tree.individuals["@I2@"].notes, [{ noteId: "@N1@" }], "other links are untouched");

  const out = store().exportToGedcomText();
  // RIN is the shared record's own bookkeeping, so it stays there.
  assert.match(out, /0 @I1@ INDI\r\n1 NOTE Reworded for Robert only.\r\n2 SOUR @S1@\r\n3 PAGE p. 1\r\n0 @I2@/);
  assert.match(out, /0 @N1@ NOTE Shared research.\r\n1 SOUR @S1@\r\n2 PAGE p. 1\r\n1 RIN 7\r\n/);

  store().undo();
  store().undo();
  assert.deepEqual(store().tree.individuals["@I1@"].notes, [{ noteId: "@N1@" }]);
});

test("citing a brand-new source creates the source and the citation as one undo step", () => {
  load("0 @I1@ INDI", "1 BIRT", "0 @S1@ SOUR", "1 TITL Existing");
  const before = store().history.undoStack.length;

  const id = nextFreeId(store().tree, "S");
  store().updateTree((d) => {
    d.sources[id] = newSource(id, "Williams Family Bible");
    d.individuals["@I1@"].birth!.citations = [{ sourceId: id, notes: [] }];
  }, "Cite new source");

  assert.equal(id, "@S2@");
  assert.equal(store().tree.sources["@S2@"].title, "Williams Family Bible");
  assert.match(store().exportToGedcomText(), /0 @S2@ SOUR\r\n1 TITL Williams Family Bible\r\n/);
  assert.equal(store().history.undoStack.length, before + 1);

  store().undo();
  assert.equal(store().tree.sources["@S2@"], undefined);
  assert.equal(store().tree.individuals["@I1@"].birth!.citations, undefined);
});

test("an unpointed citation can be made into a source; a dangling one can have its source created", () => {
  load(
    "0 @I1@ INDI",
    "1 BIRT",
    "2 SOUR Recollection of Hannah Pryce",
    "3 NOTE As told to her grandson.",
    "1 DEAT",
    "2 SOUR @S99@",
    "3 PAGE Burials 1825",
  );

  const id = nextFreeId(store().tree, "S");
  store().updateTree((d) => {
    d.sources[id] = promoteToSource(d.individuals["@I1@"].birth!.citations![0], id);
  }, "Make citation into source");

  const birthCitation = store().tree.individuals["@I1@"].birth!.citations![0];
  assert.equal(birthCitation.sourceId, id);
  assert.equal(birthCitation.description, undefined);
  assert.deepEqual(birthCitation.notes, [{ text: "As told to her grandson.", citations: [] }], "the citation keeps its notes");
  assert.equal(store().tree.sources[id].title, "Recollection of Hannah Pryce");

  store().updateTree((d) => void (d.sources["@S99@"] = newSource("@S99@")), "Create missing source");
  assert.deepEqual(store().tree.sources["@S99@"], { id: "@S99@", repositories: [], notes: [] });
  assert.match(store().exportToGedcomText(), /0 @S99@ SOUR\r\n/);

  store().undo();
  store().undo();
  assert.equal(store().tree.individuals["@I1@"].birth!.citations![0].description, "Recollection of Hannah Pryce");
});
