import type { GedcomNode } from "./types";

/**
 * Normalized, editable family-tree model built from a parsed GEDCOM tree.
 *
 * This is what the rest of the app (UI, undo/redo history, Drive sync)
 * actually reads and mutates. GEDCOM stays the on-disk/on-Drive format;
 * this is the in-memory shape.
 *
 * Fidelity rule: import -> export must lose nothing (enforced by
 * __tests__/fixtures.test.ts against the files in data/). Anything we don't
 * have a typed, editable field for is kept verbatim — in the `extra` bucket
 * of the record/name/event it belongs to, or in one of the smaller
 * "attached children" maps below — and re-emitted in place on export.
 * Known fields are the only ones the app can currently *edit*; everything
 * else round-trips read-only until modeled.
 */

export interface NameParts {
  /**
   * The NAME line's own value exactly as imported ("George /Harlow/ Jr.").
   * Emitted verbatim on export until a name part is edited — edit names via
   * `applyNamePatch`, which clears this so the value is rebuilt from parts.
   */
  full?: string;
  given?: string;
  surname?: string;
  prefix?: string;
  suffix?: string;
  nickname?: string;
  type?: string;
  /**
   * Parts that were *derived from the NAME value* because the file had no
   * GIVN/SURN/NSFX line for them. They're shown and editable like any other
   * part, but not written back out as their own lines — the file didn't
   * have them, and the NAME value already carries them.
   */
  derived?: DerivablePart[];
  /** Other NAME sub-records (SOUR citations, NOTE, SPFX, _MARNM, ...), verbatim. */
  extra?: GedcomNode[];
}

type DerivablePart = "given" | "surname" | "suffix";

const NAME_PART_TAGS = {
  GIVN: "given",
  SURN: "surname",
  NPFX: "prefix",
  NSFX: "suffix",
  NICK: "nickname",
  TYPE: "type",
} as const satisfies Record<string, keyof NameParts>;

type NamePartTag = keyof typeof NAME_PART_TAGS;

/** The DATE/PLAC/NOTE lines of an event, lifted into typed fields. */
type LiftedEventTag = "DATE" | "PLAC" | "NOTE";

export interface EventFact {
  tag: string;
  /** The tag's own line value, e.g. "Farmer" for `1 OCCU Farmer`. */
  value?: string;
  date?: string;
  place?: string;
  note?: string;
  /**
   * Sub-records hanging off the DATE/PLAC/NOTE line itself — e.g. a place's
   * MAP/LATI/LONG coordinates or a date's TIME. Kept (and re-attached) for
   * as long as that field is non-empty; clearing the field drops them.
   */
  attached?: Partial<Record<LiftedEventTag, GedcomNode[]>>;
  /** Any other sub-records (AGE, TYPE, SOUR citations, ...), preserved as-is. */
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
  /** Sub-records under a FAMC line (PEDI "adopted", STAT, NOTE), keyed by family id. */
  familyAsChildExtra?: Record<string, GedcomNode[]>;
  /** Sub-records under a FAMS line (NOTE), keyed by family id. */
  familyAsSpouseExtra?: Record<string, GedcomNode[]>;
  notes: string[];
  extra: GedcomNode[];
}

