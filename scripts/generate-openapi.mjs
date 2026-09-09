// scripts/generate-openapi.js — build docs/openapi.json from the shared
// Zod schemas + a hand-maintained route inventory.
//
// This is the "production" payoff of keeping input validation in
// shared/schemas/: the exact schemas that gate request bodies at the
// server (and drive form validation on the client) are the source of
// truth for the API contract that Swagger UI renders. Change a schema,
// re-run this script, and the docs stay in lock-step — no drift.
//
// Usage:
//   npm run openapi           # writes docs/openapi.json
//   npm run openapi:serve     # validates + prints a summary
//
// The output is intentionally OpenAPI 3.0.x (widest tooling support:
// Swagger UI, Redoc, Postman import, editor.swagger.io).

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { OpenAPIRegistry, OpenApiGeneratorV3 } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

// extendZodWithOpenApi must run BEFORE the shared schemas are imported —
// it patches z.object()/z.enum() etc. with `.openapi()` metadata, and the
// schema modules construct their schemas at import time. Load them via
// dynamic import so this ordering is explicit.
extendZodWithOpenApi(z);

const [
  { testCaseSchema, testCaseUpdateSchema },
  { testSuiteSchema, testSuiteUpdateSchema },
  { registerSchema, loginSchema, updateUserRoleSchema },
  { scheduledJobSchema, scheduledJobUpdateSchema },
] = await Promise.all([
  import('../shared/schemas/testCase.js'),
  import('../shared/schemas/testSuite.js'),
  import('../shared/schemas/auth.js'),
  import('../shared/schemas/scheduledJob.js'),
]);

const registry = new OpenAPIRegistry();

// ---------------------------------------------------------------------------
// Reusable component schemas (the shared single source of truth)
// ---------------------------------------------------------------------------
registry.register('TestCase', testCaseSchema.partial().passthrough());
registry.register('TestCaseUpdate', testCaseUpdateSchema);
registry.register('TestSuite', testSuiteSchema);
registry.register('TestSuiteUpdate', testSuiteUpdateSchema);
registry.register('RegisterRequest', registerSchema);
registry.register('LoginRequest', loginSchema);
registry.register('UpdateUserRole', updateUserRoleSchema);
registry.register('ScheduledJob', scheduledJobSchema);
registry.register('ScheduledJobUpdate', scheduledJobUpdateSchema);

// Auth + common error payloads (hand-authored, not shared-schema — they're
// response shapes, not input-validation schemas).
registry.registerComponent('schemas', 'User', {
  type: 'object',
  properties: {
    id: { type: 'integer' },
    email: { type: 'string', format: 'email' },
    name: { type: 'string' },
    role: { type: 'string', enum: ['admin', 'editor', 'viewer'] },
  },
});

registry.registerComponent('schemas', 'AuthResponse', {
  type: 'object',
  required: ['user', 'token'],
  properties: {
    user: { $ref: '#/components/schemas/User' },
    token: { type: 'string' },
  },
});

registry.registerComponent('schemas', 'Error', {
  type: 'object',
  properties: {
    error: { type: 'string', description: 'Human-readable failure reason' },
    details: {
      type: 'array',
      items: { type: 'string' },
      description: 'Field-level validation messages (present on 400)',
    },
  },
});

registry.registerComponent('schemas', 'Run', {
  type: 'object',
  properties: {
    id: { type: 'integer' },
    test_case_id: { type: 'integer' },
    status: { type: 'string', enum: ['not_run', 'running', 'passed', 'failed', 'errored'] },
    started_at: { type: 'string', format: 'date-time' },
    finished_at: { type: 'string', format: 'date-time', nullable: true },
    duration_ms: { type: 'integer', nullable: true },
    notes: { type: 'string', nullable: true },
    run_by_id: { type: 'integer', nullable: true },
    error_log: { type: 'string', nullable: true },
    assertion_count: { type: 'integer', nullable: true },
    exit_code: { type: 'integer', nullable: true },
    started_via: { type: 'string', enum: ['manual', 'scheduled', 'api'], nullable: true },
  },
});

