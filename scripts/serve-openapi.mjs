// scripts/serve-openapi.mjs — browse the OpenAPI spec in Swagger UI.
//
// Serves three things on http://localhost:3002:
//   GET /openapi.json        the generated spec
//   GET /                    a Swagger UI page that loads it
//   GET /vendor/*            local copies of swagger-ui-dist assets (works offline)
//
// Purpose: a zero-install way to "try the API" during a capstone demo.
// Point your browser at http://localhost:3002, click "Authorize", paste a
// JWT, and exercise the endpoints live against a running server on :3001.
//
// Usage:
//   npm run openapi:serve        # then open http://localhost:3002

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const specPath = resolve(__dirname, '..', 'docs', 'openapi.json');
const spec = readFileSync(specPath, 'utf8');

// The API server that Swagger UI proxies to. This just tells the UI which
// base URL to prefix requests with; you can override it in the UI's
// "Servers" dropdown.
const API_BASE = process.env.API_BASE || 'http://localhost:3001';
const PORT = process.env.PORT || 3002;

// Vendored Swagger UI assets (npm i -D swagger-ui-dist). Served locally so
// the page renders even with no internet access — no CDN dependency.
const UI_DIST = resolve(__dirname, '..', 'node_modules', 'swagger-ui-dist');

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Regress API — Swagger UI</title>
  <link rel="stylesheet" href="/vendor/swagger-ui.css" />
  <style>
    body { margin: 0; }
    .topbar { display: none; }
  </style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="/vendor/swagger-ui-bundle.js"></script>
  <script>
    window.onload = () => {
      window.ui = SwaggerUIBundle({
        url: '/openapi.json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        persistAuthorization: true,
        supportedSubmitMethods: ['get', 'post', 'put', 'patch', 'delete'],
      });
    };
  </script>
</body>
</html>`;

const MIME = {
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

const server = createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/openapi.json') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(spec);
    return;
  }
  if (url.pathname.startsWith('/vendor/')) {
    const rel = url.pathname.slice('/vendor/'.length);
    const file = resolve(UI_DIST, rel);
    if (!file.startsWith(UI_DIST)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return;
    }
    const ext = extname(file);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(readFileSync(file));
    return;
  }
  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HTML);
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`Swagger UI: http://localhost:${PORT}  (spec targets API_BASE=${API_BASE})`);
});
