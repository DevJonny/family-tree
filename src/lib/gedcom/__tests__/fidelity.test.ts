import assert from "node:assert/strict";
import { test } from "node:test";
import { applyNamePatch, loadGedcom, saveGedcom } from "../index";
import { parseGedcom } from "../parse";
import { serializeGedcom } from "../serialize";

/**
 * One focused test per data-loss bug found by fixtures.test.ts, so a
 * regression names the exact cause rather than just "the fixture diff".
 */

function gedcom(body: string): string {
  return `0 HEAD\n1 GEDC\n2 VERS 5.5.1\n1 CHAR UTF-8\n${body.trim()}\n0 TRLR\n`;
}

/** Exported INDI/FAM lines for one record, without the level-0 line. */
function exportedLines(text: string, xref: string): string[] {
  const lines = saveGedcom(loadGedcom(text).tree).split("\r\n");
  const start = lines.findIndex((l) => l.startsWith(`0 ${xref} `));
  const end = lines.findIndex((l, i) => i > start && l.startsWith("0 "));
  return lines.slice(start + 1, end);
}

// --- CONC wrapping -----------------------------------------------------------

test("CONC wrapping never splits at a space, so no space is lost on re-import", () => {
  // Character 200 (the default split point) is a space.
  const value = `${"a".repeat(199)} ${"b".repeat(150)}`;
  const text = serializeGedcom([{ level: 0, xref: "@N1@", tag: "NOTE", value, children: [] }]);

  for (const line of text.split("\r\n").filter(Boolean)) {
    assert.doesNotMatch(line, /\s$/, `line ends with a space: ${JSON.stringify(line)}`);
    assert.doesNotMatch(line, /^\d+ CONC \s/, `CONC starts with a space: ${JSON.stringify(line)}`);
  }
  assert.equal(parseGedcom(text).roots[0].value, value);
});

test("CONC wrapping never splits a surrogate pair", () => {
  // The emoji's two UTF-16 halves sit at indices 199-200, straddling the limit.
  const value = `${"a".repeat(199)}😀${"b".repeat(150)}`;
  const text = serializeGedcom([{ level: 0, xref: "@N1@", tag: "NOTE", value, children: [] }]);
  assert.equal(parseGedcom(text).roots[0].value, value);
});

test("parser keeps a trailing space when the next line CONCatenates onto it", () => {
  // How some other exporters split: after the space, not before it.
  const { roots } = parseGedcom("0 @N1@ NOTE grown to \n1 CONC 22 people\n0 @N2@ NOTE plain trailing space   \n");
  assert.equal(roots[0].value, "grown to 22 people");
  assert.equal(roots[1].value, "plain trailing space");
});

// --- Names ---------------------------------------------------------------

test("a NAME value with a suffix is written back exactly as imported", () => {
  const text = gedcom(`
0 @I1@ INDI
1 NAME George /Harlow/ Jr.
2 GIVN George
2 SURN Harlow
2 NSFX Jr.`);
  assert.deepEqual(exportedLines(text, "@I1@"), [
    "1 NAME George /Harlow/ Jr.",
    "2 GIVN George",
    "2 SURN Harlow",
    "2 NSFX Jr.",
  ]);
});

test("name parts derived from the NAME value are editable but not added as new lines", () => {
  const text = gedcom(`
0 @I1@ INDI
1 NAME Hannah /Williams/
2 TYPE married`);
  const name = loadGedcom(text).tree.individuals["@I1@"].names[0];
  assert.equal(name.given, "Hannah");
  assert.equal(name.surname, "Williams");
  assert.deepEqual(exportedLines(text, "@I1@"), ["1 NAME Hannah /Williams/", "2 TYPE married"]);
});

test("name sub-records we don't model (citations, SPFX, vendor tags) survive", () => {
  const text = gedcom(`
0 @I1@ INDI
1 NAME Jan /de Vries/
2 GIVN Jan
2 SPFX de
2 SURN Vries
2 SOUR @S1@
3 PAGE p. 4
2 _MARNM Smith`);
  const lines = exportedLines(text, "@I1@");
  for (const expected of ["2 SPFX de", "2 SOUR @S1@", "3 PAGE p. 4", "2 _MARNM Smith"]) {
    assert.ok(lines.includes(expected), `missing ${expected}`);
  }
});

test("editing a name part via applyNamePatch rebuilds the NAME value, keeping the suffix", () => {
  const { tree } = loadGedcom(gedcom(`
0 @I1@ INDI
1 NAME John /Smith/ Jr.`));
  const name = tree.individuals["@I1@"].names[0];
  assert.equal(name.suffix, "Jr."); // derived from the value, no NSFX line

  applyNamePatch(name, { given: "Johnny" });
  const lines = saveGedcom(tree).split("\r\n");
  assert.ok(lines.includes("1 NAME Johnny /Smith/ Jr."), lines.join("\n"));
});

