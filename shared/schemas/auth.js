import { z } from 'zod';

// --- Auth ---

export const ROLE_VALUES = ['admin', 'editor', 'viewer'];

// Audit C (validation): trim+lowercase the email at the boundary so
// " Alice@X.com " and "alice@x.com" map to the same account. The DB
// itself stores the lowercased form (see routes/auth.js). Without
// this trim, two registrations of the same address with stray
// whitespace both pass the unique-email check on the second insert
// (one would be P2002, the other would silently fail later) and
// users get confusing "email already exists" errors.
//
// We trim BEFORE the .email() check so a leading/trailing space
// doesn't make the format-check reject an otherwise valid address.
// Length is re-checked post-trim to keep the RFC 5321 cap honest
// (trimming can only shorten, never lengthen, so the .max() placement
// here is the binding constraint).
const normalizedEmail = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(
    z
      .string()
      .email('Must be a valid email')
      .max(254)
  );

// Password complexity floor. The old schema only enforced length
// (8..100), which lets "12345678" through — and that's the single most
// leaked password on every breach corpus. We require at least one
// letter and one digit/number; this matches NIST SP 800-63B's
// "composition" guidance for memorized secrets while staying out of
// the user's way for everything else. Max is still 100 so the bcrypt
// hash payload stays bounded.
const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(100)
  .refine((p) => /[A-Za-z]/.test(p) && /[0-9]/.test(p), {
    message: 'Password must contain at least one letter and one number',
  });

export const registerSchema = z.object({
  email: normalizedEmail,
  password,
  name: z.string().min(1).max(100).optional(),
});

export const loginSchema = z.object({
  // Login does NOT trim the password (we don't want to silently
  // mangle user input on a 401 path), but the email gets the same
  // canonicalization so "Alice@x.com" finds the row stored as
  // "alice@x.com".
  email: normalizedEmail,
  password: z.string().min(1, 'Password is required').max(100),
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