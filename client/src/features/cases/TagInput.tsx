// Chip-style tag input.
//
// - Type + Enter to add a tag (deduped against current value list).
// - Backspace in an empty input removes the last tag.
// - Click a chip to remove it.
// - Optional autocomplete from a `suggestions` list (all tags currently
//   in the system, computed by the parent).

import { useState } from 'react';

interface TagInputProps {
  value: string[];
  onChange: (next: string[]) => void;
  suggestions?: string[];
}

export function TagInput({ value, onChange, suggestions = [] }: TagInputProps) {
  const [input, setInput] = useState('');
  const [open, setOpen] = useState(false);

  function add(raw: string) {
    const t = raw.trim();
    if (!t) return;
    if (value.includes(t)) return;
    onChange([...value, t]);
    setInput('');
    setOpen(false);
  }

  function remove(t: string) {
    onChange(value.filter((x) => x !== t));
  }

  const matches = input.trim()
    ? suggestions.filter(
        (s) => s.toLowerCase().includes(input.toLowerCase()) && !value.includes(s),
      ).slice(0, 6)
    : [];

  return (
    <div className="relative flex flex-wrap items-center gap-1 rounded border border-gray-300 px-2 py-1">
      {value.map((t) => (
        <span
          key={t}
          data-cy="tag-chip"
          onClick={() => remove(t)}
          className="cursor-pointer rounded bg-blue-100 px-2 py-0.5 text-xs text-blue-800 hover:bg-blue-200"
          title="Click to remove"
        >
          {t} ×
        </span>
      ))}
      <input
        data-cy="tag-input"
        type="text"
        value={input}
        onChange={(e) => {
          setInput(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            add(input);
          } else if (e.key === 'Backspace' && !input && value.length > 0) {
            onChange(value.slice(0, -1));
          }
        }}
        placeholder="Add tag…"
        className="min-w-[100px] flex-1 border-0 px-1 py-1 text-sm outline-none"
      />
      {open && matches.length > 0 && (
        <div
          data-cy="tag-suggestions"
          className="absolute left-0 top-full z-10 mt-1 w-48 rounded border border-gray-200 bg-white py-1 shadow"
        >
          {matches.map((m) => (
            <button
              key={m}
              type="button"
              data-cy="tag-suggestion"
              onMouseDown={(e) => {
                // mousedown fires before the input's blur, so the click
                // handler actually runs before the suggestions close.
                e.preventDefault();
                add(m);
              }}
              className="block w-full px-3 py-1 text-left text-sm hover:bg-gray-100"
            >
              {m}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
