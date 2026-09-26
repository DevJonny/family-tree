"use client";

import { useMemo, useState } from "react";
import type { Draft } from "immer";
import { useFamilyTreeStore } from "@/lib/store/familyTreeStore";
import { TextAreaField, TextField } from "@/components/fields";
import { NoteList } from "@/components/NoteRow";
import {
  describeCitation,
  newSource,
  nextFreeId,
  promoteToSource,
  QUALITY_LABELS,
  exactSourceMatch,
  searchSources,
  sourceDisplayTitle,
  type Citation,
  type FamilyTree,
} from "@/lib/gedcom";

/** Finds this list inside a draft tree, creating it (and its fact) if needed. */
export type LocateCitations = (draft: Draft<FamilyTree>) => Citation[];

type TextKey = "page" | "date" | "text";

/** Sets a text field, dropping it entirely when cleared so export writes no empty line. */
function setText(citation: Draft<Citation>, key: TextKey, value: string) {
  if (value.trim()) citation[key] = value;
  else delete citation[key];
}

/**
 * The citations on one fact, name, or person: one line each, expanding
 * inline to edit page/quality/date/text/notes, plus "+ cite" to add one.
 */
export function CitationList({
  citations,
  locate,
  ownerId,
  what,
}: {
  citations: Citation[] | undefined;
  locate: LocateCitations;
  /** The person (or other record) these belong to, for shared-note counts. */
  ownerId: string;
  /** What's being cited, for history labels: "birth", "name", ... */
  what: string;
}) {
  const updateTree = useFamilyTreeStore((s) => s.updateTree);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [justAdded, setJustAdded] = useState<number | null>(null);
  const [picking, setPicking] = useState(false);
  const list = citations ?? [];

  const added = (index: number) => {
    setPicking(false);
    setExpanded(index);
    setJustAdded(index);
  };

  return (
    <div className="space-y-1">
      {list.map((citation, i) => (
        <CitationRow
          key={i}
          citation={citation}
          locate={(d) => locate(d)[i]}
          ownerId={ownerId}
          expanded={expanded === i}
          focusPage={justAdded === i}
          onToggle={() => {
            setExpanded(expanded === i ? null : i);
            setJustAdded(null);
          }}
          onRemove={() => {
            updateTree((d) => void locate(d).splice(i, 1), `Remove citation from ${what}`);
            setExpanded(null);
            setJustAdded(null);
          }}
        />
      ))}
      {picking ? (
        <CitePicker
          onClose={() => setPicking(false)}
          onPick={(sourceId, title) => {
            updateTree((d) => void locate(d).push({ sourceId, notes: [] }), `Cite ${title} on ${what}`);
            added(list.length);
          }}
          onCreate={(title) => {
            const id = nextFreeId(useFamilyTreeStore.getState().tree, "S");
            updateTree((d) => {
              d.sources[id] = newSource(id, title);
              locate(d).push({ sourceId: id, notes: [] });
            }, `Cite new source on ${what}`);
            added(list.length);
          }}
        />
      ) : (
        <button onClick={() => setPicking(true)} className="text-xs text-blue-600 hover:underline">
          + cite
        </button>
      )}
    </div>
  );
}

