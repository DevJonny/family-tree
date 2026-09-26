"use client";

import { useFamilyTreeStore } from "@/lib/store/familyTreeStore";
import { getParents } from "@/lib/gedcom/relationships";
import { personDisplayName as displayName, type Individual } from "@/lib/gedcom/model";

const MAX_DEPTH = 4; // self + 3 generations back

function PersonCard({ individual, selected }: { individual: Individual; selected: boolean }) {
  const selectIndividual = useFamilyTreeStore((s) => s.selectIndividual);
  return (
    <button
      onClick={() => selectIndividual(individual.id)}
      className={`w-40 shrink-0 rounded-md border px-3 py-2 text-left text-sm transition-colors ${
        selected
          ? "border-neutral-900 bg-neutral-900 text-white"
          : "border-neutral-200 bg-white hover:border-neutral-400"
      }`}
    >
      <div className="truncate font-medium">{displayName(individual)}</div>
      <div className={`truncate text-xs ${selected ? "text-neutral-300" : "text-neutral-400"}`}>
        {individual.birth?.date ? `b. ${individual.birth.date}` : "birth date unknown"}
      </div>
    </button>
  );
}

function AddParentSlot({ onAdd, label }: { onAdd: () => void; label: string }) {
  return (
    <button
      onClick={onAdd}
      className="w-40 shrink-0 rounded-md border border-dashed border-neutral-300 px-3 py-2 text-left text-xs text-neutral-400 hover:border-neutral-400 hover:text-neutral-600"
    >
      + Add {label}
    </button>
  );
}

function PedigreeNode({ individualId, depth }: { individualId: string; depth: number }) {
  const tree = useFamilyTreeStore((s) => s.tree);
  const addParent = useFamilyTreeStore((s) => s.addParent);
  const selectedId = useFamilyTreeStore((s) => s.selectedId);

  const individual = tree.individuals[individualId];
  if (!individual) return null;

  const { father, mother } = getParents(tree, individualId);
  const canGoDeeper = depth < MAX_DEPTH;

  return (
    <div className="flex items-center">
      <PersonCard individual={individual} selected={selectedId === individualId} />
      {canGoDeeper && (
        <div className="ml-4 flex flex-col gap-3 border-l border-neutral-200 pl-4">
          {father ? (
            <PedigreeNode individualId={father.id} depth={depth + 1} />
          ) : (
            <AddParentSlot label="father" onAdd={() => addParent(individualId, "father")} />
          )}
          {mother ? (
            <PedigreeNode individualId={mother.id} depth={depth + 1} />
          ) : (
            <AddParentSlot label="mother" onAdd={() => addParent(individualId, "mother")} />
          )}
        </div>
      )}
    </div>
  );
}

export function PedigreeChart({ rootId }: { rootId: string | null }) {
  if (!rootId) {
    return (
      <p className="p-6 text-center text-sm text-neutral-400">
        Select a person from the list to see their pedigree chart.
      </p>
    );
  }
  return (
    <div className="overflow-x-auto p-4">
      <PedigreeNode individualId={rootId} depth={0} />
    </div>
  );
}
