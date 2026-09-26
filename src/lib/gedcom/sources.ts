import type { GedcomNode } from "./types";

/**
 * Sources, repositories, citations and notes (Phase 4b).
 *
 * Same fidelity rule as model.ts: typed fields are lifted only from the
 * first well-formed occurrence of a tag (has a value, no sub-records of its
 * own); everything else is kept verbatim in `extra` and re-emitted.
 *
 * Verbatim nodes are re-leveled on export (`atLevel`), so a note or citation
 * can move to a different depth — e.g. a shared level-0 NOTE record copied
 * inline under a person — and still serialize correctly.
 */

/** A SOUR citation hanging off a fact, name, note, family or person. */
export interface Citation {
  /** Pointer to the cited source ("@S2@"). Absent for an unpointed citation. */
  sourceId?: string;
  /** The free-text value of an unpointed `SOUR <text>` citation. */
  description?: string;
  page?: string;
  /** QUAY: 0 unreliable, 1 questionable, 2 secondary, 3 primary evidence. */
  quality?: 0 | 1 | 2 | 3;
  /** DATA.DATE — when the record was entered in the original source. */
  date?: string;
  /** The first DATA.TEXT — a transcription of the relevant part of the source. */
  text?: string;
  notes: Note[];
  /** Other sub-records of the DATA line (a second TEXT, vendor tags), verbatim. */
  dataExtra?: GedcomNode[];
  /** EVEN/ROLE, OBJE, _APID, ... verbatim. */
  extra?: GedcomNode[];
}

/** A note written in place (`1 NOTE Some text`). */
export interface InlineNote {
  text: string;
  citations: Citation[];
  extra?: GedcomNode[];
}

/** A link to a shared note record (`1 NOTE @N1@`). */
export interface NoteLink {
  noteId: string;
  extra?: GedcomNode[];
}

export type Note = InlineNote | NoteLink;

/** A top-level `0 @N1@ NOTE` record, which any number of notes can link to. */
export interface SharedNote {
  id: string;
  text: string;
  citations: Citation[];
  extra?: GedcomNode[];
}

export interface RepositoryRef {
  repoId: string;
  /** CALN — the source's call number within that repository. */
  callNumber?: string;
  /**
   * Sub-records of the CALN line (MEDI: book, microfilm, ...). They describe
   * the item held rather than the number, so a corrected number keeps them;
   * they're written for as long as there's a call number to hang them on.
   */
  callNumberExtra?: GedcomNode[];
  extra?: GedcomNode[];
}

export interface Source {
  id: string;
  title?: string;
  author?: string;
  publication?: string;
  abbreviation?: string;
  text?: string;
  repositories: RepositoryRef[];
  notes: Note[];
  /** DATA/EVEN/AGNC, _APID, RIN, CHAN, OBJE, ... verbatim. */
  extra?: GedcomNode[];
}

export interface Repository {
  id: string;
  name?: string;
  website?: string;
  notes: Note[];
  /** ADDR, PHON, EMAIL, ... verbatim. */
  extra?: GedcomNode[];
}

const POINTER_RE = /^@[^@]+@$/;

export function isPointer(value: string | undefined): value is string {
  return value !== undefined && POINTER_RE.test(value);
}

/** True for a node we can lift into a plain string field. */
function isSimple(node: GedcomNode): node is GedcomNode & { value: string } {
  return node.value !== undefined && node.value !== "" && node.children.length === 0;
}

/** Deep-copies verbatim nodes, setting each one's level from its depth. */
export function atLevel(nodes: GedcomNode[], level: number): GedcomNode[] {
  return nodes.map((n) => ({ ...n, level, children: atLevel(n.children, level + 1) }));
}

function line(level: number, tag: string, value: string, children: GedcomNode[] = []): GedcomNode {
  return { level, tag, value, children };
}

// ---------------------------------------------------------------------------
// Citations

const QUALITIES = ["0", "1", "2", "3"];

