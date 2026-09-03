# Postman Collection

This folder contains the Postman artifacts for testing the Test Case Manager API.

## Files

- **`Test-Case-Manager.postman_collection.json`** — the full test collection
- **`Test-Case-Manager.postman_environment.json`** — environment with `baseUrl` and chain variables

## How to import

1. Open Postman
2. Click **Import** (top-left)
3. Drag both JSON files in (or use **File → Import**)
4. Select the **Test Case Manager** environment from the top-right dropdown

## How to run

### Option A — Run all requests in order

1. Make sure your server is running:
   ```bash
   node index.js
   ```
2. In Postman, right-click the collection → **Run collection**
3. Click **Run Test Case Manager API**
4. Watch the **Test Results** tab — each request has assertions that pass/fail

### Option B — Run requests individually

**Every request sets itself up automatically:**

- Collection-level pre-request → auto-registers a fresh user if no token exists
- `Get / Update / Delete test case` → verifies `testCaseId` still exists; if missing or deleted, creates a fresh fixture
- `Get / Update / Delete test suite` → verifies `suiteId` still exists; if missing or deleted, creates a fresh fixture (plus a fresh test case to attach)
- `Create test suite` → always creates a fresh test case to attach

You can run **any single request** in isolation and it will still work — no manual setup needed.

## What's tested

| Folder | Coverage |
|---|---|
| **Auth** | register, login, /me (with + without token), validation errors, bad password |
| **Test Cases** | full CRUD + auth-fail + missing-title + invalid-enum |
| **Test Suites** | full CRUD + missing-name |
| **Misc** | health check, 404 fallback |

## Environment variables used

These get auto-populated as requests run:

- `token` — JWT for the authenticated user
- `userId` / `userEmail` — current user info
- `testCaseId` — last test case ID touched
- `suiteId` — last suite ID touched

You can clear them anytime via Postman's environment editor if you want a fresh state.

## Reset state

To start fresh:

```bash
npm run db:reset    # drops the Postgres volume + reapplies migrations
```

Then re-run the collection.