test("editing only the name TYPE keeps the imported NAME value verbatim", () => {
  const { tree } = loadGedcom(gedcom(`
0 @I1@ INDI
1 NAME Joe /Williams/
2 GIVN Joseph`));
  const name = tree.individuals["@I1@"].names[0];
  applyNamePatch(name, { type: "aka" });
  assert.equal(name.full, "Joe /Williams/");
  applyNamePatch(name, { given: "Joseph" }); // unchanged value: still not an edit
  assert.equal(name.full, "Joe /Williams/");
});

// --- Events --------------------------------------------------------------

test("sub-records under DATE/PLAC (TIME, MAP coordinates) survive", () => {
  const text = gedcom(`
0 @I1@ INDI
1 DEAT
2 DATE 14 APR 1905
3 TIME 10:30
2 PLAC Stamford
3 MAP
4 LATI N41.0534
4 LONG W73.5387`);
  assert.deepEqual(exportedLines(text, "@I1@"), [
    "1 DEAT",
    "2 DATE 14 APR 1905",
    "3 TIME 10:30",
    "2 PLAC Stamford",
    "3 MAP",
    "4 LATI N41.0534",
    "4 LONG W73.5387",
  ]);
});

test("clearing a place drops its coordinates rather than attaching them to nothing", () => {
  const { tree } = loadGedcom(gedcom(`
0 @I1@ INDI
1 DEAT
2 PLAC Stamford
3 MAP
4 LATI N41.0534`));
  tree.individuals["@I1@"].death!.place = undefined;
  assert.doesNotMatch(saveGedcom(tree), /MAP|LATI/);
});

test("a second NOTE on an event is kept, not dropped", () => {
  const text = gedcom(`
0 @I1@ INDI
1 BIRT
2 NOTE first
2 NOTE second`);
  assert.deepEqual(exportedLines(text, "@I1@"), ["1 BIRT", "2 NOTE first", "2 NOTE second"]);
});

test("a second BIRT/DEAT/MARR is kept as an alternate fact instead of overwriting the first", () => {
  const text = gedcom(`
0 @I1@ INDI
1 BIRT
2 DATE 2 OCT 1822
1 BIRT
2 DATE ABT 1823
0 @F1@ FAM
1 MARR
2 DATE 1859
1 MARR
2 DATE 1860`);
  const { tree } = loadGedcom(text);
  const indi = tree.individuals["@I1@"];
  assert.equal(indi.birth?.date, "2 OCT 1822");
  assert.deepEqual(indi.events.map((e) => [e.tag, e.date]), [["BIRT", "ABT 1823"]]);
  const fam = tree.families["@F1@"];
  assert.equal(fam.marriage?.date, "1859");
  assert.deepEqual(fam.events.map((e) => [e.tag, e.date]), [["MARR", "1860"]]);
});

test("non-event tags (CHAN, RIN, SOUR, OBJE, REFN) are kept verbatim, not shown as events", () => {
  const text = gedcom(`
0 @I1@ INDI
1 OCCU Cooper
1 SOUR @S1@
2 PAGE p. 1
1 OBJE @M1@
1 REFN 42
1 RIN 7
1 CHAN
2 DATE 12 MAR 2024
3 TIME 14:02:11
0 @F1@ FAM
1 DIV
1 RIN 8`);
  const { tree } = loadGedcom(text);
  assert.deepEqual(tree.individuals["@I1@"].events.map((e) => e.tag), ["OCCU"]);
  assert.deepEqual(tree.families["@F1@"].events.map((e) => e.tag), ["DIV"]);
  assert.ok(exportedLines(text, "@I1@").includes("3 TIME 14:02:11"));
});

// --- Links, sex, notes ---------------------------------------------------

test("sub-records under FAMC/FAMS and HUSB/WIFE/CHIL (PEDI, _FREL/_MREL) survive", () => {
  const text = gedcom(`
0 @I1@ INDI
1 FAMC @F1@
2 PEDI adopted
1 FAMS @F2@
2 NOTE second marriage
0 @F1@ FAM
1 HUSB @I2@
2 NOTE step-father
1 CHIL @I1@
2 _FREL Adopted
2 _MREL Natural`);
  assert.deepEqual(exportedLines(text, "@I1@"), [
    "1 FAMC @F1@",
    "2 PEDI adopted",
    "1 FAMS @F2@",
    "2 NOTE second marriage",
  ]);
  assert.deepEqual(exportedLines(text, "@F1@"), [
    "1 HUSB @I2@",
    "2 NOTE step-father",
    "1 CHIL @I1@",
    "2 _FREL Adopted",
    "2 _MREL Natural",
  ]);
});

