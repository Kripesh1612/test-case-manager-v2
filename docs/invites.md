# Invites

The Invite mechanism lets an admin issue a token that grants exactly
one registration. With `REGISTRATION_MODE=invite`, the public
`/auth/register` endpoint refuses any caller without a valid
`invite_token`. The default mode is `open` — anyone can register —
because that's the learning-friendly baseline.

## Why invites

When you ship a tool to a real team, you don't want random people on
the internet signing up. You want admin-controlled onboarding.
Invites give you that without giving up the open mode that makes the
codebase friendly to follow along at home.

## How it works

### Modes (env-controlled)

```bash
REGISTRATION_MODE=open    # default; anyone can /auth/register
REGISTRATION_MODE=invite  # only valid invite tokens work
```

`middleware/registrationGate.js` runs at the top of `POST /auth/register`:

- If `open`, do nothing (call `next()`).
- If `invite`:
  - If zero users exist yet, allow (bootstrap).
  - If the email is in `ADMIN_EMAILS`, allow (bootstrap).
  - Otherwise, require `invite_token` in the body. Look up the token,
    check `accepted_at` is null and `expires_at > now`. Attach the
    invite to `req.invite` and call `next()`.

The handler in `routes/auth.js` then re-checks: the invite's stored
`email` must match the body's `email`. Otherwise, a user could redeem
token `T` (intended for `alice@example.com`) while registering as
`bob@example.com`.

### Endpoints

| Method | Path                | Auth   | Body / Result                                            |
| ------ | ------------------- | ------ | -------------------------------------------------------- |
| POST   | `/invites`          | admin  | `{ email, role }` → `{ id, token, accept_url, expires_at }` |
| GET    | `/invites`          | admin  | `?status=pending\|accepted\|expired`                     |
| DELETE | `/invites/:id`      | admin  | revoke (hard delete)                                     |
| POST   | `/invites/redeem`   | public | `{ token, name, password }` → `{ user, token }` (JWT)    |

### Tokens

A token is 32 random bytes hex-encoded (64 chars). Tokens are stored
hashed-style as plain text on `Invite.token` because they're already
unguessable. There's no separate "token + secret" — the token IS the
secret.

`expires_at` defaults to `INVITE_TTL_DAYS=7` from `.env`. After that
the token is rejected with `410 Gone`.

### The flow

1. Admin opens `/admin`, clicks "+ New Invite", enters an email and
   role. POSTs `/invites`.
2. The response includes `accept_url: /invite-redeem?token=...`. In a
   real deployment, an SMTP / SES step would email this link to the
   invitee. (Out of scope for this codebase.)
3. Invitee opens the URL. The `/invite-redeem.html` page reads
   `?token=` and posts `{ token, name, password }` to
   `/invites/redeem`.
4. `/invites/redeem` looks up the invite, validates it, creates the
   user with the invite's role, stamps `accepted_at`, and returns a
   JWT so the user is logged in immediately.
5. The invitee is bounced to `/dashboard`.

### Why `/invites/redeem` and not `/auth/register`

They look similar but serve different audiences:

- `/auth/register` is for the bootstrap / first user. It checks
  `REGISTRATION_MODE` and `ADMIN_EMAILS`.
- `/invites/redeem` is for invited users. It doesn't go through the
  gate; it just verifies the token.

That separation means the redeem endpoint stays public even in
invite-only mode.

## The UI

### Admin page

`/admin` has an "Invites" section below the user table. Each row
shows email, role, status (pending / accepted / expired), and expires
date. Pending invites have a Revoke button.

### `/invite-redeem.html`

A minimal page: name + password fields, big "Accept invite" button.
No header navigation, no tabs. Just the form, on its own, on the
assumption that the invitee hasn't seen the rest of the app yet.

## Email delivery

This codebase doesn't send email. The `accept_url` is in the API
response so you can copy-paste it into an email manually, or wire
your own transport. Common choices:

- AWS SES (via `@aws-sdk/client-ses`)
- Postmark (`postmark` npm package)
- SMTP via `nodemailer`

A real implementation might add a `POST /invites/:id/send` endpoint
that triggers the email. Not in scope here.

## Tests

- `cypress/e2e/api/08-invites.cy.js` — 16 tests: create / list /
  revoke, redeem happy path + replay (410), bad token (404),
  missing fields (400), RBAC (admin-only on create/list/revoke).
- `cypress/e2e/ui/07-invites.cy.js` — 5 tests: admin modal, public
  redeem page, no-token error state, bogus-token error, revoke from
  admin.

The single most important contract: **a redeemed invite cannot be
redeemed again** — covered by "redeeming an already-accepted invite
returns 410".
