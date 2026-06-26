# Gutenberg SHA Sync Workflow — Design

**Date:** 2026-06-26
**Status:** Approved
**Branch:** `add/gutenberg-sha-bump`

## Summary

Add a GitHub Actions workflow that keeps `package.json` → `gutenberg.sha` (a
full-length commit hash in the `WordPress/gutenberg` repository) up to date by
opening draft pull requests in `WordPress/wordpress-develop`:

- **`trunk`** is updated to the commit referenced by Gutenberg's most recent
  **public release** (non-prerelease, non-draft).
- The **most recent version branch** (`X.Y`) is updated daily to the head
  commit of the corresponding `wp/X.Y` branch in Gutenberg.

Every PR is created as a **draft**, labeled **`Gutenberg Sync`**, and carries a
changelog in its body.

## Requirements

1. Open PRs against `trunk` when a new public (non-prerelease) Gutenberg release
   is published. The SHA used is the commit associated with the release's tag.
2. Version branches (`X.Y`) are **not** updated to release SHAs. They are updated
   to the head commit of the matching `wp/X.Y` branch in Gutenberg.
3. Version branches are updated **daily**.
4. `trunk` is always updated to the most recent release.
5. PRs are created as **drafts**.
6. PR bodies list a changelog:
   - **trunk:** the Gutenberg release notes (release `body`).
   - **version branch:** the commit list produced by the pipeline in
     [Changelog generation](#changelog-generation).

## Decisions (resolved during brainstorming)

| Topic | Decision |
| --- | --- |
| Release detection for `trunk` | **Scheduled poll now**, designed so a `repository_dispatch` can drive it later without rework. |
| Which version branches | The **single most recent** `X.Y` branch (auto-detected; `N = 1`). |
| `X.Y` → Gutenberg branch | **Identity mapping:** WP `X.Y` ↔ Gutenberg `wp/X.Y`. |
| Version-branch PR body | Commit list via the user's `git log --reverse` + `sed` pipeline. |
| Trunk PR body | The release notes (`body`). |
| Existing open PR | **Update in place** the open PR that has the `Gutenberg Sync` label and the same base branch — even if a contributor opened it first. Otherwise create a new draft PR. |
| Auth identity | Reuse the existing GitHub App from `commit-built-file-changes.yml` (`vars.GH_PR_BUILT_FILES_APP_ID` + `secrets.GH_PR_BUILT_FILES_PRIVATE_KEY`, committing as `wordpress-develop-pr-bot[bot]`). |
| Structure | **One workflow file**, logic inline in `github-script`/bash steps, sharing values across jobs via outputs and `needs`. May be refactored to a composite action later. |
| Trunk cadence | **Daily** (same cron as version branches) for now. |

## Architecture

A single workflow file: `.github/workflows/gutenberg-sync.yml`.

### Triggers

```yaml
on:
  schedule:
    - cron: '0 6 * * *'        # daily — drives version-branch updates and the trunk release poll
  workflow_dispatch:
    inputs:
      target:
        type: choice
        options: [both, trunk, version-branch]
        default: both
      dry_run:
        type: boolean
        default: false          # log intended actions; do not push or open/update PRs
  # Future seam: repository_dispatch (type: gutenberg-release) to make trunk near-instant.
```

### Top-level configuration

- Every job guarded with `if: ${{ github.repository == 'WordPress/wordpress-develop' }}`.
- Top-level `permissions: {}`. Jobs request only `contents: read` for
  `GITHUB_TOKEN`. **All writes** (push, PR create/update, labels) use the **app
  installation token** so that opened/updated PRs trigger downstream CI.
- A `concurrency` group keyed on the workflow name prevents overlapping
  daily/manual runs.

### Jobs

#### `setup` (shared, non-secret outputs)

Computes values both downstream jobs need and exposes them as job outputs:

- `latest_version_branch` — list this repo's branches, filter to `^[0-9]+\.[0-9]+$`,
  sort by semantic version descending, take the top entry (e.g. `7.0`).
- `wp_branch_exists` — whether `wp/<X.Y>` exists in `WordPress/gutenberg`.

Each downstream job mints its **own** app token rather than passing a token
through a job output (which would expose an unmasked credential).

#### `update-trunk`

1. Mint an app installation token (reuse the Python JWT → installation-token
   block from `commit-built-file-changes.yml`).
2. `GET /repos/WordPress/gutenberg/releases/latest` — this endpoint already
   excludes drafts **and** prereleases — yielding `tag_name`, `body`, `html_url`.
3. Resolve `tag_name` → commit SHA (dereference annotated tags via the git refs API).
4. Read the current `gutenberg.sha` from `package.json` on `trunk`. If it equals
   the resolved SHA → clean no-op.
5. Changelog = the release `body`, with a header link to `html_url`.
6. Hand off to the shared find-or-update-PR routine with `base = trunk`.

#### `update-version-branch`

1. Mint an app installation token.
2. Read `latest_version_branch` and `wp_branch_exists` from `setup`. If
   `wp/<X.Y>` does not exist yet → clean no-op (expected early in a release cycle).
3. `GET /repos/WordPress/gutenberg/commits/wp/<X.Y>` → head commit SHA.
4. Read the current `gutenberg.sha` from `package.json` on the `X.Y` branch. If
   equal → clean no-op.
5. Changelog = the commit-list pipeline (see below), prefixed with an
   `OLD...NEW` compare link.
6. Hand off to the shared find-or-update-PR routine with `base = X.Y`.

### Changelog generation

For version branches, treeless-clone Gutenberg so the full commit graph is cheap,
then run the user's established pipeline (without `pbcopy`):

```bash
git clone --filter=tree:0 https://github.com/WordPress/gutenberg.git
git -C gutenberg log --reverse --format="- %s" OLD...NEW \
  | sed 's|#\([0-9][0-9]*\)|https://github.com/WordPress/gutenberg/pull/\1|g; /github\.com\/WordPress\/gutenberg\/pull/!d'
```

This keeps only commits that reference a Gutenberg PR and linkifies `#N`
references. The captured output becomes the PR body, prefixed with a
`https://github.com/WordPress/gutenberg/compare/OLD...NEW` link.

### Shared find-or-update labeled draft PR

Inputs: base branch, new SHA, title, body.

1. Search for an **open PR** with label `Gutenberg Sync` **and** matching base
   branch (catches PRs a contributor opened first).
2. **If found:**
   - Head branch in this repo → check it out, `npm pkg set gutenberg.sha=<NEW>`,
     commit as `wordpress-develop-pr-bot[bot]`, push a commit on top (no
     force-push), then refresh the PR title/body.
   - Head branch on a fork (an installation token cannot push to forks) → update
     the PR body and ensure the label/draft state via the API, and note in the
     body that the SHA could not be pushed automatically. *(Accepted fallback.)*
3. **If not found:** create head branch `gutenberg-sync/<base>`,
   `npm pkg set gutenberg.sha=<NEW>`, commit, push, and open a **draft** PR
   (base = target) with the `Gutenberg Sync` label.
4. `dry_run` short-circuits before any push or PR write, logging the intended action.

The `gutenberg.sha` value is edited with `npm pkg set gutenberg.sha=<NEW>`.

## Error handling & edge cases

- No new release / `wp/X.Y` missing / SHA unchanged → clean no-op with a log line,
  not a failed run.
- `/releases/latest` inherently filters prereleases and drafts; no manual tag parsing.
- Forked-PR fallback as described above (update metadata, cannot push the commit).
- Commit message: `Build/Test Tools: Update the bundled Gutenberg commit reference.`

## Testing

- `actionlint` via the existing `workflow-lint.yml`.
- Manual `workflow_dispatch` runs with `dry_run: true` to verify branch
  detection, SHA resolution, and changelog generation without real PR side-effects.

## Out of scope (for now)

- The `repository_dispatch` trigger that would make `trunk` near-instant (a seam
  is left, but it is not wired).
- Updating more than one version branch (`N > 1`).
- Refactoring shared logic into a composite action (may follow if the inline
  approach grows unwieldy).
