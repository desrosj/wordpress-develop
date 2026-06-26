# Gutenberg SHA Sync Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a GitHub Actions workflow that opens draft PRs updating `package.json` → `gutenberg.sha` for `trunk` (latest public Gutenberg release) and the most recent version branch (daily, from `wp/X.Y` head).

**Architecture:** A single workflow file `.github/workflows/gutenberg-sync.yml` with three jobs: a `setup` job that detects the latest `X.Y` version branch and whether its `wp/X.Y` counterpart exists in Gutenberg; an `update-trunk` job; and an `update-version-branch` job. Each update job mints its own GitHub App installation token (reusing the app from `commit-built-file-changes.yml`), resolves the target SHA + changelog, and runs a shared inline "find-or-update labeled draft PR" routine. Logic is inline (`run:`/`gh` CLI) per the chosen Option C; shared values flow through job outputs.

**Tech Stack:** GitHub Actions (YAML), `gh` CLI, `jq`, `git`, `python3` (PyJWT) for the app-token JWT, `actionlint` + `zizmor` for linting.

## Global Constraints

- Repository guard on every job: `if: ${{ github.repository == 'WordPress/wordpress-develop' }}` (combined with other conditions where present).
- Top-level `permissions: {}`; each job grants only the minimum (`contents: read` for `GITHUB_TOKEN`). All writes use the app installation token so opened/updated PRs trigger CI.
- Pin every external action to a full commit SHA (reuse SHAs already vetted in this repo: `actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2`).
- **Zizmor-safe:** never interpolate API-fetched or untrusted data (`${{ ... }}`) directly into `run:` scripts. Pass values via `env:` or write multiline content (release notes, commit lists) to files. Set `persist-credentials: false` on checkouts that do not push.
- App credentials: `vars.GH_PR_BUILT_FILES_APP_ID` and `secrets.GH_PR_BUILT_FILES_PRIVATE_KEY`.
- Bot git identity: name `wordpress-develop-pr-bot[bot]`, email `${GH_APP_ID}+wordpress-develop-pr-bot[bot]@users.noreply.github.com`.
- PR label (already exists): `Gutenberg Sync`.
- Commit message: `Build/Test Tools: Update the bundled Gutenberg commit reference.`
- `package.json` uses **tab** indentation — edit the SHA with `jq --tab` to keep the diff to a single line.
- Version → Gutenberg branch mapping is identity: WP `X.Y` ↔ Gutenberg `wp/X.Y`.
- Daily schedule (`cron: '0 6 * * *'`) plus `workflow_dispatch` with `target` (both|trunk|version-branch) and `dry_run` inputs.

---

### Task 1: Workflow skeleton, triggers, and `setup` job

**Files:**
- Create: `.github/workflows/gutenberg-sync.yml`

**Interfaces:**
- Consumes: nothing.
- Produces: job `setup` with outputs `latest_version_branch` (e.g. `7.0`) and `wp_branch_exists` (`true`/`false`), consumed by Task 3's `update-version-branch` job via `needs.setup.outputs.*`.

- [ ] **Step 1: Write the branch-detection logic as a local test first**

Create a throwaway script to prove the detection picks the correct latest `X.Y` branch against the live repo. Save as `/tmp/detect-branch.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
REPO="WordPress/wordpress-develop"
latest=$(gh api --paginate "repos/${REPO}/branches" --jq '.[].name' \
  | grep -E '^[0-9]+\.[0-9]+$' | sort -V | tail -1)
echo "latest_version_branch=$latest"
if git ls-remote --exit-code --heads https://github.com/WordPress/gutenberg.git "wp/${latest}" >/dev/null 2>&1; then
  echo "wp_branch_exists=true"
else
  echo "wp_branch_exists=false"
fi
```

- [ ] **Step 2: Run the detection test to confirm it returns a sane result**

Run: `bash /tmp/detect-branch.sh`
Expected: prints `latest_version_branch=<the highest X.Y branch>` (e.g. `latest_version_branch=7.0`) and `wp_branch_exists=true` or `false`. Cross-check the branch against `gh api repos/WordPress/wordpress-develop/branches --jq '.[].name' | grep -E '^[0-9]+\.[0-9]+$' | sort -V | tail -1`. If they match, the logic is correct.

