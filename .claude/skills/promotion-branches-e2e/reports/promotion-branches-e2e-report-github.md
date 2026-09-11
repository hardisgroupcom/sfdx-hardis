# Promotion branches: end to end test on GitHub

**Date:** 2026-09-09 (supersedes the runs of 2026-09-07 and 2026-09-08)
**Repository under test:** `nvuillam/sfdx-hardis-promo-e2e-6` (private, created empty for this run)
**Salesforce org:** `nicolas.vuillamy.c8024b5deb9f@agentforce.com` (developer org, shared with the other providers)
**sfdx-hardis:** `fix/promotion-split-sync-merges`, `7a1347715`
**vscode-sfdx-hardis:** `fix/config-conflict-markers`, `0fd07cf0`

The GitLab and Azure runs that followed landed three more fixes (`16072b2ec`, `53ea7a81a`,
`ac317e170`); none of them touches a GitHub code path, so the results below stand as measured.

This is the first run of the new **pipeline checkpoints**: five points of the run assert what the
vscode-sfdx-hardis DevOps Pipeline shows, before and after every promotion operation, by driving
the extension's own `PipelineDataProvider` against the real repository.

Every job below is a real `deploy:smart` against that org, run locally with the GitHub Actions
variables set, which is what the git provider reads.

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

