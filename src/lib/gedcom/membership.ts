import type { Draft } from "immer";
import { dateSortKey } from "./dates";
import { labelForEventTag } from "./eventTags";
import { walkTree } from "./walk";
import { nextFreeId, type Family, type FamilyTree, type Individual } from "./model";

/**
 * Who belongs to a family. A link is recorded on both sides (FAMS/FAMC on
 * the person, HUSB/WIFE/CHIL on the family, each with its own link
 * sub-records), so every change here updates both, and each is one
 * `updateTree` recipe, so one undo step.
 */

type Tree = Draft<FamilyTree>;

/** Whether `id` is in the family in any role. */
export function isMember(family: Family, id: string): boolean {
  return family.husband === id || family.wife === id || family.children.includes(id);
}

function addOnce(list: string[], id: string): void {
  if (!list.includes(id)) list.push(id);
}

function birthKey(tree: Tree, id: string): number | undefined {
  const date = tree.individuals[id]?.birth?.date;
  return date === undefined ? undefined : dateSortKey(date);
}

/**
 * Adds `childId` to the family's children, before the first sibling born
 * later (siblings whose dates can't be compared are stepped over), or at
 * the end when their own birth date can't be placed. Does nothing if
 * they're already in the family in any role.
 */
export function addChild(tree: Tree, famId: string, childId: string): void {
  const family = tree.families[famId];
  const child = tree.individuals[childId];
  if (!family || !child || isMember(family, childId)) return;

  const key = birthKey(tree, childId);
  let at = family.children.length;
  if (key !== undefined) {
    const later = family.children.findIndex((id) => {
      const sibling = birthKey(tree, id);
      return sibling !== undefined && sibling > key;
    });
    if (later >= 0) at = later;
  }
  family.children.splice(at, 0, childId);
  addOnce(child.familyAsChild, famId);
}

/**
 * Adds `personId` as a spouse/partner in whichever slot is empty. With both
 * empty, a woman goes in WIFE and anyone else in HUSB (the slots are what
 * GEDCOM 5.5.1 has; sex isn't enforced). Does nothing if both are taken or
 * they're already in the family.
 */
export function addSpouse(tree: Tree, famId: string, personId: string): void {
  const family = tree.families[famId];
  const person = tree.individuals[personId];
  if (!family || !person || isMember(family, personId)) return;

  if (!family.husband && !family.wife) {
    if (person.sex === "F") family.wife = personId;
    else family.husband = personId;
  } else if (!family.husband) family.husband = personId;
  else if (!family.wife) family.wife = personId;
  else return;
  addOnce(person.familyAsSpouse, famId);
}

/**
 * Starts a new family (a partnership) for `personId`, in the slot their
 * sex suggests, with `partnerId` (if any) in the other. Returns its id.
 */
export function newFamily(tree: Tree, personId: string, partnerId?: string): string {
  const famId = nextFreeId(tree, "F");
  tree.families[famId] = { id: famId, children: [], events: [], notes: [], citations: [], extra: [] };
  addSpouse(tree, famId, personId);
  if (partnerId) addSpouse(tree, famId, partnerId);
  return famId;
}

/**
 * Takes `personId` out of the family in every role, on both sides, along
 * with the sub-records of those links (PEDI, _FREL/_MREL, a NOTE under
 * FAMS, ...), since they describe a link that no longer exists. The
 * person themselves stays. A family left with nobody in it is deleted too,
 * since nothing in the UI could reach it any more (`familyContents` says
 * what that takes with it, for a warning first).
 */
export function removeFromFamily(tree: Tree, famId: string, personId: string): void {
  const family = tree.families[famId];
  if (family) {
    if (family.husband === personId) delete family.husband;
    if (family.wife === personId) delete family.wife;
    family.children = family.children.filter((id) => id !== personId);
    if (family.memberExtra) delete family.memberExtra[personId];
  }
  const person = tree.individuals[personId];
  if (person) {
    person.familyAsSpouse = person.familyAsSpouse.filter((id) => id !== famId);
    person.familyAsChild = person.familyAsChild.filter((id) => id !== famId);
    if (person.familyAsSpouseExtra) delete person.familyAsSpouseExtra[famId];
    if (person.familyAsChildExtra) delete person.familyAsChildExtra[famId];
    if (person.pedigree) delete person.pedigree[famId];
  }
  if (family && isEmpty(tree, famId)) delete tree.families[famId];
}

/**
 * Deletes a person, first taking them out of every family that lists them
 * or that they list (so nothing points at a missing id), which deletes any
 * family they leave empty.
 */
export function deleteIndividual(tree: Tree, personId: string): void {
  const person = tree.individuals[personId];
  if (!person) return;
  const famIds = new Set([...person.familyAsSpouse, ...person.familyAsChild]);
  for (const [famId, family] of Object.entries(tree.families)) {
    if (isMember(family, personId)) famIds.add(famId);
  }
  for (const famId of famIds) removeFromFamily(tree, famId, personId);
  delete tree.individuals[personId];
}

/** No one in the family, and no one linking to it from their side either. */
function isEmpty(tree: Tree, famId: string): boolean {
  const family = tree.families[famId];
  if (family.husband || family.wife || family.children.length > 0) return false;
  return !Object.values(tree.individuals).some(
    (p) => p.familyAsSpouse.includes(famId) || p.familyAsChild.includes(famId),
  );
}

/** Record bookkeeping that isn't worth warning about when a family goes. */
const BOOKKEEPING_TAGS = new Set(["CHAN", "CREA", "RIN", "REFN", "RFN", "AFN", "UID", "_UID", "EXID"]);

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/**
 * What deleting a family would take with it, as short phrases for a
 * warning ("Marriage 1900", "2 notes", ...). Empty when there's nothing
 * worth warning about.
 */
export function familyContents(tree: FamilyTree, famId: string): string[] {
  const family = tree.families[famId];
  if (!family) return [];
  const out: string[] = [];
  for (const event of [family.marriage, ...family.events]) {
    if (event) out.push([labelForEventTag(event.tag), event.date].filter(Boolean).join(" "));
  }
  let notes = 0;
  let citations = 0;
  walkTree(tree, {
    note: (_, owner) => void (owner === famId && notes++),
    citation: (_, owner) => void (owner === famId && citations++),
  });
  if (notes) out.push(plural(notes, "note"));
  if (citations) out.push(plural(citations, "citation"));
  if (family.extra.some((node) => !BOOKKEEPING_TAGS.has(node.tag))) {
    out.push("other details this app doesn't show yet");
  }
  return out;
}

/**
 * A child's relationship to one family (PEDI). Not editable when the file
 * has a PEDI the model keeps verbatim (one with sub-records, or a second
 * one), since writing ours as well would give the link two.
 */
export function pedigreeOf(person: Individual, famId: string): { value?: string; editable: boolean } {
  const verbatim = person.familyAsChildExtra?.[famId]?.find((node) => node.tag === "PEDI");
  if (verbatim) return { value: verbatim.value, editable: false };
  return { value: person.pedigree?.[famId], editable: true };
}

/** Sets (or, with undefined, clears) a child's relationship to one family. */
export function setPedigree(tree: Tree, childId: string, famId: string, value: string | undefined): void {
  const child = tree.individuals[childId];
  if (!child || !pedigreeOf(child, famId).editable) return;
  if (value) (child.pedigree ??= {})[famId] = value;
  else if (child.pedigree) delete child.pedigree[famId];
}
