// utils/executor.js — fire-and-forget runner for `TestCase.executable_snippet`.
//
// Spawns the locally-installed Cypress binary as a child process so the
// parent's event loop stays responsive (SSE clients stay connected while
// the run is in flight). Output is piped to subscribers via runStream
// AND captured in two files inside the run's artifact directory:
//   spec.cy.js    — the generated spec file (deleted on exit)
//   result.json   — the JSON reporter's machine-readable summary
//   stdout.log    — captured child stdout
//   stderr.log    — captured child stderr
//
// Final status mapping (set on the TestRun row after exit):
//   exit=0 + stats.failures=0 → 'passed'
//   exit=0 + stats.failures>0 → 'failed'
//   anything else              → 'errored'
//
// Returns a Promise that resolves once the child exits and the DB row is
// updated. The promise never rejects — executor errors are written to
// the DB and emitted as 'errored' so the SSE stream reaches a terminal
// state.

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const prisma = require('../db');
const runStream = require('./runStream');
const {
  artifactDir,
  artifactPath,
  writeArtifact,
  removeArtifacts,
} = require('./artifactStore');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const CYPRESS_BIN = path.join(PROJECT_ROOT, 'node_modules', '.bin', 'cypress');

// Cypress's bundled baseUrl. Defaults to whatever the app server's PORT
// is. Tests can override with CYPRESS_BASE_URL=...
const baseUrl = () =>
  process.env.CYPRESS_BASE_URL || `http://localhost:${process.env.PORT || 3001}`;

// Spec wrapper. The user's snippet is body of a `describe`, so they can
// write `it('foo', () => { ... })` directly without worrying about the
// test framework plumbing. A leading `//` (comment) is preserved verbatim.
function wrapSnippet(snippet, runId) {
  const header = `// AUTO-GENERATED for run ${runId} — safe to delete.\n`;
  const body = `describe('run ${runId}', () => {\n${snippet}\n});\n`;
  return header + body;
}