registry.registerComponent('schemas', 'TestCaseDetail', {
  type: 'object',
  properties: {
    id: { type: 'integer' },
    title: { type: 'string' },
    description: { type: 'string' },
    steps: { type: 'array', items: { type: 'string' } },
    expected_result: { type: 'string' },
    status: { type: 'string', enum: ['draft', 'active', 'deprecated'] },
    priority: { type: 'string', enum: ['low', 'medium', 'high'] },
    result: { type: 'string', enum: ['not_run', 'passed', 'failed'] },
    tags: { type: 'array', items: { type: 'string' } },
    executable_snippet: { type: 'string', nullable: true },
    last_run_at: { type: 'string', format: 'date-time', nullable: true },
    created_at: { type: 'string', format: 'date-time' },
    updated_at: { type: 'string', format: 'date-time' },
    created_by_id: { type: 'integer', nullable: true },
    flakiness: { type: 'object', nullable: true },
  },
});

// ---------------------------------------------------------------------------
// Security scheme — the entire API except /auth/* and /invites/redeem uses
// a Bearer JWT in the Authorization header.
// ---------------------------------------------------------------------------
registry.registerComponent('securitySchemes', 'BearerAuth', {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
});

// ---------------------------------------------------------------------------
// Route inventory. Each route mirrors the actual Express router mounted in
// index.js (path prefix + method + auth role).
// ---------------------------------------------------------------------------
const bearer = [{ BearerAuth: [] }];

// Helper to describe the common 401/403/404 error responses.
const defaultResponses = {
  401: { description: 'Missing or invalid JWT' },
  403: { description: 'Authenticated but not permitted for this action' },
  404: { description: 'Resource not found' },
};

