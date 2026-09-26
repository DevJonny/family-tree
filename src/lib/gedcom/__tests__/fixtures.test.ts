import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
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
 * Real exports dropped into data/private/ (gitignored, never in CI) run
 * through the same checks, but their failures are *redacted*: tag paths,
 * counts and line numbers only, never values, so real people's names and
 * dates don't end up in terminal logs or an AI assistant's context. Once a
 * quirk is located, reproduce it with fictional people in
 * sample-extended.ged.
 */
const DATA_DIR = path.resolve(process.cwd(), "data");
const PRIVATE_DIR = path.join(DATA_DIR, "private");

interface Fixture {
  name: string;
  file: string;
  redact: boolean;
}

const FIXTURES: Fixture[] = [
  ...["555SAMPLE.GED", "sample-extended.ged"].map((name) => ({ name, file: path.join(DATA_DIR, name), redact: false })),
  ...(existsSync(PRIVATE_DIR) ? readdirSync(PRIVATE_DIR) : [])
    .filter((name) => /\.ged$/i.test(name))
    .map((name) => ({ name: `private/${name}`, file: path.join(PRIVATE_DIR, name), redact: true })),
];

/**
 * Path segments are joined with a control character, not "/", because
 * values contain slashes ("Robert /Williams/", "Baptisms 1749/50") and the
 * redacted view has to split paths back into segments without leaking them.
 */
const SEP = "\u001f";

/** Multiset of "record/TAG value/TAG value/..." paths, one per GEDCOM line. */
function linePaths(roots: GedcomNode[]): Map<string, number> {
  const out = new Map<string, number>();
  const walk = (node: GedcomNode, prefix: string) => {
    const key = `${prefix}${SEP}${node.tag} ${node.value ?? ""}`;
    out.set(key, (out.get(key) ?? 0) + 1);
    for (const child of node.children) walk(child, key);
  };
  for (const root of roots) walk(root, root.xref ?? "");
  return out;
}

/** "@I1@/BIRT 1 JAN 1900/SOUR @S1@/PAGE p. 4" -> "BIRT/SOUR/PAGE": tags only, no values or ids. */
function tagPath(key: string): string {
  return key
    .split(SEP)
    .slice(1)
    .map((segment) => segment.split(" ")[0])
    .join("/");
}

/** Collapses diff lines to value-free tag paths with counts, e.g. "- INDI/BIRT/SOUR/_TMPLT ×37". */
function redactDiff(lines: string[]): string[] {
  const counts = new Map<string, number>();
  for (const line of lines) {
    const key = `${line[0]} ${tagPath(line.slice(2))}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].map(([key, n]) => `${key} ×${n}`);
}

function firstDifferingLine(a: string, b: string): number {
  const al = a.split("\r\n");
  const bl = b.split("\r\n");
  const i = al.findIndex((line, idx) => line !== bl[idx]);
  return (i === -1 ? Math.min(al.length, bl.length) : i) + 1;
}

function diff(before: Map<string, number>, after: Map<string, number>): string[] {
  const lines: string[] = [];
  for (const [key, n] of before) if ((after.get(key) ?? 0) < n) lines.push(`- ${key}`);
  for (const [key, n] of after) if ((before.get(key) ?? 0) < n) lines.push(`+ ${key}`);
  return lines;
}

for (const { name, file, redact } of FIXTURES) {
  const read = () => readFileSync(file, "utf8");

  test(`${name}: parses without warnings`, () => {
    const warnings = parseGedcom(read()).warnings;
    assert.deepEqual(redact ? warnings.map((w) => `line ${w.line}`) : warnings, []);
  });

  test(`${name}: import -> export loses and adds nothing`, () => {
    const text = read();
    const original = parseGedcom(text).roots;
    const exported = parseGedcom(saveGedcom(loadGedcom(text).tree)).roots;
    const lines = diff(linePaths(original), linePaths(exported));
    assert.deepEqual(redact ? redactDiff(lines) : lines.map((l) => l.replaceAll(SEP, "/")), []);
  });

  test(`${name}: export is stable (exporting twice gives identical text)`, () => {
    const once = saveGedcom(loadGedcom(read()).tree);
    const twice = saveGedcom(loadGedcom(once).tree);
    if (redact) {
      assert.ok(twice === once, `second export differs from the first at line ${firstDifferingLine(once, twice)}`);
    } else {
      assert.equal(twice, once);
    }
  });
}
