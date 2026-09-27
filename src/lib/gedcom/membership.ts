import { current, isDraft, produce, type Draft } from "immer";
import { dateSortKey } from "./dates";
import { labelForEventTag } from "./eventTags";
import { walkFamily } from "./walk";
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
 * GEDCOM 5.5.1 has; sex isn't enforced). `slot` asks for one in
 * particular. Does nothing if the slot is taken or they're already in the
 * family.
 */
export function addSpouse(tree: Tree, famId: string, personId: string, slot?: "husband" | "wife"): void {
  const family = tree.families[famId];
  const person = tree.individuals[personId];
  if (!family || !person || isMember(family, personId)) return;

  if (slot) {
    if (family[slot]) return;
    family[slot] = personId;
  } else if (!family.husband && !family.wife) {
    if (person.sex === "F") family.wife = personId;
    else family.husband = personId;
  } else if (!family.husband) family.husband = personId;
  else if (!family.wife) family.wife = personId;
  else return;
  addOnce(person.familyAsSpouse, famId);
}

/**
 * Starts a new family (a partnership) for `personId`, in `slot` or the one
 * their sex suggests, with `partnerId` (if any) in the other. Returns its id.
 */
export function newFamily(tree: Tree, personId: string, partnerId?: string, slot?: "husband" | "wife"): string {
  const famId = nextFreeId(isDraft(tree) ? current(tree) : tree, "F");
  tree.families[famId] = { id: famId, children: [], events: [], notes: [], citations: [], extra: [] };
  addSpouse(tree, famId, personId, slot);
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
  walkFamily(family, { note: () => void notes++, citation: () => void citations++ });
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

/** Whether the file's header says GEDCOM 7, whose enumerations are in capitals. */
function isGedcom7(tree: FamilyTree): boolean {
  const gedc = tree.header?.children.find((n) => n.tag === "GEDC");
  return gedc?.children.find((n) => n.tag === "VERS")?.value?.trim().startsWith("7") ?? false;
}

/**
 * Sets (or, with undefined, clears) a child's relationship to one family.
 * Values are 5.5.1's lower case (birth, adopted, ...), written in
 * capitals in a GEDCOM 7 file.
 */
export function setPedigree(tree: Tree, childId: string, famId: string, value: string | undefined): void {
  const child = tree.individuals[childId];
  if (!child || !pedigreeOf(child, famId).editable) return;
  if (value) (child.pedigree ??= {})[famId] = isGedcom7(tree) ? value.toUpperCase() : value;
  else if (child.pedigree) delete child.pedigree[famId];
}

/** Whether `removeFromFamily` would delete the family, so the UI can warn first. */
export function removalDeletesFamily(tree: FamilyTree, famId: string, personId: string): boolean {
  if (!tree.families[famId]) return false;
  return !produce(tree, (d) => removeFromFamily(d, famId, personId)).families[famId];
}

/**
 * The families of `parentId` that `childId` could join as a child: those
 * they aren't already in, as a child or as a spouse.
 */
export function joinableFamilies(tree: FamilyTree, parentId: string, childId: string): string[] {
  return (tree.individuals[parentId]?.familyAsSpouse ?? []).filter((famId) => {
    const family = tree.families[famId];
    return family !== undefined && !isMember(family, childId);
  });
}
