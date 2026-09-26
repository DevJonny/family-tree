"use client";

import { useRef, useState } from "react";
import { useFamilyTreeStore } from "@/lib/store/familyTreeStore";
import { PedigreeChart } from "@/components/PedigreeChart";
import { HistoryPanel } from "@/components/HistoryPanel";
import { PersonDetailPanel } from "@/components/PersonDetailPanel";
import { SourcesPanel } from "@/components/SourcesPanel";
import { UnsavedWork } from "@/components/UnsavedWork";
import { DriveConflictBanner, DriveFilePicker, DriveSyncStatus } from "@/components/DriveSyncStatus";
import { BareTextInput } from "@/components/fields";
import type { Individual } from "@/lib/gedcom/model";

function IndividualRow({
  indi,
  selected,
  onSelect,
  onEdit,
  onRemove,
}: {
  indi: Individual;
  selected: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const updateIndividualName = useFamilyTreeStore((s) => s.updateIndividualName);

  return (
    <div
      onClick={onSelect}
      className={`cursor-pointer space-y-1 p-2 text-sm ${selected ? "bg-neutral-100" : "hover:bg-neutral-50"}`}
    >
      <div className="flex items-center gap-2">
        <span className="w-12 shrink-0 font-mono text-xs text-neutral-400">{indi.id}</span>
        <BareTextInput
          value={indi.names[0]?.given ?? ""}
          onChange={(v) => updateIndividualName(indi.id, 0, { given: v })}
          placeholder="Given"
          className="w-20 min-w-0 rounded border border-neutral-200 px-1.5 py-1 text-xs"
        />
        <BareTextInput
          value={indi.names[0]?.surname ?? ""}
          onChange={(v) => updateIndividualName(indi.id, 0, { surname: v })}
          placeholder="Surname"
          className="w-20 min-w-0 rounded border border-neutral-200 px-1.5 py-1 text-xs"
        />
        <button
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          className="ml-auto shrink-0 text-xs text-blue-500 hover:text-blue-700"
        >
          Edit
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="shrink-0 text-xs text-red-400 hover:text-red-600"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

export default function Home() {
  const [activeTab, setActiveTab] = useState<"pedigree" | "details" | "sources">("pedigree");
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const {
    tree,
    fileName,
    lastWarnings,
    canUndo,
    canRedo,
    dirty,
    selectedId,
    loadFromGedcomText,
    exportToGedcomText,
    markSaved,
    selectIndividual,
    addIndividual,
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
    markSaved(); // a downloaded file counts as saved
  }

  function handleAddPerson() {
    const id = addIndividual();
    selectIndividual(id);
  }

  return (
    <div className="min-h-screen bg-neutral-50 p-8 text-neutral-900">
      <div className="mx-auto max-w-6xl space-y-6">
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
            onClick={handleAddPerson}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium hover:bg-neutral-100"
          >
            + Add person
          </button>
          <div className="mx-2 h-5 w-px bg-neutral-300" />
          <DriveSyncStatus />
        </div>

        <UnsavedWork />
        <DriveFilePicker />
        <DriveConflictBanner />

        {lastWarnings.length > 0 && (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
            {lastWarnings.length} warning(s) while importing — some lines may not have been understood.
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)_260px]">
          <div className="divide-y divide-neutral-200 rounded-md border border-neutral-200 bg-white lg:max-h-[32rem] lg:overflow-y-auto">
            {individuals.length === 0 && (
              <p className="p-6 text-center text-sm text-neutral-400">
                No one in the tree yet. Import a GEDCOM file or add a person to get started.
              </p>
            )}
            {individuals.map((indi) => (
              <IndividualRow
                key={indi.id}
                indi={indi}
                selected={selectedId === indi.id}
                onSelect={() => selectIndividual(indi.id)}
                onEdit={() => {
                  selectIndividual(indi.id);
                  setActiveTab("details");
                }}
                onRemove={() => removeIndividual(indi.id)}
              />
            ))}
          </div>

          <div className="min-w-0 rounded-md border border-neutral-200 bg-white">
            <div className="flex border-b border-neutral-200 text-xs font-medium">
              <button
                onClick={() => setActiveTab("pedigree")}
                className={`px-3 py-2 ${activeTab === "pedigree" ? "border-b-2 border-neutral-900 text-neutral-900" : "text-neutral-400 hover:text-neutral-600"}`}
              >
                Pedigree
              </button>
              <button
                onClick={() => setActiveTab("details")}
                disabled={!selectedId}
                className={`px-3 py-2 disabled:cursor-default disabled:text-neutral-300 ${activeTab === "details" ? "border-b-2 border-neutral-900 text-neutral-900" : "text-neutral-400 hover:text-neutral-600"}`}
              >
                Details
              </button>
              <button
                onClick={() => setActiveTab("sources")}
                className={`px-3 py-2 ${activeTab === "sources" ? "border-b-2 border-neutral-900 text-neutral-900" : "text-neutral-400 hover:text-neutral-600"}`}
              >
                Sources
              </button>
            </div>
            {activeTab === "sources" ? (
              <SourcesPanel
                selectedId={selectedSourceId}
                onSelect={setSelectedSourceId}
                onOpenPerson={(id) => {
                  selectIndividual(id);
                  setActiveTab("details");
                }}
              />
            ) : activeTab === "pedigree" || !selectedId ? (
              <PedigreeChart rootId={selectedId} />
            ) : (
              <PersonDetailPanel key={selectedId} id={selectedId} />
            )}
          </div>

          <div className="rounded-md border border-neutral-200 bg-white">
            <div className="border-b border-neutral-200 px-3 py-2 text-xs font-medium text-neutral-500">
              History
            </div>
            <HistoryPanel />
          </div>
        </div>
      </div>
    </div>
  );
}
