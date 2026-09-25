import type { FamilyTree, Individual } from "./model";

/**
 * Relationship-traversal helpers built on top of the normalized
 * FamilyTree model. Kept separate from model.ts (which is purely about
 * GEDCOM <-> model conversion) since these are read-only queries over an
 * already-built tree, used by UI views like the pedigree chart.
 */

export interface Parents {
  father?: Individual;
  mother?: Individual;
}

/** Returns this person's parents, found via their first FAMC (family as child). */
export function getParents(tree: FamilyTree, individualId: string): Parents {
  const individual = tree.individuals[individualId];
  if (!individual || individual.familyAsChild.length === 0) return {};

  const family = tree.families[individual.familyAsChild[0]];
  if (!family) return {};

  return {
    father: family.husband ? tree.individuals[family.husband] : undefined,
    mother: family.wife ? tree.individuals[family.wife] : undefined,
  };
}

/** Returns every child of this person, across all families they were a spouse/partner in. */
export function getChildren(tree: FamilyTree, individualId: string): Individual[] {
  const individual = tree.individuals[individualId];
  if (!individual) return [];

  const children: Individual[] = [];
  for (const famId of individual.familyAsSpouse) {
    const family = tree.families[famId];
    if (!family) continue;
    for (const childId of family.children) {
      const child = tree.individuals[childId];
      if (child) children.push(child);
    }
  }
  return children;
}

/** Returns this person's spouses/partners (the other parent in each family they belong to). */
export function getSpouses(tree: FamilyTree, individualId: string): Individual[] {
  const individual = tree.individuals[individualId];
  if (!individual) return [];

  const spouses: Individual[] = [];
  for (const famId of individual.familyAsSpouse) {
    const family = tree.families[famId];
    if (!family) continue;
    const spouseId = family.husband === individualId ? family.wife : family.husband;
    if (spouseId && tree.individuals[spouseId]) spouses.push(tree.individuals[spouseId]);
  }
  return spouses;
}

export interface AncestorNode {
  individual: Individual | null;
  /** Present so a "no data yet" slot can still be rendered/clicked in the chart. */
  placeholderId?: string;
  father: AncestorNode | null;
  mother: AncestorNode | null;
}

/**
 * Builds a fixed-depth ancestor tree (pedigree) rooted at `individualId`,
 * e.g. self -> parents -> grandparents -> ... A missing parent yields
 * `null` at that branch rather than throwing, since incomplete trees are
 * the norm in genealogy data.
 */
export function buildAncestorTree(
  tree: FamilyTree,
  individualId: string,
  maxGenerations: number,
): AncestorNode | null {
  const individual = tree.individuals[individualId];
  if (!individual) return null;

  function build(id: string, generationsRemaining: number): AncestorNode {
    const person = tree.individuals[id] ?? null;
    if (generationsRemaining <= 0 || !person) {
      return { individual: person, father: null, mother: null };
    }
    const { father, mother } = getParents(tree, id);
    return {
      individual: person,
      father: father ? build(father.id, generationsRemaining - 1) : null,
      mother: mother ? build(mother.id, generationsRemaining - 1) : null,
    };
  }

  return build(individualId, maxGenerations - 1);
}
