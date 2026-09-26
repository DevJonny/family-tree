import assert from "node:assert/strict";
import { test } from "node:test";
import { describeCitation, labelForEventTag, loadGedcom, searchSources } from "../index";

function gedcom(...lines: string[]): string {
  return ["0 HEAD", "1 CHAR UTF-8", ...lines, "0 TRLR", ""].join("\n");
}

test("event labels cover the tags you can't add from the picker, like BIRT and DEAT", () => {
  assert.equal(labelForEventTag("BIRT"), "Birth");
  assert.equal(labelForEventTag("DEAT"), "Death");
  assert.equal(labelForEventTag("MARR"), "Marriage");
  assert.equal(labelForEventTag("OCCU"), "Occupation");
  assert.equal(labelForEventTag("_MILT"), "_MILT", "unknown tags fall back to the tag itself");
});

test("describeCitation gives the one-line summary shown under a fact", () => {
  const { tree } = loadGedcom(
    gedcom(
      "0 @S1@ SOUR",
      "1 TITL 1850 United States Federal Census",
      "1 ABBR 1850 Census",
      "0 @S2@ SOUR",
      "1 ABBR Llanfair PR",
      "0 @S3@ SOUR",
    ),
  );

  assert.deepEqual(
    describeCitation(tree, { sourceId: "@S1@", page: "Roll: M432_39", quality: 3, notes: [] }),
    { status: "ok", title: "1850 United States Federal Census", page: "Roll: M432_39", quality: "Primary" },
  );
  assert.deepEqual(describeCitation(tree, { sourceId: "@S2@", notes: [] }), {
    status: "ok",
    title: "Llanfair PR",
  });
  assert.deepEqual(describeCitation(tree, { sourceId: "@S3@", notes: [] }), {
    status: "ok",
    title: "Untitled source @S3@",
  });
  assert.deepEqual(describeCitation(tree, { description: "Recollection of Hannah Pryce", quality: 0, notes: [] }), {
    status: "unpointed",
    title: "Recollection of Hannah Pryce",
    quality: "Unreliable",
  });
  assert.deepEqual(describeCitation(tree, { sourceId: "@S99@", page: "Burials 1825", notes: [] }), {
    status: "missing",
    title: "Missing source @S99@",
    page: "Burials 1825",
  });
});

test("searchSources matches title or abbreviation, ignoring case, sorted by title", () => {
  const { tree } = loadGedcom(
    gedcom(
      "0 @S1@ SOUR",
      "1 TITL 1880 United States Federal Census",
      "0 @S2@ SOUR",
      "1 TITL 1850 United States Federal Census",
      "0 @S3@ SOUR",
      "1 TITL Parish Registers of St Mary, Llanfair",
      "1 ABBR Llanfair PR",
      "0 @S4@ SOUR",
    ),
  );

  assert.deepEqual(
    searchSources(tree, "census").map((s) => s.id),
    ["@S2@", "@S1@"],
  );
  assert.deepEqual(
    searchSources(tree, "LLANFAIR pr").map((s) => s.id),
    ["@S3@"],
  );
  assert.deepEqual(
    searchSources(tree, "  ").map((s) => s.id),
    ["@S2@", "@S1@", "@S3@", "@S4@"],
    "a blank query lists everything; untitled sources sort last",
  );
});