export interface Family {
  id: string;
  husband?: string;
  wife?: string;
  children: string[];
  /**
   * Sub-records under a HUSB/WIFE/CHIL line, keyed by that person's id —
   * e.g. Ancestry/FTM's `_FREL Adopted` / `_MREL Natural` under CHIL.
   * Keyed by person rather than role so a replaced spouse's data can't
   * leak onto whoever takes their place.
   */
  memberExtra?: Record<string, GedcomNode[]>;
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

/**
 * Standard INDI/FAM sub-record tags that are *not* events or attributes.
 * They're kept verbatim in `extra` rather than shown as fake "events".
 * Everything else that isn't otherwise modeled (BAPM, OCCU, CENS, DIV, a
 * custom tag added from the UI, ...) is treated as an event. Vendor tags
 * (leading "_") are always kept verbatim.
 */
const NON_EVENT_TAGS = new Set([
  // GEDCOM 5.5.1
  "RESN", "SUBM", "ALIA", "ANCI", "DESI", "RFN", "AFN", "REFN", "RIN", "CHAN",
  "SOUR", "OBJE", "ASSO",
  // GEDCOM 7
  "UID", "EXID", "SNOTE", "CREA", "NO",
]);

function isEventTag(tag: string): boolean {
  return !tag.startsWith("_") && !NON_EVENT_TAGS.has(tag);
}

// ---------------------------------------------------------------------------
// Names

/** Splits a NAME value "Given /Surname/ Suffix" into its parts. */
function splitNameValue(value: string): Partial<Record<DerivablePart, string>> {
  const match = /^([^/]*)\/([^/]*)(?:\/(.*))?$/.exec(value.trim());
  const out: Partial<Record<DerivablePart, string>> = {};
  if (!match) {
    if (value.trim()) out.given = value.trim();
    return out;
  }
  const [, given, surname, suffix] = match;
  if (given.trim()) out.given = given.trim();
  if (surname.trim()) out.surname = surname.trim();
  if (suffix?.trim()) out.suffix = suffix.trim();
  return out;
}

function parseName(nameNode: GedcomNode): NameParts {
  const parts: NameParts = {};
  if (nameNode.value !== undefined) parts.full = nameNode.value;
  const extra: GedcomNode[] = [];

  for (const child of nameNode.children) {
    const field = NAME_PART_TAGS[child.tag as NamePartTag];
    // First childless occurrence with a value becomes the typed field;
    // duplicates, or part lines with their own sub-records, stay verbatim.
    if (field && child.value && child.children.length === 0 && parts[field] === undefined) {
      parts[field] = child.value;
    } else {
      extra.push(child);
    }
  }

  if (nameNode.value) {
    const fromValue = splitNameValue(nameNode.value);
    const derived: DerivablePart[] = [];
    for (const part of ["given", "surname", "suffix"] as const) {
      if (parts[part] === undefined && fromValue[part] !== undefined) {
        parts[part] = fromValue[part];
        derived.push(part);
      }
    }
    if (derived.length > 0) parts.derived = derived;
  }

  if (extra.length > 0) parts.extra = extra;
  return parts;
}

/** Rebuilds a NAME line value from parts: "Prefix Given /Surname/ Suffix". */
function nameValueFromParts(name: NameParts): string {
  return [
    name.prefix,
    name.given,
    name.surname !== undefined ? `/${name.surname}/` : undefined,
    name.suffix,
  ]
    .filter((p) => p !== undefined && p !== "")
    .join(" ");
}

const NAME_VALUE_PARTS = ["given", "surname", "prefix", "suffix"] as const;

/**
 * The one correct way to edit a name: applies the patch in place (works on
 * an Immer draft) and, if any part that appears in the NAME line value
 * changed, drops the imported `full` value so export rebuilds it from the
 * edited parts instead of writing back the stale original.
 */
export function applyNamePatch(name: NameParts, patch: Partial<NameParts>): void {
  const valueChanged = NAME_VALUE_PARTS.some((k) => k in patch && patch[k] !== name[k]);
  Object.assign(name, patch);
  if (valueChanged && !("full" in patch)) delete name.full;
}

function nameToGedcomNode(name: NameParts): GedcomNode {
  const children: GedcomNode[] = [];
  for (const tag of Object.keys(NAME_PART_TAGS) as NamePartTag[]) {
    const field = NAME_PART_TAGS[tag];
    const value = name[field];
    if (!value || name.derived?.includes(field as DerivablePart)) continue;
    children.push({ level: 2, tag, value, children: [] });
  }
  if (name.extra) children.push(...name.extra);
  return { level: 1, tag: "NAME", value: name.full ?? nameValueFromParts(name), children };
}

// ---------------------------------------------------------------------------
// Events

const LIFTED_EVENT_FIELDS = { DATE: "date", PLAC: "place", NOTE: "note" } as const;

function parseEvent(node: GedcomNode): EventFact {
  const event: EventFact = { tag: node.tag };
  if (node.value !== undefined) event.value = node.value;
  const extra: GedcomNode[] = [];

  for (const child of node.children) {
    const field = LIFTED_EVENT_FIELDS[child.tag as LiftedEventTag];
    // Only the first DATE/PLAC/NOTE (with a value) is lifted; a second
    // NOTE, or a PLAC with no value, stays verbatim in `extra`.
    if (field && child.value && event[field] === undefined) {
      event[field] = child.value;
      if (child.children.length > 0) {
        event.attached = { ...event.attached, [child.tag]: child.children };
      }
    } else {
      extra.push(child);
    }
  }

  if (extra.length > 0) event.extra = extra;
  return event;
}

function eventToGedcomNode(level: number, event: EventFact): GedcomNode {
  const children: GedcomNode[] = [];
  for (const [tag, field] of Object.entries(LIFTED_EVENT_FIELDS) as [LiftedEventTag, "date" | "place" | "note"][]) {
    const value = event[field];
    if (!value) continue;
    children.push({ level: level + 1, tag, value, children: event.attached?.[tag] ?? [] });
  }
  if (event.extra) children.push(...event.extra);
  return { level, tag: event.tag, value: event.value, children };
}

// ---------------------------------------------------------------------------
// GEDCOM -> model

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

/** Records a pointer line's sub-records into a keyed map, if it has any. */
function keepLinkExtra(
  map: Record<string, GedcomNode[]> | undefined,
  key: string,
  node: GedcomNode,
): Record<string, GedcomNode[]> | undefined {
  if (node.children.length === 0) return map;
  return { ...map, [key]: node.children };
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
    const value = child.value;
    switch (child.tag) {
      case "NAME":
        indi.names.push(parseName(child));
        continue;
      case "SEX":
        if (indi.sex === undefined && child.children.length === 0 && isSex(value)) {
          indi.sex = value;
          continue;
        }
        break; // unrecognised value or duplicate: keep verbatim
      case "BIRT":
      case "DEAT": {
        // First one is *the* birth/death; later ones are alternate facts
        // (common in Ancestry exports) and are kept as ordinary events.
        const key = child.tag === "BIRT" ? "birth" : "death";
        if (indi[key] === undefined) indi[key] = parseEvent(child);
        else indi.events.push(parseEvent(child));
        continue;
      }
      case "FAMC":
        if (value && !indi.familyAsChild.includes(value)) {
          indi.familyAsChild.push(value);
          indi.familyAsChildExtra = keepLinkExtra(indi.familyAsChildExtra, value, child);
          continue;
        }
        break;
      case "FAMS":
        if (value && !indi.familyAsSpouse.includes(value)) {
          indi.familyAsSpouse.push(value);
          indi.familyAsSpouseExtra = keepLinkExtra(indi.familyAsSpouseExtra, value, child);
          continue;
        }
        break;
      case "NOTE":
        // Notes with their own sub-records (e.g. a SOUR citation) stay
        // verbatim until notes are modeled properly (Phase 4b).
        if (value && child.children.length === 0) {
          indi.notes.push(value);
          continue;
        }
        break;
      default:
        if (isEventTag(child.tag)) {
          indi.events.push(parseEvent(child));
          continue;
        }
    }
    indi.extra.push(child);
  }