Eleven more Pull Requests exercise the edge cases: the retrofit (#11), the conflicting pair
(#12, #13), a hand-named branch (#20), a retargeted promotion (#21), a story carrying a sync merge
of its own (#23) and its second merge (#24), the ordinary `integration -> uat` sync (#25), the full
`uat -> preprod` merge (#27) and the major-to-major Pull Request kept open for the flag-off
comparison (#28).

## The promotions

| Promotion | Pull Request | Branch                                   | Carries         | Outcome                                                             |
|-----------|--------------|------------------------------------------|-----------------|---------------------------------------------------------------------|
| P1        | #7           | `promotion/integration/uat/2026-09-08-1` | #1, #3          | merged, deployed to uat                                             |
| P2        | #8           | `promotion/uat/preprod/2026-09-08-1`     | #4              | merged, deployed to preprod                                         |
| P3        | #9           | `promotion/uat/preprod/2026-09-08-2`     | #3              | merged, deployed to preprod: a story P1 had carried, promoted alone |
| P4        | #10          | `promotion/preprod/main/2026-09-08-1`    | #4, #3, #6      | merged, deployed to main, two levels of vehicle under it            |
| P5        | #14          | `promotion/integration/uat/2026-09-08-2` | #13             | assembled with conflict markers on purpose, solved, then superseded |
| P6        | #15/#16/#17  | `.../2026-09-08-3`, `-4`, `-5`           | #12             | the Pull Request creation cases, all closed by the supersede run    |
| P7        | #18          | `promotion/integration/uat/2026-09-08-8` | #12             | the supersede run, closed by P8                                     |
| P8        | #19          | `promotion/integration/uat/2026-09-08-9` | #11, #6, #3, #4 | the grouped merge commit, left open                                 |
| P9        | #22          | `promotion/uat/preprod/2026-09-08-100`   | #5              | the allowed step of the restricted configuration                    |
| P10       | #26          | `promotion/uat/preprod/2026-09-08-101`   | #1              | the duplicate candidate case, left open                             |

___

## What this run found

Two defects, both fixed inside the run, both proven again afterwards.

### 1. A User Story was offered twice once a sync merge re-delivered it

After the ordinary `integration -> uat` merge (#25), the candidate list of `uat` held **two rows
for #1 and two rows for #3**: one for the cherry-pick a promotion had put in `uat`, one for the
original merge commit the sync had just delivered. Both are inside the same window, so both became
candidate rows.

```
#1  | S1 alpha | nvuillam | d84da4d | ...    <- the cherry-pick of P1
...
#1  | S1 alpha | nvuillam | 8948f5f | ...    <- the original merge, brought by the sync
```

Selecting `1` still cherry-picked once, so nothing was deployed twice, but the table a release
manager reads listed the same story on two rows, one of them marked "already promoted" and the
other not. That breaks the rule the runbook asks for: **one candidate row per User Story, whatever
brought it into the source branch**.

Fixed with `dropOfferedTwice` in `promotionCreateUtils.ts`: an exact repeat of the same set of Pull
Request numbers is dropped, keeping the first, which is the one the command already cherry-picked,
so the fix is presentational and cannot change what a promotion carries. A row that groups several
Pull Requests (a back-merge, an octopus merge) is never allowed to hide the finer rows of the
stories it holds, and a row with no number at all is a commit of its own and always stays. Three
unit tests cover it.

After the fix, every number appears once (see the candidate table of section "Test groups").

### 2. A machine with no GitHub CLI crashed instead of printing the creation link

`createPullRequestWithGhCli` guards its fallback with `await which('gh')`, and `which` **rejects**
when the binary is missing. So on a machine without the GitHub CLI, a promotion whose Pull Request
the provider refused ended like this:

```
[sfdx-hardis][Git Provider] Error creating pull request: Validation Failed (HTTP 422, ...)
[sfdx-hardis][command] git remote get-url origin
Error (1): not found: gh
```

The branch was pushed and the command died, so the user never reached the manual creation link that
the previous session added for exactly this situation. Fixed with `which('gh', { nothrow: true })`.
Rerun of the same case afterwards:

```
The Pull Request could not be created automatically (Validation Failed (HTTP 422, POST
https://api.github.com/repos/.../pulls)). The branch promotion/integration/uat/2026-09-08-7 is
pushed: create the Pull Request to uat in your git provider, and paste the description saved in ...
Create it in one click, everything is already filled in (source branch, target branch, title,
description): https://github.com/nvuillam/sfdx-hardis-promo-e2e-6/compare/uat...promotion/...?expand=1&title=...&body=...
```

The URL carries the `promotionPullRequests` block, which is what the deployment jobs read.

### Two things worth knowing, neither of them a product defect

- **On GitHub the "creation refused" path is hard to reach**, because `gh pr create` is a genuine
  second path: with the provider pointed at another repository, the GitHub CLI still created the
  Pull Request in the right one. The case was reproduced by taking the GitHub CLI off `PATH`.
- **When the provider and the git remote disagree, the command acts on the provider's repository.**
  With `GITHUB_REPOSITORY` deliberately pointed at another repository, the supersede step closed a
  Pull Request there. That is the configuration being wrong, not the command; the GitLab provider
  has a guard for the equivalent mistake (`gitlabProjectIdMismatch`) because a stale `CI_PROJECT_ID`
  really happens, while `GITHUB_REPOSITORY` is set by GitHub Actions itself and a fork legitimately
  has a different head repository.

___

## The DevOps Pipeline, before and after every promotion operation

New in this run. `scripts/check-pipeline.cjs` drives the extension's `PipelineDataProvider` against
the real repository and reads the counter bubbles and the merge edges back out of the mermaid it
produced, so what is asserted is the diagram itself, with a cold cache on every call.

| Checkpoint              | integration | uat      | preprod                      | main       | arrows                                   | Result |
|-------------------------|-------------|----------|------------------------------|------------|------------------------------------------|--------|
| `pipeline-before-p1`    | #1, #2, #3  | -        | -                            | -          | none                                     | OK     |
| `pipeline-p1-open`      | #1, #2, #3  | -        | -                            | -          | `integration>uat` draws **#7**           | OK     |
| `pipeline-after-p1`     | #2          | #1, #3   | -                            | -          | none                                     | OK     |
| `pipeline-before-p3`    | #2          | #1,#3,#5 | #4                           | -          | none                                     | OK     |
| `pipeline-after-golive` | #2          | #1, #5   | -                            | #3, #4, #6 | none                                     | OK     |
| `pipeline-final`        | -           | -        | #1,#2,#5,#11,#12,#13,#23,#24 | #3,#4,#6   | `integration>uat` #19, `uat>preprod` #26 | OK     |

What the checkpoints prove, beyond the numbers:

- **An open promotion is drawn on the arrow of its step and takes nothing out of the source branch.**
  At `pipeline-p1-open`, #7 sits on the `integration -> uat` edge, has no feature branch node of its
  own, and `integration` still lists all three stories: a promotion moves a story when it is merged,
  not when it is assembled.
- **After the merge the stories are listed in the branch they reached**, and only there: `uat` holds
  #1 and #3, `integration` keeps #2 alone.
- **What the pipeline lists and what `promotion:create` offers are the same set.** At
  `pipeline-before-p3` the pipeline shows #1, #3, #5 in `uat` and the candidate table of the next
  promotion offers exactly those three.
- **The retargeted promotion (#21) and the hand-named branch (#20) are drawn on no arrow**, which is
  the diagram side of invariant 2.
- Two checks run at every checkpoint with no expectations at all: a Pull Request number is listed in
  one branch and one only, and every counter bubble equals the length of the list under it.

One expectations file of this run was written wrong (it left #5 out of `uat` after the go-live) and
the check caught it. The pipeline was right, the expectation was not.

___

## Test groups

| Group                                    | Expected                                                                            | Result                                                                                               |
|------------------------------------------|-------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------|
| Feature branch validation and deployment | `Pull Request scope: 1 Pull Request(s) (#N)` and nothing else                       | OK for #1..#6                                                                                        |
| Two yaml blocks in a description         | the union of both is selected                                                       | OK on #1: `PromoE2EAlphaTest` and `PromoE2EBetaTest`                                                 |
| `NO_DELTA`                               | `Delta deployment has been disabled`, `Deployment mode: FULL`                       | OK on #2                                                                                             |
| `PURGE_FLOW_VERSIONS`                    | extra pre-deploy action, skipped in validation, run in deployment                   | OK on #3, then on #7 and #9 by inheritance                                                           |
| Manual actions in a validation job       | `Skipping ...: deployment-only action`                                              | OK everywhere                                                                                        |
| Promotion Pull Request creation          | branch pushed, Pull Request opened with the declaration and the carried table       | OK: #7, #8, #9, #10, #14, #18, #19, #22, #26                                                         |
| Promotion validation and deployment      | scope = declared + the promotion itself                                             | OK: #7 (`#1, #3, #7`), #8 (`#4, #8`), #9 (`#3, #9`), #10 (`#4, #3, #6, #10`)                         |
| Keyword inheritance                      | only the keywords of the carried stories                                            | OK: #7 inherits `PURGE_FLOW_VERSIONS` from #3 and **not** `NO_DELTA` from #2, which stayed           |
| Test classes of a promotion              | union of the carried Pull Requests, `RunSpecifiedTests`                             | OK on #7 and #10                                                                                     |
| Deployment action state                  | the comment lands on the **story** Pull Request, one column per org branch          | OK: #6 has four columns and one pending checkbox per org branch                                      |
| One candidate row per User Story         | a sync merge and a promotion merged into its target are opened up                   | OK: from `uat`, #1 and #3 are two rows, never one row for the whole `integration -> uat` sync        |
| Story brought in by a promotion          | promoting `3` carries S3 alone                                                      | OK on P3: one cherry-pick, `assembled with 1 User Story(ies): #3`                                    |
| Two levels of vehicle                    | the stories under an inner promotion are candidates of their own                    | OK: from `preprod`, #4, #3 and #6 are offered, never #8, #9 or #10                                   |
| Vehicle boundary                         | the merge after an opened-up vehicle does not swallow it                            | OK: no candidate row lists a vehicle's numbers on top of its own                                     |
| Back-merge from the target branch        | stays a single row instead of a page of stories already delivered                   | OK: the `preprod` back-merge into `uat` is one row with no numbers                                   |
| Grouped merge commit                     | the numbers nobody asked for are named **before** cherry-picking, and declared      | OK on #19: "cherry-picking it also carries #6, #3, #4, which were not requested"                     |
| Sync merge inside a story                | the candidate lists the story only                                                  | OK: #23 alone, the `integration` merge inside its branch adds nothing                                |
| Branch merged twice                      | listed once, never once with its number and once as a `-` row                       | OK: #23 and #24, one row each                                                                        |
| Retrofit `main` -> `integration`         | the promotion is expanded, then every already shipped story is named                | OK on #11: `Promotion Pull Request 10 adds 3 carried Pull Request(s)`, then three `already deployed` |
| Release notes of the go-live             | the User Stories, not the vehicles                                                  | OK: 3 Pull Requests (#3, #4, #6); 4 with `--include-promotions`, #10 added                           |
| Already promoted                         | marked in the table, `--include-already-promoted` named, no branch created          | OK, exit 1 and no new branch                                                                         |
| Empty cherry-pick                        | `Nothing to cherry-pick`, no branch, exit 0                                         | OK                                                                                                   |
| Empty cherry-pick, dirty report folder   | same result with `hardis-report/` untracked                                         | OK                                                                                                   |
| Conflict, agent default                  | promotion undone, both files named, no leftover branch                              | OK on #13: `NOTES.md` and the labels file named, no local or remote branch left                      |
| Conflict outside `force-app`             | the gate still catches it                                                           | OK, `NOTES.md` named in both the conflict and the marker gate                                        |
| Conflict, kept                           | Pull Request created, prompt file written and embedded                              | OK: #14, `hardis-report/promotion-conflicts-prompt-*.md`                                             |
| Conflict answered once for all           | `Applying the conflict handling chosen earlier`                                     | OK through `--on-conflict commit-with-markers`; the interactive answer is not covered, see below     |
| Conflict prompt commit message           | one line per file, naming the story, the target side, the story side, what was kept | OK: rule 5 of the prompt asks for exactly that, with a fenced example                                |
| Marker guard                             | job fails naming the files **and the validation comment says so**                   | OK: 2 files named, and the comment carries the failure banner, the branch, the count and the list    |
| Marker guard, solved                     | the job passes                                                                      | OK, scope `#13, #14`                                                                                 |
| Committed conflict prompt report         | the gate ignores it                                                                 | OK: the report was committed on the promotion branch and the next validation passed                  |
| Deployment from a promotion branch       | the job stops naming the branch and the CI setting to fix                           | OK, and `--check` on the same branch still runs                                                      |
| Pull Request creation refused            | branch pushed, the provider's own reason, a one-click creation link                 | OK after the fix, see "What this run found"                                                          |
| Pull Request creation retries            | the creation is retried while the provider may not have indexed the branch          | OK: `New attempt in 5s (2/4)` up to `(4/4)`                                                          |
| Feature off                              | one informational line, scope = the Pull Request alone                              | OK on #19                                                                                            |
| Hand-named branch                        | warning, treated as a feature branch, declaration ignored                           | OK on #20                                                                                            |
| Retargeted promotion                     | warning naming the mismatch, scope = the Pull Request alone                         | OK on #21: "named for target preprod but its Pull Request targets main"                              |
| Unreadable declaration                   | warning and skip, not a failure                                                     | OK: `#9999 ... was not found: skipped`, the job still passed                                         |
| Supersede an open promotion              | the open ones are closed **after** the new one exists, stories offered again        | OK: #18 created, then #17, #16, #15, #14 closed; #12 and #13 offered with no mark                    |
| Provider unreachable                     | nothing is closed and the command says so                                           | OK: `Unable to list the promotions already open from integration to uat: none will be closed`        |
| Restricted `allowedPromotionSteps`       | a forbidden source and a forbidden target are both refused, the allowed one works   | OK, all three                                                                                        |
| `allowedPromotionSteps` not declared     | the command stops, asking for the list and linking to the doc                       | OK                                                                                                   |
| `promotion:list-candidates`              | the candidate table, creating nothing                                               | OK from `uat` and from `integration`, no branch created                                              |
| Full merge after a partial promotion     | already promoted stories skipped, the never promoted ones arrive, nothing left      | OK on #27, then `No Pull Request merged into uat is waiting for promotion to preprod`                |
| DevOps Pipeline before and after         | section above                                                                       | OK, six checkpoints                                                                                  |
| Single place in the diagram              | each number in one branch only                                                      | OK, and the two toggles both raise the counts                                                        |
| Pull Request comment audit               | consistent comments, navigation and action state                                    | 672 checks, one explained finding, see below                                                         |
| Flag-off regression                      | `TOTAL DIFFERING LINES: 0`                                                          | **0**                                                                                                |

### Pull Request comment audit

`audit-pr-comments.cjs` ran 672 checks over 27 Pull Requests and reported one finding:

> `#6: manual action e2e-manual-6 is marked skipped in uat: it left the pending list and can no longer be ticked`

That is the honest record of what happened, not a defect. #6 entered the scope of a **validation**
job against `uat` (the promotion #19 declares it), and a validation skips a
`process-deployment-only` action by design, so the last thing that happened to `e2e-manual-6` in
`uat` was a skip. #6 was never deployed to `uat`, so there is nothing to tick there yet; the day a
`uat` deployment carries it, the cell becomes "waiting" and the checkbox appears. The three org
branches it really reached (`integration`, `preprod`, `main`) all show the pending checkbox.

### Flag-off regression

Four passes (`branch`, `main`, `branch2`, `main2`), the second pair compared:

```
check-feature-pr20.log: 119 lines vs 119 lines, only in A: 0, only in B: 0
check-major-pr28.log:    76 lines vs  76 lines, only in A: 0, only in B: 0
deploy-uat.log:         144 lines vs 144 lines, only in A: 0, only in B: 0
release-notes.log:       71 lines vs  71 lines, only in A: 0, only in B: 0
release-notes.md:        36 lines vs  36 lines, only in A: 0, only in B: 0
TOTAL DIFFERING LINES: 0
```

A project that does not set `enablePromotionBranches` gets byte for byte the jobs it got before.

___

## What this run did not cover

- **The interactive "commit this and every following conflict" answer.** The sticky choice was
  exercised through `--on-conflict commit-with-markers`, which walks the same `rememberedChoice`
  code, and through the unit tests of the prompt answer. The prompt itself needs a terminal the
  harness does not have.
- **A true octopus merge (three or more parents).** Git resolved both attempts into two-parent
  merges by fast-forwarding the first side. The guard that leaves such a merge whole is covered by
  the unit tests only. The two-parent back-merge case was exercised live.
- **The pipeline webview by clicking.** It is exercised through its own data provider and its unit
  tests; the mermaid is asserted as text, never rendered.
- **The four pipeline levels share one Salesforce org**, so deployment action state is keyed by org
  **branch**, not by distinct orgs.
- **GitHub Actions itself.** The jobs are reproduced locally with the Actions variables set, which
  is what the git provider reads.

## Traps written into the runbook by this run

- `yarn compile` (tsc), not `yarn dev` (webpack), is what produces the per-module `out/` layout the
  diagram and pipeline scripts require.
- Both release-notes runs write the **same** file, so the plain run must be copied aside before the
  `--include-promotions` one overwrites it.
- An ad-hoc `git add -A` after any CLI run commits `hardis-report/`, and from then on
  `promotion:create` refuses to run on a dirty tree.
- `gh pr edit --body-file` can fail on the classic-projects GraphQL deprecation; `gh api -X PATCH`
  is the way to rewrite a description.

## Suite counts

- sfdx-hardis, the six promotion suites: **118 passing**
  (`promotionBranchUtils`, `promotionCreateUtils`, `releaseNotesPromotion`, `backpromoteUtils`,
  `prDescriptionYaml`, `pullRequestCreateUrl`).
- vscode-sfdx-hardis, the two promotion suites: **37 passing**
  (`promotionBranchUtils`, `gitlabPipelineStatus`).
