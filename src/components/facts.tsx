"use client";

import type { Draft } from "immer";
import { TextField } from "@/components/fields";
import { CitationList } from "@/components/CitationList";
import { NoteList } from "@/components/NoteRow";
import { labelForEventTag } from "@/lib/gedcom/eventTags";
import type { EventFact, FamilyTree } from "@/lib/gedcom/model";
import type { Citation, Note } from "@/lib/gedcom/sources";

/** The fact editors shared by a person's Details and the family blocks in it. */

export const SECTION_HEADING = "text-xs font-semibold uppercase tracking-wide text-neutral-400";

export function EventFields({
  event,
  onChange,
  onRemove,
}: {
  event: EventFact;
  onChange: (patch: Partial<EventFact>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2">
      <TextField label="Value" value={event.value ?? ""} onChange={(v) => onChange({ value: v || undefined })} />
      <TextField label="Date" value={event.date ?? ""} onChange={(v) => onChange({ date: v || undefined })} />
      <TextField label="Place" value={event.place ?? ""} onChange={(v) => onChange({ place: v || undefined })} />
      <button onClick={onRemove} className="pb-1 text-xs text-red-500 hover:text-red-700">
        Remove
      </button>
    </div>
  );
}

/**
 * The citations and notes under one fact or name, indented so it's clear
 * which fact they belong to.
 */
export function FactSources({
  ownerId,
  what,
  citations,
  locateCitations,
  notes,
  locateNotes,
}: {
  ownerId: string;
  what: string;
  citations: Citation[] | undefined;
  locateCitations: (d: Draft<FamilyTree>) => Citation[];
  notes?: Note[];
  locateNotes?: (d: Draft<FamilyTree>) => Note[];
}) {
  return (
    <div className="ml-1 space-y-1 border-l-2 border-neutral-100 pl-2">
      <CitationList citations={citations} locate={locateCitations} ownerId={ownerId} what={what} />
      {locateNotes && <NoteList notes={notes} locate={locateNotes} ownerId={ownerId} compact />}
    </div>
  );
}

/** An alternate BIRT/DEAT/MARR (a second one, common in Ancestry exports) reads better with a prefix. */
export function otherEventLabel(tag: string): string {
  const label = labelForEventTag(tag);
  return tag === "BIRT" || tag === "DEAT" || tag === "MARR" ? `Alternate ${label.toLowerCase()}` : label;
}

/**
 * Date and place of a fact with its own slot (birth, death, marriage),
 * with its citations and notes underneath. `locate` finds the fact in a
 * draft tree, creating it if needed.
 */
export function SlotFact({
  title,
  fact,
  ownerId,
  onChange,
  locate,
}: {
  title: string;
  fact: EventFact | undefined;
  ownerId: string;
  onChange: (patch: Partial<EventFact>, label: string) => void;
  locate: (d: Draft<FamilyTree>) => Draft<EventFact>;
}) {
  const what = title.toLowerCase();
  return (
    <section className="space-y-2">
      <h3 className={SECTION_HEADING}>{title}</h3>
      <div className="grid grid-cols-2 gap-2">
        <TextField
          label="Date"
          value={fact?.date ?? ""}
          onChange={(v) => onChange({ date: v || undefined }, `Edit ${what} date`)}
        />
        <TextField
          label="Place"
          value={fact?.place ?? ""}
          onChange={(v) => onChange({ place: v || undefined }, `Edit ${what} place`)}
        />
      </div>
      <FactSources
        ownerId={ownerId}
        what={what}
        citations={fact?.citations}
        locateCitations={(d) => (locate(d).citations ??= [])}
        notes={fact?.notes}
        locateNotes={(d) => (locate(d).notes ??= [])}
      />
    </section>
  );
}