- [ ] **Step 3: Create the workflow file with triggers, permissions, concurrency, and the `setup` job**

Create `.github/workflows/gutenberg-sync.yml`:

```yaml
# Opens draft pull requests that update the bundled Gutenberg commit reference
# (package.json -> gutenberg.sha):
#   - trunk: the commit for Gutenberg's latest public (non-prerelease) release.
#   - the most recent X.Y version branch: the head of Gutenberg's wp/X.Y branch.
name: Gutenberg Sync

on:
  schedule:
    # Daily. Drives the version-branch update and the trunk release poll.
    - cron: '0 6 * * *'
  workflow_dispatch:
    inputs:
      target:
        description: 'Which branches to update.'
        type: choice
        options:
          - both
          - trunk
          - version-branch
        default: both
      dry_run:
        description: 'Log intended actions without creating or updating PRs.'
        type: boolean
        default: false

# Disable permissions for all available scopes by default.
# Any needed permissions are configured at the job level.
permissions: {}

# Prevent overlapping daily/manual runs from racing on the same PR branches.
concurrency:
  group: ${{ github.workflow }}
  cancel-in-progress: false

jobs:
  # Detects the most recent X.Y version branch and whether Gutenberg has a
  # matching wp/X.Y branch. Shared by the version-branch job.
  setup:
    name: Determine target branches
    runs-on: ubuntu-24.04
    if: ${{ github.repository == 'WordPress/wordpress-develop' }}
    timeout-minutes: 5
    permissions:
      contents: read
    outputs:
      latest_version_branch: ${{ steps.detect.outputs.latest_version_branch }}
      wp_branch_exists: ${{ steps.detect.outputs.wp_branch_exists }}
    steps:
      - name: Detect latest version branch and wp/X.Y existence
        id: detect
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          REPO: ${{ github.repository }}
        run: |
          latest=$(gh api --paginate "repos/${REPO}/branches" --jq '.[].name' \
            | grep -E '^[0-9]+\.[0-9]+$' | sort -V | tail -1)
          echo "latest_version_branch=${latest}" >> "$GITHUB_OUTPUT"

          if [ -n "${latest}" ] && git ls-remote --exit-code --heads \
            https://github.com/WordPress/gutenberg.git "wp/${latest}" >/dev/null 2>&1; then
            echo "wp_branch_exists=true" >> "$GITHUB_OUTPUT"
          else
            echo "wp_branch_exists=false" >> "$GITHUB_OUTPUT"
          fi
```

- [ ] **Step 4: Lint the workflow file**

Run: `actionlint .github/workflows/gutenberg-sync.yml`
Expected: no output (exit 0). actionlint also runs `shellcheck` on the `run:` block — fix any reported issues.

- [ ] **Step 5: Confirm the file parses as valid YAML**

Run: `yq '.jobs.setup.outputs' .github/workflows/gutenberg-sync.yml`
Expected: prints the two output keys (`latest_version_branch`, `wp_branch_exists`).

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/gutenberg-sync.yml
git commit -m "Build/Test Tools: Add Gutenberg Sync workflow skeleton and setup job."
```

---

### Task 2: `update-trunk` job

**Files:**
- Modify: `.github/workflows/gutenberg-sync.yml` (append the `update-trunk` job)

**Interfaces:**
- Consumes: app credentials `vars.GH_PR_BUILT_FILES_APP_ID`, `secrets.GH_PR_BUILT_FILES_PRIVATE_KEY`.
- Produces: a draft PR to `trunk` labeled `Gutenberg Sync`, head branch `gutenberg-sync/trunk`. Establishes the shared "create or update labeled draft PR" `run:` block reused verbatim in Task 3.

- [ ] **Step 1: Verify the SHA edit keeps a one-line diff (local test)**

Prove `jq --tab` changes only the SHA line in the real `package.json`:

```bash
cp package.json /tmp/pkg.bak
jq --tab --arg sha "0000000000000000000000000000000000000000" '.gutenberg.sha = $sha' package.json > /tmp/pkg.new
diff <(cat package.json) /tmp/pkg.new
```

Run the above.
Expected: the `diff` shows exactly one changed line (the `"sha":` line). If more lines differ, indentation/key-order is being altered — do not proceed until only one line changes.

- [ ] **Step 2: Verify trunk SHA resolution against the live Gutenberg API (local test)**

```bash
release=$(gh api repos/WordPress/gutenberg/releases/latest)
TAG=$(jq -r '.tag_name' <<<"$release")
ref=$(gh api "repos/WordPress/gutenberg/git/refs/tags/${TAG}")
obj_type=$(jq -r '.object.type' <<<"$ref")
obj_sha=$(jq -r '.object.sha' <<<"$ref")
if [ "$obj_type" = "tag" ]; then
  NEW_SHA=$(gh api "repos/WordPress/gutenberg/git/tags/${obj_sha}" --jq '.object.sha')
