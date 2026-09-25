import assert from "node:assert/strict";
import { test } from "node:test";
import { loadGedcom } from "../index";
import { buildAncestorTree, getChildren, getParents, getSpouses } from "../relationships";

// Three generations: grandparents I4/I5 -> parents I1(their child)/I2 -> child I3.
const SAMPLE = `0 HEAD
1 CHAR UTF-8
0 @I4@ INDI
1 NAME Grandpa /Smith/
1 FAMS @F2@
0 @I5@ INDI
1 NAME Grandma /Jones/
1 FAMS @F2@
0 @I1@ INDI
1 NAME John /Smith/
1 FAMC @F2@
1 FAMS @F1@
0 @I2@ INDI
1 NAME Jane /Doe/
1 FAMS @F1@
0 @I3@ INDI
1 NAME Junior /Smith/
1 FAMC @F1@
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 CHIL @I3@
0 @F2@ FAM
1 HUSB @I4@
1 WIFE @I5@
1 CHIL @I1@
0 TRLR
`;

test("getParents resolves father and mother via the first FAMC", () => {
  const { tree } = loadGedcom(SAMPLE);
  const { father, mother } = getParents(tree, "@I1@");
  assert.equal(father?.id, "@I4@");
  assert.equal(mother?.id, "@I5@");
});

test("getParents returns an empty object for a person with no FAMC", () => {
  const { tree } = loadGedcom(SAMPLE);
  assert.deepEqual(getParents(tree, "@I4@"), {});
});

test("getChildren collects children across all FAMS", () => {
  const { tree } = loadGedcom(SAMPLE);
  const children = getChildren(tree, "@I1@");
  assert.deepEqual(children.map((c) => c.id), ["@I3@"]);
});

test("getSpouses returns the other parent in each shared family", () => {
  const { tree } = loadGedcom(SAMPLE);
  assert.deepEqual(getSpouses(tree, "@I1@").map((s) => s.id), ["@I2@"]);
  assert.deepEqual(getSpouses(tree, "@I2@").map((s) => s.id), ["@I1@"]);
});

test("buildAncestorTree walks back the requested number of generations", () => {
  const { tree } = loadGedcom(SAMPLE);
  const pedigree = buildAncestorTree(tree, "@I3@", 3);

  assert.equal(pedigree?.individual?.id, "@I3@");
  assert.equal(pedigree?.father?.individual?.id, "@I1@");
  assert.equal(pedigree?.mother?.individual?.id, "@I2@");
  assert.equal(pedigree?.father?.father?.individual?.id, "@I4@");
  assert.equal(pedigree?.father?.mother?.individual?.id, "@I5@");
  // I2 has no known parents in this sample, so both branches are null rather than throwing.
  assert.equal(pedigree?.mother?.father, null);
  assert.equal(pedigree?.mother?.mother, null);
});

test("buildAncestorTree stops at maxGenerations even if more ancestors exist", () => {
  const { tree } = loadGedcom(SAMPLE);
  const pedigree = buildAncestorTree(tree, "@I3@", 1);
  assert.equal(pedigree?.individual?.id, "@I3@");
  assert.equal(pedigree?.father, null);
  assert.equal(pedigree?.mother, null);
});

test("buildAncestorTree returns null for an unknown individual id", () => {
  const { tree } = loadGedcom(SAMPLE);
  assert.equal(buildAncestorTree(tree, "@I999@", 3), null);
});
