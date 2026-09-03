// Field-by-field diff for test case versions.
//
// Algorithm: Myers diff (1986) via the `diff` npm package. Myers' O(ND)
// algorithm finds the shortest edit script between two sequences — the
// same algorithm git uses internally for line-level diffing.
//
// We normalise every field to an array of lines, run Myers once per
// field, and emit a structured {field, kind, before, after} record.
// The UI consumes that structure and renders side-by-side diffs with
// one component, regardless of whether the field is text (title,
// description) or an array (steps, tags).
//
// `kind`:
//   - 'changed' → both before and after are non-empty AND not identical
//   - 'added'    → before is empty, after is non-empty
//   - 'removed'  → after is empty, before is non-empty
//
// Text fields (title, description, expected_result, priority, status)
// are diffed by splitting on '\n' so multi-line descriptions render
// sensibly. Array fields (steps, tags) are diffed element-by-element.

const Diff = require('diff');

// Fields that exist on a snapshot, in the order we want to render them.
const FIELDS = [
  'title',
  'description',
  'steps',
  'expected_result',
  'priority',
  'status',
  'tags',
];

function lines(value) {
  if (Array.isArray(value)) return value.map((v) => String(v));
  return String(value ?? '').split('\n');
}

function diffField(field, beforeRaw, afterRaw) {
  const before = lines(beforeRaw);
  const after = lines(afterRaw);

  // Fast path: identical fields don't appear in the diff at all. We only
  // emit a record when the field actually changed in some way.
  const beforeStr = before.join('\n');
  const afterStr = after.join('\n');

  if (beforeStr === afterStr) return null;

  let kind;
  if (before.length === 0) kind = 'added';
  else if (after.length === 0) kind = 'removed';
  else kind = 'changed';

  // For text fields we don't need the per-line breakdown in the output —
  // the UI will run its own Myers diff on the strings for inline
  // highlighting. For array fields (steps, tags), `before` / `after`
  // already contain the per-element lines the UI will diff.
  //
  // To keep the wire format uniform, we always return the raw `before`
  // / `after` line arrays. The UI decides whether to do word-level diff
  // (text fields) or line-level diff (arrays).
  return { field, kind, before, after };
}

// Public entry point. Compares two snapshots (plain objects matching
// caseSnapshotSchema) and returns an array of {field, kind, before,
// after} — one record per field that differs. Fields that are identical
// between the two snapshots are omitted.
function diffSnapshots(before, after) {
  if (!before || !after) {
    throw new Error('diffSnapshots requires both before and after snapshots');
  }
  const out = [];
  for (const field of FIELDS) {
    const record = diffField(field, before[field], after[field]);
    if (record) out.push(record);
  }
  return out;
}

// Convenience: run Myers once on two strings and return a tagged list
// of { kind: 'added' | 'removed' | 'context', value }. Used by the UI
// to render inline highlight on text fields. We re-export the underlying
// algorithm here so the React component doesn't need to import `diff`
// directly.
function diffStrings(a, b) {
  return Diff.diffWordsWithSpace(String(a ?? ''), String(b ?? ''));
}

module.exports = { diffSnapshots, diffStrings };