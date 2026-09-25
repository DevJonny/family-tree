import assert from "node:assert/strict";
import { test } from "node:test";
import { parseGedcom } from "../parse";
import { serializeGedcom } from "../serialize";

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
1 FAMS @F1@
1 NOTE This is a long note that should exercise the line wrapping logic in the serializer because it exceeds two hundred characters once you keep padding it out with more and more filler words until it definitely, definitely crosses the threshold we picked.
0 @I2@ INDI
1 NAME Jane /Doe/
1 SEX F
1 FAMS @F1@
0 @F1@ FAM
1 HUSB @I1@
1 WIFE @I2@
1 MARR
2 DATE 1 JAN 1975
0 TRLR
`;

test("parses a well-formed GEDCOM file without warnings", () => {
  const { roots, warnings } = parseGedcom(SAMPLE);
  assert.equal(warnings.length, 0);
  assert.equal(roots.length, 5); // HEAD, I1, I2, F1, TRLR
});

test("builds correct nesting for continuation-free records", () => {
  const { roots } = parseGedcom(SAMPLE);
  const indi1 = roots.find((r) => r.xref === "@I1@");
  assert.ok(indi1);
  const name = indi1!.children.find((c) => c.tag === "NAME");
  assert.equal(name?.value, "John /Smith/");
  const givn = name!.children.find((c) => c.tag === "GIVN");
  assert.equal(givn?.value, "John");
});

test("wraps and unwraps a long NOTE value losslessly via CONC", () => {
  const { roots } = parseGedcom(SAMPLE);
  const text = serializeGedcom(roots);
  // The serialized text should contain at least one CONC continuation for
  // the long note.
  assert.match(text, /\d+ CONC /);

  const reparsed = parseGedcom(text);
  assert.equal(reparsed.warnings.length, 0);

  const original = roots.find((r) => r.xref === "@I1@")!;
  const again = reparsed.roots.find((r) => r.xref === "@I1@")!;
  const originalNote = original.children.find((c) => c.tag === "NOTE")!.value;
  const againNote = again.children.find((c) => c.tag === "NOTE")!.value;
  assert.equal(againNote, originalNote);
});

test("full roundtrip is stable (parse -> serialize -> parse produces identical tree)", () => {
  const first = parseGedcom(SAMPLE);
  const text = serializeGedcom(first.roots);
  const second = parseGedcom(text);
  assert.deepEqual(second.roots, first.roots);
});

test("preserves multi-line CONT values with embedded newlines", () => {
  const withCont = `0 @I3@ INDI\r\n1 NOTE line one\r\n2 CONT line two\r\n2 CONT line three\r\n0 TRLR\r\n`;
  const { roots } = parseGedcom(withCont);
  const note = roots[0].children.find((c) => c.tag === "NOTE");
  assert.equal(note?.value, "line one\nline two\nline three");
});
