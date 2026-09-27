import { labelForEventTag } from "./eventTags";
import type { EventFact, Family, FamilyTree } from "./model";
import { isNoteLink, type Citation, type Note } from "./sources";

/**
 * Visits every note and every citation in the tree, however deeply nested
 * (a note under a citation under an event, ...), along with the id of the
 * top-level record that owns it: a person, family, source, repository or
 * shared note — and `where` in that record it hangs: a fact's label
 * ("Birth", "Census"), or "Name", "Note", "Person" (person-level
 * citations) or "Family" (family-level). Anything nested inherits the
 * `where` of the fact, name or note it's under.
 *
 * This is the single place that knows where notes and citations can live,
 * so usage counts ("Shared with N others", "Cited by ...") and cascading
 * deletes can't miss a container.
 */
export interface TreeVisitor {
  note?: (note: Note, ownerId: string, where: string) => void;
  citation?: (citation: Citation, ownerId: string, where: string) => void;
  /**
   * Each citation list, before its citations are visited. A visitor may
   * remove entries in place (that's how deletes cascade); the walk then
   * carries on over what's left.
   */
  citationList?: (list: Citation[], ownerId: string, where: string) => void;
}

function walkers(visitor: TreeVisitor) {
  const notes = (list: Note[] | undefined, owner: string, where: string) => {
    for (const note of list ?? []) {
      visitor.note?.(note, owner, where);
      if (!isNoteLink(note)) citations(note.citations, owner, where);
    }
  };
  const citations = (list: Citation[] | undefined, owner: string, where: string) => {
    if (!list) return;
    visitor.citationList?.(list, owner, where);
    for (const citation of list) {
      visitor.citation?.(citation, owner, where);
      notes(citation.notes, owner, where);
    }
  };
  const event = (e: EventFact | undefined, owner: string) => {
    if (!e) return;
    const where = labelForEventTag(e.tag);
    citations(e.citations, owner, where);
    notes(e.notes, owner, where);
  };
  const family = (fam: Family) => {
    event(fam.marriage, fam.id);
    fam.events.forEach((e) => event(e, fam.id));
    notes(fam.notes, fam.id, "Note");
    citations(fam.citations, fam.id, "Family");
  };
  return { notes, citations, event, family };
}

export function walkTree(tree: FamilyTree, visitor: TreeVisitor): void {
  const { notes, citations, event, family } = walkers(visitor);
  for (const indi of Object.values(tree.individuals)) {
    for (const name of indi.names) citations(name.citations, indi.id, "Name");
    event(indi.birth, indi.id);
    event(indi.death, indi.id);
    indi.events.forEach((e) => event(e, indi.id));
    notes(indi.notes, indi.id, "Note");
    citations(indi.citations, indi.id, "Person");
  }
  for (const fam of Object.values(tree.families)) family(fam);
  for (const source of Object.values(tree.sources)) notes(source.notes, source.id, "Note");
  for (const repo of Object.values(tree.repositories)) notes(repo.notes, repo.id, "Note");
  for (const shared of Object.values(tree.notes)) citations(shared.citations, shared.id, "Note");
}

/** `walkTree` for one family only: its facts' and its own notes and citations. */
export function walkFamily(fam: Family, visitor: TreeVisitor): void {
  walkers(visitor).family(fam);
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
