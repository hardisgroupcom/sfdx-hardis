# Promotion branches and backpromote: end to end test on GitHub

**Date:** 2026-09-13 (supersedes the run of 2026-09-12)
**Repositories under test (private, created empty for this run):**

- promotion branches: `nvuillam/sfdx-hardis-promo-e2e-15`
- backpromote (Beta): `nvuillam/sfdx-hardis-promo-e2e-16` (code of `7efe8867f`), then
  `nvuillam/sfdx-hardis-promo-e2e-17` (the same steps again after the retrieve project change below)

**Salesforce org:** `nicolas.vuillamy.c8024b5deb9f@agentforce.com` (developer org, Dev Hub), shared
with GitLab. Scratch orgs `promo-e2e-dev` and `promo-e2e-dev2` (sandbox name `devorg1`), reset to
the base project by `backpromote-setup.sh` before each backpromote run.
**sfdx-hardis:** `feat/backpromote-panel`, `7efe8867f` at the start, `272abcbeb` plus the skill commit at the end.
Every call went through `bin/run.js` after `yarn compile` (see "Performance" for why not `bin/dev.js`).
**vscode-sfdx-hardis:** `feat/backpromote-panel`, `1b1eab85`, compiled with `yarn compile`, not
modified by this run.

Every job is a real `deploy:smart`, `promotion:create`, `promotion:list-candidates`,
`doc:release-notes` or `work:backpromote` against the org, run locally with the GitHub Actions
variables set. Two repositories, not one: `backpromote-setup.sh` opens the same branch names as the
User Stories of section 3.

**This run is the first one where sections 3, 4 and 6 are scripted** (`promotion-run.sh`,
`promotion-edge.sh`, over `promotion-provider.sh`), so GitHub and GitLab ran exactly the same steps
and assertions. Earlier runs typed section 6 by hand.

___

## Counts

| Section                                                                              | Checks                           | OK                         | FAIL |
|--------------------------------------------------------------------------------------|----------------------------------|----------------------------|------|
| 3, 4 and 4bis: stories, promotions, release notes, retrofit, 11 pipeline checkpoints | 40                               | 40                         | 0    |
| 6: edge cases (groups g1 to g6)                                                      | 47                               | 47                         | 0    |
| 5bis: Pull Request comment audit                                                     | 700 checks over 36 Pull Requests | all                        | 0    |
| 7bis: single place in the diagram                                                    | 1                                | 1                          | 0    |
| 6bis: backpromote B0 to B16, C1 to C4, on `-16`                                      | 63                               | 63                         | 0    |
| 6bis again on `-17`, after the retrieve project change                               | 63                               | 63                         | 0    |
| 7ter: flag-off A/B against `origin/main` (`2685237d3`), second pair                  | 5 files compared                 | `TOTAL DIFFERING LINES: 0` | 0    |

