import assert from "node:assert/strict";
import { test } from "node:test";
import { produce } from "immer";
import { loadGedcom, saveGedcom } from "../index";
import { addPerson, exactPersonMatches, lifeSpan, nameFromTyped, searchPeople } from "../people";

const TREE = loadGedcom(`0 HEAD
0 @I1@ INDI
1 NAME Ann /Smith/
1 BIRT
2 DATE 1872
1 DEAT
2 DATE ABT 1950
0 @I2@ INDI
1 NAME Anna /Smithers/
1 BIRT
2 DATE 4 MAR 1901
0 @I3@ INDI
1 NAME Mary /Jones/
1 NAME Mary /Smith/
2 TYPE married
1 DEAT
2 DATE 1930
0 @I4@ INDI
1 NAME John /Brown/
0 TRLR
`).tree;

test("a typed name's last word is the surname and the rest the given names", () => {
  assert.deepEqual(nameFromTyped("  Ann  Mary Smith "), { given: "Ann Mary", surname: "Smith" });
  assert.deepEqual(nameFromTyped("Ann"), { given: "Ann" });
});

test("searchPeople matches every typed word against any of a person's names, sorted by name", () => {
  const ids = (q: string, exclude: string[] = []) => searchPeople(TREE, q, new Set(exclude)).map((p) => p.id);
  assert.deepEqual(ids("ann smi"), ["@I1@", "@I2@"]);
  assert.deepEqual(ids("smith"), ["@I1@", "@I2@", "@I3@"]); // Mary by her married name
  assert.deepEqual(ids("SMITH mary"), ["@I3@"]);
  assert.deepEqual(ids("smith", ["@I1@", "@I3@"]), ["@I2@"]);
  assert.deepEqual(ids(""), ["@I1@", "@I2@", "@I4@", "@I3@"]);
});

test("lifeSpan gives the years a person lived, as far as they're known", () => {
  assert.equal(lifeSpan(TREE.individuals["@I1@"]), "1872–1950");
  assert.equal(lifeSpan(TREE.individuals["@I2@"]), "b. 1901");
  assert.equal(lifeSpan(TREE.individuals["@I3@"]), "d. 1930");
  assert.equal(lifeSpan(TREE.individuals["@I4@"]), "");
});

test("exactPersonMatches finds everyone whose whole name is what was typed", () => {
  const all = searchPeople(TREE, "", new Set());
  assert.deepEqual(exactPersonMatches(all, " ann SMITH ").map((p) => p.id), ["@I1@"]);
  assert.deepEqual(exactPersonMatches(all, "Ann Smi"), []);
  const twins = loadGedcom("0 HEAD\n0 @I1@ INDI\n1 NAME Tom /Lee/\n0 @I2@ INDI\n1 NAME Tom /Lee/\n0 TRLR\n").tree;
  assert.equal(exactPersonMatches(searchPeople(twins, "", new Set()), "Tom Lee").length, 2);
});

test("addPerson creates a person with the next free id, inside a recipe", () => {
  let id = "";
  const tree = produce(TREE, (d) => {
    id = addPerson(d, { given: "Ann Mary", surname: "Smith" });
  });
  assert.equal(id, "@I5@");
  assert.ok(saveGedcom(tree).includes("0 @I5@ INDI\r\n1 NAME Ann Mary /Smith/\r\n"));
});