export function parseCitation(node: GedcomNode): Citation {
  const citation: Citation = { notes: [] };
  if (isPointer(node.value)) citation.sourceId = node.value;
  else if (node.value) citation.description = node.value;
  const extra: GedcomNode[] = [];
  let sawData = false;

  for (const child of node.children) {
    if (child.tag === "PAGE" && isSimple(child) && citation.page === undefined) {
      citation.page = child.value;
    } else if (child.tag === "QUAY" && isSimple(child) && QUALITIES.includes(child.value) && citation.quality === undefined) {
      citation.quality = Number(child.value) as Citation["quality"];
    } else if (child.tag === "DATA" && child.value === undefined && !sawData) {
      sawData = true;
      parseCitationData(child, citation);
    } else if (child.tag === "NOTE") {
      citation.notes.push(parseNote(child));
    } else {
      extra.push(child);
    }
  }

  if (extra.length > 0) citation.extra = extra;
  return citation;
}

function parseCitationData(data: GedcomNode, citation: Citation): void {
  const dataExtra: GedcomNode[] = [];
  for (const child of data.children) {
    if (child.tag === "DATE" && isSimple(child) && citation.date === undefined) citation.date = child.value;
    else if (child.tag === "TEXT" && isSimple(child) && citation.text === undefined) citation.text = child.value;
    else dataExtra.push(child);
  }
  if (dataExtra.length > 0) citation.dataExtra = dataExtra;
}

export function citationToNode(citation: Citation, level: number): GedcomNode {
  const children: GedcomNode[] = [];
  if (citation.page) children.push(line(level + 1, "PAGE", citation.page));
  if (citation.quality !== undefined) children.push(line(level + 1, "QUAY", String(citation.quality)));
  const data: GedcomNode[] = [];
  if (citation.date) data.push(line(level + 2, "DATE", citation.date));
  if (citation.text) data.push(line(level + 2, "TEXT", citation.text));
  data.push(...atLevel(citation.dataExtra ?? [], level + 2));
  if (data.length > 0) children.push({ level: level + 1, tag: "DATA", children: data });
  for (const note of citation.notes) children.push(noteToNode(note, level + 1));
  children.push(...atLevel(citation.extra ?? [], level + 1));
  return { level, tag: "SOUR", value: citation.sourceId ?? citation.description, children };
}

// ---------------------------------------------------------------------------
// Notes

export function parseNote(node: GedcomNode): Note {
  if (isPointer(node.value)) {
    // A link has no citations of its own in 5.5.1; anything under it is kept verbatim.
    return node.children.length > 0 ? { noteId: node.value, extra: [...node.children] } : { noteId: node.value };
  }
  return { text: node.value ?? "", ...splitCitations(node.children) };
}

/** Separates SOUR citations from the other (verbatim) sub-records of a note. */
function splitCitations(children: GedcomNode[]): { citations: Citation[]; extra?: GedcomNode[] } {
  const citations: Citation[] = [];
  const extra: GedcomNode[] = [];
  for (const child of children) {
    if (child.tag === "SOUR") citations.push(parseCitation(child));
    else extra.push(child);
  }
  return extra.length > 0 ? { citations, extra } : { citations };
}

function noteChildren(note: { citations: Citation[]; extra?: GedcomNode[] }, level: number): GedcomNode[] {
  return [...note.citations.map((c) => citationToNode(c, level)), ...atLevel(note.extra ?? [], level)];
}

export function isNoteLink(note: Note): note is NoteLink {
  return "noteId" in note;
}

export function noteToNode(note: Note, level: number): GedcomNode {
  if (isNoteLink(note)) return line(level, "NOTE", note.noteId, atLevel(note.extra ?? [], level + 1));
  return line(level, "NOTE", note.text, noteChildren(note, level + 1));
}

/** Tags that identify or track a record rather than say anything about its content. */
const RECORD_BOOKKEEPING_TAGS = new Set(["CHAN", "CREA", "RIN", "REFN", "RFN", "AFN", "UID", "_UID", "EXID"]);

/**
 * An inline note with the same text, citations and verbatim sub-records as
 * a shared note, fully independent of it. Swapping a link for this lets one
 * person's copy be reworded without touching everyone else's. Levels
 * don't matter here: verbatim nodes are re-leveled on export.
 */
export function privateCopyOf(shared: SharedNote, link?: NoteLink): InlineNote {
  const copy: InlineNote = { text: shared.text, citations: structuredClone(shared.citations) };
  // The record's own bookkeeping stays with the record: it isn't valid under
  // an inline note, and a copied unique id would clash with the original's.
  const content = (shared.extra ?? []).filter((n) => !RECORD_BOOKKEEPING_TAGS.has(n.tag));
  // Anything that hung off the link line itself would otherwise be lost with it.
  const extra = [...content, ...(link?.extra ?? [])];
  if (extra.length > 0) copy.extra = structuredClone(extra);
  return copy;
}

