require('./config'); // load .env before anything that reads process.env

const path = require('path');
const express = require('express');
const { errorHandler } = require('./middleware/http');
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const projectRoutes = require('./routes/projects');
const testCaseRoutes = require('./routes/testCases');
const testCaseVersionRoutes = require('./routes/versions');
const testSuiteRoutes = require('./routes/testSuites');
const auditRoutes = require('./routes/audit');
const trashRoutes = require('./routes/trash');
const runRoutes = require('./routes/runs');
const executionRoutes = require('./routes/execution');
const inviteRoutes = require('./routes/invites');
const scheduledJobRoutes = require('./routes/scheduledJobs');
const webhookRoutes = require('./routes/webhooks');
const digestRoutes = require('./routes/digest');
const visualRoutes = require('./routes/visual');
const { startScheduler, stopScheduler } = require('./middleware/schedulerLoop');
const { startDigestLoop, stopDigestLoop } = require('./middleware/digestLoop');
const { startTrashPurge, stopTrashPurge } = require('./utils/trashPurge');

// Path to the Vite production build, when present (used to serve the
// React app at /cases — see the page-handler section below).
const clientDistDir = path.join(__dirname, 'client', 'dist');

const app = express();
const PORT = process.env.PORT || 3001;

// Trust the first proxy hop so client IPs (used by the rate limiter
// and the audit log) reflect the real caller when running behind
// nginx / Coolify / another reverse proxy. `1` = trust the nearest
// proxy; bump via TRUST_PROXY env if you put more hops in front.
app.set('trust proxy', parseInt(process.env.TRUST_PROXY ?? '1', 10) || 1);

// Bound JSON bodies. 1 MB is generous for our payloads (largest is a
// case with long description + many steps) and rejects the obvious
// OOM attempts. Override via JSON_BODY_LIMIT env if you need to.
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '1mb' }));

// Audit C (CSRF): enforce an Origin/Referer allowlist on all state-
// changing requests (POST/PUT/PATCH/DELETE). Bearer-token auth already
// forecloses classic form-based CSRF, but a defense-in-depth origin
// check costs nothing and constrains the damage radius of a stolen
// token. See middleware/csrf.js for the full rationale. Mounted here
// (before all routers) so every write endpoint is covered.
//
// Trust the same-host origin by default. CI / programmatic callers
// can opt out via CSRF_ALLOW_NO_ORIGIN=1 (rare — almost always means
// something's wrong). Production should never set CSRF_ALLOWED_ORIGINS=*
// outside of integration tests.
app.use(require('./middleware/csrf').csrfGuard());

// Serve the simple UI from /public
app.use(express.static('public'));

// Serve the React build's hashed asset bundles at /assets/* (the Vite
// build emits absolute paths like /assets/index-abc.js).
app.use('/assets', express.static(path.join(clientDistDir, 'assets')));

// Mount routers
app.use('/auth', authRoutes);
app.use('/users', userRoutes);
// Project management (Feature 4) — admin-only CRUD + the project switcher.
app.use('/projects', projectRoutes);
// Flakiness routes own the literal /test-cases/flaky path. Mounted
// BEFORE testCaseRoutes because testCaseRoutes has a `/:id` handler
// that would otherwise 404 on caseId="flaky".
app.use('/test-cases', require('./routes/flakiness'));
app.use('/test-cases', testCaseRoutes);
// Nested under /test-cases/:caseId/versions. Mounted AFTER the parent
// router so /test-cases (no :caseId) keeps matching testCaseRoutes' own
// handlers. The version router uses mergeParams:true to read :caseId.
app.use('/test-cases/:caseId/versions', testCaseVersionRoutes);
app.use('/test-suites', testSuiteRoutes);
app.use('/audit', auditRoutes);
app.use('/invites', inviteRoutes);
app.use('/scheduled-jobs', scheduledJobRoutes);
// Runs router is mounted at root (not /test-cases) because it owns
// /test-cases/:id/runs AND /runs/recent — the latter is a dashboard
// feed that doesn't belong under a single case.
app.use(runRoutes);
// Execution router (Phase 8) owns POST /test-cases/:id/execute and
// GET /runs/:id/stream. Both live at root because the SSE endpoint
// isn't scoped under a particular case in the URL.
app.use(executionRoutes);
// Webhook management (Feature 1) — admin-only CRUD + delivery history.
app.use('/webhooks', webhookRoutes);
// Email digest (Feature 2) — admin-only history/send/preview.
app.use('/digest', digestRoutes);
// Visual regression artifacts (Feature 3) — screenshot upload/diff/serve.
app.use(visualRoutes);

// UI pages — serve the React app for the routes we've migrated, fall
// back to the vanilla HTML files in public/ for the rest (so Cypress
// specs that haven't been migrated yet keep working).
//
// Order matters: page handlers come BEFORE the /trash API router so
// GET /trash serves the React SPA (which renders the TrashPlaceholder
// for now) rather than hitting the API's requireAuth.
const servePage = (name) => (req, res) => res.sendFile(`public/${name}.html`, { root: __dirname });
const serveReact = (req, res) => res.sendFile(path.join(clientDistDir, 'index.html'));

// Routes whose React counterpart lives in client/src/ and that the
// Cypress UI specs already target via data-cy. (Phase 4 + Phase 5
// migrations.)
app.get('/', serveReact);
app.get('/login', serveReact);
app.get('/register', serveReact);
app.get('/cases', serveReact);
app.get('/cases/:id', serveReact);
app.get('/admin', serveReact);
app.get('/invite-redeem', serveReact);
app.get('/trash', serveReact);
app.get('/dashboard', serveReact);
app.get('/suites', serveReact);
app.get('/suites/:id', serveReact);
app.get('/scheduler', serveReact);
app.get('/admin/audit', serveReact);
app.get('/admin/webhooks', serveReact);
app.get('/admin/digest', serveReact);
app.get('/admin/projects', serveReact);
app.get('/visual', serveReact);

// API router — mounted AFTER the HTML page so it owns all the
// /trash/cases, /trash/suites, etc. sub-paths but the bare /trash
// goes to the UI.
app.use('/trash', trashRoutes);

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

// 404 handler for unmatched routes (must come after all real routes)
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Central error handler (must be last)
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
  // Start the scheduler loop after the HTTP server is accepting so the
  // first tick doesn't block boot.
  startScheduler();
  // Hourly sweep that hard-deletes soft-deleted rows past their
  // TRASH_RETENTION_DAYS window. Disabled by TRASH_RETENTION_DAYS=0.
  startTrashPurge();
  // Daily email digest (Feature 2) — opt-in via DIGEST_ENABLED=1.
  startDigestLoop();
});

// Graceful shutdown — clear the tick interval and let in-flight
// requests drain. Registered for both SIGINT (Ctrl+C) and SIGTERM
// (container orchestrators).
const shutdown = (signal) => {
  console.log(`\nReceived ${signal}, shutting down...`);
  stopScheduler();
  stopTrashPurge();
  stopDigestLoop();
  process.exit(0);
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));