// routes/digest.js — admin endpoints for the email digest feature.
//
// GET  /digest            — list digest_logs history (admin only)
// POST /digest/send       — send a digest now (admin only)
// POST /digest/preview    — compose a digest without persisting (admin only)

const express = require('express');
const { asyncHandler } = require('../middleware/http');
const requireAuth = require('../middleware/auth');
const requireRole = require('../middleware/roles');
const withAudit = require('../middleware/withAudit');
const { composeDigest, sendDigest } = require('../utils/digest');
const prisma = require('../db');

const router = express.Router();

// LIST HISTORY — GET /digest
router.get(
  '/',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const logs = await prisma.digestLog.findMany({
      where: { project_id: req.user.projectId || 1 },
      orderBy: { sent_at: 'desc' },
      take: 30,
    });
    res.json(logs);
  })
);

// SEND NOW — POST /digest/send
router.post(
  '/send',
  requireAuth,
  requireRole('admin'),
  withAudit('digest.send', async (req, res) => {
    const result = await sendDigest(req.user.projectId || 1);
    res.status(201).json({
      log_id: result.log_id,
      project_id: result.project_id,
      sent_at: result.window_end,
      recipients: result.recipients,
      title: result.title,
      sections: result.sections,
      delivery: result.delivery || undefined,
    });
  }, { target_type: 'digest' })
);

// PREVIEW — POST /digest/preview (composes but writes nothing)
router.post(
  '/preview',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const digest = await composeDigest(req.user.projectId || 1);
    res.json({
      window_start: digest.window_start,
      window_end: digest.window_end,
      project_id: digest.project_id,
      recipients: digest.recipients,
      title: digest.title,
      sections: digest.sections,
      html: digest.html,
    });
  })
);

module.exports = router;