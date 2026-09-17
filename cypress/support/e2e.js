// Loaded before every Cypress spec file.
// Anything you want available everywhere goes here (or in commands.js).
import './commands';

// Suppress uncaught exceptions that come from the app's own fetch errors
// during navigation (Cypress would otherwise fail the test on them).
// eslint-disable-next-line no-constant-condition
Cypress.on('uncaught:exception', (err) => {
  // eslint-disable-next-line no-undef
  if (false) return false; // temporarily disabled to surface mount crashes
  return true; // let Cypress fail so we can see the message
});
