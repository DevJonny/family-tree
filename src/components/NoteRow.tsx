"use client";

import { useMemo } from "react";
import { useFamilyTreeStore } from "@/lib/store/familyTreeStore";
import { TextAreaField } from "@/components/fields";
import { isNoteLink, noteUsage, privateCopyOf, type Note } from "@/lib/gedcom";

const FIELD = "w-full rounded border border-neutral-200 px-2 py-1 text-sm";

/**
 * One note in any container's notes list (a person's today; sources and
 * repositories later). Container-agnostic: the parent says how to edit an
 * inline note's text, swap the note for another, or remove it.
 *
 * A shared note (a link to a `0 @N1@ NOTE` record) edits the record
 * itself, so the change shows everywhere it's linked, and says how many
 * other records share it. "Make private copy" swaps the link for an inline
 * copy that can be reworded on its own; "Remove" only unlinks, the shared
 * record stays.
 */
export function NoteRow({
  note,
  ownerId,
  onEditText,
  onReplace,
  onRemove,
}: {
  note: Note;
  /** The record this note belongs to, so it isn't counted as one of the "others". */
  ownerId: string;
  onEditText: (text: string) => void;
  onReplace: (note: Note) => void;
  onRemove: () => void;
}) {
  const tree = useFamilyTreeStore((s) => s.tree);
  const updateTree = useFamilyTreeStore((s) => s.updateTree);
  const link = isNoteLink(note) ? note : null;
  const shared = link ? tree.notes[link.noteId] : undefined;
  const others = useMemo(
    () => (link ? noteUsage(tree, link.noteId).filter((id) => id !== ownerId).length : 0),
    [tree, link, ownerId],
  );

  const removeButton = (
    <button
      onClick={onRemove}
      title={link ? "Unlink this note here. The shared note itself is kept." : undefined}
      className="text-xs text-red-500 hover:text-red-700"
    >
      Remove
    </button>
  );

  if (!isNoteLink(note)) {
    return (
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <TextAreaField value={note.text} onChange={onEditText} rows={2} className={FIELD} />
        </div>
        {removeButton}
      </div>
    );
  }

  if (!link || !shared) {
    return (
      <div className="flex items-start gap-2">
        <p className="flex-1 rounded border border-dashed border-amber-300 bg-amber-50 px-2 py-1 text-sm text-amber-800">
          Missing shared note {note.noteId}. It isn&apos;t in this file.
        </p>
        {removeButton}
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2">
      <div className="flex-1 space-y-1">
        <div className="flex items-center gap-2 text-[11px]">
          <span className="rounded bg-violet-100 px-1.5 py-0.5 font-medium text-violet-700">
            {others === 0 ? "Shared note, only used here" : `Shared with ${others} other${others === 1 ? "" : "s"}`}
          </span>
          <button
            onClick={() => onReplace(privateCopyOf(shared, link))}
            title="Replace the link with a copy you can reword here without changing it elsewhere"
            className="text-blue-600 hover:underline"
          >
            Make private copy
          </button>
        </div>
        <TextAreaField
          value={shared.text}
          onChange={(text) => updateTree((d) => void (d.notes[link.noteId].text = text), "Edit shared note")}
          rows={3}
          className={`${FIELD} border-violet-200`}
        />
      </div>
      {removeButton}
    </div>
  );
}
