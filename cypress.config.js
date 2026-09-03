const { defineConfig } = require('cypress');

module.exports = defineConfig({
  e2e: {
    // The API + UI both run on this port (matches PORT in the server).
    baseUrl: 'http://localhost:3001',

    // Where Cypress looks for specs.
    specPattern: 'cypress/e2e/**/*.cy.{js,jsx,ts,tsx}',

    supportFile: 'cypress/support/e2e.js',
    fixturesFolder: 'cypress/fixtures',
    screenshotsFolder: 'cypress/screenshots',
    videosFolder: 'cypress/videos',

    // Default viewport for the desktop-class flows we test.
    viewportWidth: 1280,
    viewportHeight: 800,

    defaultCommandTimeout: 8000,
    requestTimeout: 10000,

    // Don't record video by default (set to true in CI).
    video: false,
    screenshotOnRunFailure: true,

    // Keep localStorage between tests so auth set in `before()` survives
    // into subsequent `beforeEach()` calls. The Cypress default wipes
    // storage between tests, which breaks every multi-test describe block
    // that depends on a logged-in session.
    testIsolation: false,
  },
});
