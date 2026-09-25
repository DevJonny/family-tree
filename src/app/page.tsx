"use client";

import { useRef } from "react";
import { useFamilyTreeStore } from "@/lib/store/familyTreeStore";

export default function Home() {
  const {
    tree,
    fileName,
    lastWarnings,
    canUndo,
    canRedo,
    dirty,
    loadFromGedcomText,
    exportToGedcomText,
    addIndividual,
    updateIndividualName,
    removeIndividual,
    undo,
    redo,
  } = useFamilyTreeStore();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const individuals = Object.values(tree.individuals);

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    loadFromGedcomText(text, file.name);
    e.target.value = "";
  }

  function handleExport() {
    const text = exportToGedcomText();
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName ?? "family-tree.ged";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-screen bg-neutral-50 p-8 text-neutral-900">
      <div className="mx-auto max-w-3xl space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold">Family Tree</h1>
          <p className="text-sm text-neutral-500">
            GEDCOM in, GEDCOM out. Every edit is undoable.{" "}
            {fileName && <span className="font-medium">({fileName}{dirty ? " · unsaved" : ""})</span>}
          </p>
        </header>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".ged,.gedcom,text/plain"
            onChange={handleImport}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-neutral-700"
          >
            Import GEDCOM
          </button>
          <button
            onClick={handleExport}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium hover:bg-neutral-100"
          >
            Export GEDCOM
          </button>
          <div className="mx-2 h-5 w-px bg-neutral-300" />
          <button
            onClick={undo}
            disabled={!canUndo}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium hover:bg-neutral-100 disabled:opacity-40"
          >
            ↶ Undo
          </button>
          <button
            onClick={redo}
            disabled={!canRedo}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium hover:bg-neutral-100 disabled:opacity-40"
          >
            ↷ Redo
          </button>
          <div className="mx-2 h-5 w-px bg-neutral-300" />
          <button
            onClick={() => addIndividual()}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium hover:bg-neutral-100"
          >
            + Add person
          </button>
        </div>

        {lastWarnings.length > 0 && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
            {lastWarnings.length} warning(s) while importing — some lines may not have been understood.
          </div>
        )}

        <div className="divide-y divide-neutral-200 rounded-md border border-neutral-200 bg-white">
          {individuals.length === 0 && (
            <p className="p-6 text-center text-sm text-neutral-400">
              No one in the tree yet. Import a GEDCOM file or add a person to get started.
            </p>
          )}
          {individuals.map((indi) => (
            <div key={indi.id} className="flex items-center gap-3 p-3">
              <span className="w-16 shrink-0 font-mono text-xs text-neutral-400">{indi.id}</span>
              <input
                value={indi.names[0]?.given ?? ""}
                onChange={(e) => updateIndividualName(indi.id, 0, { given: e.target.value })}
                placeholder="Given name"
                className="w-32 rounded border border-neutral-200 px-2 py-1 text-sm"
              />
              <input
                value={indi.names[0]?.surname ?? ""}
                onChange={(e) => updateIndividualName(indi.id, 0, { surname: e.target.value })}
                placeholder="Surname"
                className="w-32 rounded border border-neutral-200 px-2 py-1 text-sm"
              />
              <span className="flex-1 text-xs text-neutral-400">
                {indi.birth?.date ? `b. ${indi.birth.date}` : ""}
              </span>
              <button
                onClick={() => removeIndividual(indi.id)}
                className="text-xs text-red-500 hover:text-red-700"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