test("an unrecognised SEX value is kept verbatim instead of dropped", () => {
  const text = gedcom(`
0 @I1@ INDI
1 SEX N`);
  assert.equal(loadGedcom(text).tree.individuals["@I1@"].sex, undefined);
  assert.deepEqual(exportedLines(text, "@I1@"), ["1 SEX N"]);
});

test("a NOTE with its own sub-records (e.g. a citation) is kept whole", () => {
  const text = gedcom(`
0 @I1@ INDI
1 NOTE Worked at the plant.
2 SOUR @S7@
3 PAGE p. 9`);
  assert.deepEqual(exportedLines(text, "@I1@"), ["1 NOTE Worked at the plant.", "2 SOUR @S7@", "3 PAGE p. 9"]);
});

// --- Review fixes (e8798ea..60bac88) ----------------------------------------

test("a prefix that's also written in the NAME value isn't doubled when the name is edited", () => {
  const { tree } = loadGedcom(gedcom(`
0 @I1@ INDI
1 NAME Dr. John /Smith/
2 NPFX Dr.`));
  const name = tree.individuals["@I1@"].names[0];
  assert.equal(name.given, "John");
  assert.equal(name.prefix, "Dr.");

  applyNamePatch(name, { surname: "Smyth" });
  const lines = saveGedcom(tree).split("\r\n");
  assert.ok(lines.includes("1 NAME Dr. John /Smyth/"), lines.join("\n"));
  assert.ok(lines.includes("2 NPFX Dr."));
});

test("a NAME value that is only the prefix doesn't become a given name", () => {
  const { tree } = loadGedcom(gedcom(`
0 @I1@ INDI
1 NAME Dr. /Smith/
2 NPFX Dr.`));
  assert.equal(tree.individuals["@I1@"].names[0].given, undefined);
});

test("a surname prefix (SPFX) stays in the NAME value when another part is edited", () => {
  const { tree } = loadGedcom(gedcom(`
0 @I1@ INDI
1 NAME John /van Smith/
2 GIVN John
2 SURN Smith
2 SPFX van`));
  applyNamePatch(tree.individuals["@I1@"].names[0], { given: "Johan" });
  const lines = saveGedcom(tree).split("\r\n");
  assert.ok(lines.includes("1 NAME Johan /van Smith/"), lines.join("\n"));
  assert.ok(lines.includes("2 SPFX van"));
});

test("a surname derived from a NAME value that includes the SPFX doesn't double it", () => {
  const { tree } = loadGedcom(gedcom(`
0 @I1@ INDI
1 NAME John /van der Berg/
2 SPFX van der`));
  const name = tree.individuals["@I1@"].names[0];
  assert.equal(name.surname, "Berg");
  applyNamePatch(name, { given: "Johan" });
  assert.ok(saveGedcom(tree).split("\r\n").includes("1 NAME Johan /van der Berg/"));
});

test("a SEX line with a citation is read, and changing it doesn't duplicate the line", () => {
  const text = gedcom(`
0 @I1@ INDI
1 SEX M
2 SOUR @S1@
3 PAGE p. 2`);
  const { tree } = loadGedcom(text);
  assert.equal(tree.individuals["@I1@"].sex, "M");
  assert.deepEqual(exportedLines(text, "@I1@"), ["1 SEX M", "2 SOUR @S1@", "3 PAGE p. 2"]);

  // The citation backed "M", so it goes with it rather than onto the new value.
  tree.individuals["@I1@"].sex = "F";
  assert.match(saveGedcom(tree), /\r\n1 SEX F\r\n0 TRLR/);
  assert.equal(saveGedcom(tree).match(/ SEX /g)?.length, 1);

  tree.individuals["@I1@"].sex = "M";
  assert.match(saveGedcom(tree), /1 SEX M\r\n2 SOUR @S1@\r\n3 PAGE p. 2/, "undoing the change brings it back");
});

test("coordinates and time stay with the place and date they came with, not a replacement value", () => {
  const { tree } = loadGedcom(gedcom(`
0 @I1@ INDI
1 DEAT
2 DATE 14 APR 1905
3 TIME 10:30
2 PLAC Stamford
3 MAP
4 LATI N41.0534`));
  const death = tree.individuals["@I1@"].death!;
  death.place = "Paris";
  death.date = undefined;
  death.date = "15 APR 1905";
  const text = saveGedcom(tree);
  assert.doesNotMatch(text, /MAP|LATI|TIME/);
  assert.match(text, /1 DEAT\r\n2 DATE 15 APR 1905\r\n2 PLAC Paris\r\n/);

  death.place = "Stamford";
  assert.match(saveGedcom(tree), /2 PLAC Stamford\r\n3 MAP\r\n4 LATI N41.0534/, "undoing the change brings them back");
});
