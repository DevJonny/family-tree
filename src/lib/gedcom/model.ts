import type { GedcomNode } from "./types";

/**
 * Normalized, editable family-tree model built from a parsed GEDCOM tree.
 *
 * This is what the rest of the app (UI, undo/redo history, Drive sync)
 * actually reads and mutates. GEDCOM stays the on-disk/on-Drive format;
 * this is the in-memory shape.
 *
 * Fidelity note: any child record we don't yet have a typed field for is
 * kept verbatim in `extra` so re-serializing doesn't silently drop data
 * (e.g. vendor tags like _UID, or GEDCOM features we haven't modeled yet
 * such as SOUR citations). Known fields are the only ones the app can
 * currently *edit*; everything else round-trips read-only until modeled.
 */

export interface NameParts {
  full?: string;
  given?: string;
  surname?: string;
  prefix?: string;
  suffix?: string;
  nickname?: string;
  type?: string;
}

export interface EventFact {
  tag: string;
  /** The tag's own line value, e.g. "Farmer" for `1 OCCU Farmer`. */
  value?: string;
  date?: string;
  place?: string;
  note?: string;
  /** Any sub-records beyond DATE/PLAC/NOTE (AGE, TYPE, ...), preserved as-is. */
  extra?: GedcomNode[];
}

export type Sex = "M" | "F" | "X" | "U";

export interface Individual {
  id: string;
  names: NameParts[];
  sex?: Sex;
  birth?: EventFact;
  death?: EventFact;
  events: EventFact[];
  familyAsChild: string[];
  familyAsSpouse: string[];
  notes: string[];
  extra: GedcomNode[];
}

export interface Family {
  id: string;
  husband?: string;
  wife?: string;
  children: string[];
  marriage?: EventFact;
  events: EventFact[];
  notes: string[];
  extra: GedcomNode[];
}

export interface FamilyTree {
  individuals: Record<string, Individual>;
  families: Record<string, Family>;
  /** Top-level records we don't model yet (SUBM, SOUR, REPO, top-level NOTE, ...). */
  otherRoots: GedcomNode[];
  header?: GedcomNode;
}

function findChild(node: GedcomNode, tag: string): GedcomNode | undefined {
  return node.children.find((c) => c.tag === tag);
}

function parseName(nameNode: GedcomNode): NameParts {
  const parts: NameParts = { full: nameNode.value };
  const given = findChild(nameNode, "GIVN")?.value;
  const surname = findChild(nameNode, "SURN")?.value;
  const prefix = findChild(nameNode, "NPFX")?.value;
  const suffix = findChild(nameNode, "NSFX")?.value;
  const nickname = findChild(nameNode, "NICK")?.value;
  const type = findChild(nameNode, "TYPE")?.value;
  if (given) parts.given = given;
  if (surname) parts.surname = surname;
  if (prefix) parts.prefix = prefix;
  if (suffix) parts.suffix = suffix;
  if (nickname) parts.nickname = nickname;
  if (type) parts.type = type;

  // Fall back to extracting from the GEDCOM "Given /Surname/" convention if
  // GIVN/SURN sub-records weren't present.
  if (!parts.given && !parts.surname && nameNode.value) {
    const match = /^([^/]*)\/([^/]*)\/?\s*$/.exec(nameNode.value.trim());
    if (match) {
      const [, g, s] = match;
      if (g.trim()) parts.given = g.trim();
      if (s.trim()) parts.surname = s.trim();
    }
  }
  return parts;
}

function nameToGedcomValue(name: NameParts): string {
  if (name.given || name.surname) {
    return `${name.given ?? ""} /${name.surname ?? ""}/`.trim();
  }
  return name.full ?? "";
}

const EVENT_SUB_TAGS = new Set(["DATE", "PLAC", "NOTE"]);

function parseEvent(node: GedcomNode): EventFact {
  const extra = node.children.filter((c) => !EVENT_SUB_TAGS.has(c.tag));
  return {
    tag: node.tag,
    value: node.value,
    date: findChild(node, "DATE")?.value,
    place: findChild(node, "PLAC")?.value,
    note: findChild(node, "NOTE")?.value,
    extra: extra.length > 0 ? extra : undefined,
  };
}

function eventToGedcomNode(level: number, event: EventFact): GedcomNode {
  const children: GedcomNode[] = [];
  if (event.date) children.push({ level: level + 1, tag: "DATE", value: event.date, children: [] });
  if (event.place) children.push({ level: level + 1, tag: "PLAC", value: event.place, children: [] });
  if (event.note) children.push({ level: level + 1, tag: "NOTE", value: event.note, children: [] });
  if (event.extra) children.push(...event.extra);
  return { level, tag: event.tag, value: event.value, children };
}

/** Builds the normalized FamilyTree model from parsed GEDCOM roots. */
export function buildFamilyTree(roots: GedcomNode[]): FamilyTree {
  const tree: FamilyTree = { individuals: {}, families: {}, otherRoots: [] };

  for (const root of roots) {
    if (root.tag === "HEAD") {
      tree.header = root;
      continue;
    }
    if (root.tag === "TRLR") {
      continue;
    }
    if (root.tag === "INDI" && root.xref) {
      tree.individuals[root.xref] = buildIndividual(root);
      continue;
    }
    if (root.tag === "FAM" && root.xref) {
      tree.families[root.xref] = buildFamily(root);
      continue;
    }
    tree.otherRoots.push(root);
  }

  return tree;
}