else
  NEW_SHA="$obj_sha"
fi
echo "TAG=$TAG NEW_SHA=$NEW_SHA"
```

Run the above.
Expected: prints a tag like `v21.x` and a 40-character `NEW_SHA`. Confirms the annotated-tag dereference path works.

- [ ] **Step 3: Append the `update-trunk` job**

Add this job to `.github/workflows/gutenberg-sync.yml` (after `setup`):

```yaml
  # Updates trunk to the commit referenced by Gutenberg's latest public release.
  update-trunk:
    name: Update trunk to latest release
    runs-on: ubuntu-24.04
    needs: setup
    if: >-
      ${{ github.repository == 'WordPress/wordpress-develop' &&
          ( github.event_name != 'workflow_dispatch' ||
            inputs.target == 'both' || inputs.target == 'trunk' ) }}
    timeout-minutes: 10
    permissions:
      contents: read
    steps:
      - name: Generate installation token
        id: generate_token
        env:
          GH_APP_ID: ${{ vars.GH_PR_BUILT_FILES_APP_ID }}
          GH_APP_PRIVATE_KEY: ${{ secrets.GH_PR_BUILT_FILES_PRIVATE_KEY }}
        run: |
          JWT=$(python3 - <<'EOF'
          import jwt, time, os
          payload = {
              "iat": int(time.time()),
              "exp": int(time.time()) + 600,  # 10-minute expiration
              "iss": int(os.environ["GH_APP_ID"]),
          }
          print(jwt.encode(payload, os.environ["GH_APP_PRIVATE_KEY"], algorithm="RS256"))
          EOF
          )
          INSTALLATION_ID=$(curl -s -X GET -H "Authorization: Bearer $JWT" \
            -H "Accept: application/vnd.github.v3+json" \
            https://api.github.com/app/installations | jq -r '.[0].id')
          ACCESS_TOKEN=$(curl -s -X POST -H "Authorization: Bearer $JWT" \
            -H "Accept: application/vnd.github.v3+json" \
            "https://api.github.com/app/installations/$INSTALLATION_ID/access_tokens" | jq -r '.token')
          echo "::add-mask::$ACCESS_TOKEN"
          echo "access-token=$ACCESS_TOKEN" >> "$GITHUB_OUTPUT"

      - name: Checkout trunk
        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
        with:
          ref: trunk
          fetch-depth: 0
          token: ${{ steps.generate_token.outputs.access-token }}
          persist-credentials: true
          show-progress: ${{ runner.debug == '1' && 'true' || 'false' }}

      - name: Configure git author
        env:
          GH_APP_ID: ${{ vars.GH_PR_BUILT_FILES_APP_ID }}
        run: |
          git config user.name "wordpress-develop-pr-bot[bot]"
          git config user.email "${GH_APP_ID}+wordpress-develop-pr-bot[bot]@users.noreply.github.com"

      - name: Resolve release SHA and build PR body
        env:
          GH_TOKEN: ${{ steps.generate_token.outputs.access-token }}
        run: |
          release=$(gh api repos/WordPress/gutenberg/releases/latest)
          TAG=$(jq -r '.tag_name' <<<"$release")
          RELEASE_URL=$(jq -r '.html_url' <<<"$release")

          ref=$(gh api "repos/WordPress/gutenberg/git/refs/tags/${TAG}")
          obj_type=$(jq -r '.object.type' <<<"$ref")
          obj_sha=$(jq -r '.object.sha' <<<"$ref")
          if [ "$obj_type" = "tag" ]; then
            NEW_SHA=$(gh api "repos/WordPress/gutenberg/git/tags/${obj_sha}" --jq '.object.sha')
          else
            NEW_SHA="$obj_sha"
          fi

          OLD_SHA=$(jq -r '.gutenberg.sha' package.json)

          # Write the (untrusted) release notes to a file rather than env.
          jq -r '.body // ""' <<<"$release" > release_notes.md
          {
            printf 'Updates the bundled Gutenberg commit reference to `%s`.\n\n' "$NEW_SHA"
            printf 'Release: [%s](%s)\n\n' "$TAG" "$RELEASE_URL"
            printf '## Changelog\n\n'
            cat release_notes.md
          } > pr_body.md

          {
            echo "BASE=trunk"
            echo "HEAD_BRANCH=gutenberg-sync/trunk"
            echo "NEW_SHA=${NEW_SHA}"
            echo "PR_TITLE=Gutenberg Sync: Update trunk to ${TAG}"
            if [ "${NEW_SHA}" != "${OLD_SHA}" ]; then echo "PROCEED=true"; else echo "PROCEED=false"; fi
          } >> "$GITHUB_ENV"

      - name: Create or update the draft pull request
        if: ${{ env.PROCEED == 'true' }}
        env:
          GH_TOKEN: ${{ steps.generate_token.outputs.access-token }}
          REPO: ${{ github.repository }}
          DRY_RUN: ${{ github.event_name == 'workflow_dispatch' && inputs.dry_run || false }}
          COMMIT_MSG: 'Build/Test Tools: Update the bundled Gutenberg commit reference.'
        run: |
          set -euo pipefail

          pr_json=$(gh pr list --repo "$REPO" --state open --base "$BASE" \
            --label "Gutenberg Sync" --json number,headRefName,isCrossRepository \
            --jq '.[0] // empty')

          if [ "${DRY_RUN}" = "true" ]; then
            echo "DRY RUN: base '$BASE' -> sha '$NEW_SHA'."
            if [ -n "$pr_json" ]; then
              echo "DRY RUN: would update existing PR #$(jq -r '.number' <<<"$pr_json")."
            else
              echo "DRY RUN: would create draft PR from '$HEAD_BRANCH'."
            fi
            exit 0
          fi

          if [ -n "$pr_json" ]; then
            number=$(jq -r '.number' <<<"$pr_json")
            head=$(jq -r '.headRefName' <<<"$pr_json")
            cross=$(jq -r '.isCrossRepository' <<<"$pr_json")

            if [ "$cross" = "true" ]; then
              echo "::warning::PR #$number is from a fork; updating metadata only."
              printf '\n\n> Note: the SHA could not be pushed automatically (PR is from a fork). Please set `gutenberg.sha` to `%s`.\n' "$NEW_SHA" >> pr_body.md
              gh pr edit "$number" --repo "$REPO" --title "$PR_TITLE" --body-file pr_body.md
              exit 0
            fi

            git fetch origin "$head"
            git checkout -B "$head" "origin/$head"
          else
            number=""
            git checkout -B "$HEAD_BRANCH" "origin/$BASE"
          fi

          jq --tab --arg sha "$NEW_SHA" '.gutenberg.sha = $sha' package.json > package.json.tmp
          mv package.json.tmp package.json

          if git diff --quiet -- package.json; then
            echo "package.json already at $NEW_SHA; no commit needed."
          else
            git add package.json
            git commit -m "$COMMIT_MSG"
          fi

          if [ -n "$number" ]; then
            git push origin "HEAD:$head"
            gh pr edit "$number" --repo "$REPO" --title "$PR_TITLE" --body-file pr_body.md
          else
            git push --force origin "HEAD:$HEAD_BRANCH"
            gh pr create --repo "$REPO" --draft --base "$BASE" --head "$HEAD_BRANCH" \
              --title "$PR_TITLE" --body-file pr_body.md --label "Gutenberg Sync"
          fi
```

- [ ] **Step 4: Lint the workflow file**

Run: `actionlint .github/workflows/gutenberg-sync.yml`
Expected: no output (exit 0). Resolve any actionlint/shellcheck findings.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/gutenberg-sync.yml
git commit -m "Build/Test Tools: Add trunk update job to Gutenberg Sync workflow."
```

---

### Task 3: `update-version-branch` job

**Files:**
- Modify: `.github/workflows/gutenberg-sync.yml` (append the `update-version-branch` job)

**Interfaces:**
- Consumes: `needs.setup.outputs.latest_version_branch` and `needs.setup.outputs.wp_branch_exists` from Task 1; app credentials.
- Produces: a draft PR to the `X.Y` branch labeled `Gutenberg Sync`, head branch `gutenberg-sync/<X.Y>`.

- [ ] **Step 1: Verify the commit-list pipeline against real Gutenberg history (local test)**

Confirm the user's pipeline produces a linkified, PR-only commit list. Pick two real `wp/X.Y` SHAs (any older→newer pair on a wp branch):

```bash
git clone --filter=tree:0 --no-checkout https://github.com/WordPress/gutenberg.git /tmp/gb-src
OLD=$(git -C /tmp/gb-src rev-parse wp/6.8~20)
NEW=$(git -C /tmp/gb-src rev-parse wp/6.8)
git -C /tmp/gb-src log --reverse --format="- %s" "$OLD...$NEW" \
  | sed 's|#\([0-9][0-9]*\)|https://github.com/WordPress/gutenberg/pull/\1|g; /github\.com\/WordPress\/gutenberg\/pull/!d'
```

Run the above.
Expected: a Markdown bullet list where each line ends in a `https://github.com/WordPress/gutenberg/pull/<n>` link, and lines without a PR reference are omitted. Confirms the treeless clone exposes `wp/*` history and the `sed` filter works.

- [ ] **Step 2: Append the `update-version-branch` job**

Add this job to `.github/workflows/gutenberg-sync.yml` (after `update-trunk`):

```yaml
  # Updates the most recent X.Y version branch to the head of Gutenberg's wp/X.Y.
  update-version-branch:
    name: Update version branch to wp/X.Y head
    runs-on: ubuntu-24.04
    needs: setup
    if: >-
      ${{ github.repository == 'WordPress/wordpress-develop' &&
          needs.setup.outputs.wp_branch_exists == 'true' &&
          ( github.event_name != 'workflow_dispatch' ||
            inputs.target == 'both' || inputs.target == 'version-branch' ) }}
    timeout-minutes: 10
    permissions:
      contents: read
    env:
      BASE_BRANCH: ${{ needs.setup.outputs.latest_version_branch }}
    steps:
      - name: Generate installation token
        id: generate_token
        env:
          GH_APP_ID: ${{ vars.GH_PR_BUILT_FILES_APP_ID }}
          GH_APP_PRIVATE_KEY: ${{ secrets.GH_PR_BUILT_FILES_PRIVATE_KEY }}
        run: |
          JWT=$(python3 - <<'EOF'
          import jwt, time, os
          payload = {
              "iat": int(time.time()),
              "exp": int(time.time()) + 600,  # 10-minute expiration
              "iss": int(os.environ["GH_APP_ID"]),
          }
          print(jwt.encode(payload, os.environ["GH_APP_PRIVATE_KEY"], algorithm="RS256"))
          EOF
          )
          INSTALLATION_ID=$(curl -s -X GET -H "Authorization: Bearer $JWT" \
            -H "Accept: application/vnd.github.v3+json" \
            https://api.github.com/app/installations | jq -r '.[0].id')
          ACCESS_TOKEN=$(curl -s -X POST -H "Authorization: Bearer $JWT" \
            -H "Accept: application/vnd.github.v3+json" \
            "https://api.github.com/app/installations/$INSTALLATION_ID/access_tokens" | jq -r '.token')
          echo "::add-mask::$ACCESS_TOKEN"
          echo "access-token=$ACCESS_TOKEN" >> "$GITHUB_OUTPUT"

      - name: Checkout version branch
        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
        with:
          ref: ${{ needs.setup.outputs.latest_version_branch }}
          fetch-depth: 0
          token: ${{ steps.generate_token.outputs.access-token }}
          persist-credentials: true
          show-progress: ${{ runner.debug == '1' && 'true' || 'false' }}

      - name: Configure git author
        env:
          GH_APP_ID: ${{ vars.GH_PR_BUILT_FILES_APP_ID }}
        run: |
          git config user.name "wordpress-develop-pr-bot[bot]"
          git config user.email "${GH_APP_ID}+wordpress-develop-pr-bot[bot]@users.noreply.github.com"

      - name: Resolve wp/X.Y head and build PR body
        env:
          GH_TOKEN: ${{ steps.generate_token.outputs.access-token }}
        run: |
          set -euo pipefail
          NEW_SHA=$(gh api "repos/WordPress/gutenberg/commits/wp/${BASE_BRANCH}" --jq '.sha')
          OLD_SHA=$(jq -r '.gutenberg.sha' package.json)

          git clone --filter=tree:0 --no-checkout \
            https://github.com/WordPress/gutenberg.git gutenberg-src
          git -C gutenberg-src log --reverse --format="- %s" "${OLD_SHA}...${NEW_SHA}" \
            | sed 's|#\([0-9][0-9]*\)|https://github.com/WordPress/gutenberg/pull/\1|g; /github\.com\/WordPress\/gutenberg\/pull/!d' \
            > commit_list.md

          {
            printf 'Updates the bundled Gutenberg commit reference for `%s` to the latest `wp/%s` commit `%s`.\n\n' \
              "$BASE_BRANCH" "$BASE_BRANCH" "$NEW_SHA"
            printf 'Compare: https://github.com/WordPress/gutenberg/compare/%s...%s\n\n' "$OLD_SHA" "$NEW_SHA"
            printf '## Changes\n\n'
            cat commit_list.md
          } > pr_body.md

          {
            echo "BASE=${BASE_BRANCH}"
            echo "HEAD_BRANCH=gutenberg-sync/${BASE_BRANCH}"
            echo "NEW_SHA=${NEW_SHA}"
            echo "PR_TITLE=Gutenberg Sync: Update ${BASE_BRANCH} to latest wp/${BASE_BRANCH}"
            if [ "${NEW_SHA}" != "${OLD_SHA}" ]; then echo "PROCEED=true"; else echo "PROCEED=false"; fi
          } >> "$GITHUB_ENV"

      - name: Create or update the draft pull request
        if: ${{ env.PROCEED == 'true' }}
        env:
          GH_TOKEN: ${{ steps.generate_token.outputs.access-token }}
          REPO: ${{ github.repository }}
          DRY_RUN: ${{ github.event_name == 'workflow_dispatch' && inputs.dry_run || false }}
          COMMIT_MSG: 'Build/Test Tools: Update the bundled Gutenberg commit reference.'
        run: |
          set -euo pipefail

          pr_json=$(gh pr list --repo "$REPO" --state open --base "$BASE" \
            --label "Gutenberg Sync" --json number,headRefName,isCrossRepository \
            --jq '.[0] // empty')

          if [ "${DRY_RUN}" = "true" ]; then
            echo "DRY RUN: base '$BASE' -> sha '$NEW_SHA'."
            if [ -n "$pr_json" ]; then
              echo "DRY RUN: would update existing PR #$(jq -r '.number' <<<"$pr_json")."
            else
              echo "DRY RUN: would create draft PR from '$HEAD_BRANCH'."
            fi
            exit 0
          fi

          if [ -n "$pr_json" ]; then
            number=$(jq -r '.number' <<<"$pr_json")
            head=$(jq -r '.headRefName' <<<"$pr_json")
            cross=$(jq -r '.isCrossRepository' <<<"$pr_json")

            if [ "$cross" = "true" ]; then
              echo "::warning::PR #$number is from a fork; updating metadata only."
              printf '\n\n> Note: the SHA could not be pushed automatically (PR is from a fork). Please set `gutenberg.sha` to `%s`.\n' "$NEW_SHA" >> pr_body.md
              gh pr edit "$number" --repo "$REPO" --title "$PR_TITLE" --body-file pr_body.md
              exit 0
            fi

            git fetch origin "$head"
            git checkout -B "$head" "origin/$head"
          else
            number=""
            git checkout -B "$HEAD_BRANCH" "origin/$BASE"
          fi

          jq --tab --arg sha "$NEW_SHA" '.gutenberg.sha = $sha' package.json > package.json.tmp
          mv package.json.tmp package.json

          if git diff --quiet -- package.json; then
            echo "package.json already at $NEW_SHA; no commit needed."
          else
            git add package.json
            git commit -m "$COMMIT_MSG"
          fi

          if [ -n "$number" ]; then
            git push origin "HEAD:$head"
            gh pr edit "$number" --repo "$REPO" --title "$PR_TITLE" --body-file pr_body.md
          else
            git push --force origin "HEAD:$HEAD_BRANCH"
            gh pr create --repo "$REPO" --draft --base "$BASE" --head "$HEAD_BRANCH" \
              --title "$PR_TITLE" --body-file pr_body.md --label "Gutenberg Sync"
          fi
```

- [ ] **Step 3: Lint the workflow file**

Run: `actionlint .github/workflows/gutenberg-sync.yml`
Expected: no output (exit 0). Resolve any actionlint/shellcheck findings.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/gutenberg-sync.yml
git commit -m "Build/Test Tools: Add version branch update job to Gutenberg Sync workflow."
```

---

### Task 4: Security lint and live dry-run verification

**Files:**
- None (verification only; may apply small fixes to `.github/workflows/gutenberg-sync.yml`).

**Interfaces:**
- Consumes: the complete workflow from Tasks 1–3.
- Produces: a lint-clean, dry-run-verified workflow on a pushed branch.

- [ ] **Step 1: Run the security linter (zizmor)**

Run: `uvx zizmor@1.24.1 --persona=regular .github/workflows/gutenberg-sync.yml`
Expected: no high/error findings. If zizmor reports template-injection, unpinned-action, or excessive-permission issues, fix them (move interpolations into `env:`, pin SHAs, narrow `permissions:`). If `uvx` is unavailable locally, note that this runs in CI via `workflow-lint.yml` and re-verify the constraints in the Global Constraints section by inspection.

- [ ] **Step 2: Run actionlint one final time on the whole file**

Run: `actionlint .github/workflows/gutenberg-sync.yml`
Expected: no output (exit 0).

- [ ] **Step 3: Push the branch and trigger a dry-run**

The workflow can only execute on GitHub. Push the working branch, then dispatch with `dry_run: true`:

```bash
git push origin add/gutenberg-sha-bump
gh workflow run "Gutenberg Sync" --ref add/gutenberg-sha-bump -f target=both -f dry_run=true
```

Expected: the run is queued. Note: `workflow_dispatch` only works once the workflow file exists on the pushed branch.

- [ ] **Step 4: Inspect the dry-run output**

Run: `gh run list --workflow "Gutenberg Sync" --limit 1` then `gh run view <run-id> --log`
Expected: the `setup` job resolves the latest `X.Y` branch; `update-trunk` and `update-version-branch` each log a `DRY RUN: ...` line indicating whether they would create or update a PR. No PRs are created, no branches pushed. Confirm no step errored.

- [ ] **Step 5: Final commit (if Step 1/2 required fixes)**

```bash
git add .github/workflows/gutenberg-sync.yml
git commit -m "Build/Test Tools: Address lint findings in Gutenberg Sync workflow."
```

---

## Notes for the implementer

- **Why the app token, not `GITHUB_TOKEN`:** PRs/commits made with the default `GITHUB_TOKEN` do not trigger downstream CI workflows. The app installation token (same app as `commit-built-file-changes.yml`) makes opened PRs run tests.
- **Why files for changelog content:** release notes and commit subjects are untrusted input; writing them to `pr_body.md`/`commit_list.md` and using `--body-file` avoids shell/template injection (a zizmor requirement).
- **Forked-PR fallback:** an installation token cannot push to a contributor's fork branch, so for cross-repo PRs the job updates the title/body and label only and notes the SHA in the body. This is an accepted limitation per the spec.
- **Duplication:** the token-mint step and the create/update-PR step are intentionally duplicated across the two jobs (Option C, inline). If this becomes hard to maintain, extracting a composite action is the documented next step (out of scope here).
- **Future trigger:** a `repository_dispatch` (type `gutenberg-release`) can later be added to the `on:` block to make trunk near-instant without restructuring.
