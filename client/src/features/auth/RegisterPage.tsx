// =============================================================================
// RegisterPage — data-cy contract:
//   [data-cy="register-card"]
//     [data-cy="register-name"]
//     [data-cy="register-email"]
//     [data-cy="register-password"]
//     [data-cy="register-submit"]
//
// After successful registration we deliberately log the user out and
// send them to /login — matches the existing spec ("registering
// redirects to /login, no auto-login").
// =============================================================================

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { z } from 'zod';

import { registerSchema } from '@shared/schemas/auth';

import { Button } from '@/components/Button';
import { Icon } from '@/components/Icons';
import { useAuth } from '@/hooks/useAuth';
import { showToast } from '@/lib/toast';
import { AuthLayout, Field, extractError } from './AuthLayout';

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

  const onSubmit = handleSubmit(async (values) => {
    try {
      await registerUser.mutateAsync(values);
      showToast({ message: 'Account created — please sign in', variant: 'success' });
      logout();
    } catch (e) {
      showToast({ message: extractError(e, 'Registration failed'), variant: 'error' });
    }
  });

  return (
    <AuthLayout
      eyebrow="Get started"
      title="Create your Regress account"
      description="One workspace for all your test cases, versions and runs."
    >
      <div data-cy="register-card" className="rg-card p-6 sm:p-7">
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <Field
            label="Name (optional)"
            autoComplete="name"
            data-cy="register-name"
            placeholder="Jane Doe"
            error={errors.name?.message}
            {...registerField('name')}
          />
          <Field
            label="Email"
            type="email"
            autoComplete="email"
            data-cy="register-email"
            placeholder="you@example.com"
            leadingIcon={<Icon.Mail size={16} />}
            error={errors.email?.message}
            {...registerField('email')}
          />
          <Field
            label="Password"
            type="password"
            autoComplete="new-password"
            data-cy="register-password"
            placeholder="At least 8 characters"
            hint="At least 8 characters."
            leadingIcon={<Icon.Lock size={16} />}
            error={errors.password?.message}
            {...registerField('password')}
          />
          <Button
            type="submit"
            variant="primary"
            size="lg"
            data-cy="register-submit"
            loading={isSubmitting || registerUser.isPending}
            className="w-full"
          >
            {registerUser.isPending ? 'Creating account…' : 'Create account'}
          </Button>
        </form>

        <p className="mt-5 text-center text-sm text-text-secondary">
          Already have an account?{' '}
          <Link
            to="/login"
            data-cy="register-link"
            className="font-medium text-brand hover:text-brand-hover hover:underline"
          >
            Log in
          </Link>
        </p>
      </div>
    </AuthLayout>
  );
}
