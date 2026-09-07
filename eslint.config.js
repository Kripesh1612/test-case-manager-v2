// Minimal ESLint config — intentionally narrow.
//
// Scope right now is utils/ and middleware/ (the modules with logic that
// is hard to cover with the Cypress API tests). Routes, the SPA client,
// and Prisma schema are out of scope for the first pass; expanding later
// is a matter of adding paths to the second `files` block.
//
// Conventions enforced:
//   - ES2022 syntax baseline (we run on Node 22).
//   - Single quotes, semicolons, 2-space indent — matches the surrounding
//     code in utils/ and middleware/.
//   - eqeqeq: catches accidental `==` against `null` or `undefined`.
//   - no-unused-vars: the `^` suffix ignores underscore-prefixed args
//     (e.g. `function foo(_unused) { ... }`), which the codebase uses
//     for "intentionally unused" parameters.
//   - no-var + prefer-const: keep the dialect consistent.
//
// We deliberately do NOT enable stylistic rules that would force a
// big reformat (e.g. no-multi-spaces, object-curly-spacing across the
// whole codebase). The goal of this config is to catch real bugs, not
// to re-style 50 files in one PR.

'use strict';

module.exports = [
  {
    files: ['utils/**/*.js', 'middleware/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        // Node globals (subset that's actually used in utils/middleware).
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        module: 'readonly',
        require: 'readonly',
        exports: 'readonly',
        global: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setImmediate: 'readonly',
        clearImmediate: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          // The codebase uses bare `_` as the parameter name for
          // "intentionally unused" — Express middleware signatures
          // (req, res, next), caught-and-ignored errors, fs errparams.
          // `caughtErrors: 'none'` makes ESLint skip that case so we
          // don't have to rename hundreds of them.
          caughtErrors: 'none',
        },
      ],
      'no-var': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'always', { null: 'always' }],
      'no-undef': 'error',
      'no-shadow': 'off',
    },
  },
  {
    // Test files share the same dialect but get a couple of relaxations:
    //   - node:test injects `describe`, `it`, `before`, `after`, etc.
    //     as globals; declare them so we don't trip `no-undef`.
    files: ['utils/**/*.test.js', 'middleware/**/*.test.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        process: 'readonly',
        console: 'readonly',
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        before: 'readonly',
        after: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        // node:test's source-level regression tests read their own
        // source via fs/path so they can grep for literal patterns.
        fs: 'readonly',
        path: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          // The codebase uses bare `_` as the parameter name for
          // "intentionally unused" — Express middleware signatures
          // (req, res, next), caught-and-ignored errors, fs errparams.
          // `caughtErrors: 'none'` makes ESLint skip that case so we
          // don't have to rename hundreds of them.
          caughtErrors: 'none',
        },
      ],
      'no-var': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'always', { null: 'always' }],
      'no-undef': 'error',
    },
  },
];
