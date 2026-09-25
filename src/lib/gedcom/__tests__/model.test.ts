import assert from "node:assert/strict";
import { test } from "node:test";
import { loadGedcom, saveGedcom } from "../index";

const SAMPLE = `0 HEAD
1 SOUR family-tree-app
1 GEDC
2 VERS 5.5.1
2 FORM LINEAGE-LINKED
1 CHAR UTF-8
0 @I1@ INDI
1 NAME John /Smith/
2 GIVN John
2 SURN Smith
1 SEX M
1 BIRT
2 DATE 4 JUL 1950
2 PLAC Springfield
1 OCCU Farmer
1 _UID ABCD-1234-EFGH
1 FAMS @F1@
0 @I2@ INDI
1 NAME Jane /Doe/
1 SEX F
1 FAMS @F1@
0 @I3@ INDI
1 NAME Junior /Smith/
1 FAMC @F1@
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 CHIL @I3@
1 MARR
2 DATE 1 JAN 1975
0 TRLR
`;

test("builds a normalized model with correct relationships", () => {
  const { tree, warnings } = loadGedcom(SAMPLE);
  assert.equal(warnings.length, 0);

  const john = tree.individuals["@I1@"];
  assert.equal(john.names[0].given, "John");
  assert.equal(john.names[0].surname, "Smith");
  assert.equal(john.sex, "M");
  assert.equal(john.birth?.date, "4 JUL 1950");
  assert.equal(john.birth?.place, "Springfield");
  assert.equal(john.familyAsSpouse[0], "@F1@");

  // OCCU has no typed field, so it should surface as a generic event...
  const occu = john.events.find((e) => e.tag === "OCCU");
  assert.equal(occu?.value, "Farmer");

  // ...while the vendor _UID tag is preserved verbatim, not guessed at.
  assert.equal(john.extra.some((n) => n.tag === "_UID"), true);

  const fam = tree.families["@F1@"];
  assert.equal(fam.husband, "@I1@");
  assert.equal(fam.wife, "@I2@");
  assert.deepEqual(fam.children, ["@I3@"]);
  assert.equal(fam.marriage?.date, "1 JAN 1975");

  const junior = tree.individuals["@I3@"];
  assert.deepEqual(junior.familyAsChild, ["@F1@"]);
});

test("model -> GEDCOM -> model roundtrip preserves data, including unmodeled tags", () => {
  const first = loadGedcom(SAMPLE);
  const text = saveGedcom(first.tree);
  const second = loadGedcom(text);

  assert.equal(second.warnings.length, 0);
  assert.deepEqual(second.tree.individuals["@I1@"], first.tree.individuals["@I1@"]);
  assert.deepEqual(second.tree.families["@F1@"], first.tree.families["@F1@"]);
});
