"use client";

import { create } from "zustand";
import type { Draft } from "immer";
import { History } from "../history/historyStore";
import type { HistorySnapshot } from "../history/types";
import {
  buildFamilyTree,
  type Family,
  type FamilyTree,
  type GedcomParseWarning,
  type Individual,
  type NameParts,
  loadGedcom,
  saveGedcom,
} from "../gedcom";

const EMPTY_TREE: FamilyTree = buildFamilyTree([]);

function nextXref(existing: Record<string, unknown>, prefix: "I" | "F"): string {
  let n = 1;
  while (existing[`@${prefix}${n}@`]) n += 1;
  return `@${prefix}${n}@`;
}

interface FamilyTreeState {
  tree: FamilyTree;
  fileName: string | null;
  lastWarnings: GedcomParseWarning[];
  canUndo: boolean;
  canRedo: boolean;
  dirty: boolean;
  history: HistorySnapshot;
  selectedId: string | null;

  /** Replaces the whole tree (e.g. from an imported/synced GEDCOM file). Not undoable. */
  loadTree: (tree: FamilyTree, fileName?: string, warnings?: GedcomParseWarning[]) => void;
  loadFromGedcomText: (text: string, fileName?: string) => GedcomParseWarning[];
  exportToGedcomText: () => string;

  selectIndividual: (id: string | null) => void;
  addIndividual: (name?: NameParts) => string;
  updateIndividualName: (id: string, index: number, patch: Partial<NameParts>) => void;
  removeIndividual: (id: string) => void;
  /**
   * Escape hatch for any other field-level edit to one person (sex,
   * birth/death, other events, notes, additional names, ...). Components
   * pass a small Immer recipe; this keeps the store from needing a
   * hand-written action per field while every edit still goes through
   * `History.apply()` and stays undoable. No-op if the person doesn't
   * exist (e.g. a stale reference from a race with a delete).
   */
  updateIndividual: (id: string, recipe: (draft: Draft<Individual>) => void, label?: string) => void;
  /** Creates a new person and links them as this child's father/mother, creating a FAM record if needed. */
  addParent: (childId: string, which: "father" | "mother", name?: NameParts) => string;

  undo: () => void;
  redo: () => void;
  /** Undoes repeatedly until the given undo-stack entry has been undone. */
  undoTo: (entryId: string) => void;
  /** Redoes repeatedly until the given redo-stack entry has been redone. */
  redoTo: (entryId: string) => void;
}

// The History instance lives outside React state; the store mirrors its
// current snapshot so components can subscribe reactively via zustand.
const historyEngine = new History<FamilyTree>(EMPTY_TREE);

export const useFamilyTreeStore = create<FamilyTreeState>((set, get) => {
  historyEngine.subscribe((tree, snapshot) => {
    set({ tree, canUndo: historyEngine.canUndo, canRedo: historyEngine.canRedo, dirty: true, history: snapshot });
  });

  return {
    tree: EMPTY_TREE,
    fileName: null,
    lastWarnings: [],
    canUndo: false,
    canRedo: false,
    dirty: false,
    history: historyEngine.snapshot,
    selectedId: null,

    loadTree: (tree, fileName, warnings = []) => {
      historyEngine.reset(tree);
      set({
        tree,
        fileName: fileName ?? get().fileName,
        lastWarnings: warnings,
        canUndo: false,
        canRedo: false,
        dirty: false,
        history: historyEngine.snapshot,
        selectedId: null,
      });
    },

    loadFromGedcomText: (text, fileName) => {
      const { tree, warnings } = loadGedcom(text);
      get().loadTree(tree, fileName, warnings);
      return warnings;
    },

    exportToGedcomText: () => saveGedcom(get().tree),

    selectIndividual: (id) => set({ selectedId: id }),

    addIndividual: (name) => {
      const id = nextXref(get().tree.individuals, "I");
      historyEngine.apply((draft) => {
        const indi: Individual = {
          id,
          names: name ? [name] : [{ given: "New", surname: "Person" }],
          events: [],
          familyAsChild: [],
          familyAsSpouse: [],
          notes: [],
          extra: [],
        };
        draft.individuals[id] = indi;
      }, "Add individual");
      return id;
    },

    updateIndividualName: (id, index, patch) => {
      historyEngine.apply((draft) => {
        const indi = draft.individuals[id];
        if (!indi) return;
        indi.names[index] = { ...indi.names[index], ...patch };
      }, "Edit name");
    },

    updateIndividual: (id, recipe, label = "Edit person") => {
      historyEngine.apply((draft) => {
        const indi = draft.individuals[id];
        if (!indi) return;
        recipe(indi);
      }, label);
    },

    removeIndividual: (id) => {
      historyEngine.apply((draft) => {
        delete draft.individuals[id];
        // Detach from any families referencing this person so the tree
        // never points at a dangling xref.
        for (const fam of Object.values(draft.families)) {
          if (fam.husband === id) fam.husband = undefined;
          if (fam.wife === id) fam.wife = undefined;
          fam.children = fam.children.filter((c) => c !== id);
        }
      }, "Remove individual");
    },

    addParent: (childId, which, name) => {
      const { individuals, families } = get().tree;
      const parentId = nextXref(individuals, "I");
      // Reuse the child's existing "family as child" record if they have
      // one (so we don't fork them into two separate families), otherwise
      // mint a new FAM record to hold this parent link.
      const existingFamId = individuals[childId]?.familyAsChild[0];
      const famId = existingFamId ?? nextXref(families, "F");

      historyEngine.apply((draft) => {
        const parent: Individual = {
          id: parentId,
          names: name ? [name] : [{ given: "New", surname: "Person" }],
          events: [],
          familyAsChild: [],
          familyAsSpouse: [famId],
          notes: [],
          extra: [],
        };
        draft.individuals[parentId] = parent;

        const family: Family = draft.families[famId] ?? {
          id: famId,
          children: [],
          events: [],
          notes: [],
          extra: [],
        };
        if (which === "father") family.husband = parentId;
        else family.wife = parentId;
        if (!family.children.includes(childId)) family.children.push(childId);
        draft.families[famId] = family;

        const child = draft.individuals[childId];
        if (child && !child.familyAsChild.includes(famId)) child.familyAsChild.push(famId);
      }, `Add ${which}`);

      return parentId;
    },

    undo: () => historyEngine.undo(),
    redo: () => historyEngine.redo(),

    // Both jump helpers land on a state where `entryId` is the *current*
    // entry (i.e. that edit is applied, nothing after it is) — like
    // clicking a point in a version history and landing on that version,
    // not the one before it.
    undoTo: (entryId) => {
      for (;;) {
        const stack = get().history.undoStack;
        const current = stack[stack.length - 1];
        if (!current || current.id === entryId) return;
        if (!historyEngine.undo()) return;
      }
    },

    redoTo: (entryId) => {
      for (;;) {
        const stack = get().history.undoStack;
        const current = stack[stack.length - 1];
        if (current?.id === entryId) return;
        if (!historyEngine.redo()) return;
      }
    },
  };
});
