import type { FamilyTree } from "./model";
import type { Citation, Source } from "./sources";

/** QUAY 0-3, worded the way genealogy apps usually show it. */
export const QUALITY_LABELS = ["Unreliable", "Questionable", "Secondary", "Primary"] as const;

export type QualityLabel = (typeof QUALITY_LABELS)[number];

export interface CitationSummary {
  /**
   * "ok": points at a source in this file. "unpointed": free-text citation
   * with no source record. "missing": points at a source that isn't here.
   */
  status: "ok" | "unpointed" | "missing";
  title: string;
  page?: string;
  quality?: QualityLabel;
}

/** The one-line summary shown under a fact: which source, which page, how reliable. */
export function describeCitation(tree: FamilyTree, citation: Citation): CitationSummary {
  const summary = ((): CitationSummary => {
    if (!citation.sourceId) return { status: "unpointed", title: citation.description ?? "Unnamed citation" };
    const source = tree.sources[citation.sourceId];
    if (!source) return { status: "missing", title: `Missing source ${citation.sourceId}` };
    return { status: "ok", title: sourceDisplayTitle(source) };
  })();
  if (citation.page) summary.page = citation.page;
  if (citation.quality !== undefined) summary.quality = QUALITY_LABELS[citation.quality];
  return summary;
}

/** The name a source is shown by: its title, else its abbreviation, else a placeholder. */
export function sourceDisplayTitle(source: Source): string {
  return source.title || source.abbreviation || `Untitled source ${source.id}`;
}

/**
 * Sources whose title or abbreviation contains the query (case-insensitive),
 * sorted by title with untitled ones last. A blank query returns them all.
 */
export function searchSources(tree: FamilyTree, query: string): Source[] {
  const q = query.trim().toLowerCase();
  const matches = Object.values(tree.sources).filter(
    (s) => !q || [s.title, s.abbreviation].some((field) => field?.toLowerCase().includes(q)),
  );
  const key = (s: Source) => s.title || s.abbreviation;
  return matches.sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (!ka || !kb) return ka ? -1 : kb ? 1 : 0;
    return ka.localeCompare(kb, undefined, { sensitivity: "base", numeric: true });
  });
}

/** An empty source record, optionally titled. Pair with `nextFreeId(tree, "S")` for a new id. */
export function newSource(id: string, title?: string): Source {
  const source: Source = { id, repositories: [], notes: [] };
  if (title) source.title = title;
  return source;
}

/**
 * Turns a free-text ("unpointed") citation into a real source: returns a
 * new source titled with the citation's text, and repoints the citation
 * (works on an Immer draft) at it. Everything else on the citation stays.
 */
export function promoteToSource(citation: Citation, id: string): Source {
  const source = newSource(id, citation.description);
  citation.sourceId = id;
  delete citation.description;
  return source;
}
