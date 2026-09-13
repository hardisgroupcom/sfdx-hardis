# Promotion branches and backpromote: end to end test on GitLab

**Date:** 2026-09-13 (supersedes the run of 2026-09-09)
**Projects under test (private, created empty for this run, on `gitlab.hardis-group.com`):**

- promotion branches: `nicolas.vuillamy/sfdx-hardis-promo-e2e-gl-7` (id 4452)
- backpromote (Beta): `nicolas.vuillamy/sfdx-hardis-promo-e2e-gl-8` (id 4451, code of `7efe8867f`),
  then `nicolas.vuillamy/sfdx-hardis-promo-e2e-gl-9` (id 4453, the same steps with `b60271506` and
  `e39dec046`, then `62462c485` from B8 on, see below)

**Salesforce org:** `nicolas.vuillamy.c8024b5deb9f@agentforce.com`, shared with GitHub, and the same
two scratch orgs (`promo-e2e-dev`, `promo-e2e-dev2`), reset to the base project before each
backpromote run. The providers ran one after the other, never at the same time.
**sfdx-hardis:** `feat/backpromote-panel`. Section 6bis on `-gl-8` ran `7efe8867f`; sections 3 to 6
ran `7efe8867f` plus the uncommitted retrieve project change (`b60271506`), which only touches
backpromote; the fix `e39dec046` was found by this run and proven on it. Every call through
`bin/run.js` after `yarn compile`.
**vscode-sfdx-hardis:** `feat/backpromote-panel`, `1b1eab85`, compiled, not modified by this run.

Every job is a real CLI call against the org with the GitLab CI variables set
(`CI_SFDX_HARDIS_GITLAB_TOKEN`, `CI_SERVER_URL`, `CI_PROJECT_ID`, `CI_MERGE_REQUEST_IID`). Merge
requests are merged with a merge commit, never squashed. Sections 3, 4 and 6 ran the same scripts as
GitHub (`promotion-run.sh`, `promotion-edge.sh` with `PROVIDER=gitlab`).

___

## Counts

| Section | Checks | OK | FAIL |
|---------|--------|----|------|
| 3, 4 and 4bis: stories, promotions, release notes, retrofit, 11 pipeline checkpoints | 40 | 40 | 0 |
| 6: edge cases (groups g1 to g6) | 47 | 47 | 0 (one product defect found and fixed, see below) |
| 5bis: merge request comment audit | 694 checks over 34 merge requests | all | 0 |
| 7bis: single place in the diagram | 1 | 1 | 0 |
| 6bis: backpromote B0 to B16, C1 to C4, on `-gl-8` | 63 | 63 | 0 |
| 6bis again on `-gl-9`, after the changes | 63 | 63 | 0 |
| 7ter: flag-off A/B against `origin/main` (`2685237d3`), second pair | 5 files compared | `TOTAL DIFFERING LINES: 0` | 0 |

Backpromote (Beta) had never run end to end on GitLab before: this is its first live GitLab run, and
it passed every step the first time.

___

## The pipeline

Same four levels and the same six User Stories as GitHub: S1 !1 to S6 !6, with the same targets,
actions, test classes and keywords (S1 in two yaml blocks, `NO_DELTA` on !2, `PURGE_FLOW_VERSIONS`
on !3, `FLOW_DELETE_INTERVIEWS` on !6). The edge cases add the same merge requests as on GitHub, with
the same numbers up to !31, then !32 (the story of the restricted steps case), !33 (its promotion)
and !34 (full `uat -> preprod` merge).

| Promotion | Merge request | Carries | Outcome |
|-----------|---------------|---------|---------|
| P1 | !7 | !1, !3 | merged, deployed to uat |
| P2 | !8 | !4 | merged, deployed to preprod |
| P3 | !9 | !3 | merged, deployed to preprod |
| P4 | !10 | !4, !3, !6 | merged, deployed to main |
| P5 | !14 | !13 | conflict markers, gate red, solved, gate green, closed by the promotion of !23 |
| P6 | - | !5 | creation refused (no token), branch `promotion/preprod/main/2026-09-13-0437` pushed |
| P7, P8 | !17, !18 | !1 | supersede case |
| P9 | !20 | !2 | merged and deployed to preprod |
| P10 | !24 | !23 | GitLab marks it merged once the octopus merge holds its head |
| P11 | !27 | !25, !26 | two conflicts kept, closed |
| P13 | !33 | !32 | the allowed step of the restricted configuration, closed |

___

## Section 3, 4 and 4bis

Every row of the GitHub table passed on GitLab with the same numbers, on the first pass (the harness
fixes of the GitHub run were already in):

