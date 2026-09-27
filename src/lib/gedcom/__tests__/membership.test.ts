import assert from "node:assert/strict";
import { test } from "node:test";
import { produce } from "immer";
import { loadGedcom, saveGedcom, type FamilyTree } from "../index";
import {
  addChild,
  addSpouse,
  deleteIndividual,
  familyContents,
  newFamily,
  pedigreeOf,
  removeFromFamily,
  setPedigree,
} from "../membership";

function gedcom(body: string): string {
  return `0 HEAD\n1 GEDC\n2 VERS 5.5.1\n1 CHAR UTF-8\n${body.trim()}\n0 TRLR\n`;
}

function load(body: string): FamilyTree {
  return loadGedcom(gedcom(body)).tree;
}

/** Exported lines of one record, without its level-0 line. */
function lines(tree: FamilyTree, xref: string): string[] {
  const all = saveGedcom(tree).split("\r\n");
  const start = all.findIndex((l) => l.startsWith(`0 ${xref} `));
  if (start < 0) return [];
  const end = all.findIndex((l, i) => i > start && l.startsWith("0 "));
  return all.slice(start + 1, end);
}

// --- PEDI (a child's relationship to the family) ----------------------------

test("PEDI under FAMC is read as the child's pedigree in that family, and a change is exported", () => {
  const tree = load(`
0 @I1@ INDI
1 FAMC @F1@
2 PEDI adopted
2 NOTE raised by an aunt
1 FAMC @F2@
0 @F1@ FAM
1 CHIL @I1@
0 @F2@ FAM
1 CHIL @I1@`);
  assert.deepEqual(tree.individuals["@I1@"].pedigree, { "@F1@": "adopted" });

  const edited = produce(tree, (d) => {
    d.individuals["@I1@"].pedigree = { "@F1@": "foster", "@F2@": "birth" };
  });
  assert.deepEqual(lines(edited, "@I1@"), [
    "1 FAMC @F1@",
    "2 PEDI foster",
    "2 NOTE raised by an aunt",
    "1 FAMC @F2@",
    "2 PEDI birth",
  ]);
});

test("a PEDI with its own sub-records, or a second PEDI, stays verbatim", () => {
  const tree = load(`
0 @I1@ INDI
1 FAMC @F1@
2 PEDI OTHER
3 PHRASE Raised by grandparents
1 FAMC @F2@
2 PEDI birth
2 PEDI adopted`);
  // Neither is lifted: with two, which one is "the" relationship isn't clear.
  assert.equal(tree.individuals["@I1@"].pedigree, undefined);
  assert.deepEqual(pedigreeOf(tree.individuals["@I1@"], "@F2@"), { value: "birth", editable: false });
  assert.deepEqual(lines(tree, "@I1@"), [
    "1 FAMC @F1@",
    "2 PEDI OTHER",
    "3 PHRASE Raised by grandparents",
    "1 FAMC @F2@",
    "2 PEDI birth",
    "2 PEDI adopted",
  ]);
});

// --- Children ------------------------------------------------------------------

const SIBLINGS = `
0 @I1@ INDI
1 NAME Older /Child/
1 BIRT
2 DATE 1870
1 FAMC @F1@
0 @I2@ INDI
1 NAME Younger /Child/
1 BIRT
2 DATE ABT 1880
1 FAMC @F1@
0 @I3@ INDI
1 NAME Middle /Child/
1 BIRT
2 DATE 3 MAR 1875
0 @I4@ INDI
1 NAME Undated /Child/
0 @F1@ FAM
1 CHIL @I1@
1 CHIL @I2@`;

test("addChild links the child on both sides, placed among siblings by birth date", () => {
  const tree = produce(load(SIBLINGS), (d) => addChild(d, "@F1@", "@I3@"));
  assert.deepEqual(tree.families["@F1@"].children, ["@I1@", "@I3@", "@I2@"]);
  assert.deepEqual(tree.individuals["@I3@"].familyAsChild, ["@F1@"]);
});

test("a child whose birth date can't be placed goes last", () => {
  const tree = produce(load(SIBLINGS), (d) => addChild(d, "@F1@", "@I4@"));
  assert.deepEqual(tree.families["@F1@"].children, ["@I1@", "@I2@", "@I4@"]);
});

