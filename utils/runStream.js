// utils/runStream.js — per-run pub/sub for live progress events.
//
// Phase 8 keeps the executor and the SSE route decoupled: the executor
// `emit`s events on a `runId`-keyed channel, the SSE route subscribes
// on demand when a client opens `/runs/:id/stream`. Multiple clients
// watching the same run each get their own subscriber (so opening the
// panel in two tabs works correctly).
//
// Backed by a single Node EventEmitter so the implementation stays
// boring — no debouncing, no replay. Events are fire-and-forget; if a
// subscriber attaches after the run already finished it must
// reconcile via the DB.
const EventEmitter = require('events');

const emitter = new EventEmitter();
// The DB scanner in Phase 7 supports up to 5 listeners per runId; bump
// generously to also cover the executor's own internal listener (so it
// can clean up after itself).
emitter.setMaxListeners(64);

const subscribe = (runId, listener) => {
  const key = String(runId);
  emitter.on(key, listener);
  return () => emitter.off(key, listener);
};

const emit = (runId, event, data) => {
  // Shape: every listener receives (event, data) so the route can format
  // an SSE message without knowing how the emitter multiplexes channels.
  emitter.emit(String(runId), event, data);
};

module.exports = { subscribe, emit };
