import { z } from 'zod';

// --- Auth ---

export const ROLE_VALUES = ['admin', 'editor', 'viewer'];

export const registerSchema = z.object({
  email: z.string().email('Must be a valid email'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(100),
  name: z.string().max(100).optional(),
});

export const loginSchema = z.object({
  email: z.string().email('Must be a valid email'),
  password: z.string().min(1, 'Password is required'),
});

export const updateUserRoleSchema = z.object({
  role: z.enum(ROLE_VALUES),
});

// Audit C (validation): Zod schema for the admin POST /invites. The
// old hand-written check only validated presence of `email` and the
// role enum; it accepted any email length, any role string in quotes,
// and let `project_id` fall through `parseInt` as `NaN`. Tightening
// here keeps the contract explicit and surfaces a 400 with a useful
// message instead of a downstream Prisma error.
export const inviteCreateSchema = z.object({
  email: z.string().email('Must be a valid email').max(254),
  role: z.enum(ROLE_VALUES).optional(),
  project_id: z.number().int().positive().optional(),
});