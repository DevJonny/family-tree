/**
 * Generic GEDCOM tree types.
 *
 * A GEDCOM file is a flat list of lines of the form:
 *   LEVEL [XREF] TAG [LINE_VALUE]
 * where indentation is implied by LEVEL, not whitespace. We parse this into
 * a tree of GedcomNode so that nesting (e.g. INDI > BIRT > DATE) is explicit.
 *
 * This layer is intentionally "dumb" and lossless: it does not know what a
 * BIRT or a HUSB is. That knowledge lives in ./model.ts. Keeping this layer
 * generic means we can round-trip *any* valid GEDCOM file (including vendor
 * extension tags like _UID) even before we understand every tag.
 */

export interface GedcomNode {
  /** Nesting depth, 0 for top-level records (HEAD, INDI, FAM, ...). */
  level: number;
  /** Cross-reference id for records that define one, e.g. "@I1@". */
  xref?: string;
  /** The tag itself, e.g. "INDI", "BIRT", "DATE". */
  tag: string;
  /**
   * The remainder of the line after the tag. For pointer lines (e.g.
   * `1 FAMC @F1@`) this holds the pointer target verbatim (e.g. "@F1@").
   */
  value?: string;
  children: GedcomNode[];
}

export interface GedcomParseWarning {
  line: number;
  message: string;
}

export interface GedcomParseResult {
  roots: GedcomNode[];
  warnings: GedcomParseWarning[];
}
