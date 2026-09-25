import type { GedcomNode, GedcomParseResult, GedcomParseWarning } from "./types";

/**
 * Matches a GEDCOM line: LEVEL [XREF] TAG [VALUE]
 *   0 HEAD
 *   0 @I1@ INDI
 *   1 NAME John /Smith/
 *   2 DATE 4 JUL 1776
 */
const LINE_RE = /^(\d+)\s+(?:(@[^@]+@)\s+)?([A-Za-z0-9_.]+)(?:\s(.*))?$/;

/**
 * Parses raw GEDCOM text into a tree of GedcomNode roots (typically a single
 * HEAD, one node per INDI/FAM/SOUR/etc., and a TRLR).
 *
 * CONC (concatenate, no line break) and CONT (concatenate with line break)
 * continuation lines are folded into the preceding value rather than kept as
 * separate child nodes, since callers almost always want the joined string.
 * The BOM, if present (common from Windows exports), is stripped.
 */
export function parseGedcom(text: string): GedcomParseResult {
  const warnings: GedcomParseWarning[] = [];
  const cleaned = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lines = cleaned.split(/\r\n|\r|\n/);

  const roots: GedcomNode[] = [];
  // Stack of open nodes, indexed by level: stack[level] is the most recent
  // node at that level, so a new line at level N attaches to stack[N - 1].
  const stack: GedcomNode[] = [];
  let lastNode: GedcomNode | null = null;

  lines.forEach((rawLine, index) => {
    const lineNo = index + 1;
    const line = rawLine.trimEnd();
    if (line.trim() === "") return;

    const match = LINE_RE.exec(line.trim());
    if (!match) {
      warnings.push({ line: lineNo, message: `Could not parse line: "${line}"` });
      return;
    }

    const [, levelStr, xref, tag, value] = match;
    const level = Number.parseInt(levelStr, 10);

    if (tag === "CONC" || tag === "CONT") {
      if (!lastNode) {
        warnings.push({ line: lineNo, message: `${tag} with no preceding line` });
        return;
      }
      const sep = tag === "CONT" ? "\n" : "";
      lastNode.value = (lastNode.value ?? "") + sep + (value ?? "");
      return;
    }

    const node: GedcomNode = {
      level,
      xref,
      tag,
      value,
      children: [],
    };

    if (level === 0) {
      roots.push(node);
    } else {
      const parent = stack[level - 1];
      if (!parent) {
        warnings.push({
          line: lineNo,
          message: `Line at level ${level} has no parent at level ${level - 1}`,
        });
      } else {
        parent.children.push(node);
      }
    }

    stack[level] = node;
    stack.length = level + 1;
    lastNode = node;
  });

  return { roots, warnings };
}

/** Convenience: parse and throw away warnings (useful in tests/quick scripts). */
export function parseGedcomOrThrow(text: string): GedcomNode[] {
  const { roots, warnings } = parseGedcom(text);
  if (warnings.length > 0) {
    throw new Error(
      `GEDCOM parse warnings:\n${warnings.map((w) => `line ${w.line}: ${w.message}`).join("\n")}`,
    );
  }
  return roots;
}
