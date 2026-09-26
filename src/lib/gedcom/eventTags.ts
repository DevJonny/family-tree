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

/** Tags the model gives their own slot (birth, death, marriage), so they aren't in the "add" picker. */
const OTHER_LABELS: Record<string, string> = {
  BIRT: "Birth",
  DEAT: "Death",
  MARR: "Marriage",
  DIV: "Divorce",
  ENGA: "Engagement",
};

export function labelForEventTag(tag: string): string {
  return INDIVIDUAL_EVENT_TAGS.find((e) => e.tag === tag)?.label ?? OTHER_LABELS[tag] ?? tag;
}
