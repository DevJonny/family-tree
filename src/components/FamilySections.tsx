"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Draft } from "immer";
import { useFamilyTreeStore } from "@/lib/store/familyTreeStore";
import { FAMILY_EVENT_TAGS, labelForEventTag } from "@/lib/gedcom/eventTags";
import { personDisplayName, type FamilyTree } from "@/lib/gedcom/model";
import {
  addChild,
  addSpouse,
  familyContents,
  joinableFamilies,
  newFamily,
  pedigreeOf,
  removalDeletesFamily,
  removeFromFamily,
  setPedigree,
} from "@/lib/gedcom/membership";
import { addPerson, nameFromTyped } from "@/lib/gedcom/people";
import { PersonPicker } from "@/components/PersonPicker";
import { CitationList } from "@/components/CitationList";
import { NoteList } from "@/components/NoteRow";
import { EventFields, FactSources, otherEventLabel, SECTION_HEADING, SlotFact } from "@/components/facts";

type OpenPerson = (id: string, familyId?: string) => void;

const SUBHEADING = "text-[11px] font-medium text-neutral-500";

function nameOf(tree: FamilyTree, id: string | undefined): string {
  const person = id ? tree.individuals[id] : undefined;
  return person ? personDisplayName(person) : (id ?? "unknown");
}

/**
 * A person's name as a link to their Details, scrolled to `familyId`. The
 * person whose Details this is shows as plain text, marked "(this person)".
 */
