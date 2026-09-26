import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { produce } from "immer";
import {
  citationCounts,
  citationUsage,
  deleteRepository,
  deleteSource,
  loadGedcom,
  repositoryAddress,
  repositoryUsage,
  saveGedcom,
  walkTree,
} from "../index";

function gedcom(...lines: string[]): string {
  return ["0 HEAD", "1 CHAR UTF-8", ...lines, "0 TRLR", ""].join("\n");
}

/** One person citing @S1@ from every kind of place a citation can live, plus a family and records. */
const EVERYWHERE = gedcom(
  "0 @I1@ INDI",
  "1 NAME Robert /Williams/",
  "2 SOUR @S1@",
  "1 BIRT",
  "2 SOUR @S1@",
  "3 PAGE p. 4",
  "2 NOTE Born at home.",
  "3 SOUR @S1@",
  "1 CENS",
  "2 SOUR @S1@",
  "3 NOTE Cited within a citation's note.",
  "4 SOUR @S1@",
  "2 SOUR @S2@",
  "1 NOTE A person note.",
  "2 SOUR @S1@",
  "1 SOUR @S1@",
  "0 @I2@ INDI",
  "1 NAME Mary Ann /Wilson/",
  "1 DEAT",
  "2 SOUR @S2@",
  "0 @I3@ INDI",
  "1 NAME /Adams/",
  "0 @F1@ FAM",
  "1 HUSB @I1@",
  "1 WIFE @I2@",
  "1 MARR",
  "2 SOUR @S1@",
  "1 SOUR @S1@",
  "0 @F2@ FAM",
  "1 WIFE @I3@",
  "1 SOUR @S1@",
  "0 @S1@ SOUR",
  "1 TITL Parish register",
  "1 REPO @R1@",
  "2 CALN A/1",
  "0 @S2@ SOUR",
  "1 TITL Census",
  "1 NOTE Compare with the register.",
  "2 SOUR @S1@",
  "1 REPO @R1@",
  "1 REPO @R2@",
  "0 @R1@ REPO",
  "1 NAME Archive",
  "0 @R2@ REPO",
  "1 NAME Library",
  "0 @N1@ NOTE Shared research.",
  "1 SOUR @S1@",
);

test("walkTree says where each citation hangs, inherited by the notes and citations nested under it", () => {
  const { tree } = loadGedcom(EVERYWHERE);
  const seen: string[] = [];
  walkTree(tree, { citation: (c, owner, where) => c.sourceId === "@S1@" && seen.push(`${owner} ${where}`) });

  assert.deepEqual(seen, [
    "@I1@ Name",
    "@I1@ Birth",
    "@I1@ Birth",
    "@I1@ Census",
    "@I1@ Census",
    "@I1@ Note",
    "@I1@ Person",
    "@F1@ Marriage",
    "@F1@ Family",
    "@F2@ Family",
    "@S2@ Note",
    "@N1@ Note",
  ]);
});

test("citationUsage groups a source's citations by record, with a label and the distinct places cited", () => {
  const { tree } = loadGedcom(EVERYWHERE);
  const usage = citationUsage(tree, "@S1@");

  assert.equal(usage.total, 12);
  assert.equal(usage.unmodelled, 0);
  assert.deepEqual(usage.owners, [
    {
      ownerId: "@I1@",
      kind: "person",
      label: "Robert Williams",
      count: 7,
      where: ["Name", "Birth", "Census", "Note", "Person"],
    },
    {
      ownerId: "@F2@",
      kind: "family",
      label: "Adams (family)",
      count: 1,
      where: ["Family"],
    },
    {
      ownerId: "@F1@",
      kind: "family",
      label: "Robert Williams & Mary Ann Wilson (family)",
      count: 2,
      where: ["Marriage", "Family"],
    },
    { ownerId: "@S2@", kind: "source", label: "Census", count: 1, where: ["Note"] },
    { ownerId: "@N1@", kind: "note", label: "Shared research.", count: 1, where: ["Note"] },
  ]);
  assert.equal(usage.people, 1, "people counts only individuals, for the delete warning");
});

test("citationUsage of an unused or missing source is empty", () => {
  const { tree } = loadGedcom(EVERYWHERE);
  assert.deepEqual(citationUsage(tree, "@S9@"), { total: 0, people: 0, owners: [], unmodelled: 0 });
});

test("citationCounts gives every source's citation total in one pass, including dangling ids", () => {
  const { tree } = loadGedcom(EVERYWHERE + "");
  assert.deepEqual(citationCounts(tree), { "@S1@": 12, "@S2@": 2 });
});

