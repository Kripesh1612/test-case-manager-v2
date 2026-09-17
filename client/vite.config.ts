import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { defineConfig } from 'vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '@shared': path.resolve(__dirname, '../shared'),
    },
  },
  server: {
    proxy: {
      // Forward each API path to the Express server on :3001. Anything
      // else is served by Vite (React app + HMR). The paths match
      // Express's route mounts exactly (no rewrite) so `http.get(
      // '/test-cases')` from the client hits the same URL the Cypress
      // `cy.intercept('GET', '/test-cases')` patterns expect.
      '/auth':           { target: 'http://localhost:3001', changeOrigin: true },
      '/users':          { target: 'http://localhost:3001', changeOrigin: true },
      '/test-cases':     { target: 'http://localhost:3001', changeOrigin: true },
      '/test-suites':    { target: 'http://localhost:3001', changeOrigin: true },
      '/audit':          { target: 'http://localhost:3001', changeOrigin: true },
      '/invites':        { target: 'http://localhost:3001', changeOrigin: true },
      '/scheduled-jobs': { target: 'http://localhost:3001', changeOrigin: true },
      '/runs':           { target: 'http://localhost:3001', changeOrigin: true },
      '/trash':          { target: 'http://localhost:3001', changeOrigin: true },
      // Phase 4/5 multi-tenant + integrations. These mount-points
      // existed on the Express side (routes/projects.js,
      // routes/webhooks.js, routes/digest.js, routes/visual.js) but
      // were never added to the dev proxy — so a developer running
      // `npm run dev` on the client against a separate backend would
      // see every request to /projects, /webhooks, /digest, /visual
      // hit Vite's default 404 handler instead of the API. Tier2-PR-14
      // fixes that asymmetry.
      '/projects':       { target: 'http://localhost:3001', changeOrigin: true },
      '/webhooks':       { target: 'http://localhost:3001', changeOrigin: true },
      '/digest':         { target: 'http://localhost:3001', changeOrigin: true },
      '/visual':         { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
});