export function parseSharedNote(node: GedcomNode): SharedNote {
  return { id: node.xref!, text: node.value ?? "", ...splitCitations(node.children) };
}

export function sharedNoteToNode(note: SharedNote): GedcomNode {
  return { level: 0, xref: note.id, tag: "NOTE", value: note.text, children: noteChildren(note, 1) };
}

// ---------------------------------------------------------------------------
// Sources

const SOURCE_FIELDS = {
  TITL: "title",
  AUTH: "author",
  PUBL: "publication",
  ABBR: "abbreviation",
  TEXT: "text",
} as const satisfies Record<string, keyof Source>;

type SourceFieldTag = keyof typeof SOURCE_FIELDS;

export function parseSource(node: GedcomNode): Source {
  const source: Source = { id: node.xref!, repositories: [], notes: [] };
  const extra: GedcomNode[] = [];

  for (const child of node.children) {
    const field = SOURCE_FIELDS[child.tag as SourceFieldTag];
    if (field && isSimple(child) && source[field] === undefined) {
      source[field] = child.value;
    } else if (child.tag === "REPO" && isPointer(child.value)) {
      source.repositories.push(parseRepositoryRef(child as GedcomNode & { value: string }));
    } else if (child.tag === "NOTE") {
      source.notes.push(parseNote(child));
    } else {
      extra.push(child);
    }
  }

  if (extra.length > 0) source.extra = extra;
  return source;
}

function parseRepositoryRef(node: GedcomNode & { value: string }): RepositoryRef {
  const ref: RepositoryRef = { repoId: node.value };
  const extra: GedcomNode[] = [];
  for (const child of node.children) {
    if (child.tag === "CALN" && child.value && ref.callNumber === undefined) {
      ref.callNumber = child.value;
      if (child.children.length > 0) ref.callNumberExtra = child.children;
    } else extra.push(child);
  }
  if (extra.length > 0) ref.extra = extra;
  return ref;
}

export function sourceToNode(source: Source): GedcomNode {
  const children: GedcomNode[] = [];
  for (const [tag, field] of Object.entries(SOURCE_FIELDS) as [SourceFieldTag, (typeof SOURCE_FIELDS)[SourceFieldTag]][]) {
    const value = source[field];
    if (value) children.push(line(1, tag, value));
  }
  for (const ref of source.repositories) {
    const refChildren: GedcomNode[] = [];
    if (ref.callNumber) refChildren.push(line(2, "CALN", ref.callNumber, atLevel(ref.callNumberExtra ?? [], 3)));
    refChildren.push(...atLevel(ref.extra ?? [], 2));
    children.push(line(1, "REPO", ref.repoId, refChildren));
  }
  for (const note of source.notes) children.push(noteToNode(note, 1));
  children.push(...atLevel(source.extra ?? [], 1));
  return { level: 0, xref: source.id, tag: "SOUR", children };
}

// ---------------------------------------------------------------------------
// Repositories

export function parseRepository(node: GedcomNode): Repository {
  const repo: Repository = { id: node.xref!, notes: [] };
  const extra: GedcomNode[] = [];
  for (const child of node.children) {
    if (child.tag === "NAME" && isSimple(child) && repo.name === undefined) repo.name = child.value;
    else if (child.tag === "WWW" && isSimple(child) && repo.website === undefined) repo.website = child.value;
    else if (child.tag === "NOTE") repo.notes.push(parseNote(child));
    else extra.push(child);
  }
  if (extra.length > 0) repo.extra = extra;
  return repo;
}

export function repositoryToNode(repo: Repository): GedcomNode {
  const children: GedcomNode[] = [];
  if (repo.name) children.push(line(1, "NAME", repo.name));
  if (repo.website) children.push(line(1, "WWW", repo.website));
  for (const note of repo.notes) children.push(noteToNode(note, 1));
  children.push(...atLevel(repo.extra ?? [], 1));
  return { level: 0, xref: repo.id, tag: "REPO", children };
}
