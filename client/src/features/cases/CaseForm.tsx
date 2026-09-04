// Create / edit form for a single Test Case.
//
// React Hook Form + zodResolver for client-side validation. The same
// Zod schema (testCaseSchema) is used by the server's validate()
// middleware, so a valid form here is a valid request there.
//
// `initial` switches between create (omitted) and edit (full case).
// `knownTags` powers the autocomplete inside <TagInput>.

import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

import { testCaseSchema } from '@shared/schemas/testCase';

import { Button } from '@/components/Button';

import type { CaseData } from './api';
import { TagInput } from './TagInput';

type FormValues = z.infer<typeof testCaseSchema>;
type FormInput = z.input<typeof testCaseSchema>;

interface CaseFormProps {
  initial?: CaseData;
  knownTags: string[];
  submitting?: boolean;
  onSubmit: (values: FormValues) => void | Promise<void>;
  onCancel: () => void;
}

export function CaseForm({ initial, knownTags, submitting, onSubmit, onCancel }: CaseFormProps) {
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<FormInput, undefined, FormValues>({
    resolver: zodResolver(testCaseSchema),
    defaultValues: {
      title: initial?.title ?? '',
      description: initial?.description ?? '',
      steps: initial?.steps ?? [],
      expected_result: initial?.expected_result ?? '',
      status: initial?.status ?? 'draft',
      priority: initial?.priority ?? 'medium',
      tags: initial?.tags ?? [],
      executable_snippet: initial?.executable_snippet ?? '',
    },
  });

  const tags = watch('tags') ?? [];
  const stepsText = (watch('steps') ?? []).join('\n');

  return (
    <form
      data-cy="case-form"
      onSubmit={handleSubmit(onSubmit)}
      className="rg-card space-y-4 p-5"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-text">
          {initial ? 'Edit test case' : 'New test case'}
        </h3>
      </div>

      <Field label="Title" required error={errors.title?.message}>
        <input
          data-cy="case-title-input"
          autoComplete="off"
          placeholder="Short, descriptive"
          {...register('title')}
          className="rg-input"
        />
      </Field>

      <Field label="Description">
        <textarea
          data-cy="case-description-input"
          rows={2}
          placeholder="What is this case verifying?"
          {...register('description')}
          className="rg-input resize-y"
        />
      </Field>

      <Field label="Steps" hint="One per line — the order matters.">
        <textarea
          data-cy="case-steps-input"
          rows={4}
          value={stepsText}
          onChange={(e) =>
            setValue(
              'steps',
              e.target.value.split('\n').map((s) => s.trim()).filter(Boolean),
            )
          }
          className="rg-input resize-y font-mono text-xs"
        />
      </Field>

      <Field label="Expected result">
        <textarea
          data-cy="case-expected-input"
          rows={2}
          placeholder="What should happen when the steps pass?"
          {...register('expected_result')}
          className="rg-input resize-y"
        />
      </Field>

      <Field
        label="Cypress snippet (optional)"
        error={errors.executable_snippet?.message}
        hint="Optional Cypress test body. The server runs it via the “Run” button on the case detail page. Leave blank to make this a documentation-only case."
      >
        <textarea
          data-cy="case-snippet-input"
          rows={6}
          placeholder="it('logs in', () => { cy.visit('/login'); ... })"
          {...register('executable_snippet')}
          className="rg-input font-mono text-xs"
        />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Status">
          <select
            data-cy="case-status-input"
            {...register('status')}
            className="rg-input"
          >
            <option value="draft">Draft</option>
            <option value="active">Active</option>
            <option value="deprecated">Deprecated</option>
          </select>
        </Field>
        <Field label="Priority">
          <select
            data-cy="case-priority-input"
            {...register('priority')}
            className="rg-input"
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </Field>
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-medium text-text">Tags</label>
        <TagInput
          value={tags}
          onChange={(next) => setValue('tags', next, { shouldValidate: true })}
          suggestions={knownTags}
        />
      </div>

      <div className="flex items-center gap-2 pt-2 border-t border-border-soft">
        <Button
          type="submit"
          variant="primary"
          data-cy="case-submit-btn"
          loading={submitting}
        >
          {submitting ? 'Saving…' : initial ? 'Update test case' : 'Create test case'}
        </Button>
        <Button
          type="button"
          variant="secondary"
          data-cy="case-cancel-btn"
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

interface FieldProps {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}

function Field({ label, hint, error, required, className, children }: FieldProps) {
  return (
    <div className={className}>
      <label className="mb-1.5 block text-sm font-medium text-text">
        {label}
        {required && <span className="ml-1 text-danger">*</span>}
      </label>
      {children}
      {error ? (
        <p className="mt-1.5 text-xs text-danger-text">{error}</p>
      ) : hint ? (
        <p className="mt-1.5 text-xs text-text-tertiary">{hint}</p>
      ) : null}
    </div>
  );
}
