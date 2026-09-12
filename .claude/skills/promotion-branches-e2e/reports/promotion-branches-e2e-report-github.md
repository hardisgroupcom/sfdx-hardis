# Promotion branches and backpromote: end to end test on GitHub

**Date:** 2026-09-12 (supersedes the run of 2026-09-09)
**Repositories under test:**

- promotion branches: `nvuillam/sfdx-hardis-promo-e2e-12` (private, created empty for this run)
- backpromote (Beta): `nvuillam/sfdx-hardis-promo-e2e-14` (private, created empty; `-11` and
  `-13` were the two earlier attempts of the same section, kept for their logs)

**Salesforce org:** `nicolas.vuillamy.c8024b5deb9f@agentforce.com` (developer org, Dev Hub)
**sfdx-hardis:** `feat/backpromote-panel`, `1eb6ab82b` plus the two uncommitted fixes this run landed
**vscode-sfdx-hardis:** `feat/backpromote-panel`, `f6001f80`, compiled with `yarn compile`

Two repositories, not one: `backpromote-setup.sh` opens `feature/E2E-101-alpha`,
`feature/E2E-102-beta` and `feature/E2E-103-gamma` itself, which are the branch names section 3 of
the runbook uses for the User Stories of the promotion pipeline. The runbook now says so.

Every job below is a real `deploy:smart` or `work:backpromote` against that org, run locally with
the GitHub Actions variables set, which is what the git provider reads.

___

## The pipeline

`integration` -> `uat` -> `preprod` -> `main`, one org, `enablePromotionBranches: true`,
`allowedPromotionSteps` with the three steps, delta deployment on, Apex test classes on, always
merged with a merge commit so the `-x` trailers of the cherry-picks survive.

| Story | Pull Request | Branch                    | Target      | Actions                   | Test classes                            | Keyword                  |
|-------|--------------|---------------------------|-------------|---------------------------|-----------------------------------------|--------------------------|
| S1    | #1           | `feature/E2E-101-alpha`   | integration | pre command + post manual | `PromoE2EAlphaTest`, `PromoE2EBetaTest` | -                        |
| S2    | #2           | `feature/E2E-102-beta`    | integration | post command              | -                                       | `NO_DELTA`               |
| S3    | #3           | `feature/E2E-103-gamma`   | integration | pre command               | `PromoE2EBetaTest`                      | `PURGE_FLOW_VERSIONS`    |
| S4    | #4           | `feature/E2E-201-delta`   | uat         | pre command + post manual | `PromoE2EAlphaTest`                     | -                        |
| S5    | #5           | `feature/E2E-202-epsilon` | uat         | post command              | -                                       | -                        |
| S6    | #6           | `feature/E2E-301-hotfix`  | preprod     | pre command + post manual | `PromoE2EBetaTest`                      | `FLOW_DELETE_INTERVIEWS` |

S1 declares its two test classes in **two separate yaml blocks** of its description.

