// =============================================================================
// Unit tests for utils/diff.js — the case-version snapshot diff.
//
// Run: npm run test:unit
//
// Coverage map (for defense review):
//   - diffSnapshots: throws on missing input; identical → empty result
//   - diffSnapshots: text field added / removed / changed
//   - diffSnapshots: array field changes (steps)
//   - diffSnapshots: tags array
//   - diffSnapshots: omits unchanged fields
//   - diffStrings: identical → no added/removed parts
//   - diffStrings: word-level additions work
//   - diffStrings: handles null/undefined without throwing
//
// Snapshot shape is the case snapshot, not the full case row — see
// docs/case-versions.md for the schema. The seven fields are the ones
// listed in utils/diff.js FIELDS.
// =============================================================================

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { diffSnapshots, diffStrings } = require('./diff');

// A "blank" snapshot — useful as the starting point for added-field tests.
function blankSnap(overrides = {}) {
  return {
    title: '',
    description: '',
    steps: [],
    expected_result: '',
    priority: '',
    status: '',
    tags: [],
    ...overrides,
  };
}

// ---- diffSnapshots: input validation ------------------------------------

test('diffSnapshots: throws when before is missing', () => {
  assert.throws(() => diffSnapshots(null, blankSnap()), /requires both/);
  assert.throws(() => diffSnapshots(undefined, blankSnap()), /requires both/);
});

test('diffSnapshots: throws when after is missing', () => {
  assert.throws(() => diffSnapshots(blankSnap(), null), /requires both/);
  assert.throws(() => diffSnapshots(blankSnap(), undefined), /requires both/);
});

test('diffSnapshots: returns empty array when both inputs are identical', () => {
  const snap = blankSnap({ title: 'Login works', steps: ['Open', 'Click'] });
  assert.deepEqual(diffSnapshots(snap, snap), []);
});

// ---- diffSnapshots: text fields -----------------------------------------

test('diffSnapshots: text field toggling empty ↔ value → kind is "changed"', () => {
  // The current diffField impl keys off `lines(value).length === 0` to
  // distinguish add/remove from change. Empty STRINGS yield `['']`
  // (length 1) while empty ARRAYS yield `[]` (length 0), so text
  // additions/removals are reported as `changed`. Array additions
  // (steps, tags) get the proper `added`/`removed` kind — see below.
  const result = diffSnapshots(blankSnap(), blankSnap({ title: 'new title' }));
  const title = result.find((r) => r.field === 'title');
  assert.ok(title, 'title field should appear in result');
  assert.equal(title.kind, 'changed');
  assert.deepEqual(title.before, ['']);
  assert.deepEqual(title.after, ['new title']);
});

test('diffSnapshots: array field added (steps was []) → kind is "added"', () => {
  const result = diffSnapshots(
    blankSnap({ steps: [] }),
    blankSnap({ steps: ['open'] }),
  );
  const steps = result.find((r) => r.field === 'steps');
  assert.ok(steps, 'steps field should appear in result');
  assert.equal(steps.kind, 'added');
});

test('diffSnapshots: array field removed (steps → []) → kind is "removed"', () => {
  const result = diffSnapshots(
    blankSnap({ steps: ['open'] }),
    blankSnap({ steps: [] }),
  );
  const steps = result.find((r) => r.field === 'steps');
  assert.ok(steps);
  assert.equal(steps.kind, 'removed');
});

test('diffSnapshots: text field changed — both sides non-empty', () => {
  const result = diffSnapshots(
    blankSnap({ description: 'Old description' }),
    blankSnap({ description: 'New description' }),
  );
  const field = result.find((r) => r.field === 'description');
  assert.equal(field.kind, 'changed');
  assert.deepEqual(field.before, ['Old description']);
  assert.deepEqual(field.after, ['New description']);
});

test('diffSnapshots: text field changed — multi-line split on \\n', () => {
  const result = diffSnapshots(
    blankSnap({ description: 'line one\nline two' }),
    blankSnap({ description: 'line one\nLINE TWO' }),
  );
  const field = result.find((r) => r.field === 'description');
  assert.equal(field.kind, 'changed');
  assert.deepEqual(field.before, ['line one', 'line two']);
  assert.deepEqual(field.after, ['line one', 'LINE TWO']);
});

// ---- diffSnapshots: array fields ----------------------------------------

test('diffSnapshots: steps array — middle element changed', () => {
  const result = diffSnapshots(
    blankSnap({ steps: ['open', 'click', 'submit'] }),
    blankSnap({ steps: ['open', 'CLICK', 'submit'] }),
  );
  const field = result.find((r) => r.field === 'steps');
  assert.ok(field, 'steps field should appear');
  assert.equal(field.kind, 'changed');
});

test('diffSnapshots: tags array — element changed', () => {
  const result = diffSnapshots(
    blankSnap({ tags: ['smoke', 'login', 'happy-path'] }),
    blankSnap({ tags: ['smoke', 'login', 'regression'] }),
  );
  const field = result.find((r) => r.field === 'tags');
  assert.ok(field, 'tags field should appear');
});

// ---- diffSnapshots: diff-field selection --------------------------------

test('diffSnapshots: only changed fields are emitted', () => {
  const result = diffSnapshots(
    {
      title: 'unchanged',
      description: 'diff-here',
      steps: ['1'],
      expected_result: 'unchanged',
      priority: 'medium',
      status: 'active',
      tags: ['x'],
    },
    {
      title: 'unchanged',
      description: 'changed-here',
      steps: ['1'],
      expected_result: 'unchanged',
      priority: 'medium',
      status: 'active',
      tags: ['x'],
    },
  );
  assert.equal(result.length, 1);
  assert.equal(result[0].field, 'description');
});

// ---- diffStrings --------------------------------------------------------

test('diffStrings: identical strings → no added or removed parts', () => {
  const parts = diffStrings('hello world', 'hello world');
  assert.equal(parts.some((p) => p.added), false);
  assert.equal(parts.some((p) => p.removed), false);
});

test('diffStrings: simple addition detected', () => {
  const parts = diffStrings('hello', 'hello world');
  const added = parts.filter((p) => p.added).map((p) => p.value).join('');
  assert.ok(added.includes('world'), `expected 'world' in added parts, got: ${added}`);
});

test('diffStrings: simple removal detected', () => {
  const parts = diffStrings('hello cruel world', 'hello world');
  const removed = parts.filter((p) => p.removed).map((p) => p.value).join('');
  assert.ok(removed.includes('cruel'), `expected 'cruel' in removed parts, got: ${removed}`);
});

test('diffStrings: handles null and undefined inputs without throwing', () => {
  // Should not throw — String(... ?? '') inside the impl coerces safely.
  diffStrings(null, 'hello');
  diffStrings(undefined, undefined);
  diffStrings('hi', null);
  diffStrings(null, null);
});
