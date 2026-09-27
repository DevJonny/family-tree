"use client";

import { useEffect, useRef, useState } from "react";
import type { Draft } from "immer";
import { useFamilyTreeStore } from "@/lib/store/familyTreeStore";
import { FAMILY_EVENT_TAGS, labelForEventTag } from "@/lib/gedcom/eventTags";
import { personDisplayName, type FamilyTree } from "@/lib/gedcom/model";
import { CitationList } from "@/components/CitationList";
import { NoteList } from "@/components/NoteRow";
import { EventFields, FactSources, otherEventLabel, SECTION_HEADING, SlotFact } from "@/components/facts";

type OpenPerson = (id: string, familyId?: string) => void;

const SUBHEADING = "text-[11px] font-medium text-neutral-500";

/** A person's name as a link to their Details, scrolled to `familyId`. */
function PersonLink({ id, familyId, onOpenPerson }: { id: string; familyId: string; onOpenPerson: OpenPerson }) {
  const individual = useFamilyTreeStore((s) => s.tree.individuals[id]);
  if (!individual) return <span className="font-mono text-neutral-400">{id}</span>;
  return (
    <button onClick={() => onOpenPerson(id, familyId)} className="text-blue-600 hover:underline">
      {personDisplayName(individual)}
    </button>
  );
}

