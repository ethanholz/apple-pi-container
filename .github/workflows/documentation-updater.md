---
name: documentation-updater
description: Keep docs accurate and up-to-date
on:
  schedule: weekly
permissions:
  contents: read
  pull-requests: read
engine: pi
strict: true
tools:
  github:
    mode: gh-proxy
    toolsets: [repos, pull_requests]
  bash: ["*"]
  cache-memory:
    retention-days: 30
    allowed-extensions: [".json"]
steps:
  - uses: actions/setup-node@v7
    with:
      node-version: 22.19.0
      cache: npm
  - run: npm ci
safe-outputs:
  create-pull-request:
    branch-prefix: "docs/documentation-updater-"
    draft: true
    allowed-files:
      - README.md
      - "docs/**/*.md"
    max-patch-files: 10
network:
  allowed:
    - defaults
    - github
    - node
concurrency: documentation-updater
timeout-minutes: 30
---

# Documentation Updater

Keep this repository's user-facing documentation accurate with one small, focused update per run.

## Repository context

This is a Node.js 22.19+ TypeScript ESM Pi extension, installed with npm and validated by `npm run check`. `README.md` is currently the primary user documentation. The implementation and tests are in `index.ts` and `test/`; project defaults also live in `.pi/apple-container.json`. CI runs `npm ci` and `npm run check` on pushes and pull requests. Releases use `vX.Y.Z` tags, and documentation branches conventionally use `docs/*`.

## Task

1. Read `README.md`, `package.json`, `index.ts`, `test/`, `.pi/apple-container.json`, repository instructions if present, and the latest release/tag. Inspect at most the 30 commits since the SHA recorded in memory; on the first run, inspect the latest 30 commits.
2. Load `/tmp/gh-aw/cache-memory/documentation-updater.json` if present. Treat it only as a cursor: verify remembered state against the current repository and GitHub state.
3. Check documentation claims against the implementation, especially installation version, Node and macOS requirements, configuration keys and precedence, defaults, Apple Container behavior, slash-command and CLI usage, mounts, Dockerfile caching, and validation commands. Ignore speculative TODO work.
4. Before editing, use `gh` to check for an open documentation-updater pull request. Do not duplicate or supersede an open PR.
5. If a material discrepancy exists, update only `README.md` or existing files under `docs/`. Keep the change narrowly scoped, preserve the current style, and run `npm run check`. Review the diff and do not propose a PR if validation fails because of the change.
6. Create one draft pull request through the `create_pull_request` safe output. Use a Conventional Commit-style `docs: ...` title, explain the discrepancy and validation result, and never merge it.
7. If no material documentation change is needed, or an equivalent PR is already open, call `noop` with a short reason.
8. Before finishing, write `/tmp/gh-aw/cache-memory/documentation-updater.json` with the audited commit SHA and run timestamp. Use JSON only; if a timestamp is used in a filename, format it as `YYYY-MM-DD-HH-MM-SS` without colons, `T`, or `Z`.