  return indi;
}

function isSex(value: string | undefined): value is Sex {
  return value === "M" || value === "F" || value === "X" || value === "U";
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
    const value = child.value;
    switch (child.tag) {
      case "HUSB":
      case "WIFE": {
        const role = child.tag === "HUSB" ? "husband" : "wife";
        if (value && fam[role] === undefined) {
          fam[role] = value;
          fam.memberExtra = keepLinkExtra(fam.memberExtra, value, child);
          continue;
        }
        break;
      }
      case "CHIL":
        if (value && !fam.children.includes(value)) {
          fam.children.push(value);
          fam.memberExtra = keepLinkExtra(fam.memberExtra, value, child);
          continue;
        }
        break;
      case "MARR":
        if (fam.marriage === undefined) fam.marriage = parseEvent(child);
        else fam.events.push(parseEvent(child));
        continue;
      case "NOTE":
        if (value && child.children.length === 0) {
          fam.notes.push(value);
          continue;
        }
        break;
      default:
        if (isEventTag(child.tag)) {
          fam.events.push(parseEvent(child));
          continue;
        }
    }
    fam.extra.push(child);
  }

  return fam;
}

// ---------------------------------------------------------------------------
// model -> GEDCOM

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

function pointerNode(tag: string, value: string, extra: Record<string, GedcomNode[]> | undefined): GedcomNode {
  return { level: 1, tag, value, children: extra?.[value] ?? [] };
}

function individualToGedcomNode(indi: Individual): GedcomNode {
  const children: GedcomNode[] = [];
  for (const name of indi.names) children.push(nameToGedcomNode(name));
  if (indi.sex) children.push({ level: 1, tag: "SEX", value: indi.sex, children: [] });
  if (indi.birth) children.push(eventToGedcomNode(1, indi.birth));
  if (indi.death) children.push(eventToGedcomNode(1, indi.death));
  for (const event of indi.events) children.push(eventToGedcomNode(1, event));
  for (const famc of indi.familyAsChild) children.push(pointerNode("FAMC", famc, indi.familyAsChildExtra));
  for (const fams of indi.familyAsSpouse) children.push(pointerNode("FAMS", fams, indi.familyAsSpouseExtra));
  for (const note of indi.notes) children.push({ level: 1, tag: "NOTE", value: note, children: [] });
  children.push(...indi.extra);

  return { level: 0, xref: indi.id, tag: "INDI", children };
}

function familyToGedcomNode(fam: Family): GedcomNode {
  const children: GedcomNode[] = [];
  if (fam.husband) children.push(pointerNode("HUSB", fam.husband, fam.memberExtra));
  if (fam.wife) children.push(pointerNode("WIFE", fam.wife, fam.memberExtra));
  for (const child of fam.children) children.push(pointerNode("CHIL", child, fam.memberExtra));
  if (fam.marriage) children.push(eventToGedcomNode(1, fam.marriage));
  for (const event of fam.events) children.push(eventToGedcomNode(1, event));
  for (const note of fam.notes) children.push({ level: 1, tag: "NOTE", value: note, children: [] });
  children.push(...fam.extra);

  return { level: 0, xref: fam.id, tag: "FAM", children };
}
