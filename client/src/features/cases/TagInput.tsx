// Chip-style tag input.
//
// - Type + Enter to add a tag (deduped against current value list).
// - Backspace in an empty input removes the last tag.
// - Click a chip to remove it.
// - Optional autocomplete from a `suggestions` list (all tags currently
//   in the system, computed by the parent).

import { useState } from 'react';

import { Pill } from '@/components/Pill';

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
    ? suggestions
        .filter(
          (s) => s.toLowerCase().includes(input.toLowerCase()) && !value.includes(s),
        )
        .slice(0, 6)
    : [];

  return (
    <div className="relative flex flex-wrap items-center gap-1.5 rounded-lg border border-border bg-surface px-2 py-1.5 focus-within:border-brand focus-within:shadow-[0_0_0_3px_var(--color-brand-soft)]">
      {value.map((t) => (
        <button
          key={t}
          type="button"
          data-cy="tag-chip"
          onClick={() => remove(t)}
          title="Click to remove"
          className="group inline-flex items-center gap-1"
        >
          <Pill tone="brand" size="sm" className="!py-0 group-hover:opacity-80">
            {t}
            <span className="ml-0.5 opacity-50 group-hover:opacity-100">×</span>
          </Pill>
        </button>
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
        className="min-w-[100px] flex-1 border-0 bg-transparent px-1 py-1 text-sm text-text outline-none placeholder:text-text-tertiary"
      />
      {open && matches.length > 0 && (
        <div
          data-cy="tag-suggestions"
          className="absolute left-0 top-full z-20 mt-1 w-48 overflow-hidden rounded-lg border border-border bg-surface shadow-pop"
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
              className="block w-full px-3 py-1.5 text-left text-sm text-text hover:bg-surface-hover"
            >
              {m}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