async function executeCase({ caseId, runId, snippet, runById: _runById }) {
  // Idempotency guard — if the worker's parent never tracked a run row
  // (impossible in the happy path but worth defending against), bail
  // before spawning anything.
  const existing = await prisma.testRun.findUnique({ where: { id: runId } });
  if (!existing) {
    console.error('[executor] no TestRun row for id', runId, '— bailing');
    runStream.emit(runId, 'done', { status: 'errored', exitCode: -1 });
    return;
  }

  const dir = artifactDir(runId);
  fs.mkdirSync(dir, { recursive: true });
  const specPath = path.join(dir, 'spec.cy.js');
  const resultPath = path.join(dir, 'result.json');

  fs.writeFileSync(specPath, wrapSnippet(snippet || '', runId), 'utf8');
  runStream.emit(runId, 'progress', { phase: 'starting' });

  return new Promise((resolve) => {
    const startedAtMs = Date.now();
    // `--reporter json` writes the run result to file. We let Cypress's
    // bundled `electron` browser handle execution — it's bundled with the
    // npm install so no X server / Chrome dependency is needed.
    const args = [
      'run',
      '--project', PROJECT_ROOT,
      '--spec', specPath,
      '--browser', 'electron',
      '--reporter', 'json',
      '--reporter-options', `output=${resultPath}`,
      '--config',
      `e2e.baseUrl=${baseUrl()},video=false,screenshotOnRunFailure=false`,
    ];

    let child;
    try {
      child = spawn(CYPRESS_BIN, args, { cwd: PROJECT_ROOT, env: process.env });
    } catch (spawnErr) {
      // The most common cause here is the Cypress binary missing —
      // happens if the image was built without `npx cypress install`.
      finishWithError(spawnErr.message);
      return;
    }

    let stdoutBuf = '';
    let stderrBuf = '';

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdoutBuf += text;
      runStream.emit(runId, 'stdout', text);
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderrBuf += text;
      runStream.emit(runId, 'stderr', text);
    });

    const finishWithError = async (msg) => {
      console.error('[executor] run', runId, 'failed:', msg);
      await finalize('errored', null, 1, msg);
    };

    child.on('error', (err) => { finishWithError(err.message); });

    child.on('exit', async (code) => {
      // Always remove the generated spec file. result.json is preserved
      // for debugging — it's tiny.
      try { fs.unlinkSync(specPath); } catch (_) {}

      // Stream is streamed incrementally; emit a final 'progress' so
      // clients can render the transitioning state.
      runStream.emit(runId, 'progress', { phase: 'finishing' });

      // Persist the captured output as named artifacts for later
      // inspection. Cap each at 64KB so a chatty Cypress doesn't fill
      // the disk.
      if (stdoutBuf) writeArtifact(runId, 'stdout.log', stdoutBuf.slice(-64 * 1024));
      if (stderrBuf) writeArtifact(runId, 'stderr.log', stderrBuf.slice(-64 * 1024));

      let result = null;
      try {
        if (fs.existsSync(resultPath)) {
          result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
        }
      } catch (parseErr) {
        console.error('[executor] failed to parse result.json:', parseErr.message);
      }

      const stats = (result && result.stats) || {};
      const totalTests = Number.isInteger(stats.tests) ? stats.tests : null;
      const totalFailures = Number.isInteger(stats.failures) ? stats.failures : 0;

      let status = 'errored';
      if (code === 0 && totalFailures === 0) status = 'passed';
      else if (code === 0 && totalFailures > 0) status = 'failed';
      else if (code !== 0) {
        // Cypress refused to even start (e.g. no spec match). Leave
        // status='errored' but capture the stderr as the error log so
        // the UI can show what went wrong.
      }

      await finalize(status, totalTests, code, null);
    });

    async function finalize(status, assertionCount, code, spawnErrorMsg) {
      const finishedAt = new Date();
      const durationMs = Math.max(0, Date.now() - startedAtMs);

      let errorLog = null;
      if (status === 'errored') {
        const tail = (stderrBuf || stdoutBuf || '').slice(-4 * 1024);
        errorLog = spawnErrorMsg ? `${spawnErrorMsg}\n${tail}` : tail || `exit code ${code}`;
      }

      try {
        const existingNow = await prisma.testRun.findUnique({ where: { id: runId } });
        const startTs = existingNow?.started_at || finishedAt;
        const dbDuration = Math.max(
          0,
          finishedAt.getTime() - new Date(startTs).getTime(),
        );
        await prisma.testRun.update({
          where: { id: runId },
          data: {
            status,
            finished_at: finishedAt,
            duration_ms: dbDuration,
            assertion_count: assertionCount,
            exit_code: typeof code === 'number' ? code : null,
            error_log: errorLog,
          },
        });
        // last_run_at should bump on terminal (passed/failed) too, so
        // the dashboard's "recently executed" sort reflects real activity.
        if (status === 'passed' || status === 'failed') {
          await prisma.testCase.update({
            where: { id: caseId },
            data: { last_run_at: finishedAt },
          });
        }
      } catch (dbErr) {
        // Log but don't crash — the SSE stream MUST emit 'done' so the
        // client knows the run terminated.
        console.error('[executor] DB update failed for run', runId, dbErr.message);
      }

      runStream.emit(runId, 'done', {
        status,
        assertionCount,
        exitCode: code,
        durationMs,
      });
      resolve();
    }
  });
}

// Self-test used by `cypress/e2e/api/12-execution.cy.js` to guarantee
// the spawn argv is well-formed without spinning up a full run.
function _buildCypressArgs(specPath, resultPath) {
  return [
    'run',
    '--project', PROJECT_ROOT,
    '--spec', specPath,
    '--browser', 'electron',
    '--reporter', 'json',
    '--reporter-options', `output=${resultPath}`,
    '--config', `e2e.baseUrl=${baseUrl()},video=false,screenshotOnRunFailure=false`,
  ];
}

module.exports = { executeCase, _buildCypressArgs, wrapSnippet };
