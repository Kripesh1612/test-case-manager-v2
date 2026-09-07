# Architecture Decision Records

This directory holds Architecture Decision Records (ADRs) — short
documents that capture a meaningful design choice, the context that
forced it, the options that were on the table, and the consequences we
accepted.

Each ADR is one file, named `NNNN-short-slug.md`, kept small enough to
read in five minutes. Once an ADR is accepted it is **not** edited in
place; if the decision later changes, a new ADR supersedes the old
one and the `Supersedes:` line links them.

## Index

| Number | Title | Status |
| ------ | ----- | ------ |
| [0001](./0001-result-vs-run-state-model.md) | `TestCase.result` vs `TestRun.status` (derived mirror, not authoritative join) | Accepted |

## How to add a new ADR

1. Copy `0001-result-vs-run-state-model.md` to the next available
   number.
2. Set `Status: Proposed` while it's under discussion.
3. Fill in the four required sections: Context, Decision,
   Consequences, Alternatives considered.
4. Once the team (or the maintainer) agrees, set `Status: Accepted`
   and add a row to the index above.

## References

- Michael Nygard's ["Documenting Architecture Decisions"](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions) — the format this directory follows.
