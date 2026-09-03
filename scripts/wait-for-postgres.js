#!/usr/bin/env node
// wait-for-postgres — tight loop that exits 0 on first successful TCP
// connect to localhost:5432. Bridges `docker compose up` (async healthcheck)
// and `prisma migrate dev` (synchronous).
//
// Usage: node scripts/wait-for-postgres.js [host] [port] [timeoutMs]

const net = require('net');

const host = process.argv[2] || 'localhost';
const port = parseInt(process.argv[3], 10) || 5432;
const timeoutMs = parseInt(process.argv[4], 10) || 60000;
const start = Date.now();
const interval = 500;

const tryConnect = () =>
  new Promise((resolve, reject) => {
    const sock = net.createConnection({ host, port });
    sock.once('connect', () => { sock.end(); resolve(); });
    sock.once('error', (err) => reject(err));
    // Cap each attempt so a half-open TCP doesn't hang us forever.
    setTimeout(() => { sock.destroy(); reject(new Error('attempt timeout')); }, 2000);
  });

(async () => {
  // eslint-disable-next-line no-console
  console.log(`[wait-for-postgres] polling ${host}:${port} (timeout ${timeoutMs}ms)`);
  while (Date.now() - start < timeoutMs) {
    try {
      await tryConnect();
      // eslint-disable-next-line no-console
      console.log(`[wait-for-postgres] ready after ${Date.now() - start}ms`);
      process.exit(0);
    } catch (_) {
      await new Promise((r) => setTimeout(r, interval));
    }
  }
  // eslint-disable-next-line no-console
  console.error(`[wait-for-postgres] gave up after ${timeoutMs}ms`);
  process.exit(1);
})();
