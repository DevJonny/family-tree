# Family Tree — Architecture

An Ancestry-like family tree app. GEDCOM is the native read/write format,
Google Drive is the sync backend, and every edit is undoable/redoable.

## Stack

- **Next.js 16 (App Router) + TypeScript + Tailwind**, statically exported
  (`output: "export"`) and deployed to **GitHub Pages**. The whole app is
  client-side already (GEDCOM parsing, undo/redo, Drive sync all run in
  the browser), so a static export is a clean fit — no Node server, no
  Next.js Image Optimization API, no API routes needed or used.
- **Zustand** for UI state.
- **Immer** for undo/redo (patch-based, see below).
- No backend database. The GEDCOM file (synced to Drive) *is* the
  database. This matches how genealogy data is normally owned by the
  user, not a vendor, and makes "export and take your data elsewhere"
  free by construction.

## Data flow

```
 .ged file (Drive)  <-->  GEDCOM text  <-->  FamilyTree model  <-->  React UI
                          (lib/gedcom)      (lib/gedcom/model)      (Zustand
                                                    ^                 store)
                                                    |
                                              History<FamilyTree>
                                              (lib/history) — undo/redo
```

### 1. GEDCOM layer — `src/lib/gedcom/`

- `types.ts` — generic `GedcomNode` tree (level/xref/tag/value/children).
  Deliberately dumb: it doesn't know what a `BIRT` is. This is what makes
  round-tripping *any* valid GEDCOM file possible, including vendor
  extension tags (`_UID`, etc.) we haven't modeled.
- `parse.ts` / `serialize.ts` — text ↔ `GedcomNode[]`. Handles `CONC`/`CONT`
  line-continuation, BOM stripping, CRLF output per spec.
- `model.ts` — the normalized, typed `FamilyTree` (individuals + families
  with typed names/events/relationships) that the UI actually reads and
  edits. Any GEDCOM sub-record we don't have a typed field for is kept
  verbatim — in the `extra: GedcomNode[]` bucket of the record, name or
  event it belongs to, or in a small keyed map for sub-records of lines we
  *do* model (`EventFact.attached` for DATE/PLAC/NOTE children like MAP
  coordinates; `familyAsChildExtra`/`familyAsSpouseExtra` for FAMC/FAMS
  children like `PEDI adopted`; `Family.memberExtra` for HUSB/WIFE/CHIL
  children like Ancestry's `_FREL`/`_MREL`). Importing a file from
  Ancestry/FamilySearch/Gramps and re-exporting loses nothing — unmodeled
  data just round-trips read-only until we model that tag.
- Modeling choices that matter for fidelity:
  - A *second* BIRT/DEAT/MARR (Ancestry "alternate facts") becomes an
    ordinary event rather than overwriting the first.
  - Standard non-event tags (`CHAN`, `RIN`, `REFN`, `SOUR`, `OBJE`, ...;
    see `NON_EVENT_TAGS`) go to `extra`, not the events list. Any other
    unknown tag is treated as an event so it's visible and editable.
  - `NameParts.full` is the imported NAME value, written back verbatim
    until a name part changes. **Edit names only via `applyNamePatch`**,
    which clears `full` so export rebuilds the value from parts. Parts
    derived from the value (no GIVN/SURN/NSFX line in the file) are listed
    in `NameParts.derived` and not written out as new lines.
  - CONC wrapping only splits between two non-space characters (and never
    inside a surrogate pair); the parser keeps a line's trailing space when
    the next line is a CONC. Previously ~1 in 6 wrap points in long notes
    silently lost a space.
- **Fidelity is enforced by `__tests__/fixtures.test.ts`:** every committed
  file in `data/` (the official `555SAMPLE.GED`, and `sample-extended.ged`
  — a fictional superset built to contain the quirks real vendor exports
  have; its HEAD NOTE lists them) must import -> export with nothing lost
  or added (sibling order aside), and exporting twice must be
  byte-identical. `__tests__/fidelity.test.ts` has one focused test per
  bug that suite found. Add new quirks to the fixture, not just to unit
  tests. Run with `npm test`.

**Sources, citations and notes (Phase 4b.1)** live in
`src/lib/gedcom/sources.ts`. Top-level SOUR/REPO/NOTE records load into
`FamilyTree.sources`/`repositories`/`notes`, and `otherRoots` now holds
only what's still unmodelled (SUBM, OBJE, vendor records). Citations are
parsed on every container listed in the design below. A person's or
family's `notes` (and an event's) are `Note[]`: inline notes carry their
own citations, and `1 NOTE @N1@` becomes a link to the shared record.
Verbatim nodes are re-leveled on export (`atLevel`), so notes and
citations can move between depths. New record ids come from
`nextFreeId(tree, prefix)`, which skips every id and pointer anywhere in
the file. The store uses it for people and families too.
`walk.ts` (`walkTree`) is the one place that knows every container a
note or citation can live in. Usage counts (`noteUsage`, and later
"Cited by") and cascading deletes are built on it, so they can't miss one.
`citations.ts` holds the pure helpers the citations UI uses:
`describeCitation` (the one-line summary and ok/unpointed/missing status),
`searchSources`, `newSource` and `promoteToSource`. The UI
(`CitationList`, `NoteList`) takes a `locate(draft)` function that finds
its list inside a draft tree, so every edit is one `updateTree` call
wherever the list lives. Not shown yet: citations on a person's inline notes
(still modelled and round-tripped), and anything on families (no family editor).
Still verbatim: NOTE under NAME, and citation EVEN/ROLE/OBJE.

