/**
 * Common GEDCOM 5.5.1 individual event/attribute tags, for populating an
 * "add event" picker in the UI. Not exhaustive — any tag can still be
 * imported and round-tripped (see model.ts's generic event handling);
 * this list is just what the UI offers to *add* directly, plus a custom
 * option for anything else.
 */
export const INDIVIDUAL_EVENT_TAGS: { tag: string; label: string }[] = [
  { tag: "BAPM", label: "Baptism" },
  { tag: "CHR", label: "Christening" },
  { tag: "BURI", label: "Burial" },
  { tag: "CREM", label: "Cremation" },
  { tag: "ADOP", label: "Adoption" },
  { tag: "GRAD", label: "Graduation" },
  { tag: "RETI", label: "Retirement" },
  { tag: "OCCU", label: "Occupation" },
  { tag: "EDUC", label: "Education" },
  { tag: "RESI", label: "Residence" },
  { tag: "EMIG", label: "Emigration" },
  { tag: "IMMI", label: "Immigration" },
  { tag: "NATU", label: "Naturalization" },
  { tag: "CENS", label: "Census" },
  { tag: "PROB", label: "Probate" },
  { tag: "WILL", label: "Will" },
  { tag: "EVEN", label: "Other event" },
  { tag: "FACT", label: "Other fact" },
];

/**
 * The GEDCOM 5.5.1 family events, for the family editor's "add event"
 * picker. MARR isn't here because the first marriage has its own block
 * (`Family.marriage`), like birth and death on a person.
 */
export const FAMILY_EVENT_TAGS: { tag: string; label: string }[] = [
  { tag: "ENGA", label: "Engagement" },
  { tag: "MARB", label: "Marriage banns" },
  { tag: "MARC", label: "Marriage contract" },
  { tag: "MARL", label: "Marriage license" },
  { tag: "MARS", label: "Marriage settlement" },
  { tag: "DIVF", label: "Divorce filed" },
  { tag: "DIV", label: "Divorce" },
  { tag: "ANUL", label: "Annulment" },
  { tag: "CENS", label: "Census" },
  { tag: "RESI", label: "Residence" },
  { tag: "EVEN", label: "Other event" },
];

/** Tags the model gives their own slot (birth, death, marriage), so they aren't in either picker. */
const OTHER_LABELS: Record<string, string> = {
  BIRT: "Birth",
  DEAT: "Death",
  MARR: "Marriage",
};

export function labelForEventTag(tag: string): string {
  return (
    INDIVIDUAL_EVENT_TAGS.find((e) => e.tag === tag)?.label ??
    FAMILY_EVENT_TAGS.find((e) => e.tag === tag)?.label ??
    OTHER_LABELS[tag] ??
    tag
  );
}
