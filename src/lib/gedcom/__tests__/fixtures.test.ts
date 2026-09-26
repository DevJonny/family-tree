import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { loadGedcom, saveGedcom } from "../index";
import { parseGedcom } from "../parse";
import type { GedcomNode } from "../types";

/**
 * Fidelity guard: every committed sample file in data/ must survive
 * import -> export with nothing lost and nothing added. This is the check
 * that backs the "never lose GEDCOM data" rule — Drive sync re-exports the
 * whole tree on every edit, so any loss here is silent, permanent data loss.
 *
 * Comparison ignores the *order* of sibling records (the model regroups a
 * record's children: names, sex, events, links, notes, then preserved
 * extras), but nothing else: every line, at the same path under the same
 * record, with the same value — including CONC/CONT-joined text.
 *
 * data/private/ (real exports, gitignored) is deliberately not listed here;
 * check those by hand.
 */
const FIXTURES = ["555SAMPLE.GED", "sample-extended.ged"];

function readFixture(name: string): string {
  return readFileSync(path.resolve(process.cwd(), "data", name), "utf8");
}

/** Multiset of "record/TAG value/TAG value/..." paths, one per GEDCOM line. */
function linePaths(roots: GedcomNode[]): Map<string, number> {
  const out = new Map<string, number>();
  const walk = (node: GedcomNode, prefix: string) => {
    const key = `${prefix}/${node.tag} ${node.value ?? ""}`;
    out.set(key, (out.get(key) ?? 0) + 1);
    for (const child of node.children) walk(child, key);
  };
  for (const root of roots) walk(root, root.xref ?? "");
  return out;
}

function diff(before: Map<string, number>, after: Map<string, number>): string[] {
  const lines: string[] = [];
  for (const [key, n] of before) if ((after.get(key) ?? 0) < n) lines.push(`- ${key}`);
  for (const [key, n] of after) if ((before.get(key) ?? 0) < n) lines.push(`+ ${key}`);
  return lines;
}

for (const fixture of FIXTURES) {
  test(`${fixture}: parses without warnings`, () => {
    assert.deepEqual(parseGedcom(readFixture(fixture)).warnings, []);
  });

  test(`${fixture}: import -> export loses and adds nothing`, () => {
    const text = readFixture(fixture);
    const original = parseGedcom(text).roots;
    const exported = parseGedcom(saveGedcom(loadGedcom(text).tree)).roots;
    assert.deepEqual(diff(linePaths(original), linePaths(exported)), []);
  });

  test(`${fixture}: export is stable (exporting twice gives identical text)`, () => {
    const once = saveGedcom(loadGedcom(readFixture(fixture)).tree);
    const twice = saveGedcom(loadGedcom(once).tree);
    assert.equal(twice, once);
  });
}
