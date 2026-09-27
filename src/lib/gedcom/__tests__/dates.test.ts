import assert from "node:assert/strict";
import { test } from "node:test";
import { dateSortKey } from "../dates";

const before = (a: string, b: string) => {
  const ka = dateSortKey(a);
  const kb = dateSortKey(b);
  assert.ok(ka !== undefined && kb !== undefined && ka < kb, `${a} should sort before ${b}`);
};

test("plain dates order by year, then month, then day", () => {
  before("1870", "1871");
  before("DEC 1870", "JAN 1871");
  before("2 OCT 1822", "3 OCT 1822");
  before("9 OCT 1822", "10 OCT 1822");
  before("OCT 1822", "NOV 1822");
});

test("qualifiers are ignored and a range or period sorts by its first date", () => {
  for (const d of ["ABT 1870", "BEF 1870", "AFT 1870", "EST 1870", "CAL 1870", "BET 1870 AND 1875", "FROM 1870 TO 1880", "INT 1870 (about then)"]) {
    assert.equal(dateSortKey(d), dateSortKey("1870"), d);
  }
  assert.equal(dateSortKey("BET 2 OCT 1822 AND 1830"), dateSortKey("2 OCT 1822"));
  assert.equal(dateSortKey("TO 1870"), dateSortKey("1870"));
});

test("a date with no usable year can't be placed", () => {
  for (const d of ["", "   ", "(unknown)", "Unknown", "OCT", "12 XYZ 1870 abc", "2 FOO 1870"]) {
    assert.equal(dateSortKey(d), undefined, JSON.stringify(d));
  }
});

test("mixed case, a dual year and a calendar escape still sort", () => {
  assert.equal(dateSortKey("2 Oct 1822"), dateSortKey("2 OCT 1822"));
  assert.equal(dateSortKey("Dec 1859"), dateSortKey("DEC 1859"));
  assert.equal(dateSortKey("11 FEB 1731/32"), dateSortKey("11 FEB 1731"));
  assert.equal(dateSortKey("@#DJULIAN@ 11 FEB 1731"), dateSortKey("11 FEB 1731"));
  assert.equal(dateSortKey("ABT @#DGREGORIAN@ 1870"), dateSortKey("1870"));
});
