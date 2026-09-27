"use client";

import { useState } from "react";
import { useFamilyTreeStore } from "@/lib/store/familyTreeStore";
import { INDIVIDUAL_EVENT_TAGS, labelForEventTag } from "@/lib/gedcom/eventTags";
import { TextField } from "@/components/fields";
import type { Draft } from "immer";
import { applyNamePatch, type FamilyTree, type NameParts, type Sex } from "@/lib/gedcom/model";
import { CitationList } from "@/components/CitationList";
import { NoteList } from "@/components/NoteRow";
import { EventFields, FactSources, otherEventLabel, SECTION_HEADING, SlotFact } from "@/components/facts";
import { FamiliesSection, ParentsSection } from "@/components/FamilySections";

const SEX_OPTIONS: { value: Sex | ""; label: string }[] = [
  { value: "", label: "Unknown" },
  { value: "M", label: "Male" },
  { value: "F", label: "Female" },
  { value: "X", label: "Other" },
  { value: "U", label: "Unrecorded" },
];

function NameFields({
  name,
  onChange,
  onRemove,
}: {
  name: NameParts;
  onChange: (patch: Partial<NameParts>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="grid grid-cols-[1fr_1fr_1fr_auto] items-end gap-2">
      <TextField label="Given" value={name.given ?? ""} onChange={(v) => onChange({ given: v || undefined })} />
      <TextField label="Surname" value={name.surname ?? ""} onChange={(v) => onChange({ surname: v || undefined })} />
      <TextField label="Type" value={name.type ?? ""} onChange={(v) => onChange({ type: v || undefined })} placeholder="birth, married, ..." />
      <button onClick={onRemove} className="pb-1 text-xs text-red-500 hover:text-red-700">
        Remove
      </button>
    </div>
  );
}

export function PersonDetailPanel({
  id,
  onOpenPerson,
  focusFamilyId,
  onFocusHandled,
}: {
  id: string;
  /** Opens someone's Details, optionally scrolled to one of their families. */
  onOpenPerson: (id: string, familyId?: string) => void;
  /** A family to scroll to and highlight once, e.g. from Sources "Cited by". */
  focusFamilyId?: string | null;
  onFocusHandled?: () => void;
}) {
  const tree = useFamilyTreeStore((s) => s.tree);
  const updateIndividual = useFamilyTreeStore((s) => s.updateIndividual);
  const [newEventTag, setNewEventTag] = useState(INDIVIDUAL_EVENT_TAGS[0].tag);

  const individual = tree.individuals[id];
  if (!individual) return null;
  const person = (d: Draft<FamilyTree>) => d.individuals[id];

  return (
    <div className="space-y-5 p-4 text-sm">
      <section className="space-y-2">
        <h3 className={SECTION_HEADING}>Names</h3>
        {individual.names.map((name, i) => (
          <div key={i} className="space-y-1">
            <NameFields
              name={name}
              onChange={(patch) =>
                updateIndividual(id, (d) => applyNamePatch(d.names[i], patch), "Edit name")
              }
              onRemove={() =>
                updateIndividual(id, (d) => void d.names.splice(i, 1), "Remove name")
              }
            />
            <FactSources
              ownerId={id}
              what="name"
              citations={name.citations}
              locateCitations={(d) => (person(d).names[i].citations ??= [])}
            />
          </div>
        ))}
        <button
          onClick={() =>
            updateIndividual(id, (d) => void d.names.push({ given: "", surname: "" }), "Add name")
          }
          className="text-xs text-blue-600 hover:underline"
        >
          + Add name
        </button>
      </section>

      <section className="grid grid-cols-2 gap-4">
        <label className="flex flex-col gap-0.5 text-xs text-neutral-500">
          Sex
          <select
            value={individual.sex ?? ""}
            onChange={(e) =>
              updateIndividual(
                id,
                (d) => void (d.sex = (e.target.value || undefined) as Sex | undefined),
                "Edit sex",
              )
            }
            className="rounded border border-neutral-200 px-2 py-1 text-sm"
          >
            {SEX_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      </section>

      <SlotFact
        title="Birth"
        fact={individual.birth}
        ownerId={id}
        onChange={(patch, label) =>
          updateIndividual(id, (d) => void Object.assign((d.birth ??= { tag: "BIRT" }), patch), label)
        }
        locate={(d) => (person(d).birth ??= { tag: "BIRT" })}
      />

      <SlotFact
        title="Death"
        fact={individual.death}
        ownerId={id}
        onChange={(patch, label) =>
          updateIndividual(id, (d) => void Object.assign((d.death ??= { tag: "DEAT" }), patch), label)
        }
        locate={(d) => (person(d).death ??= { tag: "DEAT" })}
      />

      <section className="space-y-2">
        <h3 className={SECTION_HEADING}>Other events</h3>
        {individual.events.map((event, i) => (
          <div key={i} className="space-y-1">
            <div className="text-xs font-medium text-neutral-600">{otherEventLabel(event.tag)}</div>
            <EventFields
              event={event}
              onChange={(patch) =>
                updateIndividual(id, (d) => Object.assign(d.events[i], patch), "Edit event")
              }
              onRemove={() =>
                updateIndividual(id, (d) => void d.events.splice(i, 1), "Remove event")
              }
            />
            <FactSources
              ownerId={id}
              what={otherEventLabel(event.tag).toLowerCase()}
              citations={event.citations}
              locateCitations={(d) => (person(d).events[i].citations ??= [])}
              notes={event.notes}
              locateNotes={(d) => (person(d).events[i].notes ??= [])}
            />
          </div>
        ))}
        <div className="flex items-center gap-2">
          <select
            value={newEventTag}
            onChange={(e) => setNewEventTag(e.target.value)}
            className="rounded border border-neutral-200 px-2 py-1 text-xs"
          >
            {INDIVIDUAL_EVENT_TAGS.map((opt) => (
              <option key={opt.tag} value={opt.tag}>
                {opt.label}
              </option>
            ))}
          </select>
          <button
            onClick={() =>
              updateIndividual(
                id,
                (d) => void d.events.push({ tag: newEventTag }),
                `Add ${labelForEventTag(newEventTag).toLowerCase()}`,
              )
            }
            className="text-xs text-blue-600 hover:underline"
          >
            + Add event
          </button>
        </div>
      </section>

      <section className="space-y-2">
        <h3 className={SECTION_HEADING}>Notes</h3>
        <NoteList notes={individual.notes} locate={(d) => person(d).notes} ownerId={id} />
      </section>

      <section className="space-y-2">
        <h3 className={SECTION_HEADING}>Other citations</h3>
        <p className="text-xs text-neutral-400">Sources for this person as a whole rather than one fact.</p>
        <CitationList
          citations={individual.citations}
          locate={(d) => person(d).citations}
          ownerId={id}
          what="person"
        />
      </section>

      <ParentsSection
        personId={id}
        onOpenPerson={onOpenPerson}
        focusFamilyId={focusFamilyId}
        onFocusHandled={onFocusHandled}
      />

      <FamiliesSection
        personId={id}
        onOpenPerson={onOpenPerson}
        focusFamilyId={focusFamilyId}
        onFocusHandled={onFocusHandled}
      />
    </div>
  );
}