Twenty-nine more Pull Requests exercise the edge cases: the retrofit (#11), the conflicting pair
(#12, #13), a hand-named branch (#15), a retargeted promotion (#16), the ordinary
`integration -> uat` sync (#19), a branch merged twice (#21, #22), a story carrying a sync merge of
its own (#23), the conflicting pair promoted together (#25, #26), the back-merge (#28), the preprod
only story (#29, #30), the octopus sides (#31, #32), the full `uat -> preprod` merge (#35) and the
two Pull Requests kept open for the flag-off comparison (#36, #38).

## The promotions

| Promotion | Pull Request | Branch                                     | Carries  | Outcome                                                                     |
|-----------|--------------|--------------------------------------------|----------|-----------------------------------------------------------------------------|
| P1        | #7           | `promotion/integration/uat/2026-09-12-0307` | #1, #3   | merged, deployed to uat                                                     |
| P2        | #8           | `promotion/uat/preprod/2026-09-12-0317`     | #4       | merged, deployed to preprod                                                 |
| P3        | #9           | `promotion/uat/preprod/2026-09-12-0321`     | #3       | merged, deployed to preprod: a story P1 had carried, promoted alone         |
| P4        | #10          | `promotion/preprod/main/2026-09-12-0327`    | #4,#3,#6 | merged, deployed to main, two levels of vehicle under it                    |
| P5        | #14          | `promotion/integration/uat/2026-09-12-0338` | #13      | assembled with conflict markers on purpose, gate red, solved, gate green    |
| P6        | -            | `promotion/uat/preprod/2026-09-12-0348`     | #1       | the "Pull Request creation refused" case: branch pushed, no Pull Request    |
| P7        | #17          | `promotion/uat/preprod/2026-09-12-0348-2`   | #1       | the supersede case, closed by P8                                            |
| P8        | #18          | `promotion/uat/preprod/2026-09-12-0349`     | #1       | the supersede run, closed by P9                                             |
| P9        | #20          | `promotion/uat/preprod/2026-09-12-0350`     | #2       | a story of the sync merge, merged and deployed to preprod                   |
| P10       | #24          | `promotion/integration/uat/2026-09-12-0355` | #23      | the story that carried a sync merge, later swallowed by the octopus merge   |
| P11       | #27          | `promotion/uat/preprod/2026-09-12-0357`     | #25, #26 | two conflicts in one promotion, both committed with markers, then closed    |
| P12       | #33          | `promotion/uat/preprod/2026-09-12-0402`     | #32, #23 | the octopus whose third side is a promotion branch                          |
| P13       | #34          | `promotion/uat/preprod/2026-09-12-0404`     | #5       | the allowed step of the restricted configuration, left open                 |

___

## What this run found

Three product defects, all fixed inside the run and proven again afterwards: one in the promotion
branches, two in backpromote (Beta), which had never been run end to end before. Four runbook rows
were wrong and six defects were found in the backpromote step script, which had never been run
either. Counts: **55 / 55 OK** for the promotion branches (sections 4 to 7ter, 0 FAIL) and
**63 / 63 OK** for backpromote (section 6bis, 0 FAIL), on top of the 697-check Pull Request comment
audit and a flag-off A/B at `TOTAL DIFFERING LINES: 0`.

### 1. The undo of a conflicted promotion ran twice and ended on an error line (fixed)

`cherryPickCandidates` undoes the promotion branch before rethrowing, and `create.ts` undoes again
in its catch. The second pass logged the undo a second time and then

```
[sfdx-hardis][PromotionCreate] error: branch 'promotion/uat/preprod/2026-09-12-0357-2' not found
```

right before the real error, which reads like the cleanup failed. Nothing was actually left behind,
but a red line at the end of a handled abort is exactly what sends a release manager looking for a
leftover branch.

Fixed in `src/common/utils/promotionCreateUtils.ts`: `abortPromotion` now returns straight away when
the local promotion branch is already gone, so the undo is idempotent and logs once. Proven again
with `edge-conflict-abort-once`: one `Undoing promotion branch` line, no `not found` warning, no
leftover branch. Covered by two unit tests on a throwaway git repository in
`test/common/utils/promotionAbort.test.ts`.

The two backpromote defects are in the backpromote section below.

### 2. Three runbook rows were wrong, and two traps were missing

None of them is a product defect; all four were corrected in
`reference/runbook.md`.

- **Back-merge from the target branch.** The row the candidate table keeps for the back-merge is
  labelled `-`, not `#28`. That is deliberate: `dropVehiclePullRequests` takes the number off a
  Pull Request whose source branch is a major branch, on every provider. The runbook only mentioned
  `-` rows as an Azure DevOps artefact, which would make a GitHub run report a defect.
- **Promotion that cannot be opened up.** The runbook said the candidate "keeps the promotion
  number". It does not: the declaration is expanded into the stories first, then the vehicle number
  is dropped, so the row reads `#32, #23` and never names the promotion. The behaviour is the one
  the feature wants, the sentence was not.
- **Restricted promotion steps.** Narrowing `allowedPromotionSteps` in the working tree without
  committing makes the cleanliness check fail before the step gate is reached, and the tree that
  counts is the one of the branch `promotion:create` checks out. The row now says to commit it on
  the source branch.
- **Two traps added**: the Dev Hub daily scratch org signup limit (see "What this run did not
  cover"), and the fact that section 6bis needs its own repository when section 4 also runs.

___

## Test groups

### Section 4, the run

| # | Check | Expected | Result |
|---|-------|----------|--------|
| 1 | `check-pr1` | scope `#1` alone, the union of the two yaml blocks (`PromoE2EAlphaTest`, `PromoE2EBetaTest`), `RunSpecifiedTests` | OK |
| 2 | `check-pr2` | `NO_DELTA` read, `Deployment mode: FULL`, `NoTestRun` | OK |
| 3 | `check-pr3` | `PURGE_FLOW_VERSIONS` adds a pre-deploy action, skipped in a validation job | OK |
| 4 | `deploy-integration-pr1..3` | actions already run are skipped, the manual action of #1 becomes pending in `integration` | OK |
| 5 | `pipeline-before-p1` | `integration` lists #1, #2, #3; `uat`, `preprod`, `main` empty; no promotion on any arrow | OK |
| 6 | `promotion-integration-uat` | P1 #7 carries #1 and #3, one candidate row per story | OK |
| 7 | `pipeline-p1-open` | #7 drawn on the `integration -> uat` arrow, no branch node of its own, nothing taken out of `integration` | OK |
| 8 | `check-promotion-uat` | scope `#1, #3, #7`, `Inherited PURGE_FLOW_VERSIONS from carried Pull Request(s) #3`, no `NO_DELTA` of the story left behind, union of the test classes | OK |
| 9 | `deploy-uat-promotion` | Purge Flow Versions runs, the manual action of #1 becomes pending in `uat` | OK |
| 10 | `pipeline-after-p1` | `uat` lists #1 and #3, `integration` keeps #2, arrow empty | OK |
| 11 | `check-pr4`, `check-pr5`, their deployments | scope of one Pull Request each | OK |
| 12 | `promotion-uat-preprod` | the P1 merge is opened up into rows `#1` and `#3`; P2 #8 carries #4 | OK |
| 13 | `check`/`deploy` of P2 | scope `#4, #8` | OK |
| 14 | `pipeline-before-p3` | `uat` lists #1, #3, #5; `preprod` lists #4 | OK (the expectation file was wrong at first: #3 was still in `uat`) |
| 15 | `promotion-uat-preprod-nested` | promoting `3` carries S3 alone, #4 marked `Already promoted by` | OK |
| 16 | `check`/`deploy` of P3 | scope `#3, #9`, `PURGE_FLOW_VERSIONS` inherited | OK |
| 17 | `check-pr6-hotfix` and its deployment | scope `#6`, manual action pending in `preprod` | OK |
| 18 | `promotion-preprod-main` | P4 #10 carries #4, #3, #6: two levels of vehicle opened up, no promotion number offered | OK |
| 19 | `check`/`deploy` of P4 | scope `#4, #3, #6, #10`, `PURGE_FLOW_VERSIONS` and `FLOW_DELETE_INTERVIEWS` inherited, manual actions of #4 and #6 pending in `main` | OK |
| 20 | `pipeline-after-golive` | `main` lists #3, #4, #6, none of them twice, counters follow | OK |
| 21 | `release-notes` | three User Stories, no vehicle, the ticket rows name the stories | OK |
| 22 | `release-notes --include-promotions` | the same three plus #10 with the three tickets | OK |
| 23 | `check-retrofit`, `deploy-integration-retrofit` | `Promotion Pull Request 10 adds 3 carried Pull Request(s)`, then one `already deployed through promotion branch(es)` per story | OK |

### Section 6, the edge cases

| # | Case | Expected | Result |
|---|------|----------|--------|
| 24 | Already promoted | candidate table shows `Already promoted by promotion/uat/preprod/...`, the warning names `--include-already-promoted`, no branch created | OK (exit 1, `#4 are not among the Pull Requests waiting for promotion (#1, #5)`) |
| 25 | Empty cherry-pick | `Nothing to cherry-pick ...: this change is already in the target branch`, branch undone, exit 0 | OK |
| 26 | Empty cherry-pick, dirty report folder | identical with `hardis-report/` untracked | OK |
| 27 | Conflict, agent default | `Cherry-pick conflict on #13 ... (NOTES.md, ...CustomLabels...): the promotion has been undone`, no leftover branch | OK |
| 28 | Conflict, kept | Pull Request #14 created, `hardis-report/promotion-conflicts-prompt-*.md` written, prompt embedded in the description | OK |
| 29 | Conflict prompt commit message | the prompt asks for a commit message with one line per conflicting file, naming the story, the target side, the story side and what was kept | OK |
| 30 | Conflict, kept for all | two conflicting stories in one promotion, both committed with markers, `Applying the conflict handling chosen earlier: commit-with-markers` printed for each | OK (through `--on-conflict commit-with-markers`, which takes the same code path; the interactive answer is not scriptable) |
| 31 | Marker guard | job fails, `still contains git conflict markers in 2 file(s): NOTES.md, force-app/.../CustomLabels...`, and the validation comment carries the failure banner, the branch, the count and the file list | OK |
| 32 | Marker guard, solved | solve, push, wait for the merge ref, validate again: green | OK |
| 33 | Conflict outside `force-app` | `NOTES.md` named by the gate | OK |
| 34 | A committed conflict prompt report | the report committed on the branch does not add a file to the gate: still `2 file(s)` | OK |
| 35 | Pull Request creation refused | branch pushed, the warning names the provider's own reason (`Git provider is not configured. Unable to create pull request.`), a one-click creation URL with source branch, target branch, title and description | OK (GitHub CLI taken off `PATH` as well) |
| 36 | Deployment from a promotion branch | the command stops naming the branch and the CI setting to fix | OK |
| 37 | Feature off | one informational line, scope = the Pull Request alone | OK |
| 38 | Hand-named branch | `starts with promotion/ but does not follow the promotion branch naming ...`, treated as a feature branch, declaration ignored | OK |
| 39 | Retargeted promotion | `is named for target preprod but its Pull Request targets main`, scope = the Pull Request alone, the declared stories do not run against production | OK |
| 40 | Grouped merge commit | `is a merge commit: cherry-picking it also carries #6, #3, #4, which were not requested` before the cherry-pick | OK (the cherry-pick was then empty, so exit 0 with `Every selected User Story ... is already in preprod`) |
| 41 | Unreadable declaration | `Pull Request #999 declared by promotion Pull Request 20 was not found: skipped`, not a failure | OK |
| 42 | Story brought in by a sync merge | one row per story of the sync (#2, #12, #13), promoting `2` cherry-picks one commit and declares `[2]` | OK |
| 43 | Story brought in by a promotion | S1 and S3 are two rows, promoting `3` carries S3 alone | OK (test 15) |
| 44 | Two levels of vehicle | the retrofit merge under the sync keeps naming the stories (`#11, #6, #3, #4`), never the promotion #10 | OK |
| 45 | Vehicle boundary | the merges after the opened-up vehicle (#12, #13) do not list its numbers | OK |
| 46 | Back-merge from the target branch | one row, labelled `-`, not a page of stories already delivered | OK (runbook corrected) |
| 47 | Octopus merge | the three-parent merge is left whole: one row `#23, #22, #21` | OK |
| 48 | Promotion that cannot be opened up | the octopus whose third side is `promotion/integration/uat/2026-09-12-0355` gives the row `#32, #23`: the declaration expanded, the vehicle dropped | OK (runbook corrected) |
| 49 | Sync merge inside a story | the candidate lists #23 only, the major branch's own Pull Requests are not offered | OK |
| 50 | Supersede a promotion | `A promotion from uat to preprod is already open ... it will be closed`, #1 offered again with no `Already promoted by`, `Closed the promotion it supersedes: #17` | OK |
| 51 | Branch merged twice | #21 and #22 are two rows, no `-` row for the same branch | OK |
| 52 | Full merge after a partial promotion | #2 named `already deployed through promotion branch(es) promotion/uat/preprod/2026-09-12-0350 (#20)`, its actions skipped, the others arrive for the first time; afterwards `No Pull Request merged into uat is waiting for promotion to preprod` | OK |
| 53 | Restricted promotion steps | `Promotions from integration are not allowed by allowedPromotionSteps (uat -> preprod)`, `A promotion from uat to main is not allowed ...`, `--source-branch uat` still works, and the DevOps Pipeline offers **Create promotion** on `uat` only | OK (the config has to be committed for the command half, see finding 2; the pipeline half is now asserted by the new `promotionSteps` key of `check-pipeline.cjs`) |
| 54 | Promotion steps not declared | `Promotion branches need the steps they are allowed to run on: set allowedPromotionSteps ...` with the doc link, before listing anything | OK |
| 55 | Two yaml blocks with the same key | the union of both is selected | OK (test 1) |

### Section 5bis, the Pull Request comment audit

`audit-pr-comments.cjs` over the 35 Pull Requests of the run:

```
697 checks over 35 Pull Requests (github)
OK: every sfdx-hardis Pull Request comment is consistent
```

One finding appeared on the first pass and was not a defect: `e2e-manual-1` showed as
`skipped` in `preprod` because the validation job of the full merge (#35) had recorded it and the
`preprod` deployment had not run yet. Running that deployment turned it into "waiting for manual
execution" with its checkbox, which is the intended sequence. The audit is clean afterwards.

### Section 7bis, the single place in the diagram

```
integration | 6 | #32, #22, #21, #13, #12, #11
uat         | 6 | #31, #26, #25, #5, #23, #1
preprod     | 3 | #30, #29, #2
main        | 3 | #4, #3, #6
OK: every Pull Request number appears in a single branch
With 'show already promoted' on:                       integration=10 uat=8 preprod=6 main=3
With 'show merge and promotion Pull Requests' on:       integration=6  uat=10 preprod=7 main=4
```

### Section 7ter, the flag-off regression check

Two pairs run against `nvuillam/sfdx-hardis-promo-e2e-12` with `enablePromotionBranches: false`,
the branch under test against `origin/main` (`0b3feacbf`), the second pair compared:

```
check-feature-pr36.log: 119 lines vs 119 lines, only in A: 0, only in B: 0
check-major-pr38.log:   124 lines vs 124 lines, only in A: 0, only in B: 0
deploy-uat.log:          93 lines vs  93 lines, only in A: 0, only in B: 0
release-notes.log:       77 lines vs  77 lines, only in A: 0, only in B: 0
release-notes.md:        40 lines vs  40 lines, only in A: 0, only in B: 0
TOTAL DIFFERING LINES: 0
```

`origin/main` was checked out in a separate `git worktree` (`/c/tmp/sfdx-hardis-main`) with
`node_modules` junctioned from the working copy, instead of switching the checkout in place: the
working copy carries the uncommitted backpromote rewrite and must not be disturbed.

___

## Backpromote (Beta), section 6bis

Run against `nvuillam/sfdx-hardis-promo-e2e-14` (private, created empty) and two scratch orgs created
from the Dev Hub, `promo-e2e-dev` (sandbox name `devorg1`) and `promo-e2e-dev2` (the same sandbox
name, another org id, for the refresh of B14). Eleven User Stories, `#1` to `#11`, merged into
`integration` as the steps need them; the developer branch is `feature/E2E-401-dev` and the
backpromote branch `backpromote/integration/devorg1`.

**63 checks, 63 OK, 0 FAIL.**

| Step | What | Expected | Result |
|------|------|----------|--------|
| B0 | `--plan` and `--auto` with no provider variable | `blocked` on the `gitProvider` check; the run exits 1 with the same message, before listing anything | OK |
| B1 | `targetUsername` of `uat` pointed at the target org | `blocked`, check `targetOrg` names `uat` | OK |
| B1c | `--parent-branch feature/E2E-105-apex` | `blocked`, check `parentBranch` says "not an allowed parent branch" and names `integration` | OK |
| B2 | `--target-org` on a production org | `blocked`, "production" | OK |
| B3 | the first plan, then the plan from `#1` with a progress file | `ok`, org type `scratch`, `scan.found` false, nothing selected, no window; then the window from `#1`, the three resources, the four actions not run, every file `missingInOrg`; 10 progress lines with `history`, `delta` and `retrieve`; the checkout untouched and clean | OK |
| B4 | `--auto --from-pull-request 1` | 3 deployed, `e2e-pre-1`, `e2e-post-2` and `e2e-pre-3` run, `e2e-manual-1` pending, nothing excluded, comments on `#1` `#2` `#3`, checkout on `backpromote/integration/devorg1`, branch not pushed (no manual merge); the org holds `E2E_S1..S3`; **C1**: one Backpromotes comment per Pull Request with one complete sandbox row and its action rows | OK |
| B5 | `--plan` when up to date, then `--confirm-action e2e-manual-1` | `nothingToDo`, `scan.found` true, the newest Pull Request holds the row and the two older ones are `beforeLastBackpromote`; the confirm runs in `confirm` mode; **C2**: the action row of `e2e-manual-1` is `success`, one row | OK |
| B6 | a new story `#4`, `--plan` then `--auto` | `#4` selected by default, window from `#4`, one item; 1 deployed, comment on `#4` | OK |
| B7 | `E2E_S2` changed in the org, `#5` changes it in `integration`, `--on-diff "<file>=git"` | the file is `different`, three-way, the three versions in the cache; 1 deployed and the org body is the git version | OK (after the retrieve defect below was fixed) |
| B8 | the same with `=org`, then the item comes back | 0 deployed, `E2E_S3` left out as `keptOrg`, **C3**: the row of `#6` is `partial` with the item; the next plan starts at `#6` again with `excludedLastTime`; then `=git` deploys it | OK (same defect) |
| B9 | agent protocol: `--agent --on-diff "<file>=merge"`, solve, run again | exit 0 with `waitingForMerges`, the file written with `<<<<<<<` and `|||||||` (three-way), a prompt file; then `ok`, 1 deployed, the branch pushed with the merge and the org body holding both lines | OK (after the diff3 defect below was fixed) |
| B10 | panel protocol: `--prepare`, `--auto` while the markers remain, solve, `--auto` | prepared with markers on the backpromote branch; then exit 1 `conflictsRemaining` with nothing deployed (the org body untouched); then `ok`, 1 deployed, pushed, both lines in the org | OK |
| B11 | `#9` removes `E2E_S4`: `--skip-destructive`, then a redeploy of `#9` | the deletion is listed, 0 deleted and `E2E_S4` still in the org; then 1 deleted and gone | OK |
| B12 | `#10` adds `E2E_S5` and `E2E_S6`, `--exclude-metadata StaticResource:E2E_S6` | 1 deployed, `E2E_S6` excluded; the next plan starts at `#10` again with `excludedLastTime`; then nothing excluded and `E2E_S6` in the org | OK |
| B13 | a dirty `NOTES.md` on the developer branch | `checkout.clean` false naming `NOTES.md`; the run stashes it under `sfdx-hardis backpromote <runId> from feature/E2E-401-dev`, lands on the backpromote branch clean, and `git stash pop` brings `NOTES.md` back | OK |
| B14 | `promo-e2e-dev2` with the same `--sandbox-name devorg1` | `scan.found` false, `#1` `#2` `#3` flagged `beforeRefresh` and not backpromoted, nothing selected; the run replays the actions in the other org; **C4**: `#1` `#2` `#3` keep one comment each, now with two sandbox rows, and `e2e-pre-1` has two action rows | OK |
| B15 | `--plan --sandbox-name never-seen --scan-limit 2` | `scan.read` 2, `found` false, `hasMore` true | OK |
| B16 | `--reset --auto` | mode `reset`, the branch gone from origin | OK |
| B17 | the terminal prompts | - | NOT COVERED: not scriptable, nobody answered them by hand |

### The two product defects this section found

Both were found by the run, fixed in `src/`, and proven again by a full rerun on a fresh repository
and freshly reset scratch orgs.

**1. A static resource of the org was reported as absent from it, and overwritten without a question.**

`sf project convert mdapi` names the content file of a StaticResource after its `contentType`, so
`E2E_S2.resource` retrieved from the sandbox comes back as `E2E_S2.txt` in the converted tree. The
comparison looked the file up by the source path tail of the **repository** file
(`staticresources/E2E_S2.resource`), found nothing, and set the status to `missingInOrg` with no
sandbox version:

```
B7-plan | FAIL | status in different|pendingInOrg (got missingInOrg); three-way true (got false);
                 sandbox and parent head versions exist in the cache ({"base":null,"sandbox":null,...})
```

The consequence is the one the feature exists to prevent: the developer is never offered
"keep the org version" or "merge", and `--on-diff "<file>=org"` keeps nothing, so the work done in
the sandbox is deployed over without a word (B8 deployed the item the run had asked to keep).

Fixed in `src/common/utils/backpromoteOrgUtils.ts`: the retrieve result now also indexes the
converted files by folder and name without the extension, and the comparison falls back to that
index when the exact tail misses. The fallback only takes a match when **one** file of the folder
carries that name, so an LWC bundle (`card.js` next to `card.html`) is never matched by it.

**2. A three-way merge was written without the base side.**

`writeMergedFile` called `git merge-file -p -L sandbox -L base -L parent`, which writes two-sided
markers: the `base` label was never used and whoever solves the merge (the developer, the VS Code
merge editor, the coding agent the prompt is written for) could not see what the two sides started
from. The command page, the `backpromote` skill and this runbook all describe `|||||||` markers.

Fixed in `src/common/utils/backpromoteGitUtils.ts` by passing `--diff3`, and covered by an assertion
on `||||||| base` in the existing `writeMergedFile` test.

### What the step script got wrong

`scripts/backpromote-steps.sh` had never been run. Six defects were found in it, four by reading it
against the command before the orgs were available and two by the first live run:

- **B12 left its commits on `integration`.** The step created `feature/E2E-110-kappa` and then called
  `story_branch`, which checks `integration` out again and whose own `git checkout -b` then fails on
  the branch that already exists. `story_branch` has no early return, so it wrote the resource,
  committed it on `integration` and pushed the stale branch. The step now writes the four files itself.
- **A `--json` run logs nothing to stderr.** oclif silences `uxLog` when `--json` is passed, so
  `$LOGS/<label>.log` is always empty and the B4 assertion on the deployment action lines could never
  have passed. It now reads `hardis-report/commands/<timestamp>-hardis-work-backpromote.log`.
- **`hardis-report/` is not gitignored in the test project**, so `git status --porcelain` is never
  empty after a backpromote and the "the checkout is clean" assertions of B3 and B13 could never have
  passed. They now exclude the report directory, which is what the command itself does.
- **`git add -A` in `stories.sh`** committed whatever sfdx-hardis had left in `hardis-report/` into
  the User Story. Both functions now add only the files of the story.
- **The story file paths were read from the wrong branch.** `S1_FILE`, `S2_FILE` and `S3_FILE` were
  resolved with `git ls-files` while `feature/E2E-401-dev` was checked out, and that branch is cut
  **before** the stories are merged: all three came back empty, `--on-diff "$S2_FILE=git"` became
  `--on-diff "=git"`, and every step from B7 on failed for the wrong reason. `resource_file` now
  falls back to `origin/integration`.
- **`SELECT Body FROM StaticResource` gives the REST path of the blob, not its content.** Decoding
  it as base64 produced binary noise, so every assertion on an org body compared garbage.
  `resource_body` now fetches the blob with the access token of the org.

Two changes make a failed run cheaper to pick up again: every Pull Request number the steps open is
appended to `$LOGS/bp-vars.sh`, and the branches the steps create use `git checkout -B`.

### Expectations that were wrong

`plan-up-to-date.json` and `plan-s4.json` asked for a `backpromote` row on **every** Pull Request of
the sandbox. The history walk is newest first and stops at the first Pull Request that carries a row
(`scan.found`), which is what the scan limit exists for: the older ones are `beforeLastBackpromote`
with `scanned: false`, which is the documented design. The two files now pin the newest one under
`backpromoted` and the older ones under the new `beforeLastBackpromote` key of
`check-backpromote-plan.cjs`.

___

## What this run did not cover

- **Nothing of section 6bis was skipped except B17.** The Dev Hub daily scratch org signup limit was
  exhausted for the first hours of the run (the scratch org of the previous run had been deleted
  before that limit was read, a mistake the new runbook trap now prevents); the section ran in full
  once the window rolled over.
- **B17, the terminal prompts of `hardis:work:backpromote`** (parent branch, start Pull Request, the
  multiselect of items and deletions, one decision per file that differs, the actions, the manual
  actions). They are not scriptable and nobody answered them by hand.
- **`--plan` with an unknown `--from-pull-request`** (refused with exit 0) and the refusal of
  `hardis:work:save` from a `backpromote/*` branch: both landed in the CLI during this run and have
  no step of their own in section 6bis.
- **The VS Code Backpromote panel is not clicked.** It reads the same `--plan --json` documents this
  run asserts, calls `--prepare` on Merge and `--auto --run-id` in the background; its command
  builder, greying rules and marker watch are covered by the extension's own unit tests.
- **The DevOps Pipeline webview is exercised through its data provider** (section 4bis), its
  compiled helpers and its unit tests, never by clicking: the mermaid is asserted as text, never
  rendered.
- **The interactive answer "commit this and every following conflict"** was exercised through
  `--on-conflict commit-with-markers`, which reaches the same code and prints the same line, not
  through the prompt itself.
- **GitLab, Azure DevOps and Bitbucket were not run.** Only GitHub was asked for. The four providers
  were all run live on 2026-09-07 and 2026-09-08; Bitbucket is still the only one whose repository
  has to be reused between runs, because its access token is repository-scoped.
- **The four pipeline levels share one Salesforce org**, so deployment action state is keyed by org
  **branch**, not by distinct orgs.
