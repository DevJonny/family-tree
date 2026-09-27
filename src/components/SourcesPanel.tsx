"use client";

import { useMemo, useState } from "react";
import type { Draft } from "immer";
import { useFamilyTreeStore } from "@/lib/store/familyTreeStore";
import { TextAreaField, TextField } from "@/components/fields";
import { NoteList } from "@/components/NoteRow";
import {
  citationCounts,
  citationUsage,
  deleteRepository,
  deleteSource,
  newSource,
  nextFreeId,
  repositoryAddress,
  repositoryUsage,
  searchSources,
  sourceDisplayTitle,
  type CitedBy,
  type FamilyTree,
  type Repository,
  type RepositoryRef,
  type Source,
} from "@/lib/gedcom";

const H3 = "text-xs font-semibold uppercase tracking-wide text-neutral-400";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The tree-wide Sources tab: every source by title with a filter and its
 * citation count, and an editor for the selected one. Repositories are
 * edited inline from the sources that hold them.
 */
export function SourcesPanel({
  selectedId,
  onSelect,
  onOpenPerson,
}: {
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Show a person's Details (from "Cited by"). */
  /** Opens someone's Details, scrolled to `familyId` when it's a family that cites the source. */
  onOpenPerson: (id: string, familyId?: string) => void;
}) {
  const tree = useFamilyTreeStore((s) => s.tree);
  const updateTree = useFamilyTreeStore((s) => s.updateTree);
  // Filtering is view state, not a tree edit, so a plain controlled input is fine here.
  const [filter, setFilter] = useState("");
  const sources = useMemo(() => searchSources(tree, filter), [tree, filter]);
  const counts = useMemo(() => citationCounts(tree), [tree]);
  const selected = selectedId ? tree.sources[selectedId] : undefined;

  const addSource = () => {
    const id = nextFreeId(useFamilyTreeStore.getState().tree, "S");
    updateTree((d) => void (d.sources[id] = newSource(id)), "Add source");
    setFilter("");
    onSelect(id);
  };

  return (
    <div className="grid min-h-[24rem] grid-cols-1 text-sm md:grid-cols-[220px_minmax(0,1fr)]">
      <div className="space-y-2 border-b border-neutral-200 p-3 md:border-r md:border-b-0">
        <div className="flex items-center gap-2">
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter sources…"
            aria-label="Filter sources"
            className="min-w-0 flex-1 rounded border border-neutral-200 px-2 py-1 text-xs"
          />
          <button onClick={addSource} className="shrink-0 text-xs text-blue-600 hover:underline">
            + New
          </button>
        </div>
        {sources.length === 0 && (
          <p className="py-4 text-center text-xs text-neutral-400">
            {Object.keys(tree.sources).length ? "No sources match." : "No sources yet."}
          </p>
        )}
        <ul className="space-y-0.5 md:max-h-[28rem] md:overflow-y-auto">
          {sources.map((source) => {
            const count = counts[source.id] ?? 0;
            return (
              <li key={source.id}>
                <button
                  onClick={() => onSelect(source.id)}
                  className={`flex w-full items-baseline gap-2 rounded px-2 py-1 text-left text-xs ${
                    source.id === selectedId ? "bg-neutral-100 font-medium" : "hover:bg-neutral-50"
                  }`}
                >
                  <span className="min-w-0 flex-1 truncate">{sourceDisplayTitle(source)}</span>
                  {count ? (
                    <span className="shrink-0 text-neutral-400" title={plural(count, "citation")}>
                      {count}
                    </span>
                  ) : (
                    <span className="shrink-0 rounded bg-amber-50 px-1 text-[10px] text-amber-700">unused</span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="min-w-0">
        {selected ? (
          <SourceEditor
            key={selected.id}
            source={selected}
            onDeleted={() => onSelect(null)}
            onOpenPerson={onOpenPerson}
            onOpenSource={onSelect}
          />
        ) : (
          <p className="p-6 text-center text-sm text-neutral-400">
            {Object.keys(tree.sources).length ? "Pick a source to see and edit it." : "Add a source to get started."}
          </p>
        )}
      </div>
    </div>
  );
}

type SourceTextKey = "title" | "abbreviation" | "author" | "publication" | "text";

function SourceEditor({
  source,
  onDeleted,
  onOpenPerson,
  onOpenSource,
}: {
  source: Source;
  onDeleted: () => void;
  /** Opens someone's Details, scrolled to `familyId` when it's a family that cites the source. */
  onOpenPerson: (id: string, familyId?: string) => void;
  onOpenSource: (id: string) => void;
}) {
  const tree = useFamilyTreeStore((s) => s.tree);
  const updateTree = useFamilyTreeStore((s) => s.updateTree);
  const usage = useMemo(() => citationUsage(tree, source.id), [tree, source.id]);
  const [confirming, setConfirming] = useState(false);
  const id = source.id;
  const title = sourceDisplayTitle(source);

  const setField = (key: SourceTextKey, value: string) =>
    updateTree((d) => {
      if (value.trim()) d.sources[id][key] = value;
      else delete d.sources[id][key];
    }, `Edit source ${key}`);

  const remove = () => {
    updateTree((d) => deleteSource(d, id), `Delete source "${title}"`);
    onDeleted();
  };

  const openOwner = (owner: CitedBy) => {
    if (owner.kind === "person") onOpenPerson(owner.ownerId);
    else if (owner.kind === "family") {
      // Someone whose own record lists the family, so their Details has a
      // block for it: a spouse first, else a child.
      const famId = owner.ownerId;
      const fam = tree.families[famId];
      const spouses = [fam.husband, fam.wife].filter((id) => id !== undefined);
      const person =
        spouses.find((id) => tree.individuals[id]?.familyAsSpouse.includes(famId)) ??
        fam.children.find((id) => tree.individuals[id]?.familyAsChild.includes(famId)) ??
        spouses[0] ??
        fam.children[0];
      if (person) onOpenPerson(person, famId);
    } else if (owner.kind === "source") onOpenSource(owner.ownerId);
  };

  const others = usage.owners.length - usage.people;

  return (
    <div className="space-y-5 p-4">
      <section className="space-y-2">
        <div className="flex items-baseline gap-2">
          <h3 className={H3}>Source</h3>
          <span className="font-mono text-[11px] text-neutral-400">{id}</span>
          <button
            onClick={() => (usage.total ? setConfirming(true) : remove())}
            className="ml-auto text-xs text-red-500 hover:text-red-700"
          >
            Delete source
          </button>
        </div>
        {confirming && (
          <div role="alert" className="space-y-2 rounded border border-red-200 bg-red-50 p-3 text-xs text-red-800">
            <p>
              Cited by {plural(usage.total, "fact")} across {plural(usage.people, "person", "people")}
              {others > 0 && ` and ${plural(others, "other record")}`}. Deleting removes the source and every one
              of those citations (you can undo it).
            </p>
            {usage.unmodelled > 0 && (
              <p>
                {plural(usage.unmodelled, "more reference")} in parts of the file this app can&apos;t edit yet will be
                left as they are.
              </p>
            )}
            <div className="flex gap-3">
              <button onClick={remove} className="rounded bg-red-600 px-2 py-1 font-medium text-white hover:bg-red-700">
                Delete source and {plural(usage.total, "citation")}
              </button>
              <button onClick={() => setConfirming(false)} className="text-neutral-600 hover:underline">
                Cancel
              </button>
            </div>
          </div>
        )}
        <TextField
          label="Title"
          value={source.title ?? ""}
          onChange={(v) => setField("title", v)}
          autoFocus={!source.title && !source.abbreviation}
        />
        <div className="grid grid-cols-2 gap-2">
          <TextField label="Abbreviation" value={source.abbreviation ?? ""} onChange={(v) => setField("abbreviation", v)} />
          <TextField label="Author" value={source.author ?? ""} onChange={(v) => setField("author", v)} />
        </div>
        <TextField label="Publication" value={source.publication ?? ""} onChange={(v) => setField("publication", v)} />
        <label className="flex flex-col gap-0.5 text-xs text-neutral-500">
          Text
          <TextAreaField
            value={source.text ?? ""}
            onChange={(v) => setField("text", v)}
            rows={2}
            className="rounded border border-neutral-200 px-2 py-1 text-sm text-neutral-900"
          />
        </label>
      </section>

      <RepositoriesSection source={source} />

      <section className="space-y-2">
        <h3 className={H3}>Notes</h3>
        <NoteList notes={source.notes} locate={(d) => d.sources[id].notes} ownerId={id} />
      </section>

      <section className="space-y-2">
        <h3 className={H3}>
          Cited by{usage.total > 0 && ` · ${plural(usage.total, "citation")}`}
        </h3>
        {usage.owners.length === 0 && <p className="text-xs text-neutral-400">Nothing cites this source yet.</p>}
        <ul className="space-y-1 text-xs">
          {usage.owners.map((owner) => (
            <li key={owner.ownerId} className="flex items-baseline gap-2">
              {owner.kind === "note" || owner.kind === "repository" ? (
                <span className="text-neutral-700">{owner.label}</span>
              ) : (
                <button
                  onClick={() => openOwner(owner)}
                  className="text-left text-blue-600 hover:underline"
                >
                  {owner.label}
                </button>
              )}
              <span className="text-neutral-500">
                {owner.kind === "note" && "(shared note) "}
                {owner.where.join(", ")}
                {owner.count > owner.where.length && ` · ${owner.count}`}
              </span>
            </li>
          ))}
        </ul>
        {usage.unmodelled > 0 && (
          <p className="text-xs text-neutral-400">
            Also referenced {plural(usage.unmodelled, "time")} in parts of the file this app can&apos;t edit yet.
          </p>
        )}
      </section>
    </div>
  );
}

const NEW_REPO = "__new__";

function RepositoriesSection({ source }: { source: Source }) {
  const tree = useFamilyTreeStore((s) => s.tree);
  const updateTree = useFamilyTreeStore((s) => s.updateTree);
  const id = source.id;
  const available = Object.values(tree.repositories)
    .filter((r) => !source.repositories.some((ref) => ref.repoId === r.id))
    .sort((a, b) => (a.name ?? a.id).localeCompare(b.name ?? b.id));

  const add = (value: string) => {
    if (!value) return;
    if (value === NEW_REPO) {
      const repoId = nextFreeId(useFamilyTreeStore.getState().tree, "R");
      updateTree((d) => {
        d.repositories[repoId] = { id: repoId, notes: [] };
        d.sources[id].repositories.push({ repoId });
      }, "Add new repository to source");
    } else {
      const name = tree.repositories[value]?.name ?? value;
      updateTree((d) => void d.sources[id].repositories.push({ repoId: value }), `Add ${name} to source`);
    }
  };

  return (
    <section className="space-y-2">
      <h3 className={H3}>Repositories</h3>
      {source.repositories.length === 0 && <p className="text-xs text-neutral-400">Not held anywhere yet.</p>}
      {source.repositories.map((ref, i) => (
        <RepositoryRefRow
          key={`${i}-${ref.repoId}`}
          sourceId={id}
          repoRef={ref}
          repo={tree.repositories[ref.repoId]}
          locateRef={(d) => d.sources[id].repositories[i]}
          onRemove={() => updateTree((d) => void d.sources[id].repositories.splice(i, 1), "Remove repository from source")}
        />
      ))}
      {/* A select resets to the placeholder after each pick, so it's an action, not a stored value. */}
      <select
        value=""
        onChange={(e) => add(e.target.value)}
        aria-label="Add repository"
        className="rounded border border-neutral-200 px-2 py-1 text-xs text-blue-600"
      >
        <option value="">+ Add repository…</option>
        {available.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name || r.id}
          </option>
        ))}
        <option value={NEW_REPO}>New repository…</option>
      </select>
    </section>
  );
}

function RepositoryRefRow({
  sourceId,
  repoRef,
  repo,
  locateRef,
  onRemove,
}: {
  sourceId: string;
  repoRef: RepositoryRef;
  repo: Repository | undefined;
  locateRef: (d: Draft<FamilyTree>) => Draft<RepositoryRef>;
  onRemove: () => void;
}) {
  const tree = useFamilyTreeStore((s) => s.tree);
  const updateTree = useFamilyTreeStore((s) => s.updateTree);
  const [confirming, setConfirming] = useState(false);
  const usage = useMemo(() => repositoryUsage(tree, repoRef.repoId), [tree, repoRef.repoId]);
  const repoId = repoRef.repoId;
  const otherSources = usage.sourceIds.filter((s) => s !== sourceId).length;

  const setRepoField = (key: "name" | "website", value: string, label: string) =>
    updateTree((d) => {
      if (value.trim()) d.repositories[repoId][key] = value;
      else delete d.repositories[repoId][key];
    }, label);

  const removeButton = (
    <button
      onClick={onRemove}
      title="Remove from this source. The repository itself is kept."
      className="shrink-0 text-xs text-red-500 hover:text-red-700"
    >
      Remove
    </button>
  );

  if (!repo) {
    return (
      <div className="flex items-start gap-2 text-xs">
        <p className="flex-1 rounded border border-dashed border-amber-300 bg-amber-50 px-2 py-1 text-amber-800">
          {repoId} isn&apos;t in this file.{" "}
          <button
            onClick={() => updateTree((d) => void (d.repositories[repoId] = { id: repoId, notes: [] }), "Create missing repository")}
            className="text-blue-600 hover:underline"
          >
            Create repository
          </button>
        </p>
        {removeButton}
      </div>
    );
  }

  const address = repositoryAddress(repo);
  const name = repo.name || repoId;

  return (
    <div className="space-y-2 rounded border border-neutral-200 p-2">
      <div className="flex items-baseline gap-2 text-[11px]">
        <span className="font-mono text-neutral-400">{repoId}</span>
        <span className="text-neutral-500">
          {otherSources === 0 ? "Only this source" : `Also holds ${plural(otherSources, "other source")}`}
        </span>
        <span className="ml-auto" />
        {removeButton}
        <button onClick={() => setConfirming(true)} className="shrink-0 text-xs text-red-500 hover:text-red-700">
          Delete repository
        </button>
      </div>
      {confirming && (
        <div role="alert" className="space-y-2 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-800">
          <p>
            {name} is used by {plural(usage.sourceIds.length, "source")}. Deleting it removes it from{" "}
            {usage.sourceIds.length === 1 ? "that source" : `all ${usage.sourceIds.length}`} (you can undo it).
            {usage.unmodelled > 0 &&
              ` ${plural(usage.unmodelled, "more reference")} in parts of the file this app can't edit yet will be left as they are.`}
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => updateTree((d) => deleteRepository(d, repoId), `Delete repository "${name}"`)}
              className="rounded bg-red-600 px-2 py-1 font-medium text-white hover:bg-red-700"
            >
              Delete repository
            </button>
            <button onClick={() => setConfirming(false)} className="text-neutral-600 hover:underline">
              Cancel
            </button>
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <TextField
          label="Name"
          value={repo.name ?? ""}
          onChange={(v) => setRepoField("name", v, "Edit repository name")}
          autoFocus={!repo.name}
        />
        <TextField
          label="Call number (this source)"
          value={repoRef.callNumber ?? ""}
          onChange={(v) =>
            updateTree((d) => {
              const draftRef = locateRef(d);
              if (v.trim()) draftRef.callNumber = v;
              else delete draftRef.callNumber;
            }, "Edit call number")
          }
        />
      </div>
      <TextField
        label="Website"
        value={repo.website ?? ""}
        onChange={(v) => setRepoField("website", v, "Edit repository website")}
      />
      {address && (
        <p className="text-xs text-neutral-500">
          <span className="text-neutral-400">Address:</span> {address}
        </p>
      )}
      <NoteList notes={repo.notes} locate={(d) => d.repositories[repoId].notes} ownerId={repoId} compact />
    </div>
  );
}
