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

import type { CaseData } from './api';
import { TagInput } from './TagInput';

type FormValues = z.infer<typeof testCaseSchema>;

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
  } = useForm<FormValues>({
    resolver: zodResolver(testCaseSchema),
    defaultValues: {
      title: initial?.title ?? '',
      description: initial?.description ?? '',
      steps: initial?.steps ?? [],
      expected_result: initial?.expected_result ?? '',
      status: initial?.status ?? 'draft',
      priority: initial?.priority ?? 'medium',
      tags: initial?.tags ?? [],
      // Phase 8 — bound to the new optional snippet field. Defaulting to
      // '' (not null) matches the schema's transform that collapses '' to
      // null on submit, so the form behaves identically regardless of
      // which slot the user opens.
      executable_snippet: initial?.executable_snippet ?? '',
    },
  });

  const tags = watch('tags') ?? [];
  const stepsText = (watch('steps') ?? []).join('\n');

  return (
    <form
      data-cy="case-form"
      onSubmit={handleSubmit(onSubmit)}
      className="mb-4 space-y-3 rounded border border-gray-200 bg-white p-4"
    >
      <h3 className="text-base font-semibold">{initial ? 'Edit Test Case' : 'New Test Case'}</h3>

      <Field label="Title" error={errors.title?.message}>
        <input
          data-cy="case-title-input"
          autoComplete="off"
          {...register('title')}
          className="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
        />
      </Field>

      <Field label="Description">
        <textarea
          data-cy="case-description-input"
          rows={2}
          {...register('description')}
          className="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
        />
      </Field>

      <Field label="Steps (one per line)">
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
          className="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
        />
      </Field>

      <Field label="Expected result">
        <textarea
          data-cy="case-expected-input"
          rows={2}
          {...register('expected_result')}
          className="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
        />
      </Field>

      <Field label="Cypress snippet (optional)" error={errors.executable_snippet?.message}>
        <textarea
          data-cy="case-snippet-input"
          rows={6}
          placeholder="it('logs in', () => { cy.visit('/login'); ... })"
          {...register('executable_snippet')}
          className="w-full rounded border border-gray-300 px-2 py-1 font-mono text-xs focus:border-blue-500 focus:outline-none"
        />
        <p className="mt-1 text-[11px] text-gray-500">
          Optional Cypress test body. The server runs it via the
          &ldquo;Run&rdquo; button on the case detail page. Leave blank to
          make the case documentation-only.
        </p>
      </Field>

      <div className="flex gap-3">
        <Field label="Status" className="flex-1">
          <select
            data-cy="case-status-input"
            {...register('status')}
            className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
          >
            <option value="draft">draft</option>
            <option value="active">active</option>
            <option value="deprecated">deprecated</option>
          </select>
        </Field>
        <Field label="Priority" className="flex-1">
          <select
            data-cy="case-priority-input"
            {...register('priority')}
            className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
          >
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
          </select>
        </Field>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-gray-700">Tags</label>
        <TagInput
          value={tags}
          onChange={(next) => setValue('tags', next, { shouldValidate: true })}
          suggestions={knownTags}
        />
      </div>

      <div className="flex gap-2 pt-2">
        <button
          type="submit"
          data-cy="case-submit-btn"
          disabled={submitting}
          className="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {submitting ? 'Saving…' : initial ? 'Update' : 'Create'}
        </button>
        <button
          type="button"
          data-cy="case-cancel-btn"
          onClick={onCancel}
          className="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

interface FieldProps {
  label: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}

function Field({ label, error, className, children }: FieldProps) {
  return (
    <div className={className}>
      <label className="mb-1 block text-sm font-medium text-gray-700">{label}</label>
      {children}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
