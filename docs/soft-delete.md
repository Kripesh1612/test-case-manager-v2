# Soft delete + Trash

Every `DELETE /test-cases/:id` and `DELETE /test-suites/:id` is a
**soft delete**: it sets `deleted_at` instead of removing the row. The
row is hidden from the user-facing list but stays in the database until
an admin restores or purges it.

## Why soft delete

Real users delete things they shouldn't. A reviewer clicks "delete" on
a case they're about to demo tomorrow; a teammate nukes a suite that
two other people still depend on. With hard deletes, those mistakes
are gone. With soft deletes, the row is hidden but recoverable.

The trade-off is storage: every soft-deleted row stays in the DB until
you purge it. See [Auto-purge](#auto-purge) below.

## How it works

### Schema

`TestCase` and `TestSuite` both have a nullable `deleted_at` column:

```prisma
model TestCase {
  id          Int       @id @default(autoincrement())
  // ... other fields ...
  deleted_at  DateTime?
}
```

### Reads filter on `deleted_at: null`

Every `findMany`/`findUnique` call in `routes/testCases.js` and
`routes/testSuites.js` includes `where: { deleted_at: null }`. The
helper at `middleware/softDelete.js` exists so this clause is consistent.

### Writes set `deleted_at`

The `DELETE` handler doesn't `prisma.testCase.delete(...)`. It does:

```js
await prisma.testCase.update({
  where: { id },
  data: { deleted_at: new Date() },
});
```

### Restore

`POST /trash/cases/:id/restore` (admin only) sets `deleted_at` back to
null. Restore of a row that isn't currently trashed returns 404 — you
can't "restore" something that's already active.

### Purge

`DELETE /trash/cases/:id` (admin only) hard-deletes the row, after
confirming it's actually trashed. Purge of a non-trashed row returns
404. This is irreversible.

### RBAC

Restore and purge are **admin-only**. The trash list itself (GET
`/trash/cases`, `/trash/suites`) is readable by anyone authenticated,
so a viewer can see "there's something in the trash" even if they
can't act on it.

## Auto-purge

`jobs/purgeTrash.js` runs once on server startup. If `TRASH_RETENTION_DAYS`
is set to a positive number, it hard-deletes everything soft-deleted
more than that many days ago. Set to `0` (the default) to disable.

In production, you probably want a cron job instead of relying on
process startup. The job is documented as one-shot so you can wire it
into your scheduler of choice.

```bash
# Purge anything deleted more than 30 days ago (env-controlled).
TRASH_RETENTION_DAYS=30 npm start
```

## The UI

`/trash` is an admin page that lists soft-deleted cases and suites
side-by-side. Each row has Restore and Purge buttons. Both go through
the admin-only endpoints above.

```text
+-----------------------------------------------+
| Trash                                          |
+-----------------------------------------------+
| Cases (3)                |  Suites (1)        |
|                          |                    |
| [title] [Restore] [Purge]                     |
| [title] [Restore] [Purge]                     |
+-----------------------------------------------+
```

`public/trash.html` + `public/trash.js` are about 200 lines of vanilla
JS. They reuse `.admin-table`, `.modal`, and `confirmModal` from
`shared.js`.

## Tests

- `cypress/e2e/api/06-soft-delete.cy.js` — 12 tests covering the contract
- `cypress/e2e/ui/06-trash.cy.js` — 4 UI tests for restore + purge

The single most important contract is: **`DELETE` is not a hard delete.
The row is still in the DB.** That contract is what makes restore
possible.
