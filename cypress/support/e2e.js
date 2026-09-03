// Loaded before every Cypress spec file.
// Anything you want available everywhere goes here (or in commands.js).
import './commands';

// Suppress uncaught exceptions that come from the app's own fetch errors
// during navigation (Cypress would otherwise fail the test on them).
Cypress.on('uncaught:exception', () => false);