function CitationRow({
  citation,
  locate,
  ownerId,
  expanded,
  focusPage,
  onToggle,
  onRemove,
}: {
  citation: Citation;
  locate: (draft: Draft<FamilyTree>) => Draft<Citation>;
  ownerId: string;
  expanded: boolean;
  focusPage: boolean;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const tree = useFamilyTreeStore((s) => s.tree);
  const updateTree = useFamilyTreeStore((s) => s.updateTree);
  const summary = describeCitation(tree, citation);
  const edit = (recipe: (c: Draft<Citation>, d: Draft<FamilyTree>) => void, label: string) =>
    updateTree((d) => recipe(locate(d), d), label);

  const titleClass =
    summary.status === "missing"
      ? "text-amber-700"
      : summary.status === "unpointed"
        ? "italic text-neutral-700"
        : "text-neutral-800";

  return (
    <div className={`rounded border text-xs ${expanded ? "border-neutral-300 bg-neutral-50" : "border-transparent"}`}>
      <div className="flex items-baseline gap-2 px-1 py-0.5">
        <button
          onClick={onToggle}
          aria-expanded={expanded}
          title={expanded ? "Collapse" : "Edit citation"}
          className="min-w-0 flex-1 truncate text-left hover:underline"
        >
          <span className="mr-1 text-neutral-400">{expanded ? "▾" : "▸"}</span>
          <span className={titleClass}>{summary.title}</span>
          {summary.page && <span className="text-neutral-500">: {summary.page}</span>}
        </button>
        {summary.quality && (
          <span className="shrink-0 rounded bg-neutral-100 px-1.5 text-[10px] text-neutral-600">{summary.quality}</span>
        )}
        <button onClick={onRemove} aria-label="Remove citation" className="shrink-0 text-red-500 hover:text-red-700">
          ✕
        </button>
      </div>

      {expanded && (
        <div className="space-y-2 px-2 pb-2">
          {summary.status === "unpointed" && (
            <p className="text-neutral-600">
              Free-text citation, with no source record behind it.{" "}
              <button
                onClick={() => {
                  const id = nextFreeId(useFamilyTreeStore.getState().tree, "S");
                  edit((c, d) => void (d.sources[id] = promoteToSource(c, id)), "Make citation into source");
                }}
                className="text-blue-600 hover:underline"
              >
                Make into source
              </button>
            </p>
          )}
          {summary.status === "missing" && citation.sourceId && (
            <p className="text-amber-700">
              {citation.sourceId} isn&apos;t in this file.{" "}
              <button
                onClick={() => {
                  const id = citation.sourceId!;
                  updateTree((d) => void (d.sources[id] = newSource(id)), "Create missing source");
                }}
                className="text-blue-600 hover:underline"
              >
                Create source
              </button>
            </p>
          )}
          <div className="grid grid-cols-[2fr_1fr] gap-2">
            <TextField
              label="Page / where in the source"
              value={citation.page ?? ""}
              autoFocus={focusPage}
              onChange={(v) => edit((c) => setText(c, "page", v), "Edit citation page")}
            />
            <label className="flex flex-col gap-0.5 text-xs text-neutral-500">
              Quality
              <select
                value={citation.quality ?? ""}
                onChange={(e) =>
                  edit((c) => {
                    if (e.target.value === "") delete c.quality;
                    else c.quality = Number(e.target.value) as Citation["quality"];
                  }, "Edit citation quality")
                }
                className="rounded border border-neutral-200 px-2 py-1 text-sm text-neutral-900"
              >
                <option value="">Not set</option>
                {[3, 2, 1, 0].map((q) => (
                  <option key={q} value={q}>
                    {QUALITY_LABELS[q]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <TextField
            label="Date recorded"
            value={citation.date ?? ""}
            onChange={(v) => edit((c) => setText(c, "date", v), "Edit citation date")}
          />
          <label className="flex flex-col gap-0.5 text-xs text-neutral-500">
            Text from the source
            <TextAreaField
              value={citation.text ?? ""}
              onChange={(v) => edit((c) => setText(c, "text", v), "Edit citation text")}
              rows={2}
              className="rounded border border-neutral-200 px-2 py-1 text-sm text-neutral-900"
            />
          </label>
          <div className="space-y-1">
            <div className="text-neutral-500">Notes</div>
            <NoteList notes={citation.notes} locate={(d) => locate(d).notes} ownerId={ownerId} compact />
          </div>
        </div>
      )}
    </div>
  );
}

/** "+ cite": search existing sources by title/abbreviation, or create one from what you typed. */
function CitePicker({
  onPick,
  onCreate,
  onClose,
}: {
  onPick: (sourceId: string, title: string) => void;
  onCreate: (title: string) => void;
  onClose: () => void;
}) {
  const tree = useFamilyTreeStore((s) => s.tree);
  // A search box, not a field of the tree: nothing reaches the store until a pick.
  const [query, setQuery] = useState("");
  const typed = query.trim();
  const { results, exact } = useMemo(() => {
    const all = searchSources(tree, query);
    const exact = exactSourceMatch(all, query);
    const top = all.slice(0, 8);
    // Always list the exact match, since Enter picks it.
    return { results: exact && !top.includes(exact) ? [exact, ...top.slice(0, 7)] : top, exact };
  }, [tree, query]);

  // The options in list order: each result, then "Create" when something's typed.
  // Enter takes the highlighted one: an exact title match by default,
  // otherwise "Create", and the arrow keys move the highlight.
  const optionCount = results.length + (typed ? 1 : 0);
  const defaultIndex = exact ? results.indexOf(exact) : typed ? results.length : -1;
  const [moved, setMoved] = useState<number | null>(null);
  const active = moved ?? defaultIndex;
  const choose = (index: number) => {
    if (index >= 0 && index < results.length) onPick(results[index].id, sourceDisplayTitle(results[index]));
    else if (index === results.length && typed) onCreate(typed);
  };

  return (
    <div className="space-y-1 rounded border border-blue-200 bg-blue-50/40 p-2 text-xs">
      <div className="flex gap-2">
        <input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setMoved(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "Enter") choose(active);
            if ((e.key === "ArrowDown" || e.key === "ArrowUp") && optionCount > 0) {
              e.preventDefault();
              const step = e.key === "ArrowDown" ? 1 : -1;
              const from = active >= 0 ? active : step > 0 ? -1 : optionCount;
              setMoved((from + step + optionCount) % optionCount);
            }
          }}
          placeholder="Search sources, or type a new title…"
          className="flex-1 rounded border border-neutral-200 bg-white px-2 py-1 text-sm"
        />
        <button onClick={onClose} className="text-neutral-500 hover:underline">
          Cancel
        </button>
      </div>
      <ul className="max-h-48 overflow-y-auto">
        {results.map((source, i) => (
          <li key={source.id}>
            <button
              onClick={() => onPick(source.id, sourceDisplayTitle(source))}
              className={`w-full truncate rounded px-1 py-0.5 text-left hover:bg-blue-100 ${i === active ? "bg-blue-100" : ""}`}
            >
              {sourceDisplayTitle(source)}
              {source.author && <span className="text-neutral-500"> · {source.author}</span>}
            </button>
          </li>
        ))}
        {results.length === 0 && !typed && <li className="px-1 text-neutral-500">No sources yet. Type a title to create one.</li>}
        {typed && (
          <li>
            <button
              onClick={() => onCreate(typed)}
              className={`w-full truncate rounded px-1 py-0.5 text-left text-blue-700 hover:bg-blue-100 ${active === results.length ? "bg-blue-100" : ""}`}
            >
              + Create source “{typed}”
            </button>
          </li>
        )}
      </ul>
    </div>
  );
}
