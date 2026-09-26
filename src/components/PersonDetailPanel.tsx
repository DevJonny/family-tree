"use client";

import { useState } from "react";
import { useFamilyTreeStore } from "@/lib/store/familyTreeStore";
import { INDIVIDUAL_EVENT_TAGS, labelForEventTag } from "@/lib/gedcom/eventTags";
import { TextAreaField, TextField } from "@/components/fields";
import { applyNamePatch, type EventFact, type NameParts, type Sex } from "@/lib/gedcom/model";

const SEX_OPTIONS: { value: Sex | ""; label: string }[] = [
  { value: "", label: "Unknown" },
  { value: "M", label: "Male" },
  { value: "F", label: "Female" },
  { value: "X", label: "Other" },
  { value: "U", label: "Unrecorded" },
];

function EventFields({
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

export function PersonDetailPanel({ id }: { id: string }) {
  const tree = useFamilyTreeStore((s) => s.tree);
  const updateIndividual = useFamilyTreeStore((s) => s.updateIndividual);
  const [newEventTag, setNewEventTag] = useState(INDIVIDUAL_EVENT_TAGS[0].tag);
  const [newNote, setNewNote] = useState("");

  const individual = tree.individuals[id];
  if (!individual) return null;

  return (
    <div className="space-y-5 p-4 text-sm">
      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Names</h3>
        {individual.names.map((name, i) => (
          <NameFields
            key={i}
            name={name}
            onChange={(patch) =>
              updateIndividual(id, (d) => applyNamePatch(d.names[i], patch), "Edit name")
            }
            onRemove={() =>
              updateIndividual(id, (d) => void d.names.splice(i, 1), "Remove name")
            }
          />
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

      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Birth</h3>
        <div className="grid grid-cols-2 gap-2">
          <TextField
            label="Date"
            value={individual.birth?.date ?? ""}
            onChange={(v) =>
              updateIndividual(
                id,
                (d) => void (d.birth = { tag: "BIRT", ...d.birth, date: v || undefined }),
                "Edit birth date",
              )
            }
          />
          <TextField
            label="Place"
            value={individual.birth?.place ?? ""}
            onChange={(v) =>
              updateIndividual(
                id,
                (d) => void (d.birth = { tag: "BIRT", ...d.birth, place: v || undefined }),
                "Edit birth place",
              )
            }
          />
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Death</h3>
        <div className="grid grid-cols-2 gap-2">
          <TextField
            label="Date"
            value={individual.death?.date ?? ""}
            onChange={(v) =>
              updateIndividual(
                id,
                (d) => void (d.death = { tag: "DEAT", ...d.death, date: v || undefined }),
                "Edit death date",
              )
            }
          />
          <TextField
            label="Place"
            value={individual.death?.place ?? ""}
            onChange={(v) =>
              updateIndividual(
                id,
                (d) => void (d.death = { tag: "DEAT", ...d.death, place: v || undefined }),
                "Edit death place",
              )
            }
          />
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Other events</h3>
        {individual.events.map((event, i) => (
          <div key={i} className="space-y-1">
            <div className="text-xs font-medium text-neutral-600">{labelForEventTag(event.tag)}</div>
            <EventFields
              event={event}
              onChange={(patch) =>
                updateIndividual(id, (d) => Object.assign(d.events[i], patch), "Edit event")
              }
              onRemove={() =>
                updateIndividual(id, (d) => void d.events.splice(i, 1), "Remove event")
              }
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
        <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-400">Notes</h3>
        {individual.notes.map((note, i) => (
          <div key={i} className="flex items-start gap-2">
            <TextAreaField
              value={note}
              onChange={(v) =>
                updateIndividual(id, (d) => void (d.notes[i] = v), "Edit note")
              }
              rows={2}
              className="flex-1 rounded border border-neutral-200 px-2 py-1 text-sm"
            />
            <button
              onClick={() => updateIndividual(id, (d) => void d.notes.splice(i, 1), "Remove note")}
              className="text-xs text-red-500 hover:text-red-700"
            >
              Remove
            </button>
          </div>
        ))}
        <div className="flex items-start gap-2">
          <textarea
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            placeholder="Add a note…"
            rows={2}
            className="flex-1 rounded border border-neutral-200 px-2 py-1 text-sm"
          />
          <button
            onClick={() => {
              if (!newNote.trim()) return;
              updateIndividual(id, (d) => void d.notes.push(newNote), "Add note");
              setNewNote("");
            }}
            className="text-xs text-blue-600 hover:underline"
          >
            + Add
          </button>
        </div>
      </section>
    </div>
  );
}
