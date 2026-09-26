import assert from "node:assert/strict";
import { test } from "node:test";
import { loadGedcom, nextFreeId, saveGedcom } from "../index";

/** Wraps record lines in a minimal HEAD/TRLR so each test shows only what it's about. */
function gedcom(...lines: string[]): string {
  return ["0 HEAD", "1 CHAR UTF-8", ...lines, "0 TRLR", ""].join("\n");
}

/** Drops undefined-valued keys (the parser sets `xref`/`value` explicitly) so expectations stay readable. */
function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

test("top-level SOUR, REPO and NOTE records load as first-class sources, repositories and notes", () => {
  const { tree } = loadGedcom(
    gedcom(
      "0 @S1@ SOUR",
      "1 TITL 1850 United States Federal Census",
      "1 AUTH Ancestry.com",
      "1 PUBL Provo, UT, USA: Ancestry.com Operations, Inc., 2009.",
      "1 ABBR 1850 Census",
      "1 TEXT Transcribed from",
      "2 CONC  the original schedules.",
      "1 REPO @R1@",
      "2 CALN 13B-1234.01",
      "2 MEDI microfilm",
      "1 NOTE Indexed by volunteers.",
      "1 _APID 1,8054::0",
      "0 @R1@ REPO",
      "1 NAME Ancestry.com",
      "1 WWW www.ancestry.com",
      "1 ADDR",
      "2 CITY Lehi",
      "0 @N1@ NOTE Williams line: research notes.",
      "1 CONT Second line.",
      "1 RIN 7",
      "0 @U1@ SUBM",
      "1 NAME Someone",
    ),
  );

  assert.deepEqual(plain(tree.sources["@S1@"]), {
    id: "@S1@",
    title: "1850 United States Federal Census",
    author: "Ancestry.com",
    publication: "Provo, UT, USA: Ancestry.com Operations, Inc., 2009.",
    abbreviation: "1850 Census",
    text: "Transcribed from the original schedules.",
    repositories: [
      {
        repoId: "@R1@",
        callNumber: "13B-1234.01",
        extra: [{ level: 2, tag: "MEDI", value: "microfilm", children: [] }],
      },
    ],
    notes: [{ text: "Indexed by volunteers.", citations: [] }],
    extra: [{ level: 1, tag: "_APID", value: "1,8054::0", children: [] }],
  });

  assert.deepEqual(plain(tree.repositories["@R1@"]), {
    id: "@R1@",
    name: "Ancestry.com",
    website: "www.ancestry.com",
    notes: [],
    extra: [
      {
        level: 1,
        tag: "ADDR",
        children: [{ level: 2, tag: "CITY", value: "Lehi", children: [] }],
      },
    ],
  });

  assert.deepEqual(plain(tree.notes["@N1@"]), {
    id: "@N1@",
    text: "Williams line: research notes.\nSecond line.",
    citations: [],
    extra: [{ level: 1, tag: "RIN", value: "7", children: [] }],
  });

  // Only records we still don't model stay in the passthrough bucket.
  assert.deepEqual(
    tree.otherRoots.map((r) => r.xref),
    ["@U1@"],
  );
});