test("adding someone already in the family changes nothing", () => {
  const before = load(`${SIBLINGS}
1 HUSB @I3@`);
  const after = produce(before, (d) => {
    addChild(d, "@F1@", "@I1@");
    addChild(d, "@F1@", "@I3@");
  });
  assert.equal(after, before);
});

test("a link recorded on one side only is completed, not duplicated", () => {
  const tree = produce(
    load(`${SIBLINGS.replace("0 @I4@ INDI", "0 @I4@ INDI\n1 FAMC @F1@")}`),
    (d) => addChild(d, "@F1@", "@I4@"),
  );
  assert.deepEqual(tree.individuals["@I4@"].familyAsChild, ["@F1@"]);
  assert.deepEqual(tree.families["@F1@"].children, ["@I1@", "@I2@", "@I4@"]);
});

// --- Spouses -------------------------------------------------------------------

const COUPLES = `
0 @I1@ INDI
1 SEX M
0 @I2@ INDI
1 SEX F
0 @I3@ INDI
0 @I4@ INDI
1 SEX F
0 @F1@ FAM
1 HUSB @I1@
0 @F2@ FAM
0 @F3@ FAM
1 HUSB @I1@
1 WIFE @I2@`;

test("addSpouse fills whichever slot is empty, whatever the person's sex", () => {
  const tree = produce(load(COUPLES), (d) => addSpouse(d, "@F1@", "@I3@"));
  assert.equal(tree.families["@F1@"].wife, "@I3@");
  assert.deepEqual(tree.individuals["@I3@"].familyAsSpouse, ["@F1@"]);
});

test("in a family with no spouses, a woman goes in WIFE and anyone else in HUSB", () => {
  const woman = produce(load(COUPLES), (d) => addSpouse(d, "@F2@", "@I4@"));
  assert.equal(woman.families["@F2@"].wife, "@I4@");
  assert.equal(woman.families["@F2@"].husband, undefined);
  const unknown = produce(load(COUPLES), (d) => addSpouse(d, "@F2@", "@I3@"));
  assert.equal(unknown.families["@F2@"].husband, "@I3@");
});

test("addSpouse does nothing when both slots are taken or they're already in the family", () => {
  const before = load(COUPLES);
  const after = produce(before, (d) => {
    addSpouse(d, "@F3@", "@I3@");
    addSpouse(d, "@F1@", "@I1@");
  });
  assert.equal(after, before);
});

test("newFamily creates a family with the person, and their partner in the other slot", () => {
  let famId = "";
  const tree = produce(load(COUPLES), (d) => {
    famId = newFamily(d, "@I4@", "@I1@");
  });
  assert.equal(famId, "@F4@");
  const family = tree.families[famId];
  assert.equal(family.wife, "@I4@");
  assert.equal(family.husband, "@I1@");
  assert.deepEqual(tree.individuals["@I4@"].familyAsSpouse, [famId]);
  assert.deepEqual(tree.individuals["@I1@"].familyAsSpouse, [famId]);
  assert.deepEqual(lines(tree, famId), ["1 HUSB @I1@", "1 WIFE @I4@"]);
});

test("newFamily without a partner leaves the other slot empty", () => {
  let famId = "";
  const tree = produce(load(COUPLES), (d) => {
    famId = newFamily(d, "@I1@");
  });
  assert.equal(tree.families[famId].husband, "@I1@");
  assert.equal(tree.families[famId].wife, undefined);
});

// --- Removing -------------------------------------------------------------------

const LINKED = `
0 @I1@ INDI
1 FAMS @F1@
2 NOTE first marriage
0 @I2@ INDI
1 FAMS @F1@
0 @I3@ INDI
1 FAMC @F1@
2 PEDI adopted
2 NOTE raised by an aunt
1 FAMC @F2@
0 @F1@ FAM
1 HUSB @I1@
2 NOTE groom
1 WIFE @I2@
1 CHIL @I3@
2 _FREL Adopted
1 MARR
2 DATE 1900
0 @F2@ FAM
1 CHIL @I3@`;

