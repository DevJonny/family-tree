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

function chunk(str: string, size: number): string[] {
  if (str.length === 0) return [];
  const out: string[] = [];
  for (let i = 0; i < str.length; i += size) {
    out.push(str.slice(i, i + size));
  }
  return out;
}
