import { z } from 'zod';

// --- Test Case ---
//
// Authored as ESM so the React client (Vite) imports them as native ES
// modules and the Express server (Node 22+, via require(esm)) consumes
// them synchronously without a build step. One source of truth for
// server-side API validation and client-side form validation.

export const STATUS_VALUES = ['draft', 'active', 'deprecated'];
export const PRIORITY_VALUES = ['low', 'medium', 'high'];
export const RESULT_VALUES = ['not_run', 'passed', 'failed'];

export const testCaseSchema = z.object({
  title: z.string().min(1, 'title is required').max(200),
  description: z.string().max(2000).optional(),
  steps: z.array(z.string().min(1)).max(100).optional(),
  expected_result: z.string().max(2000).optional(),
  status: z.enum(STATUS_VALUES).optional(),
  priority: z.enum(PRIORITY_VALUES).optional(),
  result: z.enum(RESULT_VALUES).optional(),
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
  // Phase 8 — optional Cypress test body executed by /test-cases/:id/execute.
  // Capped at 10 KB so a runaway paste can't blow up the DB. Empty strings
  // normalize to null so a cleared editor doesn't leave a useless empty row.
  executable_snippet: z
    .union([z.string().max(10000), z.null()])
    .optional()
    .transform((v) => (v == null || v === '' ? null : v)),
});

// For PUT — every field optional, but if present still validated.
export const testCaseUpdateSchema = testCaseSchema.partial();