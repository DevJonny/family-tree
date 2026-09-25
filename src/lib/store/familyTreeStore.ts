"use client";

import { create } from "zustand";
import { History } from "../history/historyStore";
import {
  buildFamilyTree,
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

  /** Replaces the whole tree (e.g. from an imported/synced GEDCOM file). Not undoable. */
  loadTree: (tree: FamilyTree, fileName?: string, warnings?: GedcomParseWarning[]) => void;
  loadFromGedcomText: (text: string, fileName?: string) => GedcomParseWarning[];
  exportToGedcomText: () => string;

  addIndividual: (name?: NameParts) => string;
  updateIndividualName: (id: string, index: number, patch: Partial<NameParts>) => void;
  removeIndividual: (id: string) => void;

  undo: () => void;
  redo: () => void;
}

// The History instance lives outside React state; the store mirrors its
// current snapshot so components can subscribe reactively via zustand.
const history = new History<FamilyTree>(EMPTY_TREE);

export const useFamilyTreeStore = create<FamilyTreeState>((set, get) => {
  history.subscribe((tree) => {
    set({ tree, canUndo: history.canUndo, canRedo: history.canRedo, dirty: true });
  });

  return {
    tree: EMPTY_TREE,
    fileName: null,
    lastWarnings: [],
    canUndo: false,
    canRedo: false,
    dirty: false,

    loadTree: (tree, fileName, warnings = []) => {
      history.reset(tree);
      set({
        tree,
        fileName: fileName ?? get().fileName,
        lastWarnings: warnings,
        canUndo: false,
        canRedo: false,
        dirty: false,
      });
    },

    loadFromGedcomText: (text, fileName) => {
      const { tree, warnings } = loadGedcom(text);
      get().loadTree(tree, fileName, warnings);
      return warnings;
    },

    exportToGedcomText: () => saveGedcom(get().tree),

    addIndividual: (name) => {
      const id = nextXref(get().tree.individuals, "I");
      history.apply((draft) => {
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
      history.apply((draft) => {
        const indi = draft.individuals[id];
        if (!indi) return;
        indi.names[index] = { ...indi.names[index], ...patch };
      }, "Edit name");
    },

    removeIndividual: (id) => {
      history.apply((draft) => {
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

    undo: () => history.undo(),
    redo: () => history.redo(),
  };
});
