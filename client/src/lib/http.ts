// Centralised axios instance.
//
// baseURL is empty so `http.get('/test-cases')` hits `/test-cases`
// directly — matching what Cypress's `cy.intercept('GET', '/test-cases')`
// patterns expect (Cypress string patterns are exact-match globs).
// In dev, Vite's proxy forwards those paths to Express; in prod, Express
// serves the SPA from client/dist AND its API routes on the same port,
// so the paths line up without a rewrite.
//
// The Bearer token lives in localStorage under 'tcm_token' to match
// what the existing vanilla-JS pages and Cypress tests already read.
// (Cypress tests set this in the browser via `cy.setAuthInBrowser`.)

import axios from 'axios';

export const TOKEN_KEY = 'tcm_token';

export const http = axios.create({
  baseURL: '',
  headers: { 'content-type': 'application/json' },
});

http.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

http.interceptors.response.use(
  (res) => res,
  (err) => {
    // Auto-redirect on 401 — but ONLY if we're not already on a public
    // auth page and the 401 is NOT from /me. Reasoning:
    //
    // - For pages behind ProtectedRoute (/cases, /admin, /dashboard):
    //   a 401 on any endpoint means the token is bad. Clear it, redirect.
    // - For public auth pages (/login, /register, /invite-redeem):
    //   a 401 is expected (the user has no token yet). Don't redirect.
    //
    // We exclude /me from the auto-redirect because /me failures should
    // be handled by useAuth's react-query cache (user goes null →
    // ProtectedRoute bounces). Redirecting on /me 401 races with the
    // page's own auth logic and double-bounces.
    if (err.response?.status === 401) {
      const path = window.location.pathname;
      const onPublicAuthPage =
        path === '/login' || path === '/register' || path === '/invite-redeem';
      const url = err.config?.url ?? '';
      const isMeCall = url === '/auth/me' || url === '/api/auth/me';
      if (!onPublicAuthPage && !isMeCall) {
        localStorage.removeItem(TOKEN_KEY);
        (window as unknown as { __redirectedToLogin?: boolean }).__redirectedToLogin = true;
        window.location.assign('/login');
      } else if (isMeCall) {
        // Just clear the token; useAuth will reflect user=null on next
        // render and ProtectedRoute (if any) will bounce.
        localStorage.removeItem(TOKEN_KEY);
      }
    }
    return Promise.reject(err);
  },
);

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}