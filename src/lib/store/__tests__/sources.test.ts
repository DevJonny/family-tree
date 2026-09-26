import assert from "node:assert/strict";
import { test } from "node:test";
import { useFamilyTreeStore } from "../familyTreeStore";

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
