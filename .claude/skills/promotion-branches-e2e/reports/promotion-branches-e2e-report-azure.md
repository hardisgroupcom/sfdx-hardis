# Promotion branches: end to end test on Azure DevOps

**Date:** 2026-09-09 (supersedes the runs of 2026-09-07 and 2026-09-08)
**Repository under test:** `nicolasvuillamy/tests-sfdx-hardis/sfdx-hardis-promo-e2e-az-3` (private, created empty for this run)
**Salesforce org:** `nicolas.vuillamy.c8024b5deb9f@agentforce.com` (developer org, shared with the other providers)
**sfdx-hardis:** `fix/promotion-split-sync-merges`, `ac317e170` (two fixes landed during the run, see below)
**vscode-sfdx-hardis:** `fix/config-conflict-markers`, `0fd07cf0`

Every job below is a real `deploy:smart` against that org, run locally with the Azure Pipelines
variables set (`SYSTEM_ACCESSTOKEN`, `SYSTEM_COLLECTIONURI`, `SYSTEM_TEAMPROJECT`,
`BUILD_REPOSITORY_ID`, `SYSTEM_PULLREQUEST_PULLREQUESTID`), which is what the git provider reads.
Pull Requests are completed with `mergeStrategy: noFastForward`, so the `-x` trailers of the
cherry-picks survive.

Pull Request ids are unique per **organization** on Azure DevOps, so this fresh repository starts at
**#52**. Nothing in the feature assumes the first story is number 1.

This run carries the new **pipeline checkpoints**: six points where what the vscode-sfdx-hardis
DevOps Pipeline shows is asserted by driving the extension's own `PipelineDataProvider` against the
real repository.

___

## The pipeline

`integration` -> `uat` -> `preprod` -> `main`, one org, `enablePromotionBranches: true`,
`allowedPromotionSteps` with the three steps, delta deployment on, Apex test classes on.

| Story | Pull Request | Branch                    | Target      | Actions                   | Test classes                            | Keyword                  |
|-------|--------------|---------------------------|-------------|---------------------------|-----------------------------------------|--------------------------|
| S1    | #52          | `feature/E2E-101-alpha`   | integration | pre command + post manual | `PromoE2EAlphaTest`, `PromoE2EBetaTest` | -                        |
| S2    | #53          | `feature/E2E-102-beta`    | integration | post command              | -                                       | `NO_DELTA`               |
| S3    | #54          | `feature/E2E-103-gamma`   | integration | pre command               | `PromoE2EBetaTest`                      | `PURGE_FLOW_VERSIONS`    |
| S4    | #55          | `feature/E2E-201-delta`   | uat         | pre command + post manual | `PromoE2EAlphaTest`                     | -                        |
| S5    | #56          | `feature/E2E-202-epsilon` | uat         | post command              | -                                       | -                        |
| S6    | #57          | `feature/E2E-301-hotfix`  | preprod     | pre command + post manual | `PromoE2EBetaTest`                      | `FLOW_DELETE_INTERVIEWS` |

S1 declares its two test classes in **two separate yaml blocks** of its description.

