// scripts/openapi-check.mjs — fail if docs/openapi.json is stale.
//
// Compares the freshly-generated spec against the committed one. If they
// differ, exit non-zero and print a unified diff so a CI run fails
// loudly instead of silently shipping a drifted contract.
//
// Usage:
//   npm run openapi:check           # local: same as CI
//   node scripts/openapi-check.mjs  # ditto
//
// The script writes the fresh copy to a temp file so we never touch the
// committed docs/openapi.json. The CI step installs this as the
// "OpenAPI stale check" gate before Cypress runs.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const committed = resolve(here, '..', 'docs', 'openapi.json');

const dir = mkdtempSync(join(tmpdir(), 'openapi-check-'));
const fresh = join(dir, 'openapi.fresh.json');
let exitCode = 0;

try {
  const gen = spawnSync(
    process.execPath,
    [resolve(here, 'generate-openapi.mjs'), '--out', fresh],
    { stdio: 'inherit' }
  );
  if (gen.status !== 0) {
    console.error(`\n[openapi:check] generator exited with status ${gen.status}`);
    process.exit(gen.status ?? 1);
  }

  const a = readFileSync(committed, 'utf8');
  const b = readFileSync(fresh, 'utf8');

  if (a === b) {
    console.log('[openapi:check] docs/openapi.json is up to date.');
    process.exit(0);
  }

  // Diff (unified if available, else byte/line count).
  const diff = spawnSync('diff', ['-u', committed, fresh], { encoding: 'utf8' });
  console.error('\n[openapi:check] docs/openapi.json is STALE.\n');
  console.error(
    'A schema in shared/schemas/ or a route in scripts/generate-openapi.mjs\n' +
      'changed without re-running `npm run openapi`. Run it locally, commit\n' +
      'the regenerated docs/openapi.json, and re-run the check.\n'
  );
  if (diff.stdout) console.error(diff.stdout);
  exitCode = 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}

process.exit(exitCode);
