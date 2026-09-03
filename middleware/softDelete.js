// softDelete — shared filter and helpers for the soft-delete pattern.
//
// Pattern:
//   - Add a nullable `deleted_at` column to the table.
//   - Every read filters { deleted_at: null }.
//   - "Delete" becomes `update({ data: { deleted_at: now } })`.
//   - Restore: `update({ data: { deleted_at: null } })`.
//   - Purge: real delete, admin-only.
//
// Why: recoverable deletes are the norm in production apps. The Trash
// page (/trash) shows everything in the graveyard; admin can restore
// or hard-delete. See docs/soft-delete.md.

const prisma = require('../db');

// Reusable where-clause fragment.
const notDeleted = { deleted_at: null };

// Stamp `deleted_at` with the current time.
const softDelete = (model, id) =>
  prisma[model].update({ where: { id }, data: { deleted_at: new Date() } });

// Restore a soft-deleted row.
const restore = (model, id) =>
  prisma[model].update({ where: { id }, data: { deleted_at: null } });

// Hard-delete (purge).
const purge = (model, id) =>
  prisma[model].delete({ where: { id } });

module.exports = { notDeleted, softDelete, restore, purge };