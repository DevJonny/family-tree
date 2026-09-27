export * from "./types";
export * from "./parse";
export * from "./serialize";
export * from "./model";
export * from "./sources";
export * from "./walk";
export * from "./citations";
export * from "./sourceUsage";
export * from "./eventTags";
export * from "./dates";
export * from "./membership";
export * from "./people";

import { parseGedcom } from "./parse";
import { serializeGedcom } from "./serialize";
import { buildFamilyTree, familyTreeToGedcomNodes, type FamilyTree } from "./model";
import type { GedcomParseWarning } from "./types";

export interface LoadGedcomResult {
  tree: FamilyTree;
  warnings: GedcomParseWarning[];
}

/** Parses raw GEDCOM text straight into the normalized FamilyTree model. */
export function loadGedcom(text: string): LoadGedcomResult {
  const { roots, warnings } = parseGedcom(text);
  return { tree: buildFamilyTree(roots), warnings };
}

/** Serializes the normalized FamilyTree model straight into GEDCOM text. */
export function saveGedcom(tree: FamilyTree): string {
  return serializeGedcom(familyTreeToGedcomNodes(tree));
}