test("citationUsage counts references the model can't edit, from unmodelled records and verbatim sub-records", () => {
  const { tree } = loadGedcom(
    gedcom(
      "0 @I1@ INDI",
      "1 BIRT",
      "2 SOUR @S1@",
      "1 _MILT",
      "2 _SRC @S1@",
      "1 ASSO @I2@",
      "2 SOUR @S1@",
      "0 @S1@ SOUR",
      "0 @U1@ SUBM",
      "1 NOTE Submitter",
      "2 SOUR @S1@",
      "0 @M1@ OBJE",
      "1 SOUR @S1@",
    ),
  );
  const usage = citationUsage(tree, "@S1@");
  assert.equal(usage.total, 1);
  assert.equal(usage.unmodelled, 4);
});

test("deleteSource removes the source and every citation of it, however deeply nested, as one recipe", () => {
  const { tree } = loadGedcom(EVERYWHERE);
  const next = produce(tree, (d) => deleteSource(d, "@S1@"));

  assert.equal(next.sources["@S1@"], undefined);
  assert.deepEqual(citationUsage(next, "@S1@").owners, []);
  assert.deepEqual(citationCounts(next), { "@S2@": 2 }, "other sources' citations are untouched");
  assert.doesNotMatch(saveGedcom(next), /@S1@/);
  // A note a removed citation sat under stays; a note inside a removed citation goes with it.
  assert.match(saveGedcom(next), /Born at home\./);
  assert.doesNotMatch(saveGedcom(next), /Cited within a citation's note\./);
});

test("deleteSource leaves references it can't edit alone", () => {
  const { tree } = loadGedcom(
    gedcom("0 @I1@ INDI", "1 BIRT", "2 SOUR @S1@", "1 _MILT", "2 _SRC @S1@", "0 @S1@ SOUR", "0 @M1@ OBJE", "1 SOUR @S1@"),
  );
  const next = produce(tree, (d) => deleteSource(d, "@S1@"));
  const out = saveGedcom(next);

  assert.equal(next.sources["@S1@"], undefined);
  assert.equal(next.individuals["@I1@"].birth?.citations?.length ?? 0, 0);
  assert.match(out, /2 _SRC @S1@/);
  assert.match(out, /1 SOUR @S1@/);
});

test("repositoryUsage lists the sources that hold a repository, and deleteRepository removes those refs", () => {
  const { tree } = loadGedcom(EVERYWHERE);
  assert.deepEqual(repositoryUsage(tree, "@R1@"), { sourceIds: ["@S1@", "@S2@"], unmodelled: 0 });
  assert.deepEqual(repositoryUsage(tree, "@R2@"), { sourceIds: ["@S2@"], unmodelled: 0 });

  const next = produce(tree, (d) => deleteRepository(d, "@R1@"));
  assert.equal(next.repositories["@R1@"], undefined);
  assert.deepEqual(next.sources["@S1@"].repositories, []);
  assert.deepEqual(
    next.sources["@S2@"].repositories.map((r) => r.repoId),
    ["@R2@"],
  );
  assert.doesNotMatch(saveGedcom(next), /@R1@/);
});

test("repositoryUsage counts unmodelled references to a repository", () => {
  const { tree } = loadGedcom(
    gedcom("0 @S1@ SOUR", "1 REPO @R1@", "0 @R1@ REPO", "0 @X1@ _PLAC", "1 REPO @R1@"),
  );
  assert.deepEqual(repositoryUsage(tree, "@R1@"), { sourceIds: ["@S1@"], unmodelled: 1 });
});

test("repositoryAddress flattens the verbatim ADDR structure to one read-only line", () => {
  const { tree } = loadGedcom(
    gedcom(
      "0 @R1@ REPO",
      "1 NAME Family History Library",
      "1 ADDR",
      "2 ADR1 35 N West Temple Street",
      "2 CITY Salt Lake City",
      "2 STAE Utah",
      "2 POST 84150",
      "2 CTRY United States of America",
      "0 @R2@ REPO",
      "1 ADDR The Old Rectory",
      "2 CONT Llanfair",
      "2 CITY Llanfair",
      "0 @R3@ REPO",
      "1 NAME No address",
    ),
  );
  assert.equal(
    repositoryAddress(tree.repositories["@R1@"]),
    "35 N West Temple Street, Salt Lake City, Utah, 84150, United States of America",
  );
  assert.equal(repositoryAddress(tree.repositories["@R2@"]), "The Old Rectory, Llanfair", "no repeated parts");
  assert.equal(repositoryAddress(tree.repositories["@R3@"]), undefined);
});

test("the extended fixture: @S9@ is unused, @S99@ is dangling, and deleting @S2@ undoes to a byte-identical export", () => {
  const { tree } = loadGedcom(readFileSync("data/sample-extended.ged", "utf8"));
  assert.equal(citationUsage(tree, "@S9@").total, 0);
  assert.equal(citationCounts(tree)["@S99@"], 1);
  assert.ok(citationUsage(tree, "@S2@").people > 1);

  const before = saveGedcom(tree);
  const next = produce(tree, (d) => deleteSource(d, "@S2@"));
  assert.doesNotMatch(saveGedcom(next), /@S2@/);
  assert.equal(saveGedcom(tree), before, "the recipe didn't touch the original");
});
