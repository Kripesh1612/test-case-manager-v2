// =============================================================================
// Custom Cypress commands.
//
// The point of these commands is to make the test specs read like user intent,
// not like low-level fetch plumbing. e.g.:
//
//   cy.loginAsAdmin()                 // not: cy.request('POST', '/auth/login', ...)
//   cy.createTestCase(token, { ... }) // not: cy.request('POST', '/test-cases', ...)
// =============================================================================

// ----- Auth -----

// Register a fresh, unique user. Returns { email, password, user, token }.
Cypress.Commands.add('register', (overrides = {}) => {
  const email = overrides.email || `cy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = overrides.password || 'password123';
  const name = overrides.name || 'Cypress User';

  return cy
    .request({
      method: 'POST',
      url: '/auth/register',
      body: { email, password, name },
    })
    .then((resp) => ({
      email,
      password,
      name,
      user: resp.body.user,
      token: resp.body.token,
    }));
});

// Login an existing user. Returns { email, user, token }.
Cypress.Commands.add('login', (email, password = 'password123') => {
  return cy
    .request({
      method: 'POST',
      url: '/auth/login',
      body: { email, password },
    })
    .then((resp) => ({
      email,
      user: resp.body.user,
      token: resp.body.token,
    }));
});

// Login as the test admin. Idempotent: registers the admin user if it
// doesn't exist yet, then logs in. This makes every spec self-sufficient —
// no dependency on a specific spec-execution order to seed the user.
Cypress.Commands.add('loginAsAdmin', () => {
  const email = 'cypress-admin@tcm.com';
  const password = 'password123';
  // Try to register; 409 means the user already exists, which is fine.
  return cy
    .request({
      method: 'POST',
      url: '/auth/register',
      body: { email, password, name: 'Cypress Admin' },
      failOnStatusCode: false,
    })
    .then(() => cy.login(email, password));
});

// Set the token + user in localStorage so the next page load is already authed.
Cypress.Commands.add('setAuthInBrowser', (user, token) => {
  cy.visit('/login'); // need to be on the same origin to touch localStorage
  cy.window().then((win) => {
    win.localStorage.setItem('tcm_token', token);
    win.localStorage.setItem('tcm_user', JSON.stringify(user));
  });
});

// Wipe auth so the next page load bounces to /login.
Cypress.Commands.add('clearAuth', () => {
  cy.window().then((win) => {
    win.localStorage.removeItem('tcm_token');
    win.localStorage.removeItem('tcm_user');
  });
});

// ----- Test data factories (use the API so the DB has the data) -----

Cypress.Commands.add('createTestCase', (token, data = {}) => {
  return cy
    .request({
      method: 'POST',
      url: '/test-cases',
      headers: { Authorization: `Bearer ${token}` },
      body: {
        title: data.title || `Cypress case ${Date.now()}`,
        description: data.description || 'Created by Cypress',
        steps: data.steps || ['Open app', 'Do thing'],
        expected_result: data.expected_result || 'Works',
        status: data.status || 'draft',
        priority: data.priority || 'medium',
        tags: data.tags || [],
        ...data,
      },
    })
    .then((resp) => resp.body);
});

Cypress.Commands.add('createTestSuite', (token, data = {}) => {
  return cy
    .request({
      method: 'POST',
      url: '/test-suites',
      headers: { Authorization: `Bearer ${token}` },
      body: {
        name: data.name || `Cypress suite ${Date.now()}`,
        description: data.description || '',
        test_case_ids: data.test_case_ids || [],
        ...data,
      },
    })
    .then((resp) => resp.body);
});

Cypress.Commands.add('deleteTestCase', (token, id) => {
  return cy.request({
    method: 'DELETE',
    url: `/test-cases/${id}`,
    headers: { Authorization: `Bearer ${token}` },
    failOnStatusCode: false,
  });
});

Cypress.Commands.add('deleteTestSuite', (token, id) => {
  return cy.request({
    method: 'DELETE',
    url: `/test-suites/${id}`,
    headers: { Authorization: `Bearer ${token}` },
    failOnStatusCode: false,
  });
});

// Promote a user to a specific role via the admin endpoint.
// Throws if the caller is not an admin.
Cypress.Commands.add('setUserRole', (adminToken, userId, role) => {
  return cy
    .request({
      method: 'PUT',
      url: `/users/${userId}/role`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { role },
    })
    .then((resp) => resp.body);
});

// ----- Auth header for ad-hoc API calls in tests -----
// Usage:
//   cy.api(token).then((api) => api.get('/test-cases'))
//   cy.api(token).then((api) => api.post('/test-cases', { title: 'x' }))
Cypress.Commands.add('api', (token) => {
  const auth = token ? { Authorization: `Bearer ${token}` } : {};
  return {
    get: (url, opts = {}) => cy.request({ method: 'GET', url, headers: auth, ...opts }),
    post: (url, body, opts = {}) => cy.request({ method: 'POST', url, headers: auth, body, ...opts }),
    put: (url, body, opts = {}) => cy.request({ method: 'PUT', url, headers: auth, body, ...opts }),
    delete: (url, opts = {}) => cy.request({ method: 'DELETE', url, headers: auth, ...opts }),
  };
});
