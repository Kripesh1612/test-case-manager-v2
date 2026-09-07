// =============================================================================
// Unit tests for utils/executor.js — the narrow surface that doesn't need
// the Postgres/Cypress harness to verify.
//
// We test the pure `caseResultFromRunStatus` mapping only. The full
// executeCase() flow is exercised end-to-end by the Cypress API/UI tests;
// here we pin the contract between run-status and case-result so a future
// refactor of `finalize()` can't silently regress it.
//
// Run: npm run test:unit
// =============================================================================

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { caseResultFromRunStatus, _buildCypressArgs } = require('./executor');

// ---- caseResultFromRunStatus ---------------------------------------------

test('caseResultFromRunStatus: "passed" → "passed"', () => {
  assert.equal(caseResultFromRunStatus('passed'), 'passed');
});

test('caseResultFromRunStatus: "failed" → "failed"', () => {
  assert.equal(caseResultFromRunStatus('failed'), 'failed');
});

test('caseResultFromRunStatus: "errored" → null (does not clobber case pill)', () => {
  // A Cypress crash mid-run is NOT an assertion verdict, so the case
  // should keep whatever pill it had before. null tells finalize() to
  // skip the TestCase.update entirely.
  assert.equal(caseResultFromRunStatus('errored'), null);
});

test('caseResultFromRunStatus: "running" → null (no terminal state)', () => {
  assert.equal(caseResultFromRunStatus('running'), null);
});

test('caseResultFromRunStatus: "not_run" → null (not terminal)', () => {
  assert.equal(caseResultFromRunStatus('not_run'), null);
});

test('caseResultFromRunStatus: only "passed" and "failed" produce pill updates', () => {
  // Sweep every plausible TestRun.status value and assert that exactly
  // the two terminal verdicts produce a string (the others produce
  // null). Guards against future enum widening accidentally mapping a
  // non-verdict status onto the case pill.
  const cases = ['passed', 'failed', 'errored', 'running', 'not_run', 'queued', '', null, undefined];
  const truthy = cases.filter((s) => caseResultFromRunStatus(s) != null);
  assert.deepEqual(truthy.sort(), ['failed', 'passed']);
});

// ---- _buildCypressArgs (regression for the argv shape) ------------------

test('_buildCypressArgs: emits the canonical 7-arg invocation', () => {
  const argv = _buildCypressArgs('/tmp/spec.cy.js', '/tmp/result.json');
  // Pin the structure so a Cypress version bump doesn't silently change
  // what we spawn. Order matters for Cypress's CLI parser.
  assert.deepEqual(argv.slice(0, 3), ['run', '--project', expectProjectRoot()]);
  assert.equal(argv[argv.indexOf('--spec') + 1], '/tmp/spec.cy.js');
  assert.equal(argv[argv.indexOf('--browser') + 1], 'electron');
  assert.equal(argv[argv.indexOf('--reporter') + 1], 'json');
  const reporterOpts = argv[argv.indexOf('--reporter-options') + 1];
  assert.equal(reporterOpts, 'output=/tmp/result.json');
  const config = argv[argv.indexOf('--config') + 1];
  assert.match(config, /e2e\.baseUrl=http:\/\/localhost:\d+/);
  assert.match(config, /video=false/);
  assert.match(config, /screenshotOnRunFailure=false/);
});

// Helper: _buildCypressArgs embeds the absolute path of the repo root.
// We resolve it the same way the source code does so this stays valid
// even if the working directory changes.
function expectProjectRoot() {
  return require('path').resolve(__dirname, '..');
}
