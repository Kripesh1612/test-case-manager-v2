import { z } from 'zod';

// utils/cron.js is CJS (`module.exports = {...}`), so its named exports
// aren't statically analyzable from ESM. Default-import + destructure
// is the supported pattern.
import cronUtils from '../../utils/cron.js';
const { isValid: isValidCron } = cronUtils;

// --- Scheduled jobs ---

// Custom cron validator: uses utils/cron.isValid so the same parser that
// computes next-fire-time is the source of truth for validity.
export const cronField = z.string().refine(isValidCron, {
  message: 'must be a valid 5-field cron expression (minute hour dom month dow)',
});

export const scheduledJobSchema = z.object({
  name: z.string().min(1).max(120),
  cron: cronField,
  timezone: z.string().min(1).max(60).optional(),
  suite_id: z.number().int().positive(),
  enabled: z.boolean().optional(),
  max_retries: z.number().int().min(0).max(10).optional(),
});

export const scheduledJobUpdateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  cron: cronField.optional(),
  timezone: z.string().min(1).max(60).optional(),
  suite_id: z.number().int().positive().optional(),
  enabled: z.boolean().optional(),
  max_retries: z.number().int().min(0).max(10).optional(),
});