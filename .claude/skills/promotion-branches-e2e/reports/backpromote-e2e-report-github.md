# Backpromote (Beta) end to end report, GitHub, 2026-09-11

Runbook section 6bis, run against real orgs for the first time.

- sfdx-hardis: branch `feat/backpromote-panel` (PR #2192), `bin/dev.js`
- Repository: `nvuillam/sfdx-hardis-promo-e2e-7` (private, throwaway), stories S1 to S3 merged in `integration` (#1, #2, #3), then S7 (#4, Apex change), S8 (#5, Apex change), S9 (#6, deletion of `E2E_S1`)
- Developer org: scratch org `promo-e2e-dev` created from the Dev Hub `nicolas.vuillamy.c8024b5deb9f@agentforce.com`, base project deployed before any story
- Developer branch: `feature/E2E-401-dev`, always merged with `origin/integration`, local `integration` never pulled after the story merges

## Results

| Step | Expected | Result |
|------|----------|--------|
| B1 Org of a major branch | plan `blocked` naming `uat`, run exits 1 | OK |
| B2 Production org | plan `blocked`, `is a production org` | OK |
| B3 Plan | `ready`, `scratch`, #1 #2 #3 pending with their static resources `newToOrg` and their actions | OK (18 checks) |
| B4 Pull Requests #1 and #3 | only `E2E_S1` and `E2E_S3` deployed, only their pre-deploy actions run, #2 in `skippedCommits` | OK |
| B5 Skipped one offered again | #2 listed as `skipped`, #1 #3 not listed | OK |
| B6 The skipped one, `--skip-actions` | `E2E_S2` deployed, no action run, `skippedCommits` empty | OK |
| B7 Unknown Pull Request | exit 1 naming 999 | OK |
| B8 Changed in the org and in integration | `ApexClass:PromoE2EAlphaTest` `changedInOrg`, `mergeable` | OK after fix 1 |
| B9 Prepare the merge | 1 conflict block, labelled markers, prompt, `nextCommand` with `--merged-metadata` | OK after fix 1 |
| B10 Markers left | exit 1, nothing deployed | OK |
| B11 Merge solved and deployed | exit 0, org body holds both lines, commit reminder | OK after fix 2 |
| B12 Keep the org version | exit 0, exclusion logged, org keeps its own `PromoE2EBetaTest` | OK |
| B13 Declined deletions | plan lists the deletion, run with `--skip-destructive` keeps `E2E_S1` in the org | OK (plan check rerun after fix 2 showed #4 `skipped` as expected, then `upToDate`) |
| B14 Dirty tree | `blocked`, `gitClean` lists `NOTES.md`, nothing under `hardis-report/` | OK |
| B15 Terminal prompts | answered by hand | not covered |

## What the run found

1. **The waiting Pull Requests were read from the local parent branch.** `listMergedPrsWithCommits` listed `lastCommit..integration` on the local branch, while the up-to-date check reads `origin/integration`. A developer who merges `origin/integration` into their branch without pulling their local `integration` got "up to date" with three stories waiting. Fixed: `resolveBackpromoteParentRef` reads `origin/<parent>` when it exists. This predates the panel work.
2. **Parallel sfdx-git-delta runs fail.** The per Pull Request deltas ran three `sf sgd:source:delta` at once; they fail on `could not lock config file .git/config`. Fixed: one run at a time.
3. **A manual deployment action was recorded as done** (`status: success`) after only printing its instructions, so the next run skipped it. Fixed: recorded as `manual`.
4. **`--json` stdout started with `WS Client started`**, and the panel's background calls opened a command tab in VS Code. Fixed: no WebSocket for `--plan` and `--prepare-merge --json`, the line goes to stderr in `--json` runs.

## What this run did not cover

- B15, the terminal prompts (group multiselect, per item deploy / keep / merge choice, merge wait loop).
- The VS Code panel itself: it reads the same `--plan --json` documents asserted here, and its command builder is unit tested, but it was not clicked.
- GitLab, Azure DevOps and Bitbucket: backpromote reads merged Pull Requests through the git provider, only GitHub was run.
- Deployment actions requiring LoginAs as another user.
- A developer sandbox (only a scratch org).

## Suite counts

- sfdx-hardis unit tests: 1926 passing before the e2e fixes; the backpromote files (selection, plan against real git repositories, utils, WebSocket skip) pass after them.
- vscode-sfdx-hardis (PR #509): `yarn test` 467 passing, `yarn test:ui` 21 passing including 6 Backpromote tests.