#### Phase 4b design — sources, citations, repositories, shared notes

Agreed with the user before coding (media/OBJE is Phase 4c, not here).
Priority is **import fidelity with messy real Ancestry/FamilySearch
exports**, since that is how most data will arrive.

**Model.** `FamilyTree` gains first-class `sources`, `repositories` and
`notes` (shared `0 @N1@ NOTE` records), all keyed by id and moved out of
`otherRoots`.

```ts
interface Citation {
  sourceId?: string;       // "@S2@"; absent for an unpointed `SOUR <free text>`
  description?: string;    // the value of an unpointed citation
  page?: string;           // PAGE
  quality?: 0 | 1 | 2 | 3; // QUAY
  date?: string;           // DATA.DATE
  text?: string;           // first DATA.TEXT
  notes: Note[];
  extra?: GedcomNode[];    // EVEN/ROLE, OBJE, _APID, extra TEXTs, ...
}
type Note =
  | { text: string; citations: Citation[]; extra?: GedcomNode[] } // inline
  | { noteId: string; extra?: GedcomNode[] };                       // link to shared record
interface Source {
  id: string; title?: string; author?: string; publication?: string;
  abbreviation?: string; text?: string;
  repositories: { repoId: string; callNumber?: string; extra?: GedcomNode[] }[];
  notes: Note[]; extra?: GedcomNode[]; // DATA/EVEN/AGNC, _APID, RIN, CHAN, OBJE
}
interface Repository {
  id: string; name?: string; website?: string;
  notes: Note[]; extra?: GedcomNode[]; // ADDR (shown read-only), PHON, EMAIL
}
```

- `citations: Citation[]` lives on **every** container that can hold a
  SOUR: `EventFact`, `Individual` (person-level "Other citations"),
  `Family`, `NameParts` and inline `Note`s. That makes "Cited by N"
  counts and delete cascades complete by construction. SOURs the model
  doesn't reach (inside SUBM or unmodelled records) are counted as
  "references we can't edit" and left alone, never half-deleted.
- `notes` on every container becomes `Note[]` (was `string[]`), and an
  event's single lifted `note?: string` becomes `notes?: Note[]` too.
- A citation's `DATA` line keeps any other sub-records (a second TEXT,
  vendor tags) in `dataExtra`, so they stay under DATA on export.
- As with names, only the first well-formed occurrence of a typed field
  is lifted; duplicates stay in `extra`.
- Unpointed citations and dangling pointers (`@S99@`) round-trip
  untouched. The UI offers "Make into source" (unpointed → new source
  titled with the text) and "Create source" (dangling → empty source with
  that exact id).
- New ids are the next free `@S<n>@`/`@R<n>@`/`@N<n>@`, never reusing any
  id that appears anywhere in the file, including inside `extra`.
- Tree-wide edits (sources, repositories, shared notes) go through one
  generic store action `updateTree(recipe, label)`, like `updateIndividual`.

**UI.**
- Citations show as one-liners under each fact (birth, death, events,
  names; person-level ones in an "Other citations" block), expanding
  inline to edit page/quality/date/text/notes. "+ cite" is a search over
  source titles/abbreviations whose last option creates a new source;
  source and citation are created in one undo step. Removing a citation
  is a plain ✕ (undoable).
- Shared notes: editing edits the record everywhere, with a "Shared with N
  others" badge. Remove unlinks only (the record stays, even if orphaned).
  "Make private copy" swaps the link for an inline copy. Creating shared
  notes or linking an existing one is deferred.
- A tree-wide **Sources** tab next to Pedigree/Details lists sources by
  title with a filter, citation counts and an "unused" tag. Its editor
  covers the Source fields above plus repositories (edited inline from the
  source, with a call number each) and a **Cited by** list grouped by
  person that jumps to their Details. Family-level citations appear there
  too (e.g. "X & Y (family): Marriage"), but aren't editable until a
  family editor exists.
