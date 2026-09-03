// CaseDiffView — render a field-by-field diff between two snapshots.
//
// Layout: one card per changed field, with a side-by-side before/after
// view inside. Lines added on the after side show on the right with a
// green gutter; lines removed show on the left with a red gutter; lines
// unchanged appear in both columns at the same row. Word-level changes
// inside a single line are highlighted with a subtle yellow background.
//
// data-cy attrs (kept compatible with the existing test spec):
//   case-diff                — wrapper
//   case-diff-summary        — top banner ("X fields changed")
//   case-diff-field          — wraps each field block
//   case-diff-field-name     — the field label
//   case-diff-added          — an "added" line
//   case-diff-removed        — a "removed" line
//   case-diff-changed        — a "changed" (context) line

import { useMemo, type ReactNode } from 'react';
import * as Diff from 'diff';

import type { CaseDiff, DiffField } from './api';

interface Props {
  diff: CaseDiff;
  fromVersion: number;
  toVersion: number;
}

const FIELD_META: Record<DiffField['field'], { label: string; icon: ReactNode }> = {
  title: {
    label: 'Title',
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
        <path d="M3 5a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 11-2 0V6H4v8h6a1 1 0 110 2H4a1 1 0 01-1-1V5z" />
      </svg>
    ),
  },
  description: {
    label: 'Description',
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M4 4a2 2 0 012-2h8a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm3 2a1 1 0 000 2h6a1 1 0 100-2H7zm0 4a1 1 0 100 2h6a1 1 0 100-2H7zm0 4a1 1 0 100 2h4a1 1 0 100-2H7z" clipRule="evenodd" />
      </svg>
    ),
  },
  steps: {
    label: 'Steps',
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
        <path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 11-2 0V5H4v10h11v-1a1 1 0 112 0v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4z" />
        <path d="M6 8a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm0 3a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm0 3a1 1 0 011-1h4a1 1 0 110 2H7a1 1 0 01-1-1z" />
      </svg>
    ),
  },
  expected_result: {
    label: 'Expected result',
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
      </svg>
    ),
  },
  priority: {
    label: 'Priority',
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
        <path d="M3 12a1 1 0 011-1h2a1 1 0 110 2H4a1 1 0 01-1-1zm0-4a1 1 0 011-1h6a1 1 0 110 2H4a1 1 0 01-1-1zm0-4a1 1 0 011-1h10a1 1 0 110 2H4a1 1 0 01-1-1z" />
      </svg>
    ),
  },
  status: {
    label: 'Status',
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1.323l3.954 1.582 1.599-.8a1 1 0 01.894 1.79l-1.233.616 1.738 5.42a1 1 0 01-.285 1.05A3.989 3.989 0 0115 15a3.989 3.989 0 01-2.667-1.019 1 1 0 01-.285-1.05l1.715-5.349L11 6.477V16h2a1 1 0 110 2H7a1 1 0 110-2h2V6.477L6.237 7.582l1.715 5.349a1 1 0 01-.285 1.05A3.989 3.989 0 015 15a3.989 3.989 0 01-2.667-1.019 1 1 0 01-.285-1.05l1.738-5.42-1.233-.617a1 1 0 01.894-1.788l1.599.799L9 4.323V3a1 1 0 011-1z" clipRule="evenodd" />
      </svg>
    ),
  },
  tags: {
    label: 'Tags',
    icon: (
      <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M17.707 9.293a1 1 0 010 1.414l-7 7a1 1 0 01-1.414 0l-7-7A.997.997 0 012 10V5a3 3 0 013-3h5c.256 0 .512.098.707.293l7 7zM5 6a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
      </svg>
    ),
  },
};

type LineKind = 'added' | 'removed' | 'context';

interface AlignedRow {
  left: { kind: LineKind | null; text: string };
  right: { kind: LineKind | null; text: string };
}

