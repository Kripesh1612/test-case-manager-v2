# Case Versions + Diff

The Test Case Manager keeps an append-only history of every test case it has
ever held. Every create and every update snapshots the full case state, so
you can:

- **Audit** — who changed what, and when.
- **Diff** — see exactly which fields changed between any two revisions,
  including line-level diffs inside `steps` and `tags`.
- **Restore** — revert a case to an older state in one click, with the
  pre-restore state preserved as a new version (no data is ever lost).

---

## Storage model

Every TestCase has a one-to-many relationship with a new
`TestCaseVersion` table:

| Column           | Type             | Notes                                           |
|------------------|------------------|-------------------------------------------------|
| `id`             | `BIGSERIAL`      | Surrogate PK                                     |
| `case_id`        | `INTEGER` (FK)   | `ON DELETE CASCADE` to `TestCase`                |
| `version`        | `INTEGER`        | 1, 2, 3, ... — assigned by `MAX(version) + 1`   |
| `snapshot`       | `JSONB`          | Frozen copy of the case's editable fields        |
| `created_at`     | `TIMESTAMPTZ`    | Server `DEFAULT now()`                           |
| `created_by_id`  | `INTEGER` (FK?)  | Set to the actor's user id when available        |

The unique constraint `(case_id, version)` guarantees no two snapshots
collide on the version number, and the `@@index([case_id, version])` keeps
the list-by-case query O(log n).

### What gets snapshotted

```jsonc
{
  "title":          "<string>",
  "description":    "<string>",
  "steps":          ["<line>", "<line>", "..."],
  "expected_result":"<string>",
  "priority":       "low" | "medium" | "high",
  "status":         "draft" | "active" | "deprecated",
  "tags":           ["<tag>", "..."]
}
```

That set is fixed at seven fields. Anything else on a TestCase
(created_at, updated_at, owner, suite_memberships) is intentionally NOT
snapshotted — those are metadata about the case, not part of its content.

---

## Snapshot lifecycle

A snapshot is written from exactly three places:

1. **`POST /test-cases`** — case is created, v1 is written.
2. **`PUT /test-cases/:id`** — case is updated, the next version is appended.
3. **`POST /test-cases/:id/versions/:versionId/restore`** — restore copies
   an older snapshot into the live row, then writes vN+1 reflecting the
   post-restore state.

The `version` counter is allocated inside a `prisma.$transaction` so two
concurrent updates can never get the same number:

```js
const latest = await tx.testCaseVersion.findFirst({
  where: { case_id: caseId },
  orderBy: { version: 'desc' },
  select: { version: true },
});
const nextVersion = (latest?.version ?? 0) + 1;
```

A failed update (validation error, unique-constraint violation, ...) does
NOT leave a phantom snapshot — the snapshot insert is part of the same
transaction as the live update, so they roll back together.

---

## API

All routes are mounted under `/test-cases/:caseId/versions` and require
authentication. Restore additionally requires admin or editor role.

| Method | Path                                          | Purpose                           |
|--------|-----------------------------------------------|-----------------------------------|
| GET    | `/test-cases/:caseId/versions`                | List summaries (newest first)      |
| GET    | `/test-cases/:caseId/versions/:versionId`     | Fetch a single snapshot            |
| GET    | `/test-cases/:caseId/versions/:a/diff/:b`     | Diff between two snapshots         |
| POST   | `/test-cases/:caseId/versions/:versionId/restore` | Revert the case and snapshot the new state |

### List

```jsonc
[
  { "id": 42, "case_id": 7, "version": 2, "created_at": "...", "created_by_id": 3 },
  { "id": 41, "case_id": 7, "version": 1, "created_at": "...", "created_by_id": 3 }
]
```

Newest first because that's the order humans want when reading history.
Diff and Restore work on `version_id`, not on `version` number, so the
list endpoint doubles as an index.

### Single snapshot

`GET /test-cases/7/versions/41` returns the full body (summary +
`snapshot: { title, description, ..., tags }`).

### Diff

```
GET /test-cases/7/versions/41/diff/42
```

```jsonc
{
  "from_version": 1,
  "to_version":   2,
  "fields": [
    {
      "field":  "title",
      "kind":   "changed",
      "before": ["Open the page"],
      "after":  ["Open the modal"]
    },
    {
      "field":  "steps",
      "kind":   "changed",
      "before": ["open", "submit", "verify"],
      "after":  ["open", "submit", "wait", "verify"]
    }
    // unchanged fields are omitted — see Diff shape below
  ]
}
```

A field is included in the response only when its `before` and `after`
arrays differ. That keeps the response compact even for cases where an
update touched only one field out of seven.

### Restore

```
POST /test-cases/7/versions/41/restore
Authorization: Bearer <editor or admin token>
```

Returns the live TestCase post-restore and creates vN+1 whose snapshot
matches the restored state. Always idempotent in the sense that the input
version still exists after the call — you can call Restore twice and end
up at the same place, with two more history entries to prove it.

403 for viewers. 404 for invalid version ids.

