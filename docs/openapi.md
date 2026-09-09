# OpenAPI spec

Regress publishes a machine-readable API contract in [`openapi.json`](./openapi.json)
(OpenAPI 3.0). It is **generated** — not hand-authored drift — from the same
shared Zod schemas that gate request bodies at the server and drive form
validation on the client (`shared/schemas/`). Change a schema and the docs
follow.

## What it covers

- **49 operations** across **38 paths**, tagged by subsystem (Auth, Test Cases,
  Versions, Runs, Execution, Suites, Scheduler, Trash, Audit, Invites).
- The **JWT security scheme** (`Authorization: Bearer …`) applied per-route.
- The shared Zod schemas exposed as reusable `components/schemas/` refs.

## Regenerate

The spec is tied to nothing at runtime — it's a static artifact you can commit
and re-commit when schemas change:

```bash
npm run openapi          # rewrites docs/openapi.json
```

## Browse / try it

`npm run openapi:serve` runs a Swagger UI on `http://localhost:3002` that
loads the local spec. The UI assets are vendored from `swagger-ui-dist`
(served at `/vendor/*`), so it renders with **no internet access**. With the
app running on `:3001`, you can click **Authorize**, paste a JWT, and exercise
endpoints live:

```bash
npm run openapi:serve    # then open http://localhost:3002
```

## Why generated-from-Zod

The same schema that rejects a bad request body on the server is what renders
in the docs — there's no second source of truth to forget to update. That's the
same "one source of truth" discipline the project already applies to client
forms and server validation, extended to the public API surface.

## Source

- Generator: [`scripts/generate-openapi.mjs`](../scripts/generate-openapi.mjs)
- Router: [`scripts/serve-openapi.mjs`](../scripts/serve-openapi.mjs)