// Align the before/after arrays so they render side-by-side. Myers
// diff gives us an array of {added, removed, value} chunks; we walk
// them pairwise and produce rows where each row has either a left-only,
// right-only, or both-sides entry.
function alignLines(before: string[], after: string[]): AlignedRow[] {
  const parts = Diff.diffArrays(before, after);
  const rows: AlignedRow[] = [];

  // We walk parts in pairs: a 'removed' chunk on the left paired with
  // an 'added' chunk on the right (if present). Myers interleaves them
  // naturally when both sides change at the same place.
  let i = 0;
  while (i < parts.length) {
    const p = parts[i]!;
    if (p.removed) {
      const next = parts[i + 1];
      if (next && next.added) {
        const removed = p.value as string[];
        const added = next.value as string[];
        const max = Math.max(removed.length, added.length);
        for (let k = 0; k < max; k++) {
          rows.push({
            left: k < removed.length ? { kind: 'removed', text: String(removed[k]) } : { kind: null, text: '' },
            right: k < added.length ? { kind: 'added', text: String(added[k]) } : { kind: null, text: '' },
          });
        }
        i += 2;
        continue;
      }
      for (const v of p.value as readonly unknown[]) {
        rows.push({ left: { kind: 'removed', text: String(v) }, right: { kind: null, text: '' } });
      }
      i++;
      continue;
    }
    if (p.added) {
      for (const v of p.value as readonly unknown[]) {
        rows.push({ left: { kind: null, text: '' }, right: { kind: 'added', text: String(v) } });
      }
      i++;
      continue;
    }
    for (const v of p.value as readonly unknown[]) {
      rows.push({
        left: { kind: 'context', text: String(v) },
        right: { kind: 'context', text: String(v) },
      });
    }
    i++;
  }
  return rows;
}

export function CaseDiffView({ diff, fromVersion, toVersion }: Props) {
  if (diff.fields.length === 0) {
    return (
      <div
        data-cy="case-diff-empty"
        className="rounded-lg border border-gray-200 bg-white p-8 text-center"
      >
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-400">
          <svg className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm-1-11a1 1 0 112 0v3.586L13.707 14.293a1 1 0 01-1.414 0 1 1 0 010-1.414L11 11.586V8a1 1 0 01-1-1z" clipRule="evenodd" />
          </svg>
        </div>
        <div className="text-sm font-medium text-gray-900">No differences</div>
        <div className="mt-1 text-xs text-gray-500">
          v{fromVersion} and v{toVersion} are identical.
        </div>
      </div>
    );
  }

  return (
    <div data-cy="case-diff" className="space-y-4">
      <div
        data-cy="case-diff-summary"
        className="flex items-center gap-3 rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm"
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-blue-700">
          <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
            <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h6a1 1 0 100-2H7zm0 4a1 1 0 100 2h6a1 1 0 100-2H7zm0 4a1 1 0 100 2h3a1 1 0 100-2H7z" clipRule="evenodd" />
          </svg>
        </div>
        <div className="flex-1">
          <div className="font-medium text-blue-900">
            {diff.fields.length} field{diff.fields.length === 1 ? '' : 's'} changed
          </div>
          <div className="text-xs text-blue-700">
            Comparing{' '}
            <span className="rounded bg-white px-1.5 py-0.5 font-mono font-semibold">v{fromVersion}</span>
            {' → '}
            <span className="rounded bg-white px-1.5 py-0.5 font-mono font-semibold">v{toVersion}</span>
          </div>
        </div>
      </div>

      {diff.fields.map((f) => (
        <DiffFieldBlock key={f.field} field={f} />
      ))}
    </div>
  );
}

