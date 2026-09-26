import type { EventFact, FamilyTree } from "./model";
import { isNoteLink, type Citation, type Note } from "./sources";

/**
 * Visits every note and every citation in the tree, however deeply nested
 * (a note under a citation under an event, ...), along with the id of the
 * top-level record that owns it: a person, family, source, repository or
 * shared note.
 *
 * This is the single place that knows where notes and citations can live,
 * so usage counts ("Shared with N others", "Cited by ...") and cascading
 * deletes can't miss a container.
 */
export interface TreeVisitor {
  note?: (note: Note, ownerId: string) => void;
  citation?: (citation: Citation, ownerId: string) => void;
}

export function walkTree(tree: FamilyTree, visitor: TreeVisitor): void {
  const notes = (list: Note[] | undefined, owner: string) => {
    for (const note of list ?? []) {
      visitor.note?.(note, owner);
      if (!isNoteLink(note)) citations(note.citations, owner);
    }
  };
  const citations = (list: Citation[] | undefined, owner: string) => {
    for (const citation of list ?? []) {
      visitor.citation?.(citation, owner);
      notes(citation.notes, owner);
    }
  };
  const event = (e: EventFact | undefined, owner: string) => {
    if (!e) return;
    notes(e.notes, owner);
    citations(e.citations, owner);
  };

  for (const indi of Object.values(tree.individuals)) {
    for (const name of indi.names) citations(name.citations, indi.id);
    event(indi.birth, indi.id);
    event(indi.death, indi.id);
    indi.events.forEach((e) => event(e, indi.id));
    notes(indi.notes, indi.id);
    citations(indi.citations, indi.id);
  }
  for (const fam of Object.values(tree.families)) {
    event(fam.marriage, fam.id);
    fam.events.forEach((e) => event(e, fam.id));
    notes(fam.notes, fam.id);
    citations(fam.citations, fam.id);
  }
  for (const source of Object.values(tree.sources)) notes(source.notes, source.id);
  for (const repo of Object.values(tree.repositories)) notes(repo.notes, repo.id);
  for (const shared of Object.values(tree.notes)) citations(shared.citations, shared.id);
}

/** Ids of the records (people, families, sources, ...) that link this shared note, each once. */
export function noteUsage(tree: FamilyTree, noteId: string): string[] {
  const owners = new Set<string>();
  walkTree(tree, {
    note: (note, owner) => {
      if (isNoteLink(note) && note.noteId === noteId) owners.add(owner);
    },
  });
  return [...owners];
}
