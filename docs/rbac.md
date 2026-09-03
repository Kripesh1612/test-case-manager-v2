# RBAC: admin / editor / viewer

The app has three roles. Every protected route checks the caller's role on
the server; the UI mirrors the same checks so a viewer can't even *see* the
"New" button.

## The role model

| Role     | Can read | Can write cases/suites | Can manage users | Can read audit log | Can manage invites | Can restore / purge trash |
| -------- | -------- | ---------------------- | ---------------- | ------------------ | ------------------ | ------------------------- |
| `admin`  | ✓        | ✓                      | ✓                | ✓                  | ✓                  | ✓                         |
| `editor` | ✓        | ✓                      | ✗ (403)          | ✗ (403)            | ✗ (403)            | ✗ (403)                   |
| `viewer` | ✓        | ✗ (403)                | ✗ (403)          | ✗ (403)            | ✗ (403)            | ✗ (403)                   |

Anonymous requests return `401`. Wrong-role requests return `403`.

The middle three columns are the additions from the four cross-cutting
mechanisms ([`architecture.md`](./architecture.md)):

- **Audit log access** — only admins can see the canonical "who changed
  what when" timeline. Editors and viewers never reach `/audit`.
- **Invites** — only admins create, list, or revoke. The redeem
  endpoint is public.
- **Trash restore / purge** — only admins. Everyone can *see* the trash
  count, but only admins act on it.

## Where the role lives

- **In the DB** (`User.role` — defaults to `editor`).
- **In the JWT** (signed when the token is issued).
- **In localStorage** on the browser (as part of `tcm_user`).

The middleware re-reads the role from the DB on every request via
`/auth/me`, so an admin promoting a user to viewer takes effect on that
user's *next* request without requiring a re-login.

## How a user becomes an admin

The first admin is bootstrapped from `ADMIN_EMAILS` in `.env`. Anyone
whose email appears in that comma-separated list is created as `admin`
when they register, and is promoted to `admin` on every login (in case the
DB was wiped).

Subsequent admins are promoted via the admin panel at `/admin`, or via
`PUT /users/:id/role` as an existing admin.

## Server-side enforcement

Every router uses a small middleware:

```js
const requireRole = (...allowed) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  if (!allowed.includes(req.user.role)) {
    return res.status(403).json({ error: `Forbidden — role "${req.user.role}" cannot perform this action` });
  }
  next();
};
```

…and every write route opts in:

```js
router.post('/',   requireAuth, requireRole('admin', 'editor'), ...);
router.put('/:id', requireAuth, requireRole('admin', 'editor'), ...);
router.delete('/', requireAuth, requireRole('admin', 'editor'), ...);
```

`/users` is admin-only by virtue of `router.use(requireAuth, requireRole('admin'))`.

## Client-side enforcement

`shared.js` provides two helpers:

```js
function canWrite() { return role === 'admin' || role === 'editor'; }
function isAdmin()  { return role === 'admin'; }
```

The body class is updated on every page load:

```js
document.body.classList.add(`role-${role}`);
```

…and CSS hides every element with `data-writable` for viewers:

```css
body.role-viewer [data-writable] { display: none !important; }
```

A read-only banner is injected for viewers:

```html
<div id="readonly-banner">You have read-only access.</div>
```

## Why both layers

Server-side checks are the **only** ones that matter for security. The
client-side checks are for UX — a viewer shouldn't see buttons that are
guaranteed to 403. But: never trust the UI. The server is the source of
truth, and the tests in `api/04-users-rbac.cy.js` prove that no client-side
trick can bypass it.

## What the tests prove

`api/04-users-rbac.cy.js` is the canonical RBAC test file. It runs the
same endpoints as each role and asserts the status code matches the table
above. If a new route is added without a `requireRole` call, that file
fails.

`ui/05-admin.cy.js` does the same checks at the UI layer: as a viewer,
the "New Test Case" button is hidden and an admin URL bounces you back
to the dashboard.