| # | Check | Result |
|---|-------|--------|
| 1 to 3 | validations of !1 to !3 (scope, union of the yaml blocks, `NO_DELTA`, `PURGE_FLOW_VERSIONS`) | OK |
| 4a to 4c | deployments of integration | OK |
| 6, 8, 9 | P1 !7: one row per story, scope `#1, #3, #7`, keyword inherited, deployed | OK |
| 11a to 11d | !4 and !5 into uat | OK |
| 12, 13a, 13b | P2 !8: the P1 merge opened up, scope `#4, #8` | OK |
| 15, 16a, 16b | P3 !9: S3 alone, #4 marked already promoted | OK |
| 17a, 17b | hotfix !6 | OK |
| 18, 19a, 19b | P4 !10: two levels of vehicle, both keywords inherited, manual actions in main | OK |
| 21, 21b, 22 | release notes list !3, !4, !6, not !10; `--include-promotions` adds !10 | OK |
| 23a, 23b | retrofit !11: go-live expanded, stories already deployed | OK |
| 11 checkpoints | `before-p1`, `p1-open`, `after-p1`, `before-p2`, `p2-open`, `before-p3`, `p3-open`, `after-p3`, `p4-open`, `after-golive`, `after-retrofit` | OK, identical windows and counters to GitHub |

The DevOps Pipeline invariants (one branch per story, counter equal to the list, no `data-count`
marker on an empty branch, open promotion on its arrow) held at every checkpoint and on the final
state (`pipeline-final`: main !3, !4, !6; preprod 15 stories; uat and integration empty).

## Section 6, the edge cases

| # | Case | Result |
|---|------|--------|
| 24 to 26 | already promoted, empty cherry-pick, with a dirty report folder | OK |
| 27, 27b, 29b | conflict undone once, no `not found` line | OK |
| 28, 29 | conflict kept, prompt saved, embedded, asks for the commit message | OK |
| 30, 30b | two conflicts kept for all | OK |
| 31 to 34 | marker guard with its comment, solved, outside force-app, committed report | OK (`gl_fetch_merge_ref` waited for the merge ref) |
| 35, 35b | merge request creation refused | **FAIL on the first pass, product defect, fixed in `e39dec046`, then OK** |
| 36 | deployment from a promotion branch | OK |
| 37 | feature off | OK |
| 38, 39 | hand-named, retargeted | OK |
| 40 | grouped merge commit | OK |
| 41, 41b | unreadable declaration `!999`, P9 deployed | OK |
| 42, 42b, 44, 45 | sync merge: one row per story, one cherry-pick, two levels of vehicle, boundary | OK |
| 46 | back-merge: one `-` row | OK |
| 47, 47a, 48, 48a | octopus, and octopus with a promotion side (`#31, #23`, never `#24`) | OK |
| 49, 51 | sync inside a story, branch merged twice | OK |
| 50 | supersede | OK |
| 52a to 52c | full merge after the partial promotions | OK |
| 53a to 53e, 54 | restricted steps (command and pipeline), undeclared steps | OK |

### The defect: no merge request number without the provider

Case 35 runs `promotion:create` with no GitLab token, as a developer without one would. The listing
warned that the git provider was unreachable, then every candidate came out as a `-` row
(`- | feature/E2E-101-alpha`, `- | feature/E2E-103-gamma`...) and the command stopped with
`Pull Request(s) #1 are not among the Pull Requests waiting for promotion (-)`.

The numbers are in the commits: GitLab writes `Merge branch 'X' into 'Y'` as the subject and
`See merge request group/project!1` in the body. `listMergedPrsWithCommits` passed only the subject
(`message` in simple-git) to `extractPrNumbersFromMessage`, so the GitLab pattern that function
already has never saw the text it is written for. With a token the numbers came from the provider's
merged merge requests, which is why every other case passed. GitHub puts the number in the subject
and was not affected.

Fixed in `src/common/utils/backpromoteUtils.ts` (`e39dec046`): `extractPrNumbersFromCommit` keeps the
subject first, then reads only the `See merge request ...!N` sentence of the body, never a generic
`#N` a description may hold. Used by the candidate listing, the provider matching and the vehicle
detection. Three unit tests. `yarn compile`, `yarn lint`, `npx mocha "test/**/*.test.ts"` (1970
passing, 1 pending) green. Proven again live: `preprod -> main` for !5 with no token lists `#1`,
`#3`, `#4`, `#5`... with their numbers, cherry-picks `#5`, pushes the branch, reports `Git provider is
not configured`, and prints the one-click `merge_requests/new` link with everything filled in.
Backpromote uses the same function; `-gl-9` reran section 6bis with the fix.

What stays in that degraded mode, identical on GitHub: the cherry-picks of earlier promotions show
as extra `-` rows, and a story row can carry a vehicle number (`#4, #7` on GitHub), because only the
provider knows which merge requests are promotions or syncs. The command warns about it.

