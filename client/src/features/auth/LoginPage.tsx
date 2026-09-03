// Login page — matches the data-cy contract the existing Cypress UI tests expect:
//   [data-cy="login-card"]
//     [data-cy="login-email"]
//     [data-cy="login-password"]
//     [data-cy="login-submit"]
//     [data-cy="register-link"]    (text "Register" link)
//   + toast on bad creds (handled by the shared ToastHost)
//
// On success, the user lands on `from` (the protected page that bounced
// them here) or `/cases` if they visited /login directly. The original
// vanilla login.js always navigated to /cases; we keep that as the
// fallback to preserve the existing UX.

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { z } from 'zod';

import { loginSchema } from '@shared/schemas/auth';
import { useAuth } from '@/hooks/useAuth';
import { showToast } from '@/lib/toast';

type LoginForm = z.infer<typeof loginSchema>;

interface LocationState {
  from?: { pathname?: string };
}

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const {
    register: registerField,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  });

  // We deliberately do NOT redirect an already-authenticated user away
  // from /login — the vanilla login.html didn't, and the existing
  // Cypress specs (e.g. "shows an error toast on bad credentials")
  // rely on being able to revisit it after a previous test left a
  // session behind. /login always shows the form; a successful
  // submit navigates to `from` or /cases.

  const onSubmit = handleSubmit(async (values) => {
    try {
      await login.mutateAsync(values);
      const from = (location.state as LocationState | null)?.from?.pathname ?? '/cases';
      navigate(from, { replace: true });
    } catch (e) {
      // Mirror the vanilla login.js behaviour: surface the failure as
      // a toast (so tests can `cy.get('[data-cy="toast"][data-cy-toast="error"]')`)
      // rather than an inline form error.
      showToast({ message: extractError(e, 'Login failed'), variant: 'error' });
    }
  });

  return (
    <div data-cy="login-card" className="mx-auto max-w-sm rounded border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="mb-6 text-2xl font-semibold">Log in</h2>

      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field
          label="Email"
          type="email"
          autoComplete="email"
          data-cy="login-email"
          error={errors.email?.message}
          {...registerField('email')}
        />
        <Field
          label="Password"
          type="password"
          autoComplete="current-password"
          data-cy="login-password"
          error={errors.password?.message}
          {...registerField('password')}
        />
        <button
          type="submit"
          disabled={isSubmitting || login.isPending}
          data-cy="login-submit"
          className="w-full rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {login.isPending ? 'Logging in…' : 'Log in'}
        </button>
      </form>

      <p className="mt-4 text-sm text-gray-600">
        No account?{' '}
        <Link
          to="/register"
          data-cy="register-link"
          className="text-blue-600 hover:underline"
        >
          Register
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