---

## Diff shape — what `kind` means

| Kind       | Meaning                                                          |
|------------|------------------------------------------------------------------|
| `added`    | Field existed only on the `after` side (e.g. a new tag)          |
| `removed`  | Field existed only on the `before` side (e.g. a tag was dropped) |
| `changed`  | Both sides exist and differ (most common)                        |

`title`, `description`, `expected_result`, `priority`, `status` are
single-line strings — their `before` / `after` arrays each have one
element. `steps` and `tags` are arrays of strings, normalized to one
element per line. The UI renders them with line-level Myers diff when the
field is `changed`.

---

## Algorithm (the CS substance)

Every diff is computed with the **Myers diff algorithm** (Eugene W. Myers,
*An O(ND) Difference Algorithm and Its Variations*, 1986), via the
`diff` npm package. That's the same algorithm git uses for its textual
diffs, chosen for two reasons:

1. **Optimal.** Myers finds a *shortest edit script* — the minimum
   number of insertions + deletions to turn `before` into `after`. No
   ad-hoc "common prefix" hack can beat it.
2. **Bounded.** Worst case is O((N+M)·D) where D is the edit distance.
   For typical test-case diffs, both fields are short and D is small, so
   it's effectively O(N+M).

### Why a field-by-field diff, not one big diff

A naive "concatenate all fields and run Myers once" approach has two
problems:

- **Noise.** Even a single tag rename would produce a wall of deletions
  and re-insertions across all seven fields, because the boundary
  between sections isn't meaningful.
- **Lossy output.** The result would be one big "blob changed" report
  with no way to know which field each chunk belongs to.

The fix: each field gets its own Myers pass. Each field's `before` and
`after` are normalized into `string[]` (one element per line for steps/
tags; one element for the long-string fields). The output groups diffs
by field, so the UI can render each as a labelled panel.

Implementation: `utils/diff.js`:

```js
const FIELDS = ['title', 'description', 'steps', 'expected_result',
                'priority', 'status', 'tags'];

function diffSnapshots(before, after) {
  const out = [];
  for (const field of FIELDS) {
    const b = normalize(field, before?.[field]);
    const a = normalize(field, after?.[field]);
    if (sameArray(b, a)) continue;  // skip unchanged
    out.push({ field, kind: classify(b, a), before: b, after: a });
  }
  return out;
}
```

Inside `CaseDiffView.tsx`, the line-level render for `changed` arrays
uses `Diff.diffArrays(before, after)` from the same package — Myers
again, this time on the line-array operands. So every diff the UI shows
is the result of Myers; we never roll our own longest-common-subsequence
or use `===` heuristics.

---

## UI tour

Open any case at `/cases/:id`. The page has two panels:

- **Sidebar (`data-cy="case-version-list"`):** one row per version,
  newest first, with a `current` badge on vN.
  - Click a row → that version becomes the `from` selection. Main panel
    shows its snapshot in read-only mode.
  - Click another row → that becomes the `to`. Main panel flips to diff
    mode and fires `GET /versions/:a/diff/:b`.
  - Click `Restore this version` (editor/admin only) → confirmation
    modal → `POST /restore` → the case reverts, history grows by one,
    and the diff selection clears so the user sees the new top of
    history.

- **Main panel:** a diff view (when both `from` and `to` are selected) or
  a single-snapshot view (only `from`). The `Clear` button in the
  sidebar header resets to a single-snapshot of the newest version.

URL state: selections live in `?from=<versionId>&to=<versionId>`. That
makes diffs shareable — paste the URL into chat and the recipient lands
on the exact same comparison.

---

## Why "append only" instead of "edit-in-place"

The history table is append-only. We never `UPDATE` or `DELETE` rows in
`test_case_versions`. Three reasons:

1. **Trivial cacheability.** Snapshots are immutable, so the client can
   cache them aggressively (`staleTime: 60_000`). Editing history rows
   would force a cache-bust on every write.
2. **Concurrency-safe.** Two writers updating the same case at the same
   time don't need to lock anything — `MAX(version) + 1` inside a
   transaction is enough to guarantee unique version numbers.
3. **Audit friendly.** The `created_by_id` column captures who produced
   each snapshot at the moment of truth. Editing rows would either lose
   that or require keeping a parallel change log.

Restore adds a fresh row, it does not rewrite old ones. Even a restore
that immediately gets re-restored leaves a clean chain of evidence: the
pre-restore state is preserved as vN+1 in case anyone needs to undo the
undo.

---

## Future work

Out of scope for this drop, possible follow-ups:

- **Pagination.** Cases with 50+ versions return them all in one shot.
  Fine for now; can paginate by `(created_at, id)` cursor when needed.
- **GC.** A scheduled job could hard-delete versions older than N (with a
  "keep latest 10" floor) for cases over a certain size. Same machinery
  as the existing trash retention.
- **Cross-version tagging.** Currently each snapshot freezes `tags` as
  a single string array. A future "show how the tag set evolved" view
  could compute that lazily from the full history.
