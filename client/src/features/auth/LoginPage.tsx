// =============================================================================
// LoginPage — data-cy contract:
//   [data-cy="login-card"]
//     [data-cy="login-email"]
//     [data-cy="login-password"]
//     [data-cy="login-submit"]
//     [data-cy="register-link"]    (text "Register" link)
//
// On success → /cases (or `from`).
// =============================================================================

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { z } from 'zod';

import { loginSchema } from '@shared/schemas/auth';

import { Button } from '@/components/Button';
import { Icon } from '@/components/Icons';
import { useAuth } from '@/hooks/useAuth';
import { showToast } from '@/lib/toast';
import { AuthLayout, Field, extractError } from './AuthLayout';

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

  const onSubmit = handleSubmit(async (values) => {
    try {
      await login.mutateAsync(values);
      const from = (location.state as LocationState | null)?.from?.pathname ?? '/cases';
      navigate(from, { replace: true });
    } catch (e) {
      showToast({ message: extractError(e, 'Login failed'), variant: 'error' });
    }
  });

  return (
    <AuthLayout
      eyebrow="Welcome back"
      title="Log in to Regress"
      description="Pick up where you left off — your cases, runs and schedules are waiting."
    >
      <div data-cy="login-card" className="rg-card p-6 sm:p-7">
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Field
            label="Email"
            type="email"
            autoComplete="email"
            data-cy="login-email"
            placeholder="you@example.com"
            leadingIcon={<Icon.Mail size={16} />}
            error={errors.email?.message}
            {...registerField('email')}
          />
          <Field
            label="Password"
            type="password"
            autoComplete="current-password"
            data-cy="login-password"
            placeholder="••••••••"
            leadingIcon={<Icon.Lock size={16} />}
            error={errors.password?.message}
            {...registerField('password')}
          />
          <Button
            type="submit"
            variant="primary"
            size="lg"
            data-cy="login-submit"
            loading={isSubmitting || login.isPending}
            className="w-full"
          >
            {login.isPending ? 'Logging in…' : 'Log in'}
          </Button>
        </form>

        <p className="mt-5 text-center text-sm text-text-secondary">
          No account?{' '}
          <Link
            to="/register"
            data-cy="register-link"
            className="font-medium text-brand hover:text-brand-hover hover:underline"
          >
            Register
          </Link>
        </p>
      </div>
    </AuthLayout>
  );
}