Nine more Pull Requests exercise the edge cases: the retrofit (#62), the conflicting pair
(#63, #64), a hand-named branch (#67), a retargeted promotion (#68), a story carrying a sync merge
of its own (#70) and its second merge (#71), the ordinary `integration -> uat` sync (#72), the full
`uat -> preprod` merge (#73) and the major-to-major Pull Request kept open for the flag-off
comparison (#74).

## The promotions

| Promotion | Pull Request | Branch                                   | Carries        | Outcome                                                                     |
|-----------|--------------|------------------------------------------|----------------|-------------------------------------------------------------------------------|
| P1        | #58          | `promotion/integration/uat/2026-09-09-1` | #52, #54       | merged, deployed to uat                                                       |
| P2        | #59          | `promotion/uat/preprod/2026-09-09-1`     | #55            | merged, deployed to preprod                                                   |
| P3        | #60          | `promotion/uat/preprod/2026-09-09-2`     | #54            | merged, deployed to preprod: a story P1 had carried, promoted alone            |
| P4        | #61          | `promotion/preprod/main/2026-09-09-1`    | #55, #54, #57  | merged, deployed to main, two levels of vehicle under it                       |
| P5        | -            | `promotion/integration/uat/2026-09-09-2` | #64            | the conflict promotion, **refused for its description length** (defect 2)      |
| P6        | #65          | `promotion/integration/uat/2026-09-09-3` | #64            | the same after the fix: created, markers solved, then superseded               |
| P7        | #66          | `promotion/integration/uat/2026-09-09-4` | #63            | the supersede run, which closed #65. Left open                                 |
| P8        | #69          | `promotion/uat/preprod/2026-09-09-100`   | #56            | the allowed step of the restricted configuration. Left open                    |

___

## What this run found

Two defects, both Azure specific, both fixed inside the run and proven again afterwards. Both would
have made the feature unusable on Azure DevOps while looking fine on GitHub and GitLab.

### 1. A story a promotion carried could not be promoted again

After P1 was merged into `uat`, the candidate table of `uat` showed the two cherry-picked commits
with **no Pull Request number at all**:

```
Pull Requests | Title                                                             | Commit
--------------|-------------------------------------------------------------------|--------
-             | Merge pull request 52 from feature/E2E-101-alpha into integration | cdd7a22
-             | Merge pull request 54 from feature/E2E-103-gamma into integration | 2b7db1f
#55           | S4 delta                                                          | fbfb826
```

Azure DevOps completing a Pull Request without fast-forward writes
`Merge pull request 52 from feature/X into integration`: **no `#`**, and the target branch after
the source. `extractPrNumbersFromMessage` knew GitHub's `Merge pull request #N from owner/branch`,
GitLab's `See merge request group/repo!N` and Azure's squash form `Merged PR N:`, but not that one;
`mergedSourceBranches` had the same gap for the branch name.

So on Azure, every commit a promotion had cherry-picked came back as an unnamed row, and the story
it carried could no longer be selected in the next promotion, which is the whole point of opening
up a vehicle merge. Both parsers now know the sentence, and the table came back right:

```
#52           | S1 alpha   | cdd7a22
#54           | S3 gamma   | 2b7db1f
#55           | S4 delta   | fbfb826 | promotion/uat/preprod/2026-09-09-1
```

Two unit tests cover it in `backpromoteUtils.test.ts`.

### 2. A promotion with conflicts could not be opened at all

Assembling the conflict promotion ended with the branch pushed and no Pull Request:

```
[Azure Integration] Creating pull request from promotion/integration/uat/2026-09-09-2 to uat...
[Git Provider] Error creating pull request: Invalid argument value.
Parameter name: A description for a pull request must not be longer than 4000 characters.
```

Azure DevOps caps a description at 4000 characters, and a promotion whose cherry-picks conflicted
embeds a ready-to-paste prompt for a coding agent that goes past it. The previous Azure run
measured 3690 characters and called it close; the prompt has since gained the commit-message rule,
and it crossed the line.

The fallback did its job (honest reason, branch pushed, one-click creation link), but a release
manager was left with a pushed branch and nothing to review, on every promotion that conflicts.

Fixed with a provider capability: `getMaxPullRequestDescriptionLength()` returns null by default
and 4000 on Azure DevOps, and `buildPromotionPullRequestBody` drops the **embedded prompt** when the
description would not fit, keeping the yaml declaration, the carried table, the conflicting file
list and a line saying where the prompt is saved. A last-resort tail truncation follows, which
still leaves the declaration intact because it sits at the top.

Rerun of the same promotion afterwards: Pull Request #65 created, description **1224 characters**,
declaration present, files named, prompt pointed at rather than embedded. Two unit tests cover it.

### What was already right

The 400-character truncation of the Pull Request **list** API, fixed by a previous run in
`AzureDevopsProvider.completeTruncatedDescription`, held throughout: every promotion resolved its
declaration, including the go-live carrying three stories.

___

## The DevOps Pipeline, before and after every promotion operation

| Checkpoint              | integration | uat            | preprod  | main            | arrows                                     | Result |
|-------------------------|-------------|----------------|----------|-----------------|----------------------------------------------|--------|
| `pipeline-before-p1`    | #52,#53,#54 | -              | -        | -               | none                                         | OK     |
| `pipeline-p1-open`      | #52,#53,#54 | -              | -        | -               | `integration>uat` draws **#58**              | OK     |
| `pipeline-after-p1`     | #53         | #52, #54       | -        | -               | none                                         | OK     |
| `pipeline-before-p3`    | #53         | #52, #54, #56  | #55      | -               | none                                         | OK     |
| `pipeline-after-golive` | #53         | #52, #56       | -        | #54, #55, #57   | none                                         | OK     |
| `pipeline-final`        | -           | -              | 8 stories | #54, #55, #57  | `integration>uat` #66, `uat>preprod` #69     | OK     |

The first `pipeline-before-p1` run failed, and was right to: the expectations had been written for
a point where the three stories were merged, and only their validations had run. Merging them made
it pass. That is the check doing its job on its first outing.

Everything the GitHub and GitLab runs prove holds here against the Azure provider's own fetching:
an open promotion is drawn on the arrow of its step and takes nothing out of the source branch
until it is merged; after the merge the stories are listed in the branch they reached and nowhere
else; what the pipeline lists at `pipeline-before-p3` is exactly what the next `promotion:create`
offered; and the retargeted promotion (#68) and the hand-named branch (#67) are drawn on no arrow.

Two checks run at every checkpoint with no expectations at all: a Pull Request number is listed in
one branch and one only, and every counter bubble equals the length of the list under it.

___

## Test groups

| Group                                    | Expected                                                                       | Result                                                                                        |
|------------------------------------------|--------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------|
| Provider detection                       | Azure picked from the PAT, repository from `BUILD_REPOSITORY_ID`               | OK on every job                                                                               |
| Feature branch validation and deployment | `Pull Request scope: 1 Pull Request(s) (#N)` and nothing else                  | OK for #52..#57                                                                               |
| Two yaml blocks in a description         | the union of both is selected                                                  | OK on #52: `RunSpecifiedTests` with both classes                                              |
| `NO_DELTA`                               | `Delta deployment has been disabled`, `Deployment mode: FULL`                  | OK on #53                                                                                     |
| `PURGE_FLOW_VERSIONS`                    | extra pre-deploy action, skipped in validation, run in deployment              | OK on #54, then on #58 and #60 by inheritance                                                 |
| Truncated description (previous fix)     | the declaration is read past Azure's 400 character list cut                    | OK: every promotion resolved its declaration                                                   |
| Merge-ref lag                            | a validation run seconds after a push must not read the previous merge         | OK: `az_check` waits, no stale tree in the whole run                                          |
| Asynchronous completion                  | the merge is waited for, never assumed                                          | OK: `az_pr_merge` waits for `completed` + `succeeded` every time                              |
| Promotion Pull Request creation          | branch pushed, Pull Request opened with the declaration and the carried table  | OK: #58, #59, #60, #61, #65, #66, #69                                                         |
| Promotion validation and deployment      | scope = declared + the promotion itself                                        | OK: #58 (`#52, #54, #58`), #59 (`#55, #59`), #60 (`#54, #60`), #61 (`#55, #54, #57, #61`)      |
| Keyword inheritance                      | only the keywords of the carried stories                                       | OK: #58 inherits `PURGE_FLOW_VERSIONS` from #54 and **not** `NO_DELTA` from #53, left behind   |
| Test classes of a promotion              | union of the carried Pull Requests, `RunSpecifiedTests`                        | OK on #58 and #61                                                                             |
| One candidate row per User Story         | a sync merge and a promotion merged into its target are opened up              | OK after defect 1 was fixed: #52 and #54 are two named rows                                    |
| Story brought in by a promotion          | promoting `54` carries S3 alone                                                | OK on P3: one cherry-pick, `assembled with 1 User Story(ies): #54`                              |
| Two levels of vehicle                    | the stories under an inner promotion are candidates of their own               | OK: from `preprod`, #55, #54 and #57 are offered, never #59, #60 or #61                         |
| Back-merge from the target branch        | stays a single row                                                             | OK: the retrofit row `#62, #57, #54, #55` is never opened up                                    |
| Sync merge inside a story                | the candidate lists the story only                                             | OK: #70 alone                                                                                  |
| Branch merged twice                      | listed once, never once with its number and once as a `-` row                  | OK: #70 and #71, one row each                                                                  |
| A story offered twice                    | one row per User Story after a sync merge re-delivers a promoted story         | OK: after #72, #52 and #54 appear once each (the `dropOfferedTwice` fix of this cycle)          |
| Retrofit `main` -> `integration`         | the promotion is expanded, then every already shipped story is named           | OK on #62: `Promotion Pull Request 61 adds 3 carried Pull Request(s)`, then three `already deployed` |
| Release notes of the go-live             | the User Stories, not the vehicles                                             | OK: 3 Pull Requests (#54, #55, #57); 4 with `--include-promotions`, #61 added                   |
| Already promoted                         | marked in the table, `--include-already-promoted` named, no branch created     | OK, exit 1                                                                                     |
| Empty cherry-pick                        | `Nothing to cherry-pick`, no branch, exit 0                                    | OK                                                                                             |
| Conflict, agent default                  | promotion undone, both files named                                             | OK on #64: `NOTES.md` and the labels file named                                                 |
| Conflict outside `force-app`             | the gate still catches it                                                      | OK, `NOTES.md` named in both the conflict and the marker gate                                    |
| Conflict, kept                           | Pull Request created, prompt saved, description within the provider limit       | OK after defect 2 was fixed: #65, description 1224 characters                                   |
| Conflict answered once for all           | `Applying the conflict handling chosen earlier`                                 | OK through `--on-conflict commit-with-markers`                                                  |
| Marker guard                             | job fails naming the files **and the validation comment says so**              | OK: 2 files named, and the thread carries the failure banner, the branch, the count and the list |
| Marker guard, solved                     | the job passes                                                                 | OK, scope `#64, #65`                                                                            |
| Committed conflict prompt report         | the gate ignores it                                                            | OK: the report was committed on the promotion branch and the next validation passed              |
| Deployment from a promotion branch       | the job stops naming the branch and the CI setting to fix                       | OK, and `--check` on the same branch still runs                                                 |
| Feature off                              | one informational line, scope = the Pull Request alone                         | OK on #66                                                                                       |
| Hand-named branch                        | warning, treated as a feature branch, declaration ignored                      | OK on #67                                                                                       |
| Retargeted promotion                     | warning naming the mismatch, scope = the Pull Request alone                    | OK on #68: "named for target preprod but its Pull Request targets main"                          |
| Unreadable declaration                   | warning and skip, not a failure                                                | OK: `#9999 ... was not found: skipped`, the job still passed                                     |
| Supersede an open promotion              | the open one is abandoned **after** the new one exists                         | OK: #66 created, then #65 closed                                                                 |
| Restricted `allowedPromotionSteps`       | a forbidden source and a forbidden target are refused, the allowed one works   | OK, all three                                                                                    |
| `allowedPromotionSteps` not declared     | the command stops, asking for the list and linking to the doc                  | OK                                                                                              |
| `promotion:list-candidates`              | the candidate table, creating nothing                                          | OK from `uat` and from `integration`                                                             |
| Full merge after a partial promotion     | already promoted stories skipped, the never promoted ones arrive, nothing left | OK on #73, then `No Pull Request merged into uat is waiting for promotion to preprod`             |
| DevOps Pipeline before and after         | section above                                                                  | OK, six checkpoints                                                                              |
| Single place in the diagram              | each number in one branch only                                                 | OK, and the two toggles both raise the counts                                                    |
| Pull Request comment audit               | consistent comments, navigation and action state                               | **695 checks, zero findings**                                                                     |
| Flag-off regression                      | `TOTAL DIFFERING LINES: 0`                                                     | **0** on the third pair, see below                                                               |

### Pull Request comment audit

```
695 checks over 22 Pull Requests (azure)
OK: every sfdx-hardis Pull Request comment is consistent
```

Nothing to report, including the placeholder deployment comment Azure needs because
`isPrDescriptionEditableAfterMerge()` is false there: the navigation block of every validation
comment points at a deployment comment that exists.

### Flag-off regression

Three pairs were run (`branch`/`main`, `branch2`/`main2`, `branch3`/`main3`). The second pair still
showed 20 differing lines, all of them the run order rather than the code: the pass that ran first
deployed the static resource and the second found it unchanged (`Changes: 1 created` against
`0 created ... 1 unchanged`), and a `git fetch origin uat:uat` that only one of them needed because
of the local clone's state.

The third pair, both passes in steady state, is clean:

```
check-feature-pr67.log: 129 lines vs 129 lines, only in A: 0, only in B: 0
check-major-pr74.log:    85 lines vs  85 lines, only in A: 0, only in B: 0
deploy-uat.log:         176 lines vs 176 lines, only in A: 0, only in B: 0
release-notes.log:       71 lines vs  71 lines, only in A: 0, only in B: 0
release-notes.md:        36 lines vs  36 lines, only in A: 0, only in B: 0
TOTAL DIFFERING LINES: 0
```

A project on Azure DevOps that does not set `enablePromotionBranches` gets byte for byte the jobs it
got before, including the two fixes this run landed: both are inside promotion code paths that the
flag leaves inert.

___

## What this run did not cover

- **The interactive "commit this and every following conflict" answer.** Exercised through
  `--on-conflict commit-with-markers`, which walks the same `rememberedChoice` code, and through
  the unit tests of the prompt answer. The prompt itself needs a terminal the harness does not have.
- **An octopus merge (three or more parents).** Git resolves the attempts into two-parent merges by
  fast-forwarding the first side; the guard that leaves such a merge whole stays a unit test.
- **Azure Pipelines itself.** The jobs are reproduced locally with the Azure Pipelines variables
  set, which is what the git provider reads.
- **The pipeline webview by clicking.** Exercised through its own data provider and its unit tests;
  the mermaid is asserted as text, never rendered.
- **The four pipeline levels share one Salesforce org**, so deployment action state is keyed by org
  **branch**, not by distinct orgs.
- **A description over 4000 characters that is not a conflict prompt.** The truncation branch of
  `buildPromotionPullRequestBody` is covered by a unit test, not by a live promotion: producing one
  would need dozens of carried stories.

## Suite counts

- sfdx-hardis, the six promotion suites: **122 passing**.
- vscode-sfdx-hardis, the two promotion suites: **37 passing**.
