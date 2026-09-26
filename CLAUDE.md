@AGENTS.md

# Family Tree

A family tree app similar to Ancestry, running entirely in the browser. GEDCOM is the native format, Google Drive is
the sync backend, and every edit can be undone and redone. Live at https://devjonny.github.io/family-tree/.

**Read `ARCHITECTURE.md` before non-trivial work.** It is the source of truth for design decisions, known limitations
and the phase roadmap. Update it (including the Roadmap checklist) whenever you finish a phase or change a design.

## Commands

```
npm run dev     # http://localhost:3000/family-tree/  (basePath applies in dev too)
npm test        # node:test via tsx — src/**/__tests__/**/*.test.ts
npm run lint
npm run build   # static export -> out/
npx tsc --noEmit
```

Before committing, run tests, lint, `tsc` and the build. CI (`.github/workflows/deploy.yml`) runs tests, lint and build
on every push to `main` and deploys to GitHub Pages, so pushing to `main` ships to production.

## Hard constraints

- **Static export only** (`output: "export"`). No API routes, server actions, middleware, Next.js image optimization
  or anything else that needs a Node server. Everything runs client-side.
- **No backend or database.** The `.ged` file in the user's Drive *is* the database. Don't add a vendor store.
- **Never lose GEDCOM data.** Tags we don't model yet go in the `extra: GedcomNode[]` bucket on each record, and
  unmodelled top-level records go in `FamilyTree.otherRoots`, so import → export round-trips losslessly. When you
  model a new tag, move it out of `extra`/`otherRoots` and add a round-trip test for it.
- **Drive scope stays `drive.file`.** The app only sees files it created.
- `basePath`/`assetPrefix` are `/family-tree` (GitHub project page). Asset URLs must respect this.

## Conventions

- **Every tree mutation goes through `History.apply()`** as an Immer recipe, so undo/redo works automatically. Per-person
  edits use the store's `updateIndividual(id, recipe, label)`. Pass a human-readable `label` because it appears in the
  History panel. Don't add a hand-written store action per field.
- **Text inputs commit on blur/Enter, never on every keystroke.** Use `TextField` / `TextAreaField` / `BareTextInput`
  from `src/components/fields.tsx`. Don't wire a raw `<input onChange>` to the store, because each keystroke becomes
  an undo entry.
- Hooks can't run inside `.map()`, so extract a row component (see `IndividualRow`).
- Keep domain logic (`src/lib/**`) pure and unit-tested, separate from UI and network code. Example: `syncManager.ts`
  holds the conflict logic, `driveClient.ts` holds the network calls. `History<T>` stays generic, not family-tree-specific.
- The GEDCOM layer: `types.ts` is a generic node tree, `parse.ts`/`serialize.ts` convert between text and nodes, and
  `model.ts` converts between nodes and the typed `FamilyTree`. Relationship traversal lives in `relationships.ts`.

## Verifying UI changes

Tests alone have missed real bugs here (the keystroke/undo bug was found in a browser). For UI work, run `npm run dev`
and exercise the flow in a real browser (claude-in-chrome), including undo/redo. `data/555SAMPLE.GED` is the official
GEDCOM 5.5.5 sample file (fictional people), useful for import testing.

## Secrets

`.env.local` holds `NEXT_PUBLIC_GOOGLE_CLIENT_ID` for local dev and is gitignored. The same public OAuth client ID is
deliberately committed in the deploy workflow; it isn't a secret (Google scopes access by Authorized JavaScript Origins).
