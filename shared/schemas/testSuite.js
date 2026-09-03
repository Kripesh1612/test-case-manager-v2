import { z } from 'zod';

// --- Test Suite ---

export const testSuiteSchema = z.object({
  name: z.string().min(1, 'name is required').max(200),
  description: z.string().max(2000).optional(),
  test_case_ids: z.array(z.number().int().positive()).optional(),
});

export const testSuiteUpdateSchema = testSuiteSchema.partial();