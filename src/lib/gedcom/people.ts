import { dateSortKey } from "./dates";
import { current, isDraft, type Draft } from "immer";
import { nextFreeId, personDisplayName, type FamilyTree, type Individual, type NameParts } from "./model";

/** A name typed into a search box: the last word is the surname, the rest the given names. */
export function nameFromTyped(text: string): NameParts {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return { given: words[0] ?? "" };
  return { given: words.slice(0, -1).join(" "), surname: words.at(-1) };
}

/** Every word in all of a person's names (married names and the like included), lower-cased. */
function nameWords(person: Individual): string[] {
  return person.names
    .flatMap((n) => [n.given, n.surname, n.full?.replace(/\//g, " ")])
    .flatMap((part) => part?.toLowerCase().split(/\s+/) ?? [])
    .filter(Boolean);
}

/**
 * People whose names match every typed word (each word the start of some
 * word in any of their names), except those in `exclude`, sorted by name.
 */
export function searchPeople(tree: FamilyTree, query: string, exclude: ReadonlySet<string>): Individual[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  return Object.values(tree.individuals)
    .filter((person) => {
      if (exclude.has(person.id)) return false;
      const words = nameWords(person);
      return terms.every((term) => words.some((w) => w.startsWith(term)));
    })
    .sort((a, b) =>
      personDisplayName(a).localeCompare(personDisplayName(b), undefined, { sensitivity: "base", numeric: true }),
    );
}

function year(date: string | undefined): number | undefined {
  const key = date === undefined ? undefined : dateSortKey(date);
  return key === undefined ? undefined : Math.floor(key / 10000);
}

/** "1872–1950", "b. 1901", "d. 1930", or "" when neither year is known. */
export function lifeSpan(person: Individual): string {
  const born = year(person.birth?.date);
  const died = year(person.death?.date);
  if (born && died) return `${born}–${died}`;
  if (born) return `b. ${born}`;
  if (died) return `d. ${died}`;
  return "";
}

/**
 * The people whose display name is exactly `text` (ignoring case and
 * spacing). In a picker, one means Enter picks them; none means Enter
 * creates a new person; several is ambiguous, so Enter waits for a choice.
 */
export function exactPersonMatches(people: Individual[], text: string): Individual[] {
  const t = text.trim().split(/\s+/).join(" ").toLowerCase();
  if (!t) return [];
  return people.filter((p) => personDisplayName(p).toLowerCase() === t);
}

/** Creates a person (inside a recipe, so it can share an undo step with linking them) and returns their id. */
export function addPerson(tree: Draft<FamilyTree>, name: NameParts): string {
  // nextFreeId exports the whole tree; reading a plain snapshot rather than
  // the draft keeps Immer from proxying every record it touches.
  const id = nextFreeId(isDraft(tree) ? current(tree) : tree, "I");
  tree.individuals[id] = {
    id,
    names: [name],
    events: [],
    familyAsChild: [],
    familyAsSpouse: [],
    notes: [],
    citations: [],
    extra: [],
  };
  return id;
}