test("a citation on an event loads its page, quality, data date/text and notes, keeping vendor tags verbatim", () => {
  const text = gedcom(
    "0 @I1@ INDI",
    "1 BIRT",
    "2 DATE 2 Oct 1822",
    "2 SOUR @S1@",
    "3 PAGE Sec. 2, p. 45",
    "3 QUAY 3",
    "3 DATA",
    "4 DATE 5 Oct 1822",
    "4 TEXT Born to Thomas and",
    "5 CONC  Hannah Williams.",
    "3 NOTE Entry is faded.",
    "3 _APID 1,8054::12345678",
    "0 @S1@ SOUR",
    "1 TITL Madison County Birth Records",
  );
  const { tree } = loadGedcom(text);
  const birth = tree.individuals["@I1@"].birth!;

  assert.deepEqual(plain(birth.citations), [
    {
      sourceId: "@S1@",
      page: "Sec. 2, p. 45",
      quality: 3,
      date: "5 Oct 1822",
      text: "Born to Thomas and Hannah Williams.",
      notes: [{ text: "Entry is faded.", citations: [] }],
      extra: [{ level: 3, tag: "_APID", value: "1,8054::12345678", children: [] }],
    },
  ]);
  assert.equal(birth.extra, undefined, "the SOUR line is modelled, not left in extra");

  // And it goes back out at the right depth.
  const out = saveGedcom(tree);
  assert.match(
    out,
    /1 BIRT\r\n2 DATE 2 Oct 1822\r\n2 SOUR @S1@\r\n3 PAGE Sec. 2, p. 45\r\n3 QUAY 3\r\n3 DATA\r\n4 DATE 5 Oct 1822\r\n4 TEXT Born to Thomas and Hannah Williams.\r\n3 NOTE Entry is faded.\r\n3 _APID 1,8054::12345678\r\n/,
  );
});

test("citations directly on a person, on a name and on a family land on that container", () => {
  const { tree } = loadGedcom(
    gedcom(
      "0 @I1@ INDI",
      "1 NAME Robert /Williams/",
      "2 SOUR @S1@",
      "3 PAGE Births page, entry 4",
      "1 SOUR @S2@",
      "2 PAGE Year: 1850; Roll: M432_39",
      "2 _APID 1,8054::12345678",
      "0 @F1@ FAM",
      "1 HUSB @I1@",
      "1 SOUR @S1@",
      "2 QUAY 2",
      "0 @S1@ SOUR",
      "0 @S2@ SOUR",
    ),
  );
  const robert = tree.individuals["@I1@"];

  assert.deepEqual(plain(robert.names[0].citations), [
    { sourceId: "@S1@", page: "Births page, entry 4", notes: [] },
  ]);
  assert.equal(robert.names[0].extra, undefined);
  assert.deepEqual(plain(robert.citations), [
    {
      sourceId: "@S2@",
      page: "Year: 1850; Roll: M432_39",
      notes: [],
      extra: [{ level: 2, tag: "_APID", value: "1,8054::12345678", children: [] }],
    },
  ]);
  assert.deepEqual(robert.extra, []);
  assert.deepEqual(plain(tree.families["@F1@"].citations), [{ sourceId: "@S1@", quality: 2, notes: [] }]);
  assert.deepEqual(tree.families["@F1@"].extra, []);
});

test("an unpointed citation keeps its text as a description, and a dangling pointer is kept as-is", () => {
  const text = gedcom(
    "0 @I1@ INDI",
    "1 BIRT",
    "2 SOUR Recollection of Hannah Pryce, recorded about 1840",
    "3 TEXT Told to her grandson.",
    "1 DEAT",
    "2 SOUR @S99@",
    "3 PAGE Burials 1825",
  );
  const { tree } = loadGedcom(text);
  const indi = tree.individuals["@I1@"];

  assert.deepEqual(plain(indi.birth!.citations), [
    {
      description: "Recollection of Hannah Pryce, recorded about 1840",
      notes: [],
      extra: [{ level: 3, tag: "TEXT", value: "Told to her grandson.", children: [] }],
    },
  ]);
  assert.deepEqual(plain(indi.death!.citations), [{ sourceId: "@S99@", page: "Burials 1825", notes: [] }]);
  assert.equal(tree.sources["@S99@"], undefined, "no source is invented for a dangling pointer");

  const out = saveGedcom(tree);
  assert.match(out, /2 SOUR Recollection of Hannah Pryce, recorded about 1840\r\n3 TEXT Told to her grandson.\r\n/);
  assert.match(out, /2 SOUR @S99@\r\n3 PAGE Burials 1825\r\n/);
});

