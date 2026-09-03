// utils/artifactStore.js — filesystem-backed store for run artifacts.
//
// Phase 8 intentionally uses the local filesystem instead of S3/Redis:
//   - one extra dep avoided
//   - the artifact tree is small (<10 KB per run)
//   - swaps well: every call goes through `artifactDir(runId)` so a future
//     S3 backend only has to override 4 methods
//
// All paths are rooted at <projectRoot>/storage/runs/<runId>/. The
// `storage/` directory is gitignored, so generated spec files + result
// JSON never leak into commits.

const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..', 'storage', 'runs');

const artifactDir = (runId) => path.join(ROOT, String(runId));

// Write a named artifact (e.g. 'stdout.log', 'result.json') under the
// run's directory. Creates the directory if missing. Returns the absolute
// path written.
const writeArtifact = (runId, name, data) => {
  const dir = artifactDir(runId);
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, name);
  if (Buffer.isBuffer(data) || typeof data === 'string') {
    fs.writeFileSync(filePath, data);
  } else {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  }
  return filePath;
};

const artifactPath = (runId, name) => path.join(artifactDir(runId), name);

// Best-effort recursive delete. Used to clean up after errored runs.
// Not throwing because the storage tree is internal to the executor and
// a stale file there is harmless.
const removeArtifacts = (runId) => {
  const dir = artifactDir(runId);
  try {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir)) {
      try { fs.unlinkSync(path.join(dir, entry)); } catch (_) {}
    }
    try { fs.rmdirSync(dir); } catch (_) {}
  } catch (_) {}
};

module.exports = {
  ROOT,
  artifactDir,
  artifactPath,
  writeArtifact,
  removeArtifacts,
};
