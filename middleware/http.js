const { ZodError } = require('zod');

// Validate request body against a zod schema; mutates req.body with parsed (cleaned) data
const validate = (schema) => (req, res, next) => {
  req.body = schema.parse(req.body);
  next();
};

// Wrap an async route handler so thrown errors reach the error middleware
const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// Central error handler — translates known errors into consistent JSON shapes.
// `next` is required by Express's 4-arg signature convention even though we
// don't call it here — without it, Express doesn't recognize this as the
// error-handling middleware.
// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Validation failed',
      details: err.issues.map((e) => ({
        path: e.path.join('.'),
        message: e.message,
      })),
    });
  }

  if (err && err.code === 'P2002') {
    return res.status(409).json({ error: 'Resource already exists' });
  }

  if (err && err.code === 'P2025') {
    return res.status(404).json({ error: 'Resource not found' });
  }

  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
};

// sseResponse — upgrade an Express response to a Server-Sent Events
// stream. Phase 8 adds this for the test-run progress feed.
//
// Usage:
//   sseResponse(res);
//   res.sse('snapshot', { status: 'running' });   // emit a named event
//   res.end();                                    // close the stream
//
// Disabling proxy buffering is the caller's job if you front Express
// with nginx (we don't currently).
const sseResponse = (res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, no-transform');
  res.setHeader('Connection', 'keep-alive');
  // Disable proxy buffering for nginx etc. (no-op for direct clients).
  res.setHeader('X-Accel-Buffering', 'no');
  // Express's compression middleware buffers responses — disable that
  // for SSE so chunks flush on the first write.
  if (typeof res.flushHeaders === 'function') res.flushHeaders();

  res.sse = (event, data) => {
    // SSE wire format: `event: <name>\ndata: <json>\n\n`. Multi-line
    // data is line-prefixed per spec, but JSON payloads keep things
    // single-line so the client can JSON.parse() blindly.
    let payload;
    try {
      payload = JSON.stringify(data ?? null);
    } catch (_) {
      payload = JSON.stringify({ stringified: String(data) });
    }
    res.write(`event: ${event}\ndata: ${payload}\n\n`);
  };
};

module.exports = { validate, asyncHandler, errorHandler, sseResponse };