test("notes load as inline notes (with their own citations) or links to shared notes, on people, families and events", () => {
  const text = gedcom(
    "0 @I1@ INDI",
    "1 BIRT",
    "2 NOTE @N1@",
    "2 NOTE Midwife's record.",
    "1 NOTE Worked at the plant.",
    "2 SOUR @S7@",
    "3 PAGE p. 9",
    "1 NOTE @N1@",
    "0 @F1@ FAM",
    "1 NOTE @N1@",
    "0 @N1@ NOTE Shared research.",
    "1 SOUR @S7@",
    "2 PAGE p. 1",
    "0 @S7@ SOUR",
  );
  const { tree } = loadGedcom(text);
  const indi = tree.individuals["@I1@"];

  assert.deepEqual(plain(indi.notes), [
    { text: "Worked at the plant.", citations: [{ sourceId: "@S7@", page: "p. 9", notes: [] }] },
    { noteId: "@N1@" },
  ]);
  assert.deepEqual(plain(indi.birth!.notes), [
    { noteId: "@N1@" },
    { text: "Midwife's record.", citations: [] },
  ]);
  assert.deepEqual(plain(tree.families["@F1@"].notes), [{ noteId: "@N1@" }]);
  assert.deepEqual(plain(tree.notes["@N1@"].citations), [{ sourceId: "@S7@", page: "p. 1", notes: [] }]);
  assert.deepEqual(indi.extra, [], "the note with a citation is no longer hidden in extra");

  const out = saveGedcom(tree);
  assert.match(out, /1 NOTE Worked at the plant.\r\n2 SOUR @S7@\r\n3 PAGE p. 9\r\n/);
  assert.match(out, /0 @N1@ NOTE Shared research.\r\n1 SOUR @S7@\r\n2 PAGE p. 1\r\n/);
});

test("malformed or duplicate citation fields stay verbatim instead of being lifted or dropped", () => {
  const text = gedcom(
    "0 @I1@ INDI",
    "1 BIRT",
    "2 SOUR @S1@",
    "3 PAGE first",
    "3 PAGE second",
    "3 QUAY high",
    "3 DATA",
    "4 TEXT first transcription",
    "4 TEXT second transcription",
    "3 DATA",
    "4 DATE 1 JAN 1900",
    "0 @S1@ SOUR",
    "1 TITL Real title",
    "1 TITL Duplicate title",
  );
  const { tree } = loadGedcom(text);

  assert.deepEqual(plain(tree.individuals["@I1@"].birth!.citations), [
    {
      sourceId: "@S1@",
      page: "first",
      text: "first transcription",
      notes: [],
      dataExtra: [{ level: 4, tag: "TEXT", value: "second transcription", children: [] }],
      extra: [
        { level: 3, tag: "PAGE", value: "second", children: [] },
        { level: 3, tag: "QUAY", value: "high", children: [] },
        { level: 3, tag: "DATA", children: [{ level: 4, tag: "DATE", value: "1 JAN 1900", children: [] }] },
      ],
    },
  ]);
  assert.equal(tree.sources["@S1@"].title, "Real title");

  // Export twice: nothing lost, nothing reordered between runs.
  const once = saveGedcom(tree);
  assert.equal(saveGedcom(loadGedcom(once).tree), once);
  for (const kept of ["3 PAGE second", "3 QUAY high", "4 TEXT second transcription", "4 DATE 1 JAN 1900", "1 TITL Duplicate title"]) {
    assert.ok(once.includes(kept), `export keeps "${kept}"`);
  }
});

test("nextFreeId never hands out an id that appears anywhere in the file, even only as a pointer", () => {
  const { tree } = loadGedcom(
    gedcom(
      "0 @I1@ INDI",
      "1 ASSO @I3@",
      "2 RELA Godfather",
      "1 BIRT",
      "2 SOUR @S2@",
      "0 @S1@ SOUR",
      "0 @N1@ NOTE Shared.",
      "0 @U1@ SUBM",
      "1 NOTE @N2@",
    ),
  );

  assert.equal(nextFreeId(tree, "S"), "@S3@", "@S2@ is only a dangling pointer, but still taken");
  assert.equal(nextFreeId(tree, "I"), "@I2@");
  assert.equal(nextFreeId(tree, "N"), "@N3@", "@N2@ is only referenced from an unmodelled record");
  assert.equal(nextFreeId(tree, "R"), "@R1@");
});
