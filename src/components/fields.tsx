"use client";

import { useState, type KeyboardEvent } from "react";

/**
 * Backs a text input with local draft state so individual keystrokes
 * don't each create their own undo-history entry - the value only
 * commits (calls `onCommit`) on blur or Enter. Resyncs from `value`
 * whenever it changes for a reason *other* than this input's own edit
 * (switching which person is selected, an undo/redo, a Drive sync
 * pulling in a remote change).
 *
 * Found this the hard way: the first version of these fields called
 * onChange straight from the <input>'s onChange, which pushed a new
 * History entry per keystroke (typing a 10-character date produced 10
 * separate undo steps). This is the fix.
 */
export function useCommittedInput(value: string, onCommit: (v: string) => void) {
  const [draft, setDraft] = useState(value);
  // "Adjusting state when a prop changes" during render, per React's docs
  // (https://react.dev/learn/you-might-not-need-an-effect) - avoids the
  // extra render + flash-of-stale-value an effect-based resync would
  // cause, since this runs before the DOM paints rather than after.
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    setDraft(value);
  }

  function commit() {
    if (draft !== value) onCommit(draft);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      commit();
      (e.target as HTMLElement).blur();
    }
  }

  return { draft, setDraft, commit, onKeyDown };
}

export function TextField({
  label,
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const { draft, setDraft, commit, onKeyDown } = useCommittedInput(value, onChange);
  return (
    <label className="flex flex-col gap-0.5 text-xs text-neutral-500">
      {label}
      <input
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
        autoFocus={autoFocus}
        className="rounded border border-neutral-200 px-2 py-1 text-sm text-neutral-900"
      />
    </label>
  );
}

/** Same commit-on-blur behavior as TextField, without the <label> wrapper - for compact inline uses. */
export function BareTextInput({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const { draft, setDraft, commit, onKeyDown } = useCommittedInput(value, onChange);
  return (
    <input
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={onKeyDown}
      onClick={(e) => e.stopPropagation()}
      className={className}
    />
  );
}

export function TextAreaField({
  value,
  onChange,
  placeholder,
  rows = 2,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  className?: string;
}) {
  const { draft, setDraft, commit } = useCommittedInput(value, onChange);
  return (
    <textarea
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      rows={rows}
      className={className}
    />
  );
}