/** A family's own facts: marriage, other family events, notes and family-level citations. */
export function FamilyFacts({ famId }: { famId: string }) {
  const family = useFamilyTreeStore((s) => s.tree.families[famId]);
  const updateFamily = useFamilyTreeStore((s) => s.updateFamily);
  const [newEventTag, setNewEventTag] = useState(FAMILY_EVENT_TAGS[0].tag);
  if (!family) return null;
  const fam = (d: Draft<FamilyTree>) => d.families[famId];

  return (
    <div className="space-y-4">
      <SlotFact
        title="Marriage"
        fact={family.marriage}
        ownerId={famId}
        onChange={(patch, label) =>
          updateFamily(famId, (d) => void Object.assign((d.marriage ??= { tag: "MARR" }), patch), label)
        }
        locate={(d) => (fam(d).marriage ??= { tag: "MARR" })}
      />

      <section className="space-y-2">
        <h3 className={SECTION_HEADING}>Other family events</h3>
        {family.events.map((event, i) => (
          <div key={i} className="space-y-1">
            <div className="text-xs font-medium text-neutral-600">{otherEventLabel(event.tag)}</div>
            <EventFields
              event={event}
              onChange={(patch) =>
                updateFamily(
                  famId,
                  (d) => void Object.assign(d.events[i], patch),
                  `Edit ${otherEventLabel(event.tag).toLowerCase()}`,
                )
              }
              onRemove={() =>
                updateFamily(
                  famId,
                  (d) => void d.events.splice(i, 1),
                  `Remove ${otherEventLabel(event.tag).toLowerCase()}`,
                )
              }
            />
            <FactSources
              ownerId={famId}
              what={otherEventLabel(event.tag).toLowerCase()}
              citations={event.citations}
              locateCitations={(d) => (fam(d).events[i].citations ??= [])}
              notes={event.notes}
              locateNotes={(d) => (fam(d).events[i].notes ??= [])}
            />
          </div>
        ))}
        <div className="flex items-center gap-2">
          <select
            aria-label="Family event to add"
            value={newEventTag}
            onChange={(e) => setNewEventTag(e.target.value)}
            className="rounded border border-neutral-200 px-2 py-1 text-xs"
          >
            {FAMILY_EVENT_TAGS.map((opt) => (
              <option key={opt.tag} value={opt.tag}>
                {opt.label}
              </option>
            ))}
          </select>
          <button
            onClick={() =>
              updateFamily(
                famId,
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
        <h3 className={SECTION_HEADING}>Family notes</h3>
        <NoteList notes={family.notes} locate={(d) => fam(d).notes} ownerId={famId} compact />
      </section>

      <section className="space-y-2">
        <h3 className={SECTION_HEADING}>Family citations</h3>
        <CitationList citations={family.citations} locate={(d) => fam(d).citations} ownerId={famId} what="family" />
      </section>
    </div>
  );
}

/** Scrolls to and briefly highlights the block for `famId` when it's the one asked for. */
function useFocus(famId: string, focusFamilyId: string | null | undefined, onFocusHandled?: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const focused = focusFamilyId === famId;
  useEffect(() => {
    if (!focused) return;
    ref.current?.scrollIntoView({ block: "start" });
    onFocusHandled?.();
  }, [focused, onFocusHandled]);
  return ref;
}

/** One family this person is a spouse/partner in (FAMS). */
function SpouseFamilyBlock({
  personId,
  famId,
  onOpenPerson,
  focusFamilyId,
  onFocusHandled,
}: {
  personId: string;
  famId: string;
  onOpenPerson: OpenPerson;
  focusFamilyId?: string | null;
  onFocusHandled?: () => void;
}) {
  const family = useFamilyTreeStore((s) => s.tree.families[famId]);
  const ref = useFocus(famId, focusFamilyId, onFocusHandled);
  // Stays highlighted until another family is focused or Details remounts.
  const [highlighted, setHighlighted] = useState(focusFamilyId === famId);
  const [prevFocus, setPrevFocus] = useState(focusFamilyId);
  if (focusFamilyId !== prevFocus) {
    setPrevFocus(focusFamilyId);
    if (focusFamilyId) setHighlighted(focusFamilyId === famId);
  }

  if (!family) {
    return (
      <p className="text-xs text-neutral-400">
        Linked to family <span className="font-mono">{famId}</span>, which isn&apos;t in the file.
      </p>
    );
  }
  const spouse = family.husband === personId ? family.wife : family.husband;

  return (
    <div
      ref={ref}
      data-family-id={famId}
      className={`scroll-mt-4 space-y-3 rounded border p-3 ${highlighted ? "border-blue-300 bg-blue-50/40" : "border-neutral-200"}`}
    >
      <div className="flex items-baseline gap-2 text-sm">
        <span className="text-neutral-500">With</span>
        {spouse ? (
          <PersonLink id={spouse} familyId={famId} onOpenPerson={onOpenPerson} />
        ) : (
          <span className="text-neutral-400">(unknown spouse)</span>
        )}
        <span className="ml-auto font-mono text-[11px] text-neutral-400">{famId}</span>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs">
        <span className={SUBHEADING}>Children</span>
        {family.children.length === 0 && <span className="text-neutral-400">none recorded</span>}
        {family.children.map((childId, i) => (
          <span key={childId}>
            <PersonLink id={childId} familyId={famId} onOpenPerson={onOpenPerson} />
            {i < family.children.length - 1 && ","}
          </span>
        ))}
      </div>
      <FamilyFacts famId={famId} />
    </div>
  );
}

/** "Families": one block per family this person is a spouse/partner in. */
export function FamiliesSection({
  personId,
  onOpenPerson,
  focusFamilyId,
  onFocusHandled,
}: {
  personId: string;
  onOpenPerson: OpenPerson;
  focusFamilyId?: string | null;
  onFocusHandled?: () => void;
}) {
  const familyIds = useFamilyTreeStore((s) => s.tree.individuals[personId]?.familyAsSpouse);
  if (!familyIds) return null;

  return (
    <section className="space-y-2">
      <h3 className={SECTION_HEADING}>Families</h3>
      {familyIds.length === 0 && <p className="text-xs text-neutral-400">No spouse or partner recorded.</p>}
      {familyIds.map((famId) => (
        <SpouseFamilyBlock
          key={famId}
          personId={personId}
          famId={famId}
          onOpenPerson={onOpenPerson}
          focusFamilyId={focusFamilyId}
          onFocusHandled={onFocusHandled}
        />
      ))}
    </section>
  );
}
