// Zod schemas for the flakiness subsystem.
//
// `flakinessReport` is the per-case analysis payload returned by
// GET /test-cases/:id/flakiness. `flakinessSummary` is the slim
// version embedded in case-list responses and used by the
// GET /test-cases/flaky dashboard endpoint.
//
// ESM-shaped so it matches the convention in shared/schemas/* (vite
// imports them natively; Node 22's CJS named-exports auto-detection
// makes require('./flakiness').flakinessReportSchema work for the
// server without a build step).

import { z } from 'zod';

export const FLAKINESS_VERDICTS = [
  'stable',
  'possibly_flaky',
  'flaky',
  'very_flaky',
  'broken',
  'insufficient_data',
];

const verdictSchema = z.enum(FLAKINESS_VERDICTS);

const windowSchema = z.object({
  window_size: z.number().int().min(0),
  passed: z.number().int().min(0),
  failed: z.number().int().min(0),
  pass_rate: z.number().min(0).max(1),
});

const signalsSchema = z.object({
  disagreement: z.number().min(0).max(1),
  switch_rate: z.number().min(0).max(1),
  late_failure: z.number().min(0).max(1),
});

export const flakinessReportSchema = z.object({
  case_id: z.number().int(),
  score: z.number().min(0).max(100).nullable(),
  verdict: verdictSchema,
  sample_size: z.number().int().min(0),
  recent: windowSchema,
  baseline: windowSchema,
  signals: signalsSchema,
  last_run_at: z.string().nullable(),
  last_run_status: z.enum(['passed', 'failed']).nullable(),
});

export const flakinessSummarySchema = z.object({
  case_id: z.number().int(),
  score: z.number().min(0).max(100).nullable(),
  verdict: verdictSchema,
  sample_size: z.number().int().min(0),
  last_run_status: z.enum(['passed', 'failed']).nullable(),
});

export const flakyListSchema = z.object({
  threshold: z.number().min(0).max(100),
  count: z.number().int().min(0),
  cases: z.array(
    flakinessSummarySchema.extend({
      title: z.string(),
    }),
  ),
});