### Section 5bis and 7bis

```
694 checks over 34 Pull Requests (gitlab)
OK: every sfdx-hardis Pull Request comment is consistent

integration | 7 | #31, #30, #22, #21, #13, #12, #11
uat         | 6 | #32, #26, #25, #5, #23, #1
preprod     | 2 | #29, #2
main        | 3 | #4, #3, #6
OK: every Pull Request number appears in a single branch
With 'show merge and promotion Pull Requests' on: integration=7 uat=10 preprod=6 main=4
```

### Section 7ter, the flag-off regression check

Two pairs on `-gl-7` with `enablePromotionBranches: false`: open feature merge request !35 into
uat, open `integration -> uat` merge request !37 (after story !36), the deployment of uat and the
release notes. Branch under test from the working copy (`272abcbeb` plus `62462c485`, neither
touching these jobs), `origin/main` from the worktree `C:/tmp/sfdx-hardis-main-0913`, both through
`bin/dev.js`. The second pair:

```
check-feature-mr35.log: 127 lines vs 120 lines, only in A: 0, only in B: 0
check-major-mr37.log:   133 lines vs 126 lines, only in A: 0, only in B: 0
deploy-uat.log:         109 lines vs  94 lines, only in A: 0, only in B: 0
release-notes.log:       81 lines vs  78 lines, only in A: 0, only in B: 0
release-notes.md:        40 lines vs  40 lines, only in A: 0, only in B: 0
TOTAL DIFFERING LINES: 0
```

The line counts differ only by `git config --null --show-origin --get-all remote.origin.url`, which
`ab-diff.py` ignores (the stale `CI_PROJECT_ID` guard of runbook section 7ter). `origin/main` runs
it once per GitLab provider instance, the branch once per process, because the provider instance is
now cached: 8 -> 1 call in each validation, 16 -> 1 in the deployment, 4 -> 1 in the release notes.
That is the "provider instance cached per process" change, visible from the outside.

___

## Backpromote (Beta), section 6bis

`nicolas.vuillamy/sfdx-hardis-promo-e2e-gl-8`, merge requests !1 to !11, developer branch
`feature/E2E-401-dev`, backpromote branch `backpromote/integration/devorg1`. **63 checks, 63 OK, 0
FAIL, on the first pass.** Every step of the GitHub table (B0 to B16, C1 to C4) passed with the same
expectations: the "Backpromotes" notes written and read on merge requests, the history found on the
newest merge request holding a row, the refresh of B14 with two sandbox rows per merge request, the
branch pushed with the merges of B9 and B10 and deleted by B16. `bp_merge` waited for GitLab to
report the pushed actions file as the head of each merge request before merging.

| Step | Result |
|------|--------|
| B0, B1, B1c, B2 | OK |
| B3 (first plan, plan from !1, progress file, checkout untouched) | OK |
| B4 and C1 | OK |
| B5 and C2 | OK |
| B6 | OK |
| B7 | OK |
| B8 and C3 | OK |
| B9 (agent protocol, diff3 markers, pushed) | OK |
| B10 (panel protocol) | OK |
| B11 | OK |
| B12 | OK |
| B13 | OK |
| B14 and C4 | OK |
| B15 | OK |
| B16 | OK |
| B17 terminal prompts | NOT COVERED |

### The rerun on `-gl-9`

Run with `b60271506` (retrieve project) and `e39dec046` (merge request numbers from the commit body)
built, to prove both on GitLab. **63 checks, 63 OK.** Another session working in the same copy of
sfdx-hardis ran `yarn compile` at 05:16 UTC, in the middle of the run, and built `62462c485` (the
dirty tree stash now stages the changed files and runs `git stash push --staged`). Every call from
`bp-run-left-out` (the second half of B8) to B16 ran that build, so **B13, the dirty tree stash,
passed on GitLab with `62462c485`**; B0 to the first half of B8 ran `e39dec046` without it. The
GitHub runs (`-16`, `-17`) predate `62462c485`: their B13 does not cover it.

___

## Performance, GitLab against GitHub

### Backpromote (same code, `7efe8867f`)

| Figure | GitHub `-16` | GitLab `-gl-8` |
|--------|--------------|----------------|
| plans with a window (8 calls), median | 56.0 s | 55.9 s |
| every plan (16 calls), median | 21.4 s | 21.9 s |
| runs (16 calls), median | 44.3 s | 45.5 s |
| retrieve on a cache miss (10 calls), median | 29.0 s | 28.7 s |
| slowest call | `bp-run-exclude` 105.8 s | `bp-run-refresh` 81.2 s |
| all backpromote calls | 1334 s | 1317 s |

