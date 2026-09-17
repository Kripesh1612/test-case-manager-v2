// routes/projects.js — project management (Feature 4).
//
// Projects are the tenant boundary: every user, test case, suite, job,
// webhook, digest, invite, and audit event belongs to exactly one project,
// and all reads are pinned to `req.user.projectId`. Admins are the only
// users who can *see* this router; they can:
//
//   GET  /projects          — all projects + member/content counts
//   POST /projects          — create a project
//   PATCH /projects/:id     — rename / re-slug / update description
//   POST /projects/:id/switch — set the admin's *active* project
//
// Deliberately no DELETE: deleting a project would cascade-restrict across
// users/cases/webhooks. Projects are expected to outlive teams; archiving
// is downstream.
//
// The "switcher" is modelled as "change my active project": the admin's
// user.project_id is updated, which (via middleware/auth.js) re-pins every
// subsequent request to that project. Membership is then implied — an
// admin switching into a project is acting as a member of it.

const express = require('express');
const { asyncHandler } = require('../middleware/http');
const requireAuth = require('../middleware/auth');
const requireRole = require('../middleware/roles');
const withAudit = require('../middleware/withAudit');
const { parseId } = require('../utils/params');
const prisma = require('../db');

const router = express.Router();

router.use(requireAuth, requireRole('admin'));

const slugify = (s) =>
  String(s || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

const projectSelect = {
  id: true,
  name: true,
  slug: true,
  description: true,
  created_at: true,
  _count: {
    select: {
      users: true,
      test_cases: true,
      test_suites: true,
      scheduled_jobs: true,
      webhooks: true,
    },
  },
};

// Export the enrichment helper for auth.js to reuse (keeps the project
// name resolution in one place).
const withProjectName = (user) =>
  prisma.project.findUnique({ where: { id: user.projectId } }).then((p) => ({
    ...user,
    projectId: user.projectId,
    project_name: p ? p.name : null,
  }));

// GET /projects — all projects with member/content counts.
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const projects = await prisma.project.findMany({
      orderBy: { id: 'asc' },
      select: projectSelect,
    });
    res.json(
      projects.map((p) => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        description: p.description,
        created_at: p.created_at,
        members: p._count.users,
        test_cases: p._count.test_cases,
        test_suites: p._count.test_suites,
        scheduled_jobs: p._count.scheduled_jobs,
        webhooks: p._count.webhooks,
      })),
    );
  }),
);

// POST /projects — create a project (admin). slug auto-derived unless given.
router.post(
  '/',
  withAudit('project.create', async (req, res) => {
    const { name, slug, description } = req.body || {};
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'name is required' });
    }
    const cleanName = name.trim();
    if (!cleanName || cleanName.length > 120) {
      return res.status(400).json({ error: 'name must be 1..120 characters' });
    }
    const finalSlug = slug && typeof slug === 'string' ? slug.trim().toLowerCase() : slugify(name);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(finalSlug)) {
      return res.status(400).json({ error: 'slug may only contain lowercase letters, digits, and dashes' });
    }
    // Audit C (Race): skip the read-then-write check; rely on the
    // unique constraint on Project.slug. P2002 on duplicate slug
    // surfaces as a clean 409 via the central error handler.
    let project;
    try {
      project = await prisma.project.create({
        data: {
          name: cleanName,
          slug: finalSlug,
          description: typeof description === 'string' ? description.slice(0, 500) : null,
        },
        select: projectSelect,
      });
    } catch (e) {
      if (e && e.code === 'P2002') {
        return res.status(409).json({ error: 'slug is already taken' });
      }
      throw e;
    }
    res.status(201).json({
      id: project.id,
      name: project.name,
      slug: project.slug,
      description: project.description,
      created_at: project.created_at,
      members: project._count.users,
      test_cases: project._count.test_cases,
      test_suites: project._count.test_suites,
      scheduled_jobs: project._count.scheduled_jobs,
      webhooks: project._count.webhooks,
    });
  }, {
    target_type: 'project',
    targetId: (_req, captured) => (captured && captured.id) || null,
    after: (_req, captured) => captured,
  }),
);

// PATCH /projects/:id — rename / re-slug / update description (admin).
router.patch(
  '/:id',
  withAudit('project.update', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: 'Project not found' });
    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const { name, slug, description } = req.body || {};
    const data = {};
    if (name !== undefined) {
      if (typeof name !== 'string' || !name.trim() || name.trim().length > 120) {
        return res.status(400).json({ error: 'name must be 1..120 characters' });
      }
      data.name = name.trim();
    }
    if (slug !== undefined) {
      const cleanSlug = String(slug).trim().toLowerCase();
      if (!/^[a-z0-9][a-z0-9-]*$/.test(cleanSlug)) {
        return res.status(400).json({ error: 'slug may only contain lowercase letters, digits, and dashes' });
      }
      const clash = await prisma.project.findUnique({ where: { slug: cleanSlug } });
      if (clash && clash.id !== id) return res.status(409).json({ error: 'slug is already taken' });
      data.slug = cleanSlug;
    }
    if (description !== undefined) {
      data.description = typeof description === 'string' ? description.slice(0, 500) : null;
    }

    if (!Object.keys(data).length) return res.status(400).json({ error: 'Nothing to update' });
    const updated = await prisma.project.update({ where: { id }, data, select: projectSelect });
    res.json({
      id: updated.id,
      name: updated.name,
      slug: updated.slug,
      description: updated.description,
      created_at: updated.created_at,
      members: updated._count.users,
      test_cases: updated._count.test_cases,
      test_suites: updated._count.test_suites,
      scheduled_jobs: updated._count.scheduled_jobs,
      webhooks: updated._count.webhooks,
    });
  }, {
    target_type: 'project',
    targetId: (req) => parseId(req.params.id),
    before: (req) => {
      const id = parseId(req.params.id);
      return id ? prisma.project.findUnique({ where: { id } }) : null;
    },
  }),
);

// POST /projects/:id/switch — set the admin's active project.
router.post(
  '/:id/switch',
  withAudit('project.switch', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: 'Project not found' });
    const project = await prisma.project.findUnique({ where: { id } });
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const updated = await prisma.user.update({
      where: { id: req.user.id },
      data: { project_id: id },
      select: { id: true, email: true, name: true, role: true, project_id: true },
    });

    res.json({ ...updated, projectId: updated.project_id, project_name: project.name });
  }, {
    target_type: 'project',
    targetId: (req) => parseId(req.params.id),
    before: (req) => {
      const id = parseId(req.params.id);
      return id ? prisma.project.findUnique({ where: { id } }) : null;
    },
  }),
);

module.exports = router;
module.exports.withProjectName = withProjectName;