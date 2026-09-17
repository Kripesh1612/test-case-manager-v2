const express = require('express');
const { validate, asyncHandler } = require('../middleware/http');
const requireAuth = require('../middleware/auth');
const requireRole = require('../middleware/roles');
const withAudit = require('../middleware/withAudit');
const { webhookSchema, webhookUpdateSchema } = require('../shared/schemas/webhook');
const { projectScope } = require('../utils/scope');
const { parseId, clampInt } = require('../utils/params');
const { deliverToWebhook } = require('../utils/webhooks');
const { encryptSecret, decryptSecret } = require('../utils/webhookSecret');
const prisma = require('../db');

const router = express.Router();

// LIST — GET /webhooks (admin only)
// Audit C (pagination): capped at 200 rows per call.
router.get(
  '/',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const limit = clampInt(req.query.limit, 1, 500, 200);
    const offset = clampInt(req.query.offset, 0, 1e9, 0);
    const webhooks = await prisma.webhook.findMany({
      where: projectScope(req.user),
      include: {
        _count: { select: { deliveries: true } },
      },
      orderBy: { id: 'asc' },
      take: limit,
      skip: offset,
    });
    res.json({
      count: webhooks.length,
      limit,
      offset,
      webhooks: webhooks.map((w) => serializeWebhook(w)),
    });
  })
);

// CREATE — POST /webhooks (admin only)
router.post(
  '/',
  requireAuth,
  requireRole('admin'),
  validate(webhookSchema),
  withAudit('webhook.create', async (req, res) => {
    const { url, secret, event, enabled } = req.body;
    // Encrypt-at-rest: the raw secret is encrypted with AES-256-GCM keyed
    // off JWT_SECRET (see utils/webhookSecret.js). The plaintext only ever
    // exists in this request handler's local scope.
    const webhook = await prisma.webhook.create({
      data: {
        url,
        secret: encryptSecret(secret || ''),
        event,
        enabled: enabled !== false,
        project_id: req.user.projectId || 1,
        created_by_id: req.user.id,
      },
      include: { _count: { select: { deliveries: true } } },
    });
    res.status(201).json(serializeWebhook(webhook));
  }, { target_type: 'webhook' })
);

// TEST — POST /webhooks/:id/test (admin only)
router.post(
  '/:id/test',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: 'Webhook not found' });
    const webhook = await prisma.webhook.findFirst({
      where: { id, ...projectScope(req.user) },
    });
    if (!webhook) return res.status(404).json({ error: 'Webhook not found' });

    // Ping payload — a synthetic event, not a real suite.run.completed.
    // Consumers should be able to tell it apart from the real thing, so:
    //   - top-level `ping: true` flag
    //   - `event` is the same constant so consumers don't need a branch,
    //     but `suite_id` is null (the prior version used the webhook's
    //     own PK, which collided with real consumer data)
    //   - `outcome.suite_id` is also null
    //   - `webhook_id` is included so consumers can correlate back to
    //     which webhook config the ping came from
    const payload = {
      event: 'suite.run.completed',
      ping: true,
      suite_id: null,
      project_id: webhook.project_id,
      webhook_id: id,
      outcome: { status: 'ping', suite_id: null, project_id: webhook.project_id },
      delivered_at: new Date().toISOString(),
    };
    const result = await deliverToWebhook(webhook, payload);
    res.json({ ok: result.success, attempts: result.attempts, delivery_ids: result.delivery_ids });
  })
);

// GET DELIVERIES — GET /webhooks/:id/deliveries (admin only)
router.get(
  '/:id/deliveries',
  requireAuth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: 'Webhook not found' });
    const webhook = await prisma.webhook.findFirst({
      where: { id, ...projectScope(req.user) },
    });
    if (!webhook) return res.status(404).json({ error: 'Webhook not found' });

    const deliveries = await prisma.webhookDelivery.findMany({
      where: { webhook_id: id },
      orderBy: { created_at: 'desc' },
      take: 50,
    });
    res.json(deliveries);
  })
);

// UPDATE — PUT /webhooks/:id (admin only)
router.put(
  '/:id',
  requireAuth,
  requireRole('admin'),
  validate(webhookUpdateSchema),
  withAudit('webhook.update', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: 'Webhook not found' });
    const existing = await prisma.webhook.findFirst({
      where: { id, ...projectScope(req.user) },
    });
    if (!existing) return res.status(404).json({ error: 'Webhook not found' });

    const { url, secret, event, enabled } = req.body;
    const data = {};
    if (url !== undefined) data.url = url;
    // Re-encrypt on update so plaintext never lands in the DB even if
    // an admin sets a new secret. An empty string clears the secret.
    if (secret !== undefined) data.secret = encryptSecret(secret);
    if (event !== undefined) data.event = event;
    if (enabled !== undefined) data.enabled = enabled;

    const webhook = await prisma.webhook.update({
      where: { id },
      data,
      include: { _count: { select: { deliveries: true } } },
    });
    res.json(serializeWebhook(webhook));
  }, {
    target_type: 'webhook',
    targetId: (req) => parseId(req.params.id),
  })
);

// DELETE — DELETE /webhooks/:id (admin only)
router.delete(
  '/:id',
  requireAuth,
  requireRole('admin'),
  withAudit('webhook.delete', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: 'Webhook not found' });
    // Scoped delete — serve 404 if the webhook belongs to another project.
    const scoped = await prisma.webhook.findFirst({
      where: { id, ...projectScope(req.user) },
      select: { id: true },
    });
    if (!scoped) return res.status(404).json({ error: 'Webhook not found' });

    await prisma.webhook.delete({ where: { id } });
    res.status(204).send();
  }, {
    target_type: 'webhook',
    targetId: (req) => parseId(req.params.id),
  })
);

function serializeWebhook(w) {
  return {
    id: w.id,
    url: w.url,
    event: w.event,
    enabled: w.enabled,
    project_id: w.project_id,
    created_by_id: w.created_by_id,
    created_at: w.created_at,
    updated_at: w.updated_at,
    has_secret: Boolean(w.secret),
    delivery_count: w._count ? w._count.deliveries : 0,
  };
}

module.exports = router;