| Step | GitHub median / worst (s) | GitLab median / worst (s) |
|------|---------------------------|---------------------------|
| startup | 7.8 / 10.5 | 7.4 / 15.5 |
| gitProvider | 0.0 / 0.0 | 0.4 / 0.5 |
| targetOrg | 0.7 / 2.0 | 0.5 / 1.2 |
| fetch | 1.4 / 3.9 | 1.4 / 3.3 |
| listing | 0.8 / 1.0 | 0.5 / 0.7 |
| history | 0.3 / 3.8 | 0.3 / 2.7 |
| delta | 0.6 / 18.1 | 0.6 / 22.9 |
| actions | 0.0 / 2.6 | 0.0 / 1.4 |
| retrieve | 0.0 / 45.0 | 0.0 / 50.3 |
| compare | 11.7 / 14.9 | 11.8 / 15.8 |
| checkout | 0.7 / 1.9 | 0.7 / 1.9 |
| preActions | 0.0 / 4.6 | 0.0 / 1.9 |
| merges | 0.5 / 1.0 | 0.4 / 1.1 |
| deploy | 13.8 / 27.2 | 14.7 / 17.5 |
| destructive | 17.0 / 17.0 | 19.8 / 19.8 |
| postActions | 0.0 / 4.6 | 0.0 / 2.1 |
| comments | 1.9 / 2.9 | 1.0 / 2.0 |
| push | 2.8 / 3.1 | 2.8 / 3.2 |

Slowest GitLab calls: `bp-run-refresh` 81.2 s (retrieve 28.3, delta 18.3, deploy 13.6),
`bp-run-keep-org` 80.2 s (retrieve 50.3, delta 16.0), `bp-run-exclude` 78.1 s, `bp-plan-diff` 72.9 s
(retrieve 29.5, delta 22.9, startup 15.5).

The two providers are within a second of each other on every median. GitLab spends 0.4 s checking the
token (a `/user` call GitHub does not need), and writes its notes faster (1.0 s against 1.9 s). The
time is in the Salesforce CLI child processes (`sf sgd:source:delta`, `sf project retrieve preview`,
`sf project retrieve start`, `sf project deploy start`) and the 7 s startup, which do not depend on
the provider. The improvement of the retrieve step is described in the GitHub report (29.0 s -> 16.9
s on a cache miss).

### The retrieve project change on GitLab (`-gl-8` before, `-gl-9` after)

| Figure | before | after |
|--------|--------|-------|
| plans with a window (8 calls), median | 55.9 s | 44.6 s |
| every plan (16 calls), median | 21.9 s | 24.3 s |
| runs (16 calls), median | 45.5 s | 41.0 s |
| retrieve on a cache miss (10 calls), median | 28.7 s | 16.4 s |
| all backpromote calls | 1317 s | 1254 s |
| slowest call | `bp-run-refresh` 81.2 s | `bp-run-refresh` 79.7 s (retrieve 32.6) |

The same gain as on GitHub (29.0 s -> 16.9 s): about 12 s off every retrieve the cache cannot serve.
Single calls still reach 50 s in the retrieve step (`bp-plan-s8` 52.2 s, `bp-agent-waiting` 49.4 s)
when the Salesforce retrieve itself waits in the org.

### Promotion jobs

| Kind | GitHub calls, median / worst (s) | GitLab calls, median / worst (s) |
|------|----------------------------------|----------------------------------|
| check | 18, 71.1 / 85.4 | 18, 67.2 / 89.1 (`edge-full-merge`) |
| deploy | 13, 74.5 / 106.6 | 13, 69.2 / 128.0 (`deploy-preprod-promotion-nested`) |
| promote | 20, 18.7 / 23.0 | 20, 18.1 / 24.2 |
| list-candidates | 4, 14.1 / 15.3 | 4, 13.2 / 18.2 |
| release-notes | 2, 28.6 / 28.7 | 2, 29.2 / 30.1 |

The GitLab check time excludes the wait for the merge ref (`gl_fetch_merge_ref`), which is the
harness reproducing what a GitLab CI job gets for free.

___

## What this run did not cover

- **B17**, the terminal prompts of backpromote.
- **The VS Code panels are not clicked**; the DevOps Pipeline is asserted through its data provider
  and the mermaid text, the Backpromote panel through the `--json` documents it reads.
- **The retry of a note read after a dropped connection** did not happen during the run.
- **"Commit this and every following conflict"** answered through `--on-conflict commit-with-markers`.
- **A real GitLab CI job**: every job is the CLI run locally with the CI variables; the
  `DEPLOY_BRANCHES` side of the "deployment from a promotion branch" case is the error message only.
- **Bitbucket and Azure DevOps** were not run.
- **One shared Salesforce org** for the four levels.
