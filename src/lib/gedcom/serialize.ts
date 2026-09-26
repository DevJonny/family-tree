import type { GedcomNode } from "./types";

/**
 * Conservative max length for a single GEDCOM value before we wrap it with
 * CONC lines. The spec technically allows longer lines in modern parsers,
 * but wrapping keeps us compatible with older tools (Ancestry, FamilySearch,
 * Gramps, etc. all still expect this).
 */
const MAX_LINE_VALUE_LENGTH = 200;

/** Serializes a GedcomNode tree back into GEDCOM text (CRLF per spec). */
export function serializeGedcom(roots: GedcomNode[]): string {
  const lines: string[] = [];
  for (const root of roots) {
    emitNode(root, lines);
  }
  return lines.join("\r\n") + "\r\n";
}

function emitNode(node: GedcomNode, lines: string[]): void {
  const parts = [String(node.level)];
  if (node.xref) parts.push(node.xref);
  parts.push(node.tag);

  const value = node.value ?? "";
  const valueLines = value.split("\n");
  const [firstLine, ...restLines] = valueLines;

  const firstChunks = chunk(firstLine, MAX_LINE_VALUE_LENGTH);
  if (firstChunks.length === 0) {
    lines.push(value === "" && node.value === undefined ? parts.join(" ") : `${parts.join(" ")} `.trimEnd());
  } else {
    lines.push(`${parts.join(" ")} ${firstChunks[0]}`.trimEnd());
    for (const extra of firstChunks.slice(1)) {
      lines.push(`${node.level + 1} CONC ${extra}`);
    }
  }

  for (const contLine of restLines) {
    const contChunks = chunk(contLine, MAX_LINE_VALUE_LENGTH);
    if (contChunks.length === 0) {
      lines.push(`${node.level + 1} CONT`);
    } else {
      lines.push(`${node.level + 1} CONT ${contChunks[0]}`);
      for (const extra of contChunks.slice(1)) {
        lines.push(`${node.level + 1} CONC ${extra}`);
      }
    }
  }

  for (const child of node.children) {
    emitNode(child, lines);
  }
}

/**
 * Splits a value into CONC-sized pieces, only ever breaking *between two
 * non-space characters*. The GEDCOM spec asks for this because many readers
 * (including ours, for lines not followed by CONC) trim trailing whitespace:
 * a split right after a space silently turns "grown to 22" into
 * "grown to22" on the next import. Also never splits a UTF-16 surrogate
 * pair (emoji, rare CJK), which would corrupt the character.
 */
function chunk(str: string, size: number): string[] {
  if (str.length === 0) return [];
  const out: string[] = [];
  let rest = str;
  while (rest.length > size) {
    const at = findSplitPoint(rest, size);
    out.push(rest.slice(0, at));
    rest = rest.slice(at);
  }
  out.push(rest);
  return out;
}

function isSafeSplit(str: string, at: number): boolean {
  const before = str[at - 1];
  const after = str[at];
  const lowSurrogate = str.charCodeAt(at) >= 0xdc00 && str.charCodeAt(at) <= 0xdfff;
  return !/\s/.test(before) && !/\s/.test(after) && !lowSurrogate;
}

function findSplitPoint(str: string, size: number): number {
  for (let at = size; at > 0; at--) {
    if (isSafeSplit(str, at)) return at;
  }
  // No safe point within the limit (e.g. a very long run of spaces): look
  // past it instead, so we emit a slightly long line rather than lose data.
  for (let at = size + 1; at < str.length; at++) {
    if (isSafeSplit(str, at)) return at;
  }
  return str.length;
}