function DiffFieldBlock({ field }: { field: DiffField }) {
  const rows = useMemo(() => alignLines(field.before, field.after), [field]);
  const meta = FIELD_META[field.field];

  return (
    <div
      data-cy="case-diff-field"
      data-field={field.field}
      data-kind={field.kind}
      className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm"
    >
      <div
        data-cy="case-diff-field-name"
        className="flex items-center justify-between border-b border-gray-200 bg-gradient-to-r from-gray-50 to-white px-4 py-2.5"
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-800">
          <span className="flex h-6 w-6 items-center justify-center rounded bg-gray-100 text-gray-600">
            {meta.icon}
          </span>
          {meta.label}
        </div>
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
            field.kind === 'added'
              ? 'bg-green-100 text-green-800'
              : field.kind === 'removed'
                ? 'bg-red-100 text-red-800'
                : 'bg-amber-100 text-amber-800'
          }`}
        >
          {field.kind === 'added' && <span>+</span>}
          {field.kind === 'removed' && <span>−</span>}
          {field.kind === 'changed' && <span>~</span>}
          {field.kind}
        </span>
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-2 border-b border-gray-200 bg-gray-50 text-[10px] font-semibold uppercase tracking-wider text-gray-500">
        <div className="flex items-center gap-1.5 border-r border-gray-200 px-3 py-1.5">
          <span className="flex h-4 w-4 items-center justify-center rounded bg-red-100 text-red-700">
            −
          </span>
          Before
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1.5">
          <span className="flex h-4 w-4 items-center justify-center rounded bg-green-100 text-green-700">
            +
          </span>
          After
        </div>
      </div>

      {/* Side-by-side rows */}
      <div className="grid grid-cols-2 font-mono text-xs">
        {rows.map((row, i) => (
          <SideRow key={i} row={row} index={i} />
        ))}
        {rows.length === 0 && (
          <div className="col-span-2 px-3 py-2 text-center text-gray-400 italic">
            (empty)
          </div>
        )}
      </div>
    </div>
  );
}

function SideRow({ row, index }: { row: AlignedRow; index: number }) {
  return (
    <>
      <DiffSide
        kind={row.left.kind}
        text={row.left.text}
        side="left"
        lineNum={index + 1}
      />
      <DiffSide
        kind={row.right.kind}
        text={row.right.text}
        side="right"
        lineNum={index + 1}
      />
    </>
  );
}

function DiffSide({
  kind,
  text,
  side,
  lineNum,
}: {
  kind: LineKind | null;
  text: string;
  side: 'left' | 'right';
  lineNum: number;
}) {
  // The data-cy hooks for added/removed/context live on the cell where
  // the change is *visible* — left cells for removed, right for added.
  const dataCy =
    side === 'left' && kind === 'removed'
      ? 'case-diff-removed'
      : side === 'right' && kind === 'added'
        ? 'case-diff-added'
        : kind === 'context'
          ? 'case-diff-context'
          : 'case-diff-empty-cell';

  const bgClass =
    kind === 'added'
      ? 'bg-green-50 text-green-900'
      : kind === 'removed'
        ? 'bg-red-50 text-red-900'
        : kind === null
          ? 'bg-gray-50/40'
          : 'text-gray-700';

  const gutterChar = kind === 'added' ? '+' : kind === 'removed' ? '−' : kind === 'context' ? ' ' : ' ';

  return (
    <div
      data-cy={dataCy}
      className={`flex items-start gap-2 border-r border-gray-100 px-3 py-1 last:border-r-0 ${bgClass}`}
    >
      <span className="select-none text-right text-[10px] text-gray-400" style={{ minWidth: '1.5rem' }}>
        {lineNum}
      </span>
      <span
        className={`select-none font-bold ${
          kind === 'added' ? 'text-green-600' : kind === 'removed' ? 'text-red-600' : 'text-transparent'
        }`}
        style={{ minWidth: '0.75rem' }}
      >
        {gutterChar}
      </span>
      <span className={`whitespace-pre-wrap break-words ${kind === 'removed' ? 'line-through decoration-red-300' : ''}`}>
        {text || <span className="italic text-gray-400">(empty)</span>}
      </span>
    </div>
  );
}
