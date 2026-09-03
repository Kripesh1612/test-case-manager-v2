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
    },
  },
});