function buildIndividual(node: GedcomNode): Individual {
  const indi: Individual = {
    id: node.xref!,
    names: [],
    events: [],
    familyAsChild: [],
    familyAsSpouse: [],
    notes: [],
    extra: [],
  };

  for (const child of node.children) {
    switch (child.tag) {
      case "NAME":
        indi.names.push(parseName(child));
        break;
      case "SEX":
        if (child.value === "M" || child.value === "F" || child.value === "X" || child.value === "U") {
          indi.sex = child.value;
        }
        break;
      case "BIRT":
        indi.birth = parseEvent(child);
        break;
      case "DEAT":
        indi.death = parseEvent(child);
        break;
      case "FAMC":
        if (child.value) indi.familyAsChild.push(child.value);
        break;
      case "FAMS":
        if (child.value) indi.familyAsSpouse.push(child.value);
        break;
      case "NOTE":
        if (child.value) indi.notes.push(child.value);
        break;
      default:
        // Vendor/extension tags (by convention prefixed with "_", e.g.
        // _UID) are preserved verbatim rather than guessed at. Everything
        // else reaching here is an unmodeled-but-standard event/attribute
        // tag (BAPM, BURI, OCCU, EDUC, RESI, ...) which we treat generically
        // as an event so it's still visible in the UI, not just silently
        // carried through.
        if (child.tag.startsWith("_")) {
          indi.extra.push(child);
        } else {
          indi.events.push(parseEvent(child));
        }
        break;
    }
  }

  return indi;
}

function buildFamily(node: GedcomNode): Family {
  const fam: Family = {
    id: node.xref!,
    children: [],
    events: [],
    notes: [],
    extra: [],
  };

  for (const child of node.children) {
    switch (child.tag) {
      case "HUSB":
        if (child.value) fam.husband = child.value;
        break;
      case "WIFE":
        if (child.value) fam.wife = child.value;
        break;
      case "CHIL":
        if (child.value) fam.children.push(child.value);
        break;
      case "MARR":
        fam.marriage = parseEvent(child);
        break;
      case "NOTE":
        if (child.value) fam.notes.push(child.value);
        break;
      default:
        if (child.tag.startsWith("_")) {
          fam.extra.push(child);
        } else {
          fam.events.push(parseEvent(child));
        }
        break;
    }
  }

  return fam;
}

/** Serializes the normalized FamilyTree model back into GEDCOM roots. */
export function familyTreeToGedcomNodes(tree: FamilyTree): GedcomNode[] {
  const roots: GedcomNode[] = [];

  roots.push(
    tree.header ?? {
      level: 0,
      tag: "HEAD",
      children: [
        { level: 1, tag: "SOUR", value: "family-tree-app", children: [] },
        {
          level: 1,
          tag: "GEDC",
          children: [
            { level: 2, tag: "VERS", value: "5.5.1", children: [] },
            { level: 2, tag: "FORM", value: "LINEAGE-LINKED", children: [] },
          ],
        },
        { level: 1, tag: "CHAR", value: "UTF-8", children: [] },
      ],
    },
  );

  for (const indi of Object.values(tree.individuals)) {
    roots.push(individualToGedcomNode(indi));
  }
  for (const fam of Object.values(tree.families)) {
    roots.push(familyToGedcomNode(fam));
  }
  roots.push(...tree.otherRoots);
  roots.push({ level: 0, tag: "TRLR", children: [] });

  return roots;
}

function individualToGedcomNode(indi: Individual): GedcomNode {
  const children: GedcomNode[] = [];
  for (const name of indi.names) {
    const nameChildren: GedcomNode[] = [];
    if (name.given) nameChildren.push({ level: 2, tag: "GIVN", value: name.given, children: [] });
    if (name.surname) nameChildren.push({ level: 2, tag: "SURN", value: name.surname, children: [] });
    if (name.prefix) nameChildren.push({ level: 2, tag: "NPFX", value: name.prefix, children: [] });
    if (name.suffix) nameChildren.push({ level: 2, tag: "NSFX", value: name.suffix, children: [] });
    if (name.nickname) nameChildren.push({ level: 2, tag: "NICK", value: name.nickname, children: [] });
    if (name.type) nameChildren.push({ level: 2, tag: "TYPE", value: name.type, children: [] });
    children.push({ level: 1, tag: "NAME", value: nameToGedcomValue(name), children: nameChildren });
  }
  if (indi.sex) children.push({ level: 1, tag: "SEX", value: indi.sex, children: [] });
  if (indi.birth) children.push(eventToGedcomNode(1, indi.birth));
  if (indi.death) children.push(eventToGedcomNode(1, indi.death));
  for (const event of indi.events) children.push(eventToGedcomNode(1, event));
  for (const famc of indi.familyAsChild) children.push({ level: 1, tag: "FAMC", value: famc, children: [] });
  for (const fams of indi.familyAsSpouse) children.push({ level: 1, tag: "FAMS", value: fams, children: [] });
  for (const note of indi.notes) children.push({ level: 1, tag: "NOTE", value: note, children: [] });
  children.push(...indi.extra);

  return { level: 0, xref: indi.id, tag: "INDI", children };
}

function familyToGedcomNode(fam: Family): GedcomNode {
  const children: GedcomNode[] = [];
  if (fam.husband) children.push({ level: 1, tag: "HUSB", value: fam.husband, children: [] });
  if (fam.wife) children.push({ level: 1, tag: "WIFE", value: fam.wife, children: [] });
  for (const child of fam.children) children.push({ level: 1, tag: "CHIL", value: child, children: [] });
  if (fam.marriage) children.push(eventToGedcomNode(1, fam.marriage));
  for (const event of fam.events) children.push(eventToGedcomNode(1, event));
  for (const note of fam.notes) children.push({ level: 1, tag: "NOTE", value: note, children: [] });
  children.push(...fam.extra);

  return { level: 0, xref: fam.id, tag: "FAM", children };
}