- Deleting a cited source shows an in-page warning ("Cited by 12 facts
  across 5 people"), then removes the source and every citation as one
  undo step. No `confirm()` dialogs, because they block browser automation.

**Real-data testing.** `fixtures.test.ts` also runs any `.ged` in the
gitignored `data/private/` when present. Failures there report only tag
paths and counts, never values, so real people's data doesn't get printed.
Each quirk found gets a fictional reproduction in `sample-extended.ged`.

### 2. Undo/redo — `src/lib/history/`

Generic `History<T>` class, decoupled from the family-tree domain (tested
against a toy `{count, items}` state, not `FamilyTree`, to keep it
honestly generic).

- Every edit is expressed as an Immer *recipe* — `(draft) => { ... }`.
- `apply()` runs the recipe via `produceWithPatches`, records the forward
  and inverse patch sets, pushes onto an undo stack, and clears the redo
  stack (standard editor semantics — no redo "branches").
- `undo()`/`redo()` replay inverse/forward patches via `applyPatches`.
- `reset()` swaps in a whole new state (used when loading an imported or
  Drive-synced file) *without* creating a history entry — you shouldn't
  be able to "undo" past a file load back into a different document.
- History is capped at 500 entries (oldest dropped first) to bound memory
  on a long editing session.

This design means undo/redo works for *any* future edit to the tree (add
a source citation, attach a photo, merge two people) for free — it's not
hand-coded per action.

### 3. Store — `src/lib/store/familyTreeStore.ts`

Thin Zustand wrapper around one `History<FamilyTree>` instance. Exposes a
few named domain actions (`addIndividual`, `addParent`, `removeIndividual`,
`loadFromGedcomText`, `exportToGedcomText`, `undo`/`redo`/`undoTo`/`redoTo`)
plus one escape hatch, `updateIndividual(id, recipe, label?)`, which runs
an arbitrary Immer recipe against one person and records it as a single
undo step — this is what `PersonDetailPanel` uses for every field (names,
sex, birth/death, other events, notes) instead of the store needing a
hand-written action per field.

**Text inputs commit on blur/Enter, not on every keystroke.** Found this
the hard way while testing Phase 4 in a live browser: the first version
called the store straight from each `<input>`'s `onChange`, so typing a
10-character date created 10 separate undo-stack entries. Fixed via
`src/components/fields.tsx` (`TextField`/`TextAreaField`/`BareTextInput`),
which hold a local draft and only call the store once, on blur or Enter —
resyncing from the incoming value during render (not an effect) if it
changes for another reason, like switching the selected person or an
undo/redo. Any new text input should use one of these rather than wiring
a raw `<input onChange>` straight to the store.

### 4. Google Drive sync — `src/lib/drive/` + `src/lib/store/driveSyncStore.ts`

**Status: wired end-to-end.**

- `driveClient.ts` — OAuth via Google Identity Services (client-side
  token flow, no backend) + Drive REST v3 calls (list/create/update
  file). Scope requested: `drive.file` — the app can only see files/
  folders *it* creates, never your whole Drive. The GEDCOM file lives in
  a normal, visible "Family Tree App" folder (not the hidden
  `appDataFolder`) so you can find it, back it up, or open it in another
  tool.
- `syncManager.ts` — sync/conflict *logic*, kept separate from the network
  calls so it's unit-testable without mocking `fetch`. `hasConflict()`
  decides whether an upload would clobber a change made elsewhere
  (another device, the Drive web UI) since our last sync, comparing
  `md5Checksum` (falls back to `modifiedTime`).
- `driveSyncStore.ts` — the orchestrator. "Connect Google Drive" requests
  an access token, finds-or-creates `Family Tree App/family-tree.ged`,
  downloads and loads it. After that, every tree change is watched (via
  the family-tree store's tree reference) and pushed to Drive on a 2s
  debounce; a conflicting remote change surfaces a "keep local / keep
  Drive" banner (`DriveConflictBanner`) instead of silently overwriting
  anything. The connected file's id is cached in IndexedDB (`idb-keyval`)
  so reconnecting on the same browser doesn't re-prompt which file to use.

**Known limitations (v1):**
- The OAuth access token is session-only and expires after roughly an
  hour; a sync failing after that shows "Sync error" with a *Reconnect*
  button rather than silently refreshing. Silent token renewal (GIS
  supports it) is a reasonable Phase-2b follow-up.
- `driveSyncStore`'s network calls aren't unit tested (would need mocking
  `fetch`/GIS); its *decision logic* (`hasConflict`) is, and the store was
  verified by hand against a real Drive folder.
- If two devices connect for the first time with no shared history, the
  most-recently-modified file in the Drive folder wins — there's no
  "which file did you mean" picker yet.

**One-time setup already done for this deployment:**

1. ✅ Google Cloud project + Drive API enabled, OAuth consent screen, and
   an OAuth 2.0 Web application Client ID (baked into
   `.github/workflows/deploy.yml` as `NEXT_PUBLIC_GOOGLE_CLIENT_ID` — this
   is safe to keep in the repo since it's a *public* client identifier,
   not a secret; Google scopes access by Authorized JavaScript Origins,
   not by hiding this value).
2. ⚠️ **You need to verify** the OAuth client's **Authorized JavaScript
   Origins** (Google Cloud Console → APIs & Services → Credentials)
   include both:
   - `http://localhost:3000` (local dev)
   - `https://devjonny.github.io` (production — GitHub Pages serves from
     the origin, not the full `/family-tree` path)

   If sign-in fails with a `redirect_uri_mismatch`-style error, this is
   almost always why.

## Deployment

Static export to **GitHub Pages** via GitHub Actions
(`.github/workflows/deploy.yml`): on every push to `main`, it runs the
test suite + lint, builds (`output: "export"`), and publishes `out/` with
`actions/deploy-pages`. Live at **https://devjonny.github.io/family-tree/**.

`next.config.ts` sets `basePath`/`assetPrefix` to `/family-tree` to match
GitHub's project-page URL scheme. If you ever move to a custom domain or
a user/org page (`devjonny.github.io` itself), delete those two lines —
root-hosted sites don't need a path prefix. `public/.nojekyll` is required
alongside this — without it, GitHub Pages' default Jekyll processing
silently drops the `_next/` asset directory (leading underscore).

## Roadmap

- [x] Phase 1 — GEDCOM parse/serialize/model, undo/redo engine, minimal
      import/edit/export UI.
- [x] Phase 2 — Google Drive sync wired end-to-end: connect, auto-sync on
      edit, conflict detection with a keep-local/keep-remote resolution
      UI. See "Known limitations" above for what's still rough.
- [x] Phase 3 — Pedigree chart (`src/components/PedigreeChart.tsx`):
      click a person to see 4 generations of ancestors, with "+ Add
      father/mother" slots that create and link a new person in place.
      Relationship traversal (`getParents`/`getChildren`/`getSpouses`/
      `buildAncestorTree`) lives in `src/lib/gedcom/relationships.ts`,
      unit tested separately from the UI. A descendant-tree view is not
      built yet.
- [x] Phase 4a — Person detail editor (`src/components/PersonDetailPanel.tsx`,
      a "Details" tab next to the pedigree chart): multiple names (add/
      remove, given/surname/type), sex, birth/death date+place, arbitrary
      other events from a common-tag picker (occupation, residence,
      burial, ...), and notes — all add/edit/remove, all undoable. Backed
      by the store's generic `updateIndividual` escape hatch rather than
      one action per field.
- [ ] Phase 4b — Sources, citations, repositories and shared notes as
      first-class editable data (design: "Phase 4b design" above).
      Delivered in four slices, each shippable on its own:
  - [x] 4b.1 Model: `sources`/`repositories`/`notes`, `Citation` on every
        container, `Note[]`, `updateTree`; `data/private/` fixture hook.
  - [x] 4b.2 Notes UI (`src/components/NoteRow.tsx`, person notes for now): shared-note text + "Shared with N others" badge,
        "Make private copy", notes carrying citations become visible.
  - [x] 4b.3 Citations UI (`src/components/CitationList.tsx`; event notes shown too): one-liners under facts, inline edit, "+ cite"
        with create-source, "Other citations", unpointed/dangling fix-ups.
  - [ ] 4b.4 Sources tab: list, source/repository editor, Cited by,
        delete with cascade warning.
- [ ] Phase 4c — Media (OBJE): attachments stored in Drive.
- [ ] Family editor — marriage/divorce and other family events, family
      notes and citations (modelled in 4b, but not yet editable in the UI).
- [x] Phase 5 — History panel (`src/components/HistoryPanel.tsx`):
      shows every edit chronologically with a "current" marker; clicking
      any past or future entry jumps straight there via the store's
      `undoTo`/`redoTo` (repeated `undo()`/`redo()` under the hood).

## Local dev

```
npm run dev     # http://localhost:3000/family-tree/  (basePath applies in dev too)
npm test        # unit tests (node:test via tsx)
npm run lint
npm run build   # static export -> out/
```

`npm run dev` needs `NEXT_PUBLIC_GOOGLE_CLIENT_ID` set in `.env.local`
(gitignored) for Drive sync to work locally — see the setup section above.