// ---- /auth ----
registry.registerPath({
  method: 'post',
  path: '/auth/register',
  summary: 'Create an account',
  tags: ['Auth'],
  security: [],
  request: { body: { content: { 'application/json': { schema: { $ref: '#/components/schemas/RegisterRequest' } } } } },
  responses: {
    201: { description: 'Account created; returns user + JWT', content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthResponse' } } } },
    409: { description: 'Email already registered' },
  },
});

registry.registerPath({
  method: 'post',
  path: '/auth/login',
  summary: 'Log in and obtain a JWT',
  tags: ['Auth'],
  security: [],
  request: { body: { content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginRequest' } } } } },
  responses: {
    200: { description: 'Login succeeded; returns user + JWT', content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthResponse' } } } },
    401: { description: 'Invalid email or password' },
  },
});

registry.registerPath({
  method: 'get',
  path: '/auth/me',
  summary: 'Fetch the current user',
  tags: ['Auth'],
  security: bearer,
  responses: {
    200: { description: 'The authenticated user', content: { 'application/json': { schema: { type: 'object', properties: { user: { $ref: '#/components/schemas/User' } } } } } },
    ...defaultResponses,
  },
});

// ---- /users (admin) ----
registry.registerPath({
  method: 'get',
  path: '/users',
  summary: 'List users',
  description: 'Admin only.',
  tags: ['Users'],
  security: bearer,
  responses: { 200: { description: 'Array of users', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/User' } } } } }, ...defaultResponses },
});

registry.registerPath({
  method: 'put',
  path: '/users/{id}/role',
  summary: 'Change a user role',
  description: 'Admin only.',
  tags: ['Users'],
  security: bearer,
  parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
  request: { body: { content: { 'application/json': { schema: { $ref: '#/components/schemas/UpdateUserRole' } } } } },
  responses: {
    200: { description: 'Updated user', content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } } },
    400: { description: 'Cannot demote yourself out of admin' },
    ...defaultResponses,
  },
});

registry.registerPath({
  method: 'delete',
  path: '/users/{id}',
  summary: 'Delete a user',
  description: 'Admin only. Hard delete.',
  tags: ['Users'],
  security: bearer,
  parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
  responses: { 204: { description: 'Deleted' }, 400: { description: 'Cannot delete yourself' }, ...defaultResponses },
});

// ---- /test-cases ----
registry.registerPath({
  method: 'post',
  path: '/test-cases',
  summary: 'Create a test case',
  description: 'Editor + admin. Snapshots an initial version.',
  tags: ['Test Cases'],
  security: bearer,
  request: { body: { content: { 'application/json': { schema: { $ref: '#/components/schemas/TestCase' } } } } },
  responses: {
    201: { description: 'Created case', content: { 'application/json': { schema: { $ref: '#/components/schemas/TestCaseDetail' } } } },
    400: { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
    ...defaultResponses,
  },
});

registry.registerPath({
  method: 'get',
  path: '/test-cases',
  summary: 'List non-deleted test cases',
  tags: ['Test Cases'],
  security: bearer,
  responses: { 200: { description: 'Array of cases', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/TestCaseDetail' } } } } }, ...defaultResponses },
});

registry.registerPath({
  method: 'get',
  path: '/test-cases/{id}',
  summary: 'Fetch one test case',
  tags: ['Test Cases'],
  security: bearer,
  parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
  responses: { 200: { description: 'The case', content: { 'application/json': { schema: { $ref: '#/components/schemas/TestCaseDetail' } } } }, ...defaultResponses },
});

registry.registerPath({
  method: 'put',
  path: '/test-cases/{id}',
  summary: 'Update a test case',
  description: 'Editor + admin; ownership enforced for editors. Snapshots a new version; a non-not_run result also records a TestRun.',
  tags: ['Test Cases'],
  security: bearer,
  parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
  request: { body: { content: { 'application/json': { schema: { $ref: '#/components/schemas/TestCaseUpdate' } } } } },
  responses: { 200: { description: 'Updated case', content: { 'application/json': { schema: { $ref: '#/components/schemas/TestCaseDetail' } } } }, ...defaultResponses },
});

registry.registerPath({
  method: 'delete',
  path: '/test-cases/{id}',
  summary: 'Soft-delete a test case',
  description: 'Editor + admin; ownership enforced for editors. Moves the case to /trash.',
  tags: ['Test Cases'],
  security: bearer,
  parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
  responses: { 204: { description: 'Soft-deleted' }, ...defaultResponses },
});

// ---- flakiness ----
registry.registerPath({
  method: 'get',
  path: '/test-cases/flaky',
  summary: 'List cases above a flakiness threshold',
  tags: ['Test Cases'],
  security: bearer,
  parameters: [{ name: 'threshold', in: 'query', required: false, schema: { type: 'integer', minimum: 0, maximum: 100, default: 50 } }],
  responses: { 200: { description: 'Flaky case summaries', content: { 'application/json': { schema: { type: 'object', properties: { threshold: { type: 'integer' }, count: { type: 'integer' }, cases: { type: 'array', items: { type: 'object' } } } } } } }, ...defaultResponses },
});

registry.registerPath({
  method: 'get',
  path: '/test-cases/{id}/flakiness',
  summary: 'Full flakiness report for one case',
  tags: ['Test Cases'],
  security: bearer,
  parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
  responses: { 200: { description: 'Score + verdict + signals' }, ...defaultResponses },
});

// ---- /test-cases/:id/versions ----
registry.registerPath({
  method: 'get',
  path: '/test-cases/{caseId}/versions',
  summary: 'List version history for a case',
  tags: ['Versions'],
  security: bearer,
  parameters: [{ name: 'caseId', in: 'path', required: true, schema: { type: 'integer' } }],
  responses: { 200: { description: 'Version summaries (no snapshots)' }, ...defaultResponses },
});

registry.registerPath({
  method: 'get',
  path: '/test-cases/{caseId}/versions/{versionId}',
  summary: 'Fetch one version + its snapshot',
  tags: ['Versions'],
  security: bearer,
  parameters: [
    { name: 'caseId', in: 'path', required: true, schema: { type: 'integer' } },
    { name: 'versionId', in: 'path', required: true, schema: { type: 'integer' } },
  ],
  responses: { 200: { description: 'Version detail with full snapshot' }, ...defaultResponses },
});

registry.registerPath({
  method: 'get',
  path: '/test-cases/{caseId}/versions/{fromVersion}/diff/{toVersion}',
  summary: 'Field-by-field diff between two versions',
  tags: ['Versions'],
  security: bearer,
  parameters: [
    { name: 'caseId', in: 'path', required: true, schema: { type: 'integer' } },
    { name: 'fromVersion', in: 'path', required: true, schema: { type: 'integer' } },
    { name: 'toVersion', in: 'path', required: true, schema: { type: 'integer' } },
  ],
  responses: { 200: { description: 'Diff response' }, ...defaultResponses },
});

registry.registerPath({
  method: 'post',
  path: '/test-cases/{caseId}/versions/{versionId}/restore',
  summary: 'Restore a case from a version',
  description: 'Admin + editor. Snapshots the post-restore state.',
  tags: ['Versions'],
  security: bearer,
  parameters: [
    { name: 'caseId', in: 'path', required: true, schema: { type: 'integer' } },
    { name: 'versionId', in: 'path', required: true, schema: { type: 'integer' } },
  ],
  responses: { 200: { description: 'Restored case', content: { 'application/json': { schema: { $ref: '#/components/schemas/TestCaseDetail' } } } }, ...defaultResponses },
});

// ---- runs ----
registry.registerPath({
  method: 'post',
  path: '/test-cases/{id}/runs',
  summary: 'Start a run for a case',
  description: 'Admin + editor.',
  tags: ['Runs'],
  security: bearer,
  parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
  responses: { 201: { description: 'Created run', content: { 'application/json': { schema: { $ref: '#/components/schemas/Run' } } } }, ...defaultResponses },
});

registry.registerPath({
  method: 'put',
  path: '/test-cases/{id}/runs/{runId}',
  summary: 'Finish / update a run',
  description: 'Admin + editor.',
  tags: ['Runs'],
  security: bearer,
  parameters: [
    { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
    { name: 'runId', in: 'path', required: true, schema: { type: 'integer' } },
  ],
  request: { body: { content: { 'application/json': { schema: { type: 'object', properties: { status: { type: 'string', enum: ['not_run', 'running', 'passed', 'failed', 'errored'] }, notes: { type: 'string' }, error_log: { type: 'string' }, assertion_count: { type: 'integer' }, exit_code: { type: 'integer' }, started_via: { type: 'string' } } } } } } },
  responses: { 200: { description: 'Updated run', content: { 'application/json': { schema: { $ref: '#/components/schemas/Run' } } } }, ...defaultResponses },
});

registry.registerPath({
  method: 'get',
  path: '/test-cases/{id}/runs',
  summary: 'List runs for a case',
  tags: ['Runs'],
  security: bearer,
  parameters: [
    { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
    { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 } },
  ],
  responses: { 200: { description: 'Recent runs, newest first', content: { 'application/json': { schema: { type: 'object', properties: { count: { type: 'integer' }, runs: { type: 'array', items: { $ref: '#/components/schemas/Run' } } } } } } }, ...defaultResponses },
});

registry.registerPath({
  method: 'get',
  path: '/runs/recent',
  summary: 'Recent runs across all cases',
  description: 'Dashboard feed.',
  tags: ['Runs'],
  security: bearer,
  parameters: [
    { name: 'days', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 365, default: 7 } },
    { name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 200, default: 50 } },
  ],
  responses: { 200: { description: 'Recent runs' }, ...defaultResponses },
});

// ---- execution (Phase 8) ----
registry.registerPath({
  method: 'post',
  path: '/test-cases/{id}/execute',
  summary: 'Run a case Cypress snippet',
  description: 'Admin + editor. Creates a TestRun (status running) and spawns a real Cypress run in the background; stream progress via GET /runs/{id}/stream.',
  tags: ['Execution'],
  security: bearer,
  parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
  responses: {
    201: { description: 'Run started', content: { 'application/json': { schema: { $ref: '#/components/schemas/Run' } } } },
    400: { description: 'Case has no executable snippet' },
    ...defaultResponses,
  },
});

registry.registerPath({
  method: 'get',
  path: '/runs/{id}/stream',
  summary: 'SSE stream of run progress',
  description: 'Long-lived Server-Sent Events feed. Any authenticated user may watch.',
  tags: ['Execution'],
  security: bearer,
  parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
  responses: { 200: { description: 'text/event-stream of snapshot/stdout/stderr/progress/done events' }, ...defaultResponses },
});

// ---- /test-suites ----
registry.registerPath({
  method: 'post',
  path: '/test-suites',
  summary: 'Create a test suite',
  description: 'Editor + admin.',
  tags: ['Suites'],
  security: bearer,
  request: { body: { content: { 'application/json': { schema: { $ref: '#/components/schemas/TestSuite' } } } } },
  responses: { 201: { description: 'Created suite' }, ...defaultResponses },
});

registry.registerPath({
  method: 'get',
  path: '/test-suites',
  summary: 'List non-deleted suites',
  tags: ['Suites'],
  security: bearer,
  responses: { 200: { description: 'Array of suites' }, ...defaultResponses },
});

registry.registerPath({
  method: 'get',
  path: '/test-suites/{id}',
  summary: 'Fetch one suite',
  tags: ['Suites'],
  security: bearer,
  parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
  responses: { 200: { description: 'The suite' }, ...defaultResponses },
});

registry.registerPath({
  method: 'put',
  path: '/test-suites/{id}',
  summary: 'Update a suite',
  description: 'Editor + admin.',
  tags: ['Suites'],
  security: bearer,
  parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
  request: { body: { content: { 'application/json': { schema: { $ref: '#/components/schemas/TestSuiteUpdate' } } } } },
  responses: { 200: { description: 'Updated suite' }, ...defaultResponses },
});

registry.registerPath({
  method: 'delete',
  path: '/test-suites/{id}',
  summary: 'Soft-delete a suite',
  description: 'Editor + admin.',
  tags: ['Suites'],
  security: bearer,
  parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
  responses: { 204: { description: 'Soft-deleted' }, ...defaultResponses },
});

registry.registerPath({
  method: 'post',
  path: '/test-suites/{id}/run',
  summary: 'Run all cases in a suite',
  description: 'Editor + admin. Marks every live member case as the target result and records one run each.',
  tags: ['Suites'],
  security: bearer,
  parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
  request: { body: { content: { 'application/json': { schema: { type: 'object', properties: { result: { type: 'string', enum: ['passed', 'failed'], default: 'passed' } } } } } } },
  responses: { 200: { description: 'Update count' } },
});

// ---- /scheduled-jobs ----
registry.registerPath({
  method: 'get',
  path: '/scheduled-jobs',
  summary: 'List scheduled jobs',
  description: 'Any authenticated user.',
  tags: ['Scheduler'],
  security: bearer,
  responses: { 200: { description: 'Array of jobs' }, ...defaultResponses },
});

registry.registerPath({
  method: 'get',
  path: '/scheduled-jobs/{id}',
  summary: 'Fetch one scheduled job',
  tags: ['Scheduler'],
  security: bearer,
  parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
  responses: { 200: { description: 'The job' }, ...defaultResponses },
});

registry.registerPath({
  method: 'get',
  path: '/scheduled-jobs/{id}/history',
  summary: 'Fire history for a job',
  description: 'Reads audit_events for scheduled_job.fire.',
  tags: ['Scheduler'],
  security: bearer,
  parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
  responses: { 200: { description: 'Recent fire events' }, ...defaultResponses },
});

registry.registerPath({
  method: 'post',
  path: '/scheduled-jobs',
  summary: 'Create a scheduled job',
  description: 'Admin only.',
  tags: ['Scheduler'],
  security: bearer,
  request: { body: { content: { 'application/json': { schema: { $ref: '#/components/schemas/ScheduledJob' } } } } },
  responses: { 201: { description: 'Created job' }, 400: { description: 'Invalid suite_id or cron expression' }, ...defaultResponses },
});

registry.registerPath({
  method: 'patch',
  path: '/scheduled-jobs/{id}',
  summary: 'Update a scheduled job',
  description: 'Admin only.',
  tags: ['Scheduler'],
  security: bearer,
  parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
  request: { body: { content: { 'application/json': { schema: { $ref: '#/components/schemas/ScheduledJobUpdate' } } } } },
  responses: { 200: { description: 'Updated job' }, ...defaultResponses },
});

registry.registerPath({
  method: 'delete',
  path: '/scheduled-jobs/{id}',
  summary: 'Delete a scheduled job',
  description: 'Admin only.',
  tags: ['Scheduler'],
  security: bearer,
  parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
  responses: { 204: { description: 'Deleted' }, ...defaultResponses },
});

registry.registerPath({
  method: 'post',
  path: '/scheduled-jobs/{id}/run',
  summary: 'Run a scheduled job now',
  description: 'Admin only. Fire-and-forget of the job suite.',
  tags: ['Scheduler'],
  security: bearer,
  parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
  responses: { 200: { description: 'Fire result' }, ...defaultResponses },
});

// ---- /trash ----
registry.registerPath({
  method: 'get',
  path: '/trash/cases',
  summary: 'List soft-deleted cases',
  description: 'Any authenticated user.',
  tags: ['Trash'],
  security: bearer,
  responses: { 200: { description: 'Trashed cases' } },
});

registry.registerPath({
  method: 'get',
  path: '/trash/suites',
  summary: 'List soft-deleted suites',
  tags: ['Trash'],
  security: bearer,
  responses: { 200: { description: 'Trashed suites' } },
});

registry.registerPath({
  method: 'post',
  path: '/trash/cases/{id}/restore',
  summary: 'Restore a trashed case',
  description: 'Admin only.',
  tags: ['Trash'],
  security: bearer,
  parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
  responses: { 200: { description: 'Restored case' } },
});

registry.registerPath({
  method: 'post',
  path: '/trash/suites/{id}/restore',
  summary: 'Restore a trashed suite',
  description: 'Admin only.',
  tags: ['Trash'],
  security: bearer,
  parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
  responses: { 200: { description: 'Restored suite' } },
});

registry.registerPath({
  method: 'delete',
  path: '/trash/cases/{id}',
  summary: 'Purge a trashed case',
  description: 'Admin only. Permanent hard delete.',
  tags: ['Trash'],
  security: bearer,
  parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
  responses: { 204: { description: 'Purged' } },
});

registry.registerPath({
  method: 'delete',
  path: '/trash/suites/{id}',
  summary: 'Purge a trashed suite',
  description: 'Admin only. Permanent hard delete.',
  tags: ['Trash'],
  security: bearer,
  parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
  responses: { 204: { description: 'Purged' } },
});

// ---- /audit (admin) ----
registry.registerPath({
  method: 'get',
  path: '/audit',
  summary: 'Query the audit log',
  description: 'Admin only.',
  tags: ['Audit'],
  security: bearer,
  parameters: [
    { name: 'actor_id', in: 'query', required: false, schema: { type: 'integer' } },
    { name: 'target_type', in: 'query', required: false, schema: { type: 'string' } },
    { name: 'target_id', in: 'query', required: false, schema: { type: 'integer' } },
    { name: 'action', in: 'query', required: false, schema: { type: 'string' } },
    { name: 'limit', in: 'query', required: false, schema: { type: 'integer', default: 50 } },
    { name: 'offset', in: 'query', required: false, schema: { type: 'integer', default: 0 } },
  ],
  responses: { 200: { description: 'Paginated audit events' }, ...defaultResponses },
});

registry.registerPath({
  method: 'get',
  path: '/audit/actions',
  summary: 'Distinct audit actions',
  description: 'Admin only.',
  tags: ['Audit'],
  security: bearer,
  responses: { 200: { description: 'Sorted action names' } },
});

// ---- /invites ----
registry.registerPath({
  method: 'get',
  path: '/invites',
  summary: 'List invites',
  description: 'Admin only.',
  tags: ['Invites'],
  security: bearer,
  parameters: [{ name: 'status', in: 'query', required: false, schema: { type: 'string', enum: ['pending', 'accepted', 'expired'] } }],
  responses: { 200: { description: 'Invites' }, ...defaultResponses },
});

registry.registerPath({
  method: 'post',
  path: '/invites',
  summary: 'Create an invite',
  description: 'Admin only. Returns the token + accept URL.',
  tags: ['Invites'],
  security: bearer,
  request: { body: { content: { 'application/json': { schema: { type: 'object', required: ['email'], properties: { email: { type: 'string', format: 'email' }, role: { type: 'string', enum: ['admin', 'editor', 'viewer'] } } } } } } },
  responses: { 201: { description: 'Created invite with token' }, ...defaultResponses },
});

registry.registerPath({
  method: 'post',
  path: '/invites/redeem',
  summary: 'Redeem an invite',
  description: 'Public. Creates the user from the invite email, returns a JWT.',
  tags: ['Invites'],
  security: [],
  request: { body: { content: { 'application/json': { schema: { type: 'object', required: ['token', 'name', 'password'], properties: { token: { type: 'string' }, name: { type: 'string' }, password: { type: 'string' } } } } } } },
  responses: {
    201: { description: 'Account created', content: { 'application/json': { schema: { $ref: '#/components/schemas/AuthResponse' } } } },
    404: { description: 'Invite not found' },
    410: { description: 'Invite used or expired' },
    409: { description: 'Email already registered' },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/invites/{id}',
  summary: 'Revoke an invite',
  description: 'Admin only.',
  tags: ['Invites'],
  security: bearer,
  parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
  responses: { 204: { description: 'Revoked' }, ...defaultResponses },
});

// ---- health (public) ----
registry.registerPath({
  method: 'get',
  path: '/health',
  summary: 'Liveness check',
  tags: ['System'],
  security: [],
  responses: { 200: { description: 'ok', content: { 'application/json': { schema: { type: 'object', properties: { status: { type: 'string', enum: ['ok'] } } } } } } },
});

// ---------------------------------------------------------------------------
// Generate the document
// ---------------------------------------------------------------------------
const generator = new OpenApiGeneratorV3(registry.definitions);

const document = generator.generateDocument({
  openapi: '3.0.0',
  info: {
    title: 'Regress — Test Case Manager API',
    version: '1.0.0',
    description:
      'REST API for the Regress test-management platform: test cases, suites, runs, version history, flakiness, scheduled jobs, RBAC, audit log, soft-delete/trash, invites, and real Cypress execution.\n\n' +
      'Except where marked public (`/auth/*`, `/invites/redeem`, `/health`), every endpoint requires an `Authorization: Bearer <JWT>` header. Roles: `admin`, `editor`, `viewer`.',
  },
  servers: [
    { url: 'http://localhost:3001', description: 'Local / default' },
  ],
  tags: [
    { name: 'Auth', description: 'Registration, login, current user' },
    { name: 'Users', description: 'Admin-only user administration' },
    { name: 'Test Cases', description: 'Case CRUD + flakiness' },
    { name: 'Versions', description: 'Append-only case history + diff + restore' },
    { name: 'Runs', description: 'Append-only run history' },
    { name: 'Execution', description: 'Real Cypress execution + SSE streaming' },
    { name: 'Suites', description: 'Suite CRUD + run-all' },
    { name: 'Scheduler', description: 'Cron-based scheduled jobs' },
    { name: 'Trash', description: 'Soft-deleted resource recovery' },
    { name: 'Audit', description: 'Admin audit log' },
    { name: 'Invites', description: 'Invite-only registration' },
    { name: 'System', description: 'Health' },
  ],
  components: {
    securitySchemes: {
      BearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
  },
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const outPath = resolve(__dirname, '..', 'docs', 'openapi.json');
writeFileSync(outPath, JSON.stringify(document, null, 2) + '\n', 'utf8');

// Quick self-check summary.
const paths = document.paths || {};
const methodCount = Object.values(paths).reduce(
  (acc, ops) =>
    acc +
    Object.keys(ops).filter((k) => ['get', 'post', 'put', 'patch', 'delete'].includes(k)).length,
  0,
);
console.log(`Wrote ${outPath}`);
console.log(`  paths: ${Object.keys(paths).length}, operations: ${methodCount}`);
console.log(`  component schemas: ${Object.keys(document.components?.schemas || {}).length}`);
