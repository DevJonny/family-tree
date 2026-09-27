"use client";

import { useMemo, useState, type ReactNode } from "react";
import { useFamilyTreeStore } from "@/lib/store/familyTreeStore";
import { exactPersonMatches, lifeSpan, searchPeople } from "@/lib/gedcom/people";
import { personDisplayName } from "@/lib/gedcom/model";

/**
 * A search over people's names whose last option creates a new person
 * from what was typed, like "+ cite". Enter picks the one person whose
 * whole name was typed, else creates a new person; with two people of that
 * name it waits for an arrow-key choice rather than guess.
 */
export function PersonPicker({
  exclude,
  placeholder,
  onPick,
  onCreate,
  onClose,
  children,
}: {
  /** People who can't be picked (the person themselves, the family's members). */
  exclude: ReadonlySet<string>;
  placeholder: string;
  onPick: (id: string) => void;
  /** Called with the typed text, for a new person. */
  onCreate: (typed: string) => void;
  onClose: () => void;
  /** Extra options under the list, e.g. "No spouse yet". */
  children?: ReactNode;
}) {
  const tree = useFamilyTreeStore((s) => s.tree);
  // A search box, not a field of the tree: nothing reaches the store until a pick.
  const [query, setQuery] = useState("");
  const typed = query.trim();
  const { results, exact } = useMemo(() => {
    const all = searchPeople(tree, query, exclude);
    const matches = exactPersonMatches(all, query);
    const top = all.slice(0, 8);
    // Always list an exact match, since Enter picks it.
    const shown = matches.length === 1 && !top.includes(matches[0]) ? [matches[0], ...top.slice(0, 7)] : top;
    return { results: shown, exact: matches };
  }, [tree, query, exclude]);

  // Options in list order: each result, then "New person" when something's typed.
  const optionCount = results.length + (typed ? 1 : 0);
  const defaultIndex =
    exact.length === 1 ? results.indexOf(exact[0]) : typed && exact.length === 0 ? results.length : -1;
  const [moved, setMoved] = useState<number | null>(null);
  const active = moved ?? defaultIndex;
  const choose = (index: number) => {
    if (index >= 0 && index < results.length) onPick(results[index].id);
    else if (index === results.length && typed) onCreate(typed);
  };

  return (
    <div className="space-y-1 rounded border border-blue-200 bg-blue-50/40 p-2 text-xs">
      <div className="flex gap-2">
        <input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setMoved(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
            if (e.key === "Enter") choose(active);
            if ((e.key === "ArrowDown" || e.key === "ArrowUp") && optionCount > 0) {
              e.preventDefault();
              const step = e.key === "ArrowDown" ? 1 : -1;
              const from = active >= 0 ? active : step > 0 ? -1 : optionCount;
              setMoved((from + step + optionCount) % optionCount);
            }
          }}
          placeholder={placeholder}
          className="flex-1 rounded border border-neutral-200 bg-white px-2 py-1 text-sm"
        />
        <button onClick={onClose} className="text-neutral-500 hover:underline">
          Cancel
        </button>
      </div>
      <ul className="max-h-48 overflow-y-auto">
        {results.map((person, i) => {
          const span = lifeSpan(person);
          return (
            <li key={person.id}>
              <button
                onClick={() => onPick(person.id)}
                className={`w-full truncate rounded px-1 py-0.5 text-left hover:bg-blue-100 ${i === active ? "bg-blue-100" : ""}`}
              >
                {personDisplayName(person)}
                {span && <span className="text-neutral-500"> ({span})</span>}
              </button>
            </li>
          );
        })}
        {results.length === 0 && !typed && <li className="px-1 text-neutral-500">Type a name to search or add someone.</li>}
        {typed && (
          <li>
            <button
              onClick={() => onCreate(typed)}
              className={`w-full truncate rounded px-1 py-0.5 text-left text-blue-700 hover:bg-blue-100 ${active === results.length ? "bg-blue-100" : ""}`}
            >
              + New person “{typed}”
            </button>
          </li>
        )}
      </ul>
      {children}
    </div>
  );
}
