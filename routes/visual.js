// routes/visual.js — visual-regression artifacts (Feature 3).
//
// Works with the screenshot columns added to TestRun:
//   screenshot_before  artifact name of the baseline image
//   screenshot_after   artifact name of the current image
//   diff_image          artifact name of the highlight diff PNG
//   diff_score          0..1 pixel-diff ratio (0 = identical)
//
// Endpoints:
//   POST /runs/:id/artifacts/:name   (admin)  attach a base64 PNG screenshot
//   POST /runs/:id/visual/diff       (admin)  diff before/after, store columns
//   GET  /runs/:id/visual            (admin/editor) diff summary + artifact URLs
//   GET  /runs/:id/artifacts/:name   (admin/editor) serve a stored artifact
//
// Artifact names are the caller's choice but restricted to `artifacts/<file>`
// for uploads and validated against a path-traversal guard on serve.

const express = require('express');
const fs = require('fs');
const path = require('path');
const { asyncHandler } = require('../middleware/http');
const requireAuth = require('../middleware/auth');
const requireRole = require('../middleware/roles');
const withAudit = require('../middleware/withAudit');
const { parseId } = require('../utils/params');
const { artifactDir, artifactPath, readArtifact } = require('../utils/artifactStore');
const { comparePngBuffers, encodePng, diffScoreToVerdict } = require('../utils/visualDiff');
const prisma = require('../db');

const router = express.Router();

const SAFE_NAME = /^[A-Za-z0-9._-]+$/;

// Resolve + verify the run exists in the caller's project (Feature 4).
async function requireRun(req) {
  const id = parseId(req.params.id);
  if (!id) return { error: 'Run not found' };
  const run = await prisma.testRun.findFirst({
    where: { id, test_case: { project_id: req.user?.projectId || 1 } },
    select: { id: true },
  });
  if (!run) return { error: 'Run not found' };
  return { id: run.id };
}

// POST /runs/:id/artifacts/:name — attach a screenshot (base64 PNG in
// { data }). Stored under the run's artifact directory as
// `artifacts/<name>.png`.
router.post(
  '/runs/:id/artifacts/:name',
  requireAuth,
  requireRole('admin'),
  withAudit('visual.upload', async (req, res) => {
    const { id, error } = await requireRun(req);
    if (error) return res.status(404).json({ error });
    const { name } = req.params;
    if (!SAFE_NAME.test(name)) {
      return res.status(400).json({ error: 'Invalid artifact name' });
    }
    const data = typeof req.body?.data === 'string' ? Buffer.from(req.body.data, 'base64') : null;
    if (!data || data.length === 0) {
      return res.status(400).json({ error: 'body.data must be a base64 PNG' });
    }

    const dir = artifactDir(id);
    fs.mkdirSync(path.join(dir, 'artifacts'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'artifacts', `${name}.png`), data);
    res.status(201).json({ ok: true, name: `artifacts/${name}.png` });
  }, { target_type: 'run', targetId: (req) => parseId(req.params.id) })
);

// POST /runs/:id/visual/diff — compute the pixel diff between the run's
// before/after screenshots and stamp the result on the TestRun row. The
// runner picks screenshot_before/screenshot_after when set, else the
// conventional artifacts/before.png + artifacts/after.png.
router.post(
  '/runs/:id/visual/diff',
  requireAuth,
  requireRole('admin'),
  withAudit('visual.diff', async (req, res) => {
    const { id: runId, error } = await requireRun(req);
    if (error) return res.status(404).json({ error });
    const run = await prisma.testRun.findUnique({ where: { id: runId } });
    if (!run) return res.status(404).json({ error: 'Run not found' });

    const beforeName = run.screenshot_before || 'artifacts/before.png';
    const afterName = run.screenshot_after || 'artifacts/after.png';
    const before = readArtifact(run.id, beforeName);
    const after = readArtifact(run.id, afterName);
    if (!before || !after) {
      return res.status(400).json({ error: 'Both before and after screenshots are required' });
    }

    let result;
    try {
      result = comparePngBuffers(before, after);
    } catch (e) {
      return res.status(400).json({ error: `Screenshot diff failed: ${e.message}` });
    }

    const diffName = 'artifacts/diff.png';
    fs.writeFileSync(artifactPath(run.id, diffName), encodePng(result.width, result.height, result.diff));

    const updated = await prisma.testRun.update({
      where: { id: run.id },
      data: {
        screenshot_before: beforeName,
        screenshot_after: afterName,
        diff_image: diffName,
        diff_score: result.diffScore,
      },
    });

    res.json({
      diff_score: updated.diff_score,
      verdict: diffScoreToVerdict(updated.diff_score),
      screenshot_before: updated.screenshot_before,
      screenshot_after: updated.screenshot_after,
      diff_image: updated.diff_image,
    });
  }, { target_type: 'run', targetId: (req) => parseId(req.params.id) })
);

// GET /visual/runs — runs that have a stored pixel diff, newest first.
// (admin/editor)
router.get(
  '/visual/runs',
  requireAuth,
  requireRole('admin', 'editor'),
  asyncHandler(async (req, res) => {
    const runs = await prisma.testRun.findMany({
      where: { diff_score: { not: null }, test_case: { project_id: req.user.projectId } },
      orderBy: { finished_at: 'desc' },
      take: 50,
      include: { test_case: { select: { id: true, title: true } } },
    });
    res.json(runs.map((r) => ({ ...serializeVisual(r), case_title: r.test_case?.title ?? null })));
  })
);

// GET /runs/:id/visual — diff summary with artifact URLs (does not
// compute, just reflects what's stored).
router.get(
  '/runs/:id/visual',
  requireAuth,
  requireRole('admin', 'editor'),
  asyncHandler(async (req, res) => {
    const { id, error } = await requireRun(req);
    if (error) return res.status(404).json({ error });
    const run = await prisma.testRun.findUnique({ where: { id } });
    if (!run) return res.status(404).json({ error: 'Run not found' });
    res.json(serializeVisual(run));
  })
);

// GET /runs/:id/artifacts/:name — serve an artifact file. Names are the
// splat after /artifacts/ (an array in Express 5's path-to-regexp v8) and
// resolved through artifactPath() which refuses traversal.
router.get(
  '/runs/:id/artifacts/{*name}',
  requireAuth,
  requireRole('admin', 'editor'),
  asyncHandler(async (req, res) => {
    const { id, error } = await requireRun(req);
    if (error) return res.status(404).json({ error });
    const relative = Array.isArray(req.params.name) ? req.params.name.join('/') : req.params.name;
    const abs = artifactPath(id, relative);
    if (!abs || !fs.existsSync(abs)) return res.status(404).json({ error: 'Artifact not found' });
    res.sendFile(abs);
  })
);

function serializeVisual(run) {
  const base = `/runs/${run.id}/artifacts/`;
  return {
    run_id: run.id,
    case_id: run.test_case_id,
    status: run.status,
    finished_at: run.finished_at,
    diff_score: run.diff_score,
    verdict: run.diff_score === null || run.diff_score === undefined ? null : diffScoreToVerdict(run.diff_score),
    screenshot_before: run.screenshot_before,
    screenshot_after: run.screenshot_after,
    diff_image: run.diff_image,
    urls: {
      before: run.screenshot_before ? `${base}${run.screenshot_before}` : null,
      after: run.screenshot_after ? `${base}${run.screenshot_after}` : null,
      diff: run.diff_image ? `${base}${run.diff_image}` : null,
    },
  };
}

module.exports = router;