function PersonLink({
  id,
  familyId,
  viewerId,
  onOpenPerson,
}: {
  id: string;
  familyId: string;
  viewerId?: string;
  onOpenPerson: OpenPerson;
}) {
  const individual = useFamilyTreeStore((s) => s.tree.individuals[id]);
  if (!individual) return <span className="font-mono text-neutral-400">{id}</span>;
  if (id === viewerId) {
    return (
      <span className="text-neutral-900">
        {personDisplayName(individual)} <span className="text-neutral-400">(this person)</span>
      </span>
    );
  }
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

/**
 * Taking someone out of a family, behind an in-page warning when that
 * leaves the family empty and it holds facts, notes or citations (an empty
 * family is deleted, since nothing could reach it). Undo brings it all back.
 */
function useRemoveMember(famId: string) {
  const updateTree = useFamilyTreeStore((s) => s.updateTree);
  const [pending, setPending] = useState<{ personId: string; contents: string[] } | null>(null);

  const remove = (personId: string) => {
    const tree = useFamilyTreeStore.getState().tree;
    updateTree((d) => removeFromFamily(d, famId, personId), `Remove ${nameOf(tree, personId)} from family`);
    setPending(null);
  };
  const request = (personId: string) => {
    const tree = useFamilyTreeStore.getState().tree;
    const contents = removalDeletesFamily(tree, famId, personId) ? familyContents(tree, famId) : [];
    if (contents.length) setPending({ personId, contents });
    else remove(personId);
  };

  const warning = pending && (
    <div role="alert" className="space-y-2 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-800">
      <p>
        That leaves no one in this family, so it will be deleted, along with: {pending.contents.join(", ")}. You can
        undo it.
      </p>
      <div className="flex gap-3">
        <button
          onClick={() => remove(pending.personId)}
          className="rounded bg-red-600 px-2 py-1 font-medium text-white hover:bg-red-700"
        >
          Remove and delete family
        </button>
        <button onClick={() => setPending(null)} className="text-neutral-600 hover:underline">
          Cancel
        </button>
      </div>
    </div>
  );
  return { request, warning };
}

function RemoveButton({ onClick, title }: { onClick: () => void; title: string }) {
  return (
    <button onClick={onClick} title={title} aria-label={title} className="text-red-400 hover:text-red-600">
      ✕
    </button>
  );
}

/** "Ancestry: father Adopted, mother Natural", from _FREL/_MREL under this child's CHIL line. */
function ancestryRelationship(tree: FamilyTree, famId: string, childId: string): string | undefined {
  const nodes = tree.families[famId]?.memberExtra?.[childId] ?? [];
  const parts = [
    ["_FREL", "father"],
    ["_MREL", "mother"],
  ].flatMap(([tag, who]) => {
    const node = nodes.find((n) => n.tag === tag);
    return node?.value ? [`${who} ${node.value}`] : [];
  });
  return parts.length ? `Ancestry: ${parts.join(", ")}` : undefined;
}

/**
 * Who's in a family: both partners (or parents) and the children, each a
 * link with a ✕ to take them out, plus "+ Add" pickers for an empty
 * partner slot and for children.
 */
function FamilyMembers({
  famId,
  viewerId,
  partnerWord,
  onOpenPerson,
}: {
  famId: string;
  viewerId: string;
  /** "spouse" in the person's own families, "parent" in their parents'. */
  partnerWord: "spouse" | "parent";
  onOpenPerson: OpenPerson;
}) {
  const tree = useFamilyTreeStore((s) => s.tree);
  const updateTree = useFamilyTreeStore((s) => s.updateTree);
  const [adding, setAdding] = useState<"partner" | "child" | null>(null);
  const { request, warning } = useRemoveMember(famId);
  const family = tree.families[famId];
  const members = useMemo(
    () => new Set(family ? [family.husband, family.wife, ...family.children].filter((id) => id !== undefined) : []),
    [family],
  );
  if (!family) return null;

  const partners = [family.husband, family.wife].filter((id) => id !== undefined);
  const link = (role: "partner" | "child", id: string, name: string) =>
    updateTree(
      (d) => (role === "child" ? addChild(d, famId, id) : addSpouse(d, famId, id)),
      `Add ${name} as ${role === "child" ? "child" : partnerWord}`,
    );
  const create = (role: "partner" | "child", typed: string) =>
    updateTree((d) => {
      const id = addPerson(d, nameFromTyped(typed));
      if (role === "child") addChild(d, famId, id);
      else addSpouse(d, famId, id);
    }, `Add ${typed} as ${role === "child" ? "child" : partnerWord}`);
  const picker = (role: "partner" | "child") => (
    <PersonPicker
      exclude={members}
      placeholder={`Search people, or type a new ${role === "child" ? "child" : partnerWord}'s name…`}
      onPick={(id) => {
        link(role, id, nameOf(tree, id));
        setAdding(null);
      }}
      onCreate={(typed) => {
        create(role, typed);
        setAdding(null);
      }}
      onClose={() => setAdding(null)}
    />
  );

  return (
    <div className="space-y-2 text-xs">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className={SUBHEADING}>{partnerWord === "spouse" ? "Partners" : "Parents"}</span>
        {partners.map((id) => (
          <span key={id} className="inline-flex items-baseline gap-1">
            <PersonLink id={id} familyId={famId} viewerId={viewerId} onOpenPerson={onOpenPerson} />
            <RemoveButton onClick={() => request(id)} title={`Remove ${nameOf(tree, id)} from this family`} />
          </span>
        ))}
        {partners.length < 2 && adding !== "partner" && (
          <button onClick={() => setAdding("partner")} className="text-blue-600 hover:underline">
            + Add {partnerWord}
          </button>
        )}
      </div>
      {adding === "partner" && picker("partner")}

      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className={SUBHEADING}>Children</span>
        {family.children.length === 0 && <span className="text-neutral-400">none recorded</span>}
        {family.children.map((id) => {
          const child = tree.individuals[id];
          const pedigree = child ? pedigreeOf(child, famId).value : undefined;
          return (
            <span key={id} className="inline-flex items-baseline gap-1">
              <PersonLink id={id} familyId={famId} viewerId={viewerId} onOpenPerson={onOpenPerson} />
              {pedigree && pedigree.toLowerCase() !== "birth" && (
                <span className="text-neutral-400">({pedigree.toLowerCase()})</span>
              )}
              <RemoveButton onClick={() => request(id)} title={`Remove ${nameOf(tree, id)} from this family`} />
            </span>
          );
        })}
        {adding !== "child" && (
          <button onClick={() => setAdding("child")} className="text-blue-600 hover:underline">
            + Add child
          </button>
        )}
      </div>
      {adding === "child" && picker("child")}
      {warning}
    </div>
  );
}

/**
 * Scrolls to and highlights the block for `famId` when it's the one asked
 * for. PersonDetailPanel clears the request afterwards, whether or not a
 * block showed it.
 */
function useFocusedBlock(famId: string, focusFamilyId: string | null | undefined) {
  const ref = useRef<HTMLDivElement>(null);
  const focused = focusFamilyId === famId;
  useEffect(() => {
    // Instant: smooth scrolling doesn't run in a hidden tab.
    if (focused) ref.current?.scrollIntoView({ block: "start" });
  }, [focused]);
  // Stays highlighted until another family is focused or Details remounts.
  const [highlighted, setHighlighted] = useState(focused);
  const [prevFocus, setPrevFocus] = useState(focusFamilyId);
  if (focusFamilyId !== prevFocus) {
    setPrevFocus(focusFamilyId);
    if (focusFamilyId) setHighlighted(focused);
  }
  return { ref, focused, highlighted };
}

interface BlockProps {
  personId: string;
  famId: string;
  onOpenPerson: OpenPerson;
  focusFamilyId?: string | null;
}

function blockClass(highlighted: boolean): string {
  return `scroll-mt-4 space-y-3 rounded border p-3 ${highlighted ? "border-blue-300 bg-blue-50/40" : "border-neutral-200"}`;
}

function MissingFamily({ famId }: { famId: string }) {
  return (
    <p className="text-xs text-neutral-400">
      Linked to family <span className="font-mono">{famId}</span>, which isn&apos;t in the file.
    </p>
  );
}

/** One family this person is a spouse/partner in (FAMS). */
function SpouseFamilyBlock({ personId, famId, onOpenPerson, focusFamilyId }: BlockProps) {
  const family = useFamilyTreeStore((s) => s.tree.families[famId]);
  const { ref, highlighted } = useFocusedBlock(famId, focusFamilyId);
  if (!family) return <MissingFamily famId={famId} />;
  const spouse = family.husband === personId ? family.wife : family.husband;

  return (
    <div ref={ref} data-family-id={famId} className={blockClass(highlighted)}>
      <div className="flex items-baseline gap-2 text-sm">
        <span className="text-neutral-500">With</span>
        {spouse ? (
          <PersonLink id={spouse} familyId={famId} onOpenPerson={onOpenPerson} />
        ) : (
          <span className="text-neutral-400">(unknown spouse)</span>
        )}
        <span className="ml-auto font-mono text-[11px] text-neutral-400">{famId}</span>
      </div>
      <FamilyMembers famId={famId} viewerId={personId} partnerWord="spouse" onOpenPerson={onOpenPerson} />
      <FamilyFacts famId={famId} />
    </div>
  );
}

const PEDIGREE_OPTIONS = [
  { value: "birth", label: "Birth" },
  { value: "adopted", label: "Adopted" },
  { value: "foster", label: "Foster" },
  { value: "sealed", label: "Sealed (LDS)" },
];

/** This child's relationship to one family (PEDI), and Ancestry's per-parent flags read-only. */
function PedigreeField({ childId, famId }: { childId: string; famId: string }) {
  const tree = useFamilyTreeStore((s) => s.tree);
  const updateTree = useFamilyTreeStore((s) => s.updateTree);
  const child = tree.individuals[childId];
  if (!child) return null;
  const { value, editable } = pedigreeOf(child, famId);
  // Match the file's value whatever its case (GEDCOM 7 writes ADOPTED); an
  // unknown one gets its own option so it isn't shown as something else.
  const known = PEDIGREE_OPTIONS.find((o) => o.value === value?.toLowerCase());
  const selected = known?.value ?? value ?? "";
  const ancestry = ancestryRelationship(tree, famId, childId);

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <label className="flex items-center gap-1 text-neutral-500">
        Relationship
        <select
          value={selected}
          disabled={!editable}
          title={editable ? undefined : "Recorded in a form this app can't edit yet"}
          onChange={(e) => {
            const next = e.target.value || undefined;
            const label = PEDIGREE_OPTIONS.find((o) => o.value === next)?.label.toLowerCase() ?? "not recorded";
            updateTree((d) => setPedigree(d, childId, famId, next), `Set relationship to ${label}`);
          }}
          className="rounded border border-neutral-200 px-1 py-0.5 text-xs text-neutral-900 disabled:bg-neutral-50"
        >
          <option value="">(not recorded)</option>
          {PEDIGREE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
          {value && !known && <option value={value}>{value}</option>}
        </select>
      </label>
      {ancestry && <span className="text-neutral-400">{ancestry}</span>}
    </div>
  );
}

/** One family this person is a child in (FAMC): the parents, their relationship, and the family on demand. */
function ParentsBlock({ personId, famId, onOpenPerson, focusFamilyId }: BlockProps) {
  const family = useFamilyTreeStore((s) => s.tree.families[famId]);
  const { ref, focused, highlighted } = useFocusedBlock(famId, focusFamilyId);
  const [expanded, setExpanded] = useState(focused);
  if (focused && !expanded) setExpanded(true);
  const { request, warning } = useRemoveMember(famId);
  if (!family) return <MissingFamily famId={famId} />;
  const parents = [family.husband, family.wife].filter((id) => id !== undefined);

  return (
    <div ref={ref} data-family-id={famId} className={blockClass(highlighted)}>
      <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
        {parents.length === 0 && <span className="text-neutral-400">(unknown parents)</span>}
        {parents.map((id, i) => (
          <span key={id}>
            {i > 0 && <span className="text-neutral-400">&amp; </span>}
            <PersonLink id={id} familyId={famId} onOpenPerson={onOpenPerson} />
          </span>
        ))}
        <span className="ml-auto font-mono text-[11px] text-neutral-400">{famId}</span>
      </div>
      <PedigreeField childId={personId} famId={famId} />
      <div className="flex gap-3 text-xs">
        <button onClick={() => setExpanded(!expanded)} className="text-blue-600 hover:underline">
          {expanded ? "▾ Hide family" : "▸ Show family"}
        </button>
        <button onClick={() => request(personId)} className="text-red-500 hover:text-red-700">
          Remove from family
        </button>
      </div>
      {warning}
      {expanded && (
        <div className="space-y-3 border-t border-neutral-100 pt-3">
          <FamilyMembers famId={famId} viewerId={personId} partnerWord="parent" onOpenPerson={onOpenPerson} />
          <FamilyFacts famId={famId} />
        </div>
      )}
    </div>
  );
}

interface SectionProps {
  personId: string;
  onOpenPerson: OpenPerson;
  focusFamilyId?: string | null;
}

/**
 * "+ Add parents": pick (or create) a parent, then join one of their
 * families as a child or start a new one with them.
 */
function AddParents({ personId, onDone }: { personId: string; onDone: () => void }) {
  const tree = useFamilyTreeStore((s) => s.tree);
  const updateTree = useFamilyTreeStore((s) => s.updateTree);
  const [parentId, setParentId] = useState<string | null>(null);
  // Not themselves, nor their own spouses or children.
  const exclude = useMemo(() => {
    const person = tree.individuals[personId];
    const own = (person?.familyAsSpouse ?? []).flatMap((f) => {
      const fam = tree.families[f];
      return fam ? [fam.husband, fam.wife, ...fam.children] : [];
    });
    return new Set([personId, ...own.filter((id) => id !== undefined)]);
  }, [tree, personId]);
  const childName = nameOf(tree, personId);

  const joinNew = (parent: string) => {
    updateTree((d) => addChild(d, newFamily(d, parent), personId), `Add ${nameOf(tree, parent)} as parent`);
    onDone();
  };
  const join = (famId: string, parent: string) => {
    updateTree((d) => addChild(d, famId, personId), `Add ${childName} to ${nameOf(tree, parent)}'s family`);
    onDone();
  };

  if (!parentId) {
    return (
      <PersonPicker
        exclude={exclude}
        placeholder="Search for a parent, or type a new parent's name…"
        onPick={(id) => {
          if (joinableFamilies(tree, id, personId).length === 0) joinNew(id);
          else setParentId(id);
        }}
        onCreate={(typed) => {
          updateTree((d) => {
            const parent = addPerson(d, nameFromTyped(typed));
            addChild(d, newFamily(d, parent), personId);
          }, `Add ${typed} as parent`);
          onDone();
        }}
        onClose={onDone}
      />
    );
  }

  const parentName = nameOf(tree, parentId);
  const families = joinableFamilies(tree, parentId, personId);
  return (
    <div className="space-y-1 rounded border border-blue-200 bg-blue-50/40 p-2 text-xs">
      <p className="text-neutral-600">Which of {parentName}&apos;s families is {childName} a child of?</p>
      <ul>
        {families.map((famId) => {
          const fam = tree.families[famId];
          const other = fam.husband === parentId ? fam.wife : fam.husband;
          return (
            <li key={famId}>
              <button onClick={() => join(famId, parentId)} className="w-full rounded px-1 py-0.5 text-left hover:bg-blue-100">
                {parentName} &amp; {other ? nameOf(tree, other) : "(unknown spouse)"}
                <span className="text-neutral-500">
                  {" "}
                  · {fam.children.length} {fam.children.length === 1 ? "child" : "children"}
                </span>
              </button>
            </li>
          );
        })}
        <li>
          <button onClick={() => joinNew(parentId)} className="w-full rounded px-1 py-0.5 text-left text-blue-700 hover:bg-blue-100">
            + A new family with just {parentName}
          </button>
        </li>
      </ul>
      <button onClick={onDone} className="text-neutral-500 hover:underline">
        Cancel
      </button>
    </div>
  );
}

/** "Parents": one block per family this person is a child in. */
export function ParentsSection({ personId, onOpenPerson, focusFamilyId }: SectionProps) {
  const familyIds = useFamilyTreeStore((s) => s.tree.individuals[personId]?.familyAsChild);
  const [adding, setAdding] = useState(false);
  if (!familyIds) return null;

  return (
    <section className="space-y-2">
      <h3 className={SECTION_HEADING}>Parents</h3>
      {familyIds.length === 0 && <p className="text-xs text-neutral-400">No parents recorded.</p>}
      {familyIds.map((famId) => (
        <ParentsBlock
          key={famId}
          personId={personId}
          famId={famId}
          onOpenPerson={onOpenPerson}
          focusFamilyId={focusFamilyId}
        />
      ))}
      {adding ? (
        <AddParents personId={personId} onDone={() => setAdding(false)} />
      ) : (
        <button onClick={() => setAdding(true)} className="text-xs text-blue-600 hover:underline">
          + Add parents
        </button>
      )}
    </section>
  );
}

/** "Families": one block per family this person is a spouse/partner in, and "+ Add family". */
export function FamiliesSection({ personId, onOpenPerson, focusFamilyId }: SectionProps) {
  const tree = useFamilyTreeStore((s) => s.tree);
  const updateTree = useFamilyTreeStore((s) => s.updateTree);
  const [adding, setAdding] = useState(false);
  const person = tree.individuals[personId];
  const exclude = useMemo(() => {
    const spouses = (person?.familyAsSpouse ?? []).flatMap((f) => [tree.families[f]?.husband, tree.families[f]?.wife]);
    return new Set([personId, ...spouses.filter((id) => id !== undefined)]);
  }, [person, personId, tree.families]);
  if (!person) return null;

  const start = (label: string, partner?: (d: Draft<FamilyTree>) => string) => {
    updateTree((d) => void newFamily(d, personId, partner?.(d)), label);
    setAdding(false);
  };

  return (
    <section className="space-y-2">
      <h3 className={SECTION_HEADING}>Families</h3>
      {person.familyAsSpouse.length === 0 && <p className="text-xs text-neutral-400">No spouse or partner recorded.</p>}
      {person.familyAsSpouse.map((famId) => (
        <SpouseFamilyBlock
          key={famId}
          personId={personId}
          famId={famId}
          onOpenPerson={onOpenPerson}
          focusFamilyId={focusFamilyId}
        />
      ))}
      {adding ? (
        <PersonPicker
          exclude={exclude}
          placeholder="Search for a spouse or partner, or type a new name…"
          onPick={(id) => start(`Add family with ${nameOf(tree, id)}`, () => id)}
          onCreate={(typed) => start(`Add family with ${typed}`, (d) => addPerson(d, nameFromTyped(typed)))}
          onClose={() => setAdding(false)}
        >
          <button onClick={() => start("Add family (unknown spouse)")} className="text-blue-600 hover:underline">
            + Family with an unknown spouse
          </button>
        </PersonPicker>
      ) : (
        <button onClick={() => setAdding(true)} className="text-xs text-blue-600 hover:underline">
          + Add family
        </button>
      )}
    </section>
  );
}
