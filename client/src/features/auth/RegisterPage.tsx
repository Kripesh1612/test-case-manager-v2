// Register page — matches the data-cy contract the existing Cypress UI tests expect:
//   [data-cy="register-card"]
//     [data-cy="register-name"]
//     [data-cy="register-email"]
//     [data-cy="register-password"]
//     [data-cy="register-submit"]
//
// Important behaviour difference vs vanilla register.js: we do NOT
// auto-login on register. The /auth/register endpoint does return a
// token in the response, but per the spec ("registering redirects to
// /login (no auto-login)") we deliberately ignore it and bounce the
// user to /login so they can sign in with their new credentials.
// This also keeps the existing server endpoint unchanged — it's just
// a client-side choice.

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { z } from 'zod';

import { registerSchema } from '@shared/schemas/auth';
import { useAuth } from '@/hooks/useAuth';
import { showToast } from '@/lib/toast';

type RegisterForm = z.infer<typeof registerSchema>;

export function RegisterPage() {
  const { register: registerUser, logout } = useAuth();

  const {
    register: registerField,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterForm>({
    resolver: zodResolver(registerSchema),
    defaultValues: { email: '', password: '', name: '' },
  });

  // Same logic as LoginPage: we never bounce an authed user away from
  // /register — the vanilla page didn't, and the Cypress specs expect
  // to be able to load it directly. If you ARE authed and submit,
  // the auto-login side-effect is undone via `logout()` below.

  const onSubmit = handleSubmit(async (values) => {
    try {
      await registerUser.mutateAsync(values);
      // useAuth.register's onSuccess persists the token + user, but
      // the spec is "registering redirects to /login (no auto-login)".
      // `logout` does the inverse of `login`: clearToken + drop the
      // /me cache + go to /login. We reuse it here so the side-effects
      // stay in one place.
      showToast({ message: 'Account created — please sign in', variant: 'success' });
      logout();
    } catch (e) {
      showToast({ message: extractError(e, 'Registration failed'), variant: 'error' });
    }
  });

  return (
    <div data-cy="register-card" className="mx-auto max-w-sm rounded border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="mb-6 text-2xl font-semibold">Create account</h2>

      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field
          label="Name (optional)"
          autoComplete="name"
          data-cy="register-name"
          error={errors.name?.message}
          {...registerField('name')}
        />
        <Field
          label="Email"
          type="email"
          autoComplete="email"
          data-cy="register-email"
          error={errors.email?.message}
          {...registerField('email')}
        />
        <Field
          label="Password"
          type="password"
          autoComplete="new-password"
          data-cy="register-password"
          error={errors.password?.message}
          {...registerField('password')}
        />
        <p className="text-xs text-gray-500">At least 8 characters.</p>
        <button
          type="submit"
          disabled={isSubmitting || registerUser.isPending}
          data-cy="register-submit"
          className="w-full rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {registerUser.isPending ? 'Creating account…' : 'Register'}
        </button>
      </form>

      <p className="mt-4 text-sm text-gray-600">
        Already have an account?{' '}
        <Link to="/login" className="text-blue-600 hover:underline">
          Log in
        </Link>
      </p>
    </div>
  );
}

// ---- helpers ----

interface FieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
}

const Field = ({ label, error, ...inputProps }: FieldProps) => (
  <div>
    <label className="mb-1 block text-sm font-medium text-gray-700">{label}</label>
    <input
      {...inputProps}
      className={`w-full rounded border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
        error ? 'border-red-400' : 'border-gray-300'
      }`}
    />
    {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
  </div>
);

function extractError(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const r = (err as { response?: { data?: { error?: string } } }).response;
    if (r?.data?.error) return r.data.error;
  }
  return fallback;
}