Six assertions failed on their first pass and were all harness defects, not product defects: each
was fixed in the script, the log was read by hand, and the case was run again (details in "What the
run found"). The counts above are after that. No product defect was found by the functional part of
the run.

___

## The pipeline

`integration` -> `uat` -> `preprod` -> `main`, one org, `enablePromotionBranches: true`,
`allowedPromotionSteps` with the three steps, delta deployment on, Apex test classes on, always
merged with a merge commit.

| Story | Pull Request | Branch                    | Target      | Actions                   | Test classes                            | Keyword                  |
|-------|--------------|---------------------------|-------------|---------------------------|-----------------------------------------|--------------------------|
| S1    | #1           | `feature/E2E-101-alpha`   | integration | pre command + post manual | `PromoE2EAlphaTest`, `PromoE2EBetaTest` | -                        |
| S2    | #2           | `feature/E2E-102-beta`    | integration | post command              | -                                       | `NO_DELTA`               |
| S3    | #3           | `feature/E2E-103-gamma`   | integration | pre command               | `PromoE2EBetaTest`                      | `PURGE_FLOW_VERSIONS`    |
| S4    | #4           | `feature/E2E-201-delta`   | uat         | pre command + post manual | `PromoE2EAlphaTest`                     | -                        |
| S5    | #5           | `feature/E2E-202-epsilon` | uat         | post command              | -                                       | -                        |
| S6    | #6           | `feature/E2E-301-hotfix`  | preprod     | pre command + post manual | `PromoE2EBetaTest`                      | `FLOW_DELETE_INTERVIEWS` |

S1 declares its two test classes in two separate yaml blocks. The edge cases add #11 (retrofit),
#12 and #13 (the conflicting pair), #15 (hand-named), #16 (retargeted), #19 (sync `integration ->
uat`), #21 and #22 (a branch merged twice), #23 (a story carrying a sync merge), #25 and #26 (the
pair promoted together), #28 (back-merge), #29 to #31 (the octopus sides), #34 (full `uat ->
preprod` merge) and #35 (the story of the restricted steps case).

## The promotions

| Promotion | Pull Request | Carries    | Outcome                                                                                                            |
|-----------|--------------|------------|--------------------------------------------------------------------------------------------------------------------|
| P1        | #7           | #1, #3     | merged, deployed to uat                                                                                            |
| P2        | #8           | #4         | merged, deployed to preprod                                                                                        |
| P3        | #9           | #3         | merged, deployed to preprod: a story P1 carried, promoted alone                                                    |
| P4        | #10          | #4, #3, #6 | merged, deployed to main                                                                                           |
| P5        | #14          | #13        | committed with conflict markers, gate red, solved, gate green, superseded by #24                                   |
| P6        | -            | #1         | Pull Request creation refused: branch pushed, no Pull Request                                                      |
| P7, P8    | #17, #18     | #1         | the supersede case: #17 closed by #18, #18 closed by #20                                                           |
| P9        | #20          | #2         | a story of the sync merge, merged and deployed to preprod                                                          |
| P10       | #24          | #23        | the story that carried a sync merge; GitHub marks it merged when the octopus merge brought its head into uat       |
| P11       | #27          | #25, #26   | two conflicts in one promotion, both committed with markers, closed                                                |
| -         | #32, #33     | #5         | created by the first pass of the restricted steps case, whose config edit did not apply (harness defect 5), closed |
| P13       | #36          | #35        | the allowed step of the restricted configuration, closed                                                           |

___

## Section 3, 4 and 4bis

| #        | Check                                          | Expected                                                                                                                                            | Result                                                                                                                 |
|----------|------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------|
| 1        | `check-pr1`                                    | scope `#1` alone, union of the two yaml blocks, `RunSpecifiedTests`, manual action skipped                                                          | OK                                                                                                                     |
| 2        | `check-pr2`                                    | `NO_DELTA` read, `Deployment mode: FULL`, `NoTestRun`                                                                                               | OK                                                                                                                     |
| 3        | `check-pr3`                                    | `PURGE_FLOW_VERSIONS` adds a pre-deploy action, skipped in a validation job                                                                         | OK                                                                                                                     |
| 4a       | `deploy-integration-pr1`                       | pre action skipped (already run), manual action runs                                                                                                | OK (first pass FAIL: the harness wanted `Successfully deployed`, the job used a quick deploy; log read, pattern fixed) |
| 4b, 4c   | `deploy-integration-pr2`, `-pr3`               | scope of one Pull Request, FULL for #2, Purge Flow Versions runs for #3                                                                             | OK                                                                                                                     |
| cp       | `pipeline-before-p1`                           | integration #1, #2, #3; the others empty; no arrow                                                                                                  | OK                                                                                                                     |
| 6        | `promotion-integration-uat`                    | P1 #7 carries #1 and #3, one row per story                                                                                                          | OK                                                                                                                     |
| cp       | `pipeline-p1-open`                             | #7 on the `integration -> uat` arrow, no node of its own, integration unchanged                                                                     | OK                                                                                                                     |
| 8        | `check-promotion-uat`                          | scope `#1, #3, #7`, `PURGE_FLOW_VERSIONS` inherited, no `NO_DELTA`, both test classes                                                               | OK                                                                                                                     |
| 9        | `deploy-uat-promotion`                         | Purge Flow Versions runs, manual action of #1 runs in uat                                                                                           | OK                                                                                                                     |
| cp       | `pipeline-after-p1`                            | uat #1, #3; integration #2; arrow empty                                                                                                             | OK                                                                                                                     |
| 11a-d    | `check-pr4`, `check-pr5` and their deployments | scope of one Pull Request each                                                                                                                      | OK                                                                                                                     |
| cp       | `pipeline-before-p2`                           | uat #1, #3, #4, #5                                                                                                                                  | OK                                                                                                                     |
| 12       | `promotion-uat-preprod`                        | the P1 merge opened up into rows #1 and #3, P2 #8 carries #4, no row for #7                                                                         | OK                                                                                                                     |
| cp       | `pipeline-p2-open`                             | #8 on the `uat -> preprod` arrow, uat unchanged                                                                                                     | OK                                                                                                                     |
| 13a, 13b | check and deployment of P2                     | scope `#4, #8`, manual action of #4 runs in preprod                                                                                                 | OK                                                                                                                     |
| cp       | `pipeline-before-p3`                           | uat #1, #3, #5; preprod #4                                                                                                                          | OK                                                                                                                     |
| 15       | `promotion-uat-preprod-nested`                 | promoting 3 carries S3 alone, #4 marked `Already promoted by` P2                                                                                    | OK                                                                                                                     |
| cp       | `pipeline-p3-open`                             | #9 on the arrow                                                                                                                                     | OK                                                                                                                     |
| 16a, 16b | check and deployment of P3                     | scope `#3, #9`, `PURGE_FLOW_VERSIONS` inherited                                                                                                     | OK                                                                                                                     |
| cp       | `pipeline-after-p3`                            | uat #1, #5; preprod #3, #4                                                                                                                          | OK                                                                                                                     |
| 17a, 17b | hotfix #6 into preprod                         | scope `#6`, manual action runs in preprod                                                                                                           | OK                                                                                                                     |
| 18       | `promotion-preprod-main`                       | P4 #10 carries #4, #3, #6, no row for #8 or #9                                                                                                      | OK                                                                                                                     |
| cp       | `pipeline-p4-open`                             | #10 on the `preprod -> main` arrow, preprod #3, #4, #6                                                                                              | OK                                                                                                                     |
| 19a, 19b | check and deployment of P4                     | 4 Pull Requests in scope, both keywords inherited, manual actions of #4 and #6 run in main                                                          | OK                                                                                                                     |
| cp       | `pipeline-after-golive`                        | main #3, #4, #6; preprod empty; uat #1, #5; integration #2                                                                                          | OK                                                                                                                     |
| 21, 21b  | `release-notes`                                | #3, #4, #6, not the vehicle #10                                                                                                                     | OK                                                                                                                     |
| 22       | `release-notes --include-promotions`           | #10 next to the stories                                                                                                                             | OK                                                                                                                     |
| 23a, 23b | retrofit #11 check and deployment              | `Promotion Pull Request 10 adds 3 carried Pull Request(s)`, each story `already deployed through promotion branch(es)`, actions already run skipped | OK                                                                                                                     |
| cp       | `pipeline-after-retrofit`                      | main #3, #4, #6; integration #2, #11                                                                                                                | OK                                                                                                                     |

### What changed in the DevOps Pipeline, and what the checkpoints prove

The "Show already promoted Pull Requests" toggle and its setting are gone. The eleven checkpoints
(five before, six added by this run: `before-p2`, `p2-open`, `p3-open`, `after-p3`, `p4-open`,
`after-retrofit`) read the node marker `data-count='N'` from the mermaid the extension builds, with a
missing marker counted as 0, and assert at every point that:

- a story is listed in one branch only (after each promotion, the stories it carried left the
  branch they came from: `after-p1`, `after-p3`, `after-golive`),
- the counter equals the length of the list the branch window shows,
- a branch with no story has no marker at all (every `0` in the table above is a missing marker),
- an open promotion is drawn on its arrow and takes nothing out of the source branch.

A final check after section 6 (`pipeline-final`: main #3, #4, #6; preprod 14 stories; uat #35;
integration empty) passed the same invariants on 36 Pull Requests.

## Section 6, the edge cases

| #       | Case                                   | Expected                                                                                                                                | Result                                                                                                 |
|---------|----------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------|
| 24, 24b | Already promoted                       | table marks #4 with P2's branch, warning names `--include-already-promoted`, exit 1, no branch                                          | OK                                                                                                     |
| 25, 25b | Empty cherry-pick                      | `Nothing to cherry-pick for #4`, `there is nothing to promote and no branch was created`, exit 0, tree clean                            | OK (first pass FAIL on the word `conflict` in git's own output; pattern fixed)                         |
| 26      | Empty cherry-pick, dirty report folder | same with an untracked file in `hardis-report/`                                                                                         | OK                                                                                                     |
| 27, 27b | Conflict, agent default                | `Cherry-pick conflict on #13 ... (NOTES.md, CustomLabels...)`, one `Undoing promotion branch` line, no `not found`                      | OK                                                                                                     |
| 28      | Conflict, kept                         | #14 created, prompt saved and embedded                                                                                                  | OK                                                                                                     |
| 29      | Conflict prompt commit message         | prompt asks to commit with a message whose body carries one line per file and story; description embeds it in `<details>`               | OK (first pass FAIL: the harness looked for "commit message", the prompt says "Commit with a message") |
| 29b     | Abort once                             | a conflicted promotion from uat undone once, no `not found`                                                                             | OK                                                                                                     |
| 30, 30b | Conflict, kept for all                 | `Applying the conflict handling chosen earlier` printed twice, both stories committed                                                   | OK (through `--on-conflict commit-with-markers`)                                                       |
| 31, 31b | Marker guard                           | job fails naming 2 files, the validation comment carries the failure and the files                                                      | OK                                                                                                     |
| 32      | Marker guard, solved                   | validation green, scope `#13, #14`                                                                                                      | OK (first pass FAIL: harness defect 2, stale merge ref)                                                |
| 33      | Conflict outside force-app             | `NOTES.md` named                                                                                                                        | OK                                                                                                     |
| 34      | Committed conflict prompt report       | still `2 file(s)`                                                                                                                       | OK                                                                                                     |
| 35, 35b | Pull Request creation refused          | branch pushed, reason, one-click link                                                                                                   | OK (GitHub CLI off `PATH` and no token)                                                                |
| 36      | Deployment from a promotion branch     | stops, naming the branch                                                                                                                | OK                                                                                                     |
| 37      | Feature off                            | `looks like a promotion branch, but enablePromotionBranches is not set`, scope `#14` alone                                              | OK (rerun on the fresh merge ref)                                                                      |
| 38      | Hand-named branch                      | warning, scope `#15`, declaration ignored                                                                                               | OK                                                                                                     |
| 39      | Retargeted promotion                   | warning, scope `#16`, no action of #1 or #5 against main                                                                                | OK (first pass FAIL: harness defect 3, an empty resource file)                                         |
| 40      | Grouped merge commit                   | `is a merge commit: cherry-picking it also carries` before the cherry-pick                                                              | OK                                                                                                     |
| 41, 41b | Unreadable declaration                 | `Pull Request #999 declared by promotion Pull Request 20 was not found: skipped`; P9 deployed                                           | OK                                                                                                     |
| 42, 42b | Story brought in by a sync merge       | rows #2, #12, #13; one cherry-pick; `promotionPullRequests: [2]`                                                                        | OK                                                                                                     |
| 44      | Two levels of vehicle                  | the retrofit row `#11, #6, #3, #4`, never #10                                                                                           | OK                                                                                                     |
| 45      | Vehicle boundary                       | #12 and #13 keep one number each                                                                                                        | OK                                                                                                     |
| 46      | Back-merge from the target branch      | one row labelled `-`, no row for #6                                                                                                     | OK                                                                                                     |
| 47, 47a | Octopus merge                          | three parents; one row `#30, #23, #22, #21`, no own row for #30 or #21                                                                  | OK                                                                                                     |
| 48, 48a | Promotion that cannot be opened up     | row `#31, #23`, never #24                                                                                                               | OK                                                                                                     |
| 49      | Sync merge inside a story              | #23 alone, closes the open P5                                                                                                           | OK                                                                                                     |
| 50      | Supersede a promotion                  | #17 named and closed, #1 offered unmarked                                                                                               | OK                                                                                                     |
| 51      | Branch merged twice                    | rows #21 and #22, no `-` row                                                                                                            | OK                                                                                                     |
| 52a-c   | Full merge after a partial promotion   | #2 `already deployed through ... (#20)`, #5 runs its action for the first time; afterwards `No Pull Request merged into uat is waiting` | OK                                                                                                     |
| 53a-e   | Restricted promotion steps             | integration refused, `uat -> main` refused, `uat -> preprod` works, pipeline offers `uat>preprod` only, then the three steps again      | OK (first pass FAIL: harness defect 5, CRLF)                                                           |
| 54      | Promotion steps not declared           | stops before listing                                                                                                                    | OK (same)                                                                                              |
| 55      | Two yaml blocks with the same key      | union selected                                                                                                                          | OK (test 1)                                                                                            |

### Section 5bis and 7bis

```
700 checks over 36 Pull Requests (github)
OK: every sfdx-hardis Pull Request comment is consistent

integration | 7 | #31, #30, #22, #21, #13, #12, #11
uat         | 6 | #35, #26, #25, #5, #23, #1
preprod     | 2 | #29, #2
main        | 3 | #4, #3, #6
OK: every Pull Request number appears in a single branch
With 'show merge and promotion Pull Requests' on: integration=7 uat=10 preprod=6 main=4
```

### Section 7ter, the flag-off regression check

Two pairs run on `-15` with `enablePromotionBranches: false`: an open feature Pull Request
#37 into uat, an open `integration -> uat` Pull Request #39 (after story #38), the deployment of uat
and the release notes. The branch under test ran from the working copy, `origin/main` from a
separate worktree (`C:/tmp/sfdx-hardis-main-0913`, `node_modules` junctioned), both through
`bin/dev.js`. The second pair:

```
check-feature-pr37.log: 119 lines vs 119 lines, only in A: 0, only in B: 0
check-major-pr39.log:   126 lines vs 126 lines, only in A: 0, only in B: 0
deploy-uat.log:          93 lines vs  93 lines, only in A: 0, only in B: 0
release-notes.log:       77 lines vs  77 lines, only in A: 0, only in B: 0
release-notes.md:        40 lines vs  40 lines, only in A: 0, only in B: 0
TOTAL DIFFERING LINES: 0
```

The branch had `b60271506` and `e39dec046` at that point: neither touches `deploy:smart`, the
release notes, or anything this pass runs with the feature off.

___

## Backpromote (Beta), section 6bis

`nvuillam/sfdx-hardis-promo-e2e-16`, eleven stories `#1` to `#11` merged into `integration` as the
steps need them, developer branch `feature/E2E-401-dev`, backpromote branch
`backpromote/integration/devorg1`. **63 checks, 63 OK, 0 FAIL.** The same 63 checks passed again on
`-17` with the retrieve project change.

| Step | What                                                     | Expected                                                                                                                            | Result                       |
|------|----------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------|------------------------------|
| B0   | no provider variable                                     | `blocked` on `gitProvider`; the run exits 1 with the message                                                                        | OK                           |
| B1   | `targetUsername` of `uat` pointed at the scratch org     | `blocked`, `targetOrg` names `uat`                                                                                                  | OK                           |
| B1c  | `--parent-branch feature/E2E-105-apex`                   | `blocked`, not an allowed parent branch                                                                                             | OK                           |
| B2   | production org                                           | `blocked`, "production"                                                                                                             | OK                           |
| B3   | first plan, then the plan from `#1` with a progress file | no history, nothing selected; then the window from #1, three items, four actions, `missingInOrg`; 13 progress lines; checkout clean | OK                           |
| B4   | `--auto --from-pull-request 1`                           | 3 deployed, actions run, manual pending, comments on #1 to #3, checkout on the backpromote branch, not pushed; **C1**               | OK                           |
| B5   | up to date, confirm `e2e-manual-1`                       | `nothingToDo`; `confirm`; **C2**                                                                                                    | OK                           |
| B6   | new story #4                                             | #4 selected by default, 1 deployed                                                                                                  | OK                           |
| B7   | `E2E_S2` changed in the org, `=git`                      | `different`, three-way; the org holds the git version                                                                               | OK                           |
| B8   | `=org`, then back                                        | `keptOrg`, **C3** `partial`; next plan starts at #6 again; then deployed                                                            | OK                           |
| B9   | agent protocol                                           | `waitingForMerges` with diff3 markers and a prompt; then `ok`, pushed, both lines in the org                                        | OK                           |
| B10  | panel protocol                                           | `prepare`; `conflictsRemaining` exit 1 with nothing deployed; then `ok`, both lines                                                 | OK                           |
| B11  | deletion                                                 | listed; skipped with `--skip-destructive`; deleted on the redeploy                                                                  | OK                           |
| B12  | excluded item                                            | `E2E_S6` excluded, flagged next time, then deployed                                                                                 | OK                           |
| B13  | dirty tree                                               | `checkout.clean` false; stashed under the run id; `git stash pop` brings `NOTES.md` back                                            | OK                           |
| B14  | refreshed sandbox                                        | `beforeRefresh`, nothing selected; actions replayed; **C4** two sandbox rows                                                        | OK                           |
| B15  | scan limit                                               | `read` 2, `hasMore` true                                                                                                            | OK                           |
| B16  | reset                                                    | mode `reset`, branch deleted on origin                                                                                              | OK                           |
| B17  | terminal prompts                                         | -                                                                                                                                   | NOT COVERED (not scriptable) |

What changed since the last run and is proven by these steps: the provider instance cached per
process, the history walk ramp, one git call for the merge files, `ls-tree --full-tree`, the retrieve
cache validated by `SourceMember` (the scratch orgs are source-tracked: B7, B8, B12 and B14 read it),
the cache allowlist, the pending org changes queried in parallel (B7 `different`, B10), the adaptive
batches of the comment reads and writes (C1 to C4), and the retried comment reads (no dropped
connection happened in this run, so the retry path itself was not exercised).

___

## Performance

Wall-clock time of every job and backpromote call (`timings.tsv`), per-step times from the
`SFDX_HARDIS_PROGRESS_FILE` of every backpromote call, `timing-report.cjs` for the tables.

### Backpromote

| Figure                                                               | `-16`, before            | `-17`, after                                                               |
|----------------------------------------------------------------------|--------------------------|----------------------------------------------------------------------------|
| plans with a window (8 calls), median                                | 56.0 s                   | 45.1 s                                                                     |
| every plan (16 calls, refusals and "nothing to do" included), median | 21.4 s                   | 22.3 s                                                                     |
| runs (16 calls), median                                              | 44.3 s                   | 45.0 s                                                                     |
| retrieve step when the cache misses (10 calls), median               | 29.0 s                   | 16.9 s                                                                     |
| slowest call                                                         | `bp-run-exclude` 105.8 s | `bp-plan-s4` 162.4 s (a retrieve of one item that waited 121 s on the org) |
| all backpromote calls                                                | 1334 s                   | 1340 s                                                                     |

| Step                           | before, median / worst (s) | after, median / worst (s) |
|--------------------------------|----------------------------|---------------------------|
| startup (node, oclif, imports) | 7.8 / 10.5                 | 7.4 / 11.5                |
| gitProvider                    | 0.0 / 0.0                  | 0.0 / 0.0                 |
| targetOrg                      | 0.7 / 2.0                  | 0.5 / 1.6                 |
| fetch                          | 1.4 / 3.9                  | 1.4 / 5.6                 |
| listing                        | 0.8 / 1.0                  | 0.8 / 1.0                 |
| history                        | 0.3 / 3.8                  | 0.3 / 4.6                 |
| delta                          | 0.6 / 18.1                 | 0.5 / 28.7                |
| actions                        | 0.0 / 2.6                  | 0.0 / 2.3                 |
| retrieve                       | 0.0 / 45.0                 | 0.0 / 121.7               |
| compare                        | 11.7 / 14.9                | 11.5 / 15.8               |
| checkout                       | 0.7 / 1.9                  | 0.7 / 1.7                 |
| preActions                     | 0.0 / 4.6                  | 0.0 / 4.8                 |
| merges                         | 0.5 / 1.0                  | 0.5 / 0.8                 |
| deploy                         | 13.8 / 27.2                | 16.6 / 22.0               |
| destructive                    | 17.0 / 17.0                | 17.5 / 17.5               |
| postActions                    | 0.0 / 4.6                  | 0.0 / 4.9                 |
| comments                       | 1.9 / 2.9                  | 2.0 / 3.1                 |
| push                           | 2.8 / 3.1                  | 2.4 / 3.2                 |

Medians of 0.0 are steps the caches skip in most calls (delta and retrieve are cached per commit
range and per org). Slowest calls before the change: `bp-run-exclude` 105.8 s (retrieve 45.0,
deploy 27.2, delta 15.9), `bp-run-refresh` 98.2 s, `bp-run-keep-org` 77.5 s, `bp-plan-diff` 59.0 s
(retrieve 31.5, delta 15.8).

Where the time goes: the git provider is not the bottleneck any more (history, actions and comments
together stay under 5 s). Every step that takes more than a few seconds is a Salesforce CLI child
process: `delta` is `sf sgd:source:delta`, `retrieve` was `sf project generate` then
`sf project retrieve start`, `compare` in a run is the wait for `sf project retrieve preview` (started
in parallel, 12 to 15 s on its own), `deploy` is `sf project deploy start`. On Windows each child
process costs 7 to 15 s before it does anything.

### The improvement: no `sf project generate` in the retrieve

The retrieve of the sandbox versions created its blank project with `sf project generate`, a
Salesforce CLI process of its own (14.5 s measured alone on this machine) whose only useful output
is `sfdx-project.json` and `.forceignore`. `createRetrieveProject` now writes those two files
directly, with the same `.forceignore` as the template and the API version of the retrieve manifest.
Other commands keep `createBlankSfdxProject`.

- Before / after on the same 63 steps: retrieve on a cache miss 29.0 s -> 16.9 s (10 calls each),
  plans with a window 56.0 s -> 45.1 s. Runs did not move: their retrieve is served by the cache.
- Correctness: the 63 checks passed again on `-17`, including B7, B8, B9 and B10, which compare the
  retrieved versions with git, and B12 and B14, which retrieve items the cache does not hold.
- Unit test added (`createRetrieveProject()` in `test/common/utils/backpromoteOrgUtils.test.ts`);
  `yarn compile`, `yarn lint` and `npx mocha "test/**/*.test.ts"` (1967 passing, 1 pending) green.
- Commit `b60271506`.

Not changed, and why: the `delta` step (`sf sgd:source:delta`) and the pending org changes
(`sf project retrieve preview`) could only be sped up by running those tools in-process, which means
new dependencies or a rewrite of source tracking, not a small change. Starting the preview earlier
would save about 3 s per run and waste a CLI process on every "nothing to do" plan. The 7 to 8 s
startup is oclif and the plugin imports, shared by every sfdx-hardis command.

### Promotion jobs

| Kind                           | Calls | Median (s) | Worst (s) | Worst call                       |
|--------------------------------|-------|------------|-----------|----------------------------------|
| check (`deploy:smart --check`) | 18    | 71.1       | 85.4      | `check-promotion-preprod-nested` |
| deploy (`deploy:smart`)        | 13    | 74.5       | 106.6     | `deploy-integration-pr3`         |
| promote (`promotion:create`)   | 20    | 18.7       | 23.0      | `edge-supersede-second`          |
| list-candidates                | 4     | 14.1       | 15.3      | `edge-back-merge`                |
| release-notes                  | 2     | 28.6       | 28.7      | `release-notes`                  |

A validation or deployment job is dominated by the Salesforce deployment itself (`sf project
deploy start`, with the Apex tests of `RunSpecifiedTests`) and by the Salesforce CLI child processes
around it; this run did not profile inside `deploy:smart`, so no change was made there. GitLab is
within 5 % of GitHub on every kind of job (see the GitLab report).

___

## What the run found

### Product

No functional defect showed on GitHub: every promotion branches case, every pipeline checkpoint and
every backpromote step passed. One performance change in backpromote (above).

The GitLab run found one defect in code shared by both providers, fixed in `e39dec046`: the
candidate listing read Pull Request numbers from the subject of a merge commit only, and GitLab writes
`See merge request group/project!N` in the body, so a promotion listed without a reachable GitLab
had no number on any row. GitHub was not affected (its number is in the subject). Asked the same
question without a token, the GitHub listing of `preprod` also shows two artefacts of that degraded
mode that are not fixed: the cherry-picks of the promotions appear as `-` rows next to the
original merges, and vehicle numbers leak into story rows (`#4, #7`, `#25, #19`), because only the
provider knows which Pull Requests are promotions or syncs. The command already warns that this list
may offer stories already on their way.

### Harness (all fixed in the skill, each case rerun)

1. **`Successfully deployed` is not the only success line.** A deployment that reuses the validation
   job answers `Successfully processed QuickDeploy`: 4a failed on a green job.
2. **The GitHub API answers with the previous head for a while after a push.** `p_wait_merge_ref`
   compared the merge ref with `head.sha` from the API, which still named the old commit, so it
   returned at once and the "solved" validation ran on the merge ref with the markers. It now waits
   on the commit pushed locally. Runbook trap added.
3. **A new static resource copied its meta file from `E2E_S1`**, which is not on `main`: the
   retargeted branch got an empty `-meta.xml` and the validation failed on `Premature end of file`.
   The meta file is now written directly.
4. **Two text patterns were wrong**: the word `conflict` appears in git's own cherry-pick output,
   and the prompt says "Commit with a message", not "commit message".
5. **Git on Windows checks the config out with CRLF** (`core.autocrlf`), so the `\n` patterns that
   narrowed `allowedPromotionSteps` matched nothing, the commit was empty and the restricted and
   undeclared cases ran against the unchanged config: they created #32 and #33 instead of being
   refused. `set_steps` now normalises the line endings and `commit_steps` fails when nothing
   changed. Runbook trap added.
6. The local promotion branches of section 4 stay in the clone, so "no branch was created" is now
   a count before and after, not zero.

___

## What this run did not cover

- **B17, the terminal prompts of `hardis:work:backpromote`**: not scriptable, nobody answered them.
- **The VS Code Backpromote panel and the DevOps Pipeline are not clicked.** The pipeline is
  asserted through its own data provider and mermaid builder (`data-count` markers read from the
  text, never rendered). The panel reads the same `--json` documents this run asserts.
- **The retry of a comment read after a dropped connection** did not happen during the run.
- **The interactive answer "commit this and every following conflict"** was exercised through
  `--on-conflict commit-with-markers`.
- **Bitbucket** was not run (see its report). Azure DevOps was not run either: it was not asked
  for this cycle.
- **The four pipeline levels share one Salesforce org**, so deployment action state is keyed by org
  branch, not by distinct orgs.
- The `-17` rerun measured the improvement on GitHub only; the GitLab backpromote run used the code
  before it.