test("removing a child unlinks both sides and drops that link's own sub-records", () => {
  const tree = produce(load(LINKED), (d) => removeFromFamily(d, "@F1@", "@I3@"));
  assert.deepEqual(lines(tree, "@I3@"), ["1 FAMC @F2@"]);
  assert.deepEqual(lines(tree, "@F1@"), ["1 HUSB @I1@", "2 NOTE groom", "1 WIFE @I2@", "1 MARR", "2 DATE 1900"]);
});

test("removing a spouse unlinks both sides and drops that link's own sub-records", () => {
  const tree = produce(load(LINKED), (d) => removeFromFamily(d, "@F1@", "@I1@"));
  assert.deepEqual(lines(tree, "@I1@"), []);
  assert.deepEqual(lines(tree, "@F1@").slice(0, 2), ["1 WIFE @I2@", "1 CHIL @I3@"]);
});

test("when the last member leaves, the family is deleted with them", () => {
  const tree = produce(load(LINKED), (d) => removeFromFamily(d, "@F2@", "@I3@"));
  assert.equal(tree.families["@F2@"], undefined);
  assert.deepEqual(tree.individuals["@I3@"].familyAsChild, ["@F1@"]);
});

test("a family someone still links to from their own side isn't deleted", () => {
  // @I4@ lists @F2@ as a spouse family, though @F2@ doesn't list them back.
  const tree = produce(load(`${LINKED}\n0 @I4@ INDI\n1 FAMS @F2@`), (d) => removeFromFamily(d, "@F2@", "@I3@"));
  assert.ok(tree.families["@F2@"]);
});

test("familyContents lists what deleting a family would take with it, for a warning", () => {
  const tree = load(`
0 @S1@ SOUR
0 @F1@ FAM
1 MARR
2 DATE 1900
2 SOUR @S1@
3 NOTE the register
4 SOUR @S1@
1 DIV
1 NOTE they parted
1 SOUR @S1@
1 _CUSTOM something
0 @F2@ FAM
1 CHAN
2 DATE 1 JAN 2020
1 _UID 1234
1 RIN 7`);
  assert.deepEqual(familyContents(tree, "@F1@"), [
    "Marriage 1900",
    "Divorce",
    "2 notes",
    "3 citations",
    "other details this app doesn't show yet",
  ]);
  // Bookkeeping alone (CHAN, _UID, RIN, ...) isn't worth a warning.
  assert.deepEqual(familyContents(tree, "@F2@"), []);
});

test("deleting a person unlinks them everywhere and deletes families they leave empty", () => {
  // @F3@ lists @I3@ as a child, though @I3@ doesn't list it back.
  const tree = produce(load(`${LINKED}\n0 @F3@ FAM\n1 CHIL @I3@`), (d) => deleteIndividual(d, "@I3@"));
  assert.equal(tree.individuals["@I3@"], undefined);
  assert.deepEqual(tree.families["@F1@"].children, []);
  assert.equal(tree.families["@F1@"].memberExtra?.["@I3@"], undefined);
  assert.equal(tree.families["@F2@"], undefined);
  assert.equal(tree.families["@F3@"], undefined);
});

// --- Editing PEDI ---------------------------------------------------------------

test("setPedigree sets or clears a child's relationship to one family", () => {
  const tree = load(LINKED);
  const set = produce(tree, (d) => setPedigree(d, "@I3@", "@F2@", "foster"));
  assert.deepEqual(pedigreeOf(set.individuals["@I3@"], "@F2@"), { value: "foster", editable: true });
  assert.equal(produce(set, (d) => setPedigree(d, "@I3@", "@F2@", "foster")), set);
  const cleared = produce(set, (d) => setPedigree(d, "@I3@", "@F1@", undefined));
  assert.deepEqual(lines(cleared, "@I3@"), ["1 FAMC @F1@", "2 NOTE raised by an aunt", "1 FAMC @F2@", "2 PEDI foster"]);
});

test("a PEDI kept verbatim is shown but can't be changed, so it's never written twice", () => {
  const tree = load(`
0 @I1@ INDI
1 FAMC @F1@
2 PEDI OTHER
3 PHRASE Raised by grandparents
0 @F1@ FAM
1 CHIL @I1@`);
  assert.deepEqual(pedigreeOf(tree.individuals["@I1@"], "@F1@"), { value: "OTHER", editable: false });
  assert.equal(produce(tree, (d) => setPedigree(d, "@I1@", "@F1@", "birth")), tree);
});
