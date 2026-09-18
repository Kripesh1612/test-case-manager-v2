// withAudit — record every successful mutation in the AuditEvent table.
//
// Usage:
//   router.delete('/:id',
//     requireAuth, requireRole('admin','editor'),
//     withAudit('test_case.delete', handler, {
//       target_type: 'test_case',
//       targetId: (req) => parseId(req.params.id),
//       before: (req) => prisma.testCase.findUnique({ where: { id: parseId(req.params.id) } }),
//     })
//   );
//
// Properties:
//   - 4xx/5xx are not audited (the request didn't actually mutate)
//   - audit-write failure is logged and swallowed; never crashes the request
//   - res.json is captured; the actual response is sent *after* the audit
//     row commits, so a client doing request -> audit-query immediately
//     after is guaranteed to see the event. (This trades a few ms of
//     response latency for test determinism.)
//
// audit-batch-C: the deferred-send pattern was introduced when audit
// redaction (`Audit C1` below) and audit-row-as-source-of-truth needed
// to coexist deterministically with mutation handlers. Belt-and-braces:
//   * `recordAudit` (line 39) wraps prisma.auditEvent.create in its
//     own try/catch — failures are logged but never bubbled out.
//   * The outer try around `await recordAudit({ ... })` (line 145)
//     exists so a *synchronous* throw from recordAudit can't break
//     `sendCaptured()`.
//   * `process.on('unhandledRejection')` in `index.js` is the
//     last-line backstop for any remaining async path that we don't
//     await (none today, but the handler stays in place).
// Net effect: a successful HTTP response is guaranteed to be sent
// even if every audit write fails for the lifetime of the request.

const prisma = require('../db');
const { isAuditEnabled } = require('../utils/settings');

const pickId = (captured, req) => {
  if (captured && typeof captured === 'object') {
    if (typeof captured.id === 'number') return captured.id;
    if (captured.user && typeof captured.user.id === 'number') return captured.user.id;
  }
  const fromParams = req && req.params && req.params.id;
  if (fromParams) {
    const n = parseInt(fromParams, 10);
    if (Number.isInteger(n)) return n;
  }
  return null;
};

const recordAudit = async ({ actor_id, project_id, action, target_type, target_id, before, after, ip, user_agent }) => {
  if (!isAuditEnabled()) return null;
  try {
    const row = await prisma.auditEvent.create({
      data: {
        actor: Number.isInteger(actor_id) ? { connect: { id: actor_id } } : undefined,
        project_id: Number.isInteger(project_id) && project_id > 0 ? project_id : 1,
        action,
        target_type,
        target_id: Number.isInteger(target_id) ? target_id : null,
        ip: ip || null,
        user_agent: user_agent || null,
        // metadata is JSONB on Postgres; Prisma serializes the object
        // automatically. We hand it the JS object directly.
        metadata: { before, after },
      },
    });
    // Audit C1: do NOT log the raw `metadata` blob to stdout. It carries
    // `before`/`after` snapshots of every mutation, which can include
    // user-controlled test-case bodies, webhook URLs/secrets, and PII
    // (emails, IPs). Stdout goes to the container's log stream and is
    // commonly ingested by log aggregators with weaker ACLs than the DB.
    // Log only the identifying fields so operators can correlate the
    // log line back to the row without exposing payload data.
    console.log(
      '[AUDIT CREATED]',
      JSON.stringify({
        id: row.id,
        action: row.action,
        target_type: row.target_type,
        target_id: row.target_id,
        actor_id: row.actor_id,
        project_id: row.project_id,
        created_at: row.created_at,
        has_metadata: Boolean(row.metadata),
      })
    );
    return row;
  } catch (e) {
    console.error('[audit] failed to record', action, e.message);
    return null;
  }
};

const withAudit = (action, fn, opts = {}) => async (req, res, next) => {
  // Snapshot the row *before* mutating (best-effort).
  let before = null;
  try {
    if (typeof opts.before === 'function') before = await opts.before(req);
  } catch (_) {
    before = null;
  }

  // Defer the actual response send. We capture the body but only call
  // the original res.json after the audit row is committed.
  let captured;
  let capturedStatus;
  const origJson = res.json.bind(res);
  const origStatus = res.status.bind(res);
  res.json = (body) => {
    captured = body;
    capturedStatus = res.statusCode;
  };
  res.status = (code) => {
    capturedStatus = code;
    res.statusCode = code; // also set the underlying statusCode so
                           // any subsequent Express internals see it
    return res;
  };

  try {
    await fn(req, res, next);
  } catch (err) {
    res.json = origJson;
    res.status = origStatus;
    return next(err);
  }

  // Restore original methods so the *outgoing* res.json is the real one.
  res.json = origJson;
  res.status = origStatus;

  const finalStatus = capturedStatus !== undefined ? capturedStatus : res.statusCode;

  // Always send whatever response the handler prepared, regardless of
  // whether we audit it. Failing to send would hang the client.
  const sendCaptured = () => {
    if (res.headersSent) return; // errorHandler already sent; nothing to do
    if (captured === undefined && finalStatus === 204) return res.status(204).send();
    if (captured === undefined) return origStatus(finalStatus).end();
    return origStatus(finalStatus).json(captured);
  };

  // Don't audit failures (4xx/5xx) — the request didn't actually mutate.
  if (finalStatus >= 400) return sendCaptured();

  const targetType = opts.target_type || action.split('.')[0];
  const targetId = typeof opts.targetId === 'function'
    ? opts.targetId(req, captured)
    : pickId(captured, req);

  const after = typeof opts.after === 'function'
    ? opts.after(req, captured)
    : captured;

  // Write the audit row, then send the response. If the audit write
  // fails internally it's already swallowed; if it throws, we still
  // send the response.
  try {
    await recordAudit({
      actor_id: req.user ? req.user.id : null,
      project_id: req.user ? req.user.projectId : 1,
      action,
      target_type: targetType,
      target_id: targetId,
      before,
      after,
      ip: req.ip,
      user_agent: req.get && req.get('user-agent'),
    });
  } catch (_) {
    // recordAudit already swallows; this catch is belt-and-braces.
  }

  return sendCaptured();
};

module.exports = withAudit;