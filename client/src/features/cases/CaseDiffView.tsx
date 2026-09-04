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
//   case-diff-context        — a "context" (unchanged) line
//   case-diff-empty-cell     — blank gutter cell

import { useMemo, type ReactNode } from 'react';
import * as Diff from 'diff';

import { Card } from '@/components/Card';
import { Icon } from '@/components/Icons';

import type { CaseDiff, DiffField } from './api';

interface Props {
  diff: CaseDiff;
  fromVersion: number;
  toVersion: number;
}

const FIELD_META: Record<DiffField['field'], { label: string; icon: ReactNode }> = {
  title: { label: 'Title', icon: <Icon.Cases size={14} /> },
  description: { label: 'Description', icon: <Icon.Cases size={14} /> },
  steps: { label: 'Steps', icon: <Icon.Run size={14} /> },
  expected_result: { label: 'Expected result', icon: <Icon.Check size={14} /> },
  priority: { label: 'Priority', icon: <Icon.Flaky size={14} /> },
  status: { label: 'Status', icon: <Icon.Schedule size={14} /> },
  tags: { label: 'Tags', icon: <Icon.Spark size={14} /> },
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
      <div data-cy="case-diff-empty" className="rg-card p-10 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-surface-sunken text-text-tertiary">
          <Icon.Check size={22} />
        </div>
        <div className="text-sm font-medium text-text">No differences</div>
        <div className="mt-1 text-xs text-text-secondary">
          v{fromVersion} and v{toVersion} are identical.
        </div>
      </div>
    );
  }

  return (
    <div data-cy="case-diff" className="space-y-4">
      <div
        data-cy="case-diff-summary"
        className="flex items-center gap-3 rounded-xl border border-info-border bg-info-soft px-4 py-3 text-sm"
      >
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-info text-text-inverse">
          <Icon.Diff size={16} />
        </div>
        <div className="flex-1">
          <div className="font-medium text-info-text">
            {diff.fields.length} field{diff.fields.length === 1 ? '' : 's'} changed
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-info-text">
            Comparing
            <span className="rounded bg-surface px-1.5 py-0.5 font-mono font-semibold text-info-text">v{fromVersion}</span>
            <Icon.ArrowRight size={12} />
            <span className="rounded bg-surface px-1.5 py-0.5 font-mono font-semibold text-info-text">v{toVersion}</span>
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
    <Card
      data-cy="case-diff-field"
      data-field={field.field}
      data-kind={field.kind}
      className="overflow-hidden"
    >
      <div
        data-cy="case-diff-field-name"
        className="flex items-center justify-between border-b border-border-soft bg-bg px-4 py-2.5"
      >
        <div className="flex items-center gap-2 text-sm font-semibold text-text">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-soft text-brand">
            {meta.icon}
          </span>
          {meta.label}
        </div>
        <KindBadge kind={field.kind} />
      </div>

      {/* Column headers */}
      <div className="grid grid-cols-2 border-b border-border-soft bg-surface-sunken text-[10px] font-semibold uppercase tracking-wider text-text-tertiary">
        <div className="flex items-center gap-1.5 border-r border-border px-3 py-1.5">
          <span className="flex h-4 w-4 items-center justify-center rounded bg-danger-soft text-danger">−</span>
          Before
        </div>
        <div className="flex items-center gap-1.5 px-3 py-1.5">
          <span className="flex h-4 w-4 items-center justify-center rounded bg-success-soft text-success">+</span>
          After
        </div>
      </div>

      {/* Side-by-side rows */}
      <div className="grid grid-cols-2 font-mono text-xs">
        {rows.map((row, i) => (
          <SideRow key={i} row={row} index={i} />
        ))}
        {rows.length === 0 && (
          <div className="col-span-2 px-3 py-3 text-center text-text-tertiary italic">
            (empty)
          </div>
        )}
      </div>
    </Card>
  );
}

function KindBadge({ kind }: { kind: DiffField['kind'] }) {
  const map = {
    added: 'bg-success-soft text-success-text',
    removed: 'bg-danger-soft text-danger-text',
    changed: 'bg-warning-soft text-warning-text',
  };
  const label = {
    added: '+ added',
    removed: '− removed',
    changed: '~ changed',
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${map[kind]}`}>
      {label[kind]}
    </span>
  );
}

function SideRow({ row, index }: { row: AlignedRow; index: number }) {
  return (
    <>
      <DiffSide kind={row.left.kind} text={row.left.text} side="left" lineNum={index + 1} />
      <DiffSide kind={row.right.kind} text={row.right.text} side="right" lineNum={index + 1} />
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
      ? 'bg-success-soft/40 text-text'
      : kind === 'removed'
        ? 'bg-danger-soft/40 text-text'
        : kind === null
          ? 'bg-surface-sunken/40'
          : 'text-text-secondary';

  const gutterChar = kind === 'added' ? '+' : kind === 'removed' ? '−' : ' ';

  return (
    <div
      data-cy={dataCy}
      className={`flex items-start gap-2 border-r border-border-soft px-3 py-1 last:border-r-0 ${bgClass}`}
    >
      <span className="select-none text-right text-[10px] text-text-tertiary" style={{ minWidth: '1.5rem' }}>
        {lineNum}
      </span>
      <span
        className={`select-none font-bold ${
          kind === 'added' ? 'text-success' : kind === 'removed' ? 'text-danger' : 'text-transparent'
        }`}
        style={{ minWidth: '0.75rem' }}
      >
        {gutterChar}
      </span>
      <span className={`whitespace-pre-wrap break-words ${kind === 'removed' ? 'line-through decoration-danger/40' : ''}`}>
        {text || <span className="italic text-text-tertiary">(empty)</span>}
      </span>
    </div>
  );
}
