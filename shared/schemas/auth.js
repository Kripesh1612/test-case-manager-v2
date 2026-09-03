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