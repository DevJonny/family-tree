import { sourceDisplayTitle } from "./citations";
import { familyTreeToGedcomNodes, personDisplayName, type FamilyTree } from "./model";
import { isPointer, type Repository } from "./sources";
import type { GedcomNode } from "./types";
import { walkTree } from "./walk";

/**
 * What the Sources tab needs to know about who uses a source or
 * repository ("Cited by"), and the deletes that cascade from them. All
 * built on `walkTree`, so no container is missed.
 */

export type OwnerKind = "person" | "family" | "source" | "repository" | "note";

/** One record that cites a source, with where in it the citations are. */
export interface CitedBy {
  ownerId: string;
  kind: OwnerKind;
  /** "Robert Williams", "Robert Williams & Mary Ann Wilson (family)", a source title, ... */
  label: string;
  /** How many citations of the source this record holds. */
  count: number;
  /** The distinct places they hang ("Birth", "Census", "Name", "Person", ...), in file order. */
  where: string[];
}

export interface SourceUsage {
  /** Citations of the source the app can see and edit. */
  total: number;
  /** How many distinct people cite it, for "Cited by 12 facts across 5 people". */
  people: number;
  owners: CitedBy[];
  /**
   * Pointers to the source the model doesn't reach — inside unmodelled
   * records (SUBM, OBJE, vendor records) or verbatim sub-records. Shown in
   * the delete warning and never deleted.
   */
  unmodelled: number;
}

const KIND_ORDER: OwnerKind[] = ["person", "family", "source", "repository", "note"];

function ownerKind(tree: FamilyTree, id: string): OwnerKind {
  if (tree.individuals[id]) return "person";
  if (tree.families[id]) return "family";
  if (tree.sources[id]) return "source";
  if (tree.repositories[id]) return "repository";
  return "note";
}

function ownerLabel(tree: FamilyTree, id: string, kind: OwnerKind): string {
  switch (kind) {
    case "person":
      return personDisplayName(tree.individuals[id]);
    case "family": {
      const fam = tree.families[id];
      const spouses = [fam.husband, fam.wife]
        .map((p) => (p && tree.individuals[p] ? personDisplayName(tree.individuals[p]) : undefined))
        .filter((n): n is string => !!n);
      return spouses.length ? `${spouses.join(" & ")} (family)` : `Family ${id}`;
    }
    case "source":
      return sourceDisplayTitle(tree.sources[id]);
    case "repository":
      return tree.repositories[id].name || `Repository ${id}`;
    case "note": {
      const text = tree.notes[id]?.text.split("\n")[0].trim() ?? "";
      if (!text) return `Shared note ${id}`;
      return text.length > 60 ? `${text.slice(0, 57)}…` : text;
    }
  }
}

/** Every record citing `sourceId`, grouped and labelled for the "Cited by" list. */
export function citationUsage(tree: FamilyTree, sourceId: string): SourceUsage {
  const byOwner = new Map<string, { count: number; where: string[] }>();
  let total = 0;
  walkTree(tree, {
    citation: (citation, ownerId, where) => {
      if (citation.sourceId !== sourceId) return;
      total += 1;
      const entry = byOwner.get(ownerId) ?? { count: 0, where: [] };
      entry.count += 1;
      if (!entry.where.includes(where)) entry.where.push(where);
      byOwner.set(ownerId, entry);
    },
  });

  const owners: CitedBy[] = [...byOwner].map(([ownerId, { count, where }]) => {
    const kind = ownerKind(tree, ownerId);
    return { ownerId, kind, label: ownerLabel(tree, ownerId, kind), count, where };
  });
  owners.sort(
    (a, b) =>
      KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
      a.label.localeCompare(b.label, undefined, { sensitivity: "base", numeric: true }),
  );

  return {
    total,
    people: owners.filter((o) => o.kind === "person").length,
    owners,
    unmodelled: pointerCount(tree, sourceId) - total,
  };
}

/** Citations per source id (dangling ids included), in one walk, for the Sources list. */
export function citationCounts(tree: FamilyTree): Record<string, number> {
  const counts: Record<string, number> = {};
  walkTree(tree, {
    citation: (citation) => {
      if (citation.sourceId) counts[citation.sourceId] = (counts[citation.sourceId] ?? 0) + 1;
    },
  });
  return counts;
}

/**
 * How many lines anywhere in the exported file point at `id`. Walks the
 * exported nodes like `nextFreeId`, so verbatim sub-records and unmodelled
 * records are included; subtracting the modelled references leaves the
 * ones the app can't edit, without having to know every verbatim bucket.
 */
function pointerCount(tree: FamilyTree, id: string): number {
  let n = 0;
  const walk = (node: GedcomNode) => {
    if (isPointer(node.value) && node.value === id) n += 1;
    node.children.forEach(walk);
  };
  familyTreeToGedcomNodes(tree).forEach(walk);
  return n;
}

/**
 * Deletes a source and every citation of it the model can reach (on
 * facts, names, people, families, and inside notes and other citations,
 * shared notes included). Works on an Immer draft; run it in one
 * `updateTree` call so it's one undo step. References it can't edit (see
 * `SourceUsage.unmodelled`) are left in place.
 */
export function deleteSource(tree: FamilyTree, sourceId: string): void {
  delete tree.sources[sourceId];
  walkTree(tree, {
    citationList: (list) => {
      for (let i = list.length - 1; i >= 0; i -= 1) if (list[i].sourceId === sourceId) list.splice(i, 1);
    },
  });
}

export interface RepositoryUsage {
  /** Sources holding this repository, each once, in file order. */
  sourceIds: string[];
  /** Pointers to it the model doesn't reach, left alone by deletes. */
  unmodelled: number;
}

export function repositoryUsage(tree: FamilyTree, repoId: string): RepositoryUsage {
  let modelled = 0;
  const sourceIds: string[] = [];
  for (const source of Object.values(tree.sources)) {
    const refs = source.repositories.filter((r) => r.repoId === repoId).length;
    modelled += refs;
    if (refs) sourceIds.push(source.id);
  }
  return { sourceIds, unmodelled: pointerCount(tree, repoId) - modelled };
}

/** Deletes a repository and every source's reference to it. Works on an Immer draft. */
export function deleteRepository(tree: FamilyTree, repoId: string): void {
  delete tree.repositories[repoId];
  for (const source of Object.values(tree.sources)) {
    source.repositories = source.repositories.filter((r) => r.repoId !== repoId);
  }
}

const ADDRESS_PARTS = ["ADR1", "ADR2", "ADR3", "CITY", "STAE", "POST", "CTRY"];

/**
 * A repository's address (kept verbatim in `extra`) as one read-only line:
 * the ADDR value's lines (CONT is already folded in by the parser), then the structured parts, skipping
 * any part the free-text lines already contain.
 */
export function repositoryAddress(repo: Repository): string | undefined {
  const addr = repo.extra?.find((n) => n.tag === "ADDR");
  if (!addr) return undefined;
  const parts: string[] = [];
  const add = (value: string | undefined) => {
    const v = value?.trim();
    if (v && !parts.some((p) => p === v)) parts.push(v);
  };
  addr.value?.split("\n").forEach(add);
  for (const tag of ADDRESS_PARTS) add(addr.children.find((c) => c.tag === tag)?.value);
  return parts.length ? parts.join(", ") : undefined;
}
