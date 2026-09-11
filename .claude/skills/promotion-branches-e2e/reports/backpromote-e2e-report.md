# Backpromote (Beta) end to end report, GitHub, GitLab and Azure DevOps, 2026-09-11

Runbook section 6bis (steps B0 to B17, Pull Request comment consistency checks C1 to C6), run with
`backpromote-setup.sh` and `backpromote-steps.sh` against real orgs, once per git provider.

- sfdx-hardis: branch `feat/backpromote-panel` (PR #2192), compiled `bin/run.js`
- Dev Hub: `nicolas.vuillamy.c8024b5deb9f@agentforce.com`; developer orgs: scratch orgs `promo-e2e-dev` (`page-connect-6049-dev-ed`) and `promo-e2e-dev2` (`site-data-8363-dev-ed`, the "refreshed sandbox" of B16), both reset to the base project by the setup before each provider
- Stories: S1 to S3 merged in `integration`, then S7 (Apex change also made in the org), S8 (Apex change kept as the org version), S9 (deletion of `E2E_S1`)
- Developer branch: `feature/E2E-401-dev`, always merged with `origin/integration`, local `integration` never pulled after the story merges

| Provider | Repository (private, throwaway) | Pull Requests | Result |
|----------|---------------------------------|---------------|--------|
| GitHub | `nvuillam/sfdx-hardis-promo-e2e-10` | #1 to #6 | 41 OK, 0 FAIL |
| Azure DevOps | `nicolasvuillamy/tests-sfdx-hardis/sfdx-hardis-promo-e2e-az-6` | 81 to 86 | 41 OK, 0 FAIL |
| GitLab (`gitlab.hardis-group.com`) | `nicolas.vuillamy/sfdx-hardis-promo-e2e-gl-6` | !1 to !6 | 41 OK, 0 FAIL (in two parts, see below) |

## Steps

| Step | Expected | GitHub | Azure DevOps | GitLab |
|------|----------|--------|--------------|--------|
| B0 Not connected to the git provider | plan `blocked` on `gitProvider`, run exits 1 before listing anything | OK | OK | OK |
| B1 Org of a major branch | plan `blocked` naming `uat`, run exits 1 | OK | OK | OK |
| B2 Production org | plan `blocked`, `is a production org` | OK | OK | OK |
| B3 Plan | `ready`, `scratch`, S1 S2 S3 pending and trackable, items `newToOrg`, four actions | OK | OK | OK |
| B4 S1 and S3 picked | only `E2E_S1` and `E2E_S3` deployed, only their pre-deploy actions, nothing stored in `config/user` | OK | OK | OK |
| B5 Window after the last backpromoted | `upToDate` with `olderFrom` set; with `--from`, S2 pending and S1 S3 done in this org | OK | OK | OK |
| B6 S2 with `--skip-actions` | `E2E_S2` deployed, no action run | OK | OK | OK |
| B7 Unknown Pull Request | exit 1 naming 999 | OK | OK | OK |
| B8 Changed in the org and in integration | `ApexClass:PromoE2EAlphaTest` `changedInOrg`, `mergeable` | OK | OK | OK |
| B9 Prepare the merge | 1 conflict block, labelled markers, prompt file, `nextCommand` with `--merged-metadata` | OK | OK | OK |
| B10 Markers left | exit 1, nothing deployed | OK | OK | OK |
| B11 Merge solved and deployed | exit 0, org body holds both lines, commit reminder, only the class modified | OK | OK | OK |
| B12 Keep the org version | exit 0, exclusion logged, org keeps its own `PromoE2EBetaTest` | OK | OK | OK |
| B13 Declined deletions | plan lists the deletion, `--skip-destructive` keeps `E2E_S1`, then `upToDate` | OK | OK | OK |
| B14 Dirty tree | `blocked`, `gitClean` lists `NOTES.md`, nothing under `hardis-report/` | OK | OK | OK |
| B15 Terminal prompts | answered by hand | not covered | not covered | not covered |
| B16 Refreshed sandbox (new org) | S1 S2 S3 pending again, each naming the first org in `backpromotedTo` | OK | OK | OK |
| B17 Second org backpromoted | exit 0 | OK | OK | OK |

## Pull Request comment consistency

`check-backpromote-comments.cjs` reads every comment of the listed Pull Requests through the provider API.

| Check | After | Expected | GitHub | Azure DevOps | GitLab |
|-------|-------|----------|--------|--------------|--------|
| C1 | B4 | S1 and S3 list the scratch org, deployed, `e2e-pre-S1` success, `e2e-manual-S1` manual, `e2e-pre-S3` success; S2 has no history | 22/22 | 22/22 | 22/22 |
| C2 | B6 | S2 lists the org, deployed, no action recorded | 8/8 | 8/8 | 8/8 |
| C3 | B11 | S7 lists the org, deployed | 7/7 | 7/7 | 7/7 |
| C4 | B13 | S8 and S9 list the org, deployed | 14/14 | 14/14 | 14/14 |
| C5 | B17 | S3 still has **one** history comment, now with **two rows** (both orgs, `e2e-pre-S3` success in each); S1 still one row | 20/20 | 20/20 | 20/20 |
| C6 | end | every history comment: at most one per Pull Request, each org listed once, records well formed, visible row matching the hidden record, recorded commit equal to the merge commit the plan lists | 51/51 | 51/51 | 51/51 |

## What the runs found

Product fixes (all in PR #2192):

1. **The waiting Pull Requests were read from the local parent branch** while the up-to-date check reads `origin/integration`: a developer merging `origin/integration` without pulling their local `integration` saw nothing to backpromote. `resolveBackpromoteParentRef` reads `origin/<parent>`.
2. **Parallel sfdx-git-delta runs fail** on `could not lock config file .git/config`. One run at a time.
3. **A manual deployment action was recorded as done**, so the next run skipped it. Recorded as `manual`.
4. **`--json` stdout started with `WS Client started`**, and the panel's background calls opened a command tab in VS Code. No WebSocket for `--plan` and `--prepare-merge --json`, the line goes to stderr in `--json` runs.
5. **The first commit of the repository broke an explicit selection without `--from`** (`--from is not a valid sha pointer <root>^1`). Commits without a first parent are not listed, and in explicit mode only the groups after the last backpromoted one are recomputed.
6. **`hardis-report/` files blocked the clean tree check** after a first run. They are ignored.

Test harness only (the product already handles these, the scripts did not):

- GitHub answers `Base branch was modified` to a merge sent right after another merge into the same branch: `bp_merge` retries.
- GitLab answers `{"source_branch":["does not exist"]}` to a merge request created right after the push of its branch: `bp_open` retries (same trap as promotion branches invariant 21).
- Azure DevOps completes a Pull Request asynchronously: `bp_merge` waits for `lastMergeSourceCommit`.
- The GitLab run stopped at B9 when Windows could not start the `sf` process (exit 3221225794, `STATUS_DLL_INIT_FAILED`, under 2 GB of free memory on the test machine). It was resumed from B9 on the same project, branch and orgs, nothing reset: B0 to B8 with C1 and C2 (19 OK), then B9 to B17 with C3 to C6 (22 OK). Run the steps with `bin/run.js` rather than `bin/dev.js` on a machine short of memory.

## What these runs did not cover

- B15, the terminal prompts (group multiselect, per item deploy / keep / merge choice, merge wait loop).
- The VS Code panel itself: it reads the same `--plan --json` documents asserted here and its command builder is unit tested, but it was not clicked.
- Bitbucket.
- Deployment actions requiring LoginAs as another user.
- A real developer sandbox (only scratch orgs; B16 uses a second scratch org to stand for a refreshed sandbox).

## Suite counts

- sfdx-hardis: 1936 unit tests passing, lint and compile clean.
- vscode-sfdx-hardis (PR #509): `yarn test` 468 passing, `yarn test:ui` 22 passing including 7 Backpromote tests.
