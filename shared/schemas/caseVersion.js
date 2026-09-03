// Zod schemas for the case-versioning subsystem.
//
// Authored as ESM so the React client (Vite) imports them as native ES
// modules and the Express server (Node 22+, via require(esm)) consumes
// them synchronously without a build step — same convention as the
// other schemas in shared/schemas/.
//
// A TestCaseVersion's `snapshot` field is a structured copy of the
// case's user-editable fields. We validate it on read to catch drift
// if someone manually edits a row, and we use it as the contract for
// the diff endpoint's inputs.

import { z } from 'zod';

import {
  STATUS_VALUES,
  PRIORITY_VALUES,
} from './testCase.js';

// The shape of the snapshot blob — mirrors the versioned fields on
// TestCase exactly. Required (no .optional()) because every snapshot
// captures the full state at the time of writing; defaults applied by
// the testCase write path are reflected here too.
export const caseSnapshotSchema = z.object({
  title: z.string(),
  description: z.string(),
  steps: z.array(z.string()),
  expected_result: z.string(),
  status: z.enum(STATUS_VALUES),
  priority: z.enum(PRIORITY_VALUES),
  tags: z.array(z.string()),
});

// The list endpoint returns this shape. We don't surface `snapshot` to
// the UI (it's potentially redundant with the live row) — just metadata
// about each version. The detail endpoint returns the full snapshot.
export const caseVersionSummarySchema = z.object({
  id: z.number().int(),
  case_id: z.number().int(),
  version: z.number().int(),
  created_at: z.string(),   // ISO date string
  created_by_id: z.number().int().nullable(),
});

export const caseVersionDetailSchema = caseVersionSummarySchema.extend({
  snapshot: caseSnapshotSchema,
});

// One field's worth of diff. `kind` tells the UI how to render it:
//   - 'changed'  → both before + after present, highlight inline
//   - 'added'    → only after present, render the whole line green
//   - 'removed'  → only before present, render the whole line red
//
// `before` / `after` are arrays (instead of strings) so the UI can do
// word-level / character-level Myers diff on text fields, and line-level
// diff on steps / tags. The server normalises once; the UI reuses a
// single diff component regardless of field type.
export const diffFieldSchema = z.object({
  field: z.enum([
    'title',
    'description',
    'steps',
    'expected_result',
    'priority',
    'status',
    'tags',
  ]),
  kind: z.enum(['changed', 'added', 'removed']),
  before: z.array(z.string()),
  after: z.array(z.string()),
});

export const diffResponseSchema = z.object({
  from_version: z.number().int(),
  to_version: z.number().int(),
  fields: z.array(diffFieldSchema),
});