# Family Tree — Architecture

An Ancestry-like family tree app. GEDCOM is the native read/write format,
Google Drive is the sync backend, and every edit is undoable/redoable.

## Stack

- **Next.js 16 (App Router) + TypeScript + Tailwind**, deployed on Vercel.
  Chosen because the whole app can run client-side (no database needed —
  see below), and Vercel/Next was already the ambient tooling context.
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
  verbatim in an `extra: GedcomNode[]` bucket per record, so importing a
  file from Ancestry/FamilySearch/Gramps and re-exporting doesn't silently
  drop data — it just round-trips read-only until we model that tag.
- 21 unit tests cover parse/serialize round-tripping and model
  extraction/reconstruction, including the "unknown tag survives a full
  roundtrip" case. Run with `npm test`.

**Known limitation (v1):** `NOTE`/`SOUR` *pointer* records (`1 NOTE @N1@`
referring to a top-level `0 @N1@ NOTE` record) aren't resolved yet — only
inline note values are. Top-level NOTE/SOUR/REPO/SUBM records are
preserved verbatim in `FamilyTree.otherRoots` so they aren't lost, just
not yet editable as first-class data.

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

Thin Zustand wrapper around one `History<FamilyTree>` instance. Exposes
domain actions (`addIndividual`, `updateIndividualName`,
`removeIndividual`, `loadFromGedcomText`, `exportToGedcomText`, `undo`,
`redo`). This is the only file that should grow as more editing features
are added — new actions call `history.apply(recipe, label)`.

### 4. Google Drive sync — `src/lib/drive/`

**Status: scaffolded, not wired into the UI yet.** The network/OAuth code
exists and type-checks, but calling it will fail until you complete the
one-time setup below — wiring a "Connect to Drive" button before that
would just ship a button that always errors.

- `driveClient.ts` — OAuth via Google Identity Services (client-side
  token flow, no backend) + Drive REST v3 calls (list/create/update
  file). Scope requested: `drive.file` — the app can only see files/
  folders *it* creates, never your whole Drive. The GEDCOM file lives in
  a normal, visible "Family Tree App" folder (not the hidden
  `appDataFolder`) so you can find it, back it up, or open it in another
  tool.
- `syncManager.ts` — sync/conflict logic, kept separate from the network
  calls so it's unit-testable without mocking `fetch`. `hasConflict()`
  decides whether an upload would clobber a change made elsewhere
  (another device, the Drive web UI) since our last sync, comparing
  `md5Checksum` (falls back to `modifiedTime`).

**Setup required before Drive sync can work (you'll need to do this —
it can't be done from inside the codebase):**

1. Create a project in the [Google Cloud Console](https://console.cloud.google.com/).
2. Enable the **Google Drive API** for it.
3. Configure the **OAuth consent screen** (External is fine for personal
   use; add yourself as a test user if it stays in "Testing" status).
4. Create an **OAuth 2.0 Client ID** (Application type: *Web application*)
   with your dev/prod URLs under "Authorized JavaScript origins" (e.g.
   `http://localhost:3000` and your Vercel domain).
5. Put the client ID in `.env.local`:
   ```
   NEXT_PUBLIC_GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
   ```

Once that's done, the next build step is wiring `syncManager` into the
Zustand store (connect/sync/conflict-resolution UI) — see Roadmap below.

## Roadmap

- [x] Phase 1 — GEDCOM parse/serialize/model, undo/redo engine, minimal
      import/edit/export UI (this commit).
- [ ] Phase 2 — Google Drive sync wired end-to-end (needs your OAuth
      client ID from the setup steps above), including conflict-resolution
      UI.
- [ ] Phase 3 — Tree visualization (pedigree/descendant chart), not just
      a flat list.
- [ ] Phase 4 — Richer editing: multiple names, more event/attribute
      types with UI (not just raw pass-through), sources/citations,
      media attachments, resolved NOTE/SOUR pointer records.
- [ ] Phase 5 — A visible "history" panel (the `History` class already
      tracks labeled entries with timestamps; just needs a UI).

## Local dev

```
npm run dev     # http://localhost:3000
npm test        # unit tests (node:test via tsx)
npm run lint
npm run build
```
