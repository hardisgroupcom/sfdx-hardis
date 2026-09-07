# Promotion branches: end to end test on Azure DevOps

**Date:** 2026-09-07
**Repository under test:** `nicolasvuillamy/tests-sfdx-hardis/sfdx-hardis-promo-e2e-az-1`
(private, created empty for this run through the Azure DevOps REST API)
**Salesforce org:** `nicolas.vuillamy.c8024b5deb9f@agentforce.com` (developer org, shared with the GitHub and GitLab runs)
**sfdx-hardis:** `feat/promotion-branches`, `0296eda30` at the start, `4611b653d` after the fix below
**vscode-sfdx-hardis:** `feat/promotion-branches`, `06ba32f8` (not modified by this run)

This is the **first time the Azure DevOps path of the feature has been exercised against a real
Azure DevOps**. Every previous run was GitHub and GitLab; Azure was covered by code reading and
unit tests only. Every job below is a real `deploy:smart` against that org, run locally with the
Azure Pipelines variables set (`SYSTEM_ACCESSTOKEN`, `SYSTEM_COLLECTIONURI`, `SYSTEM_TEAMPROJECT`,
`BUILD_REPOSITORY_ID`, `SYSTEM_PULLREQUEST_PULLREQUESTID`), which is what the git provider reads.

Pull Request ids are unique per **organization** on Azure DevOps, not per repository, so this brand
new repository starts at **#6**. Nothing in the feature assumes the first story is number 1.

___

## The pipeline

Same shape as the two previous runs: `integration` -> `uat` -> `preprod` -> `main`, one org,
`enablePromotionBranches: true`, `allowedPromotionSteps` with the three steps, delta deployment on,
Apex test classes on. Every Pull Request completed with `mergeStrategy: noFastForward` so the `-x`
trailers of the cherry-picks survive.

| Story | Pull Request | Branch                    | Target      | Actions                   | Test classes                            | Keyword                  |
|-------|--------------|---------------------------|-------------|---------------------------|-----------------------------------------|--------------------------|
| S1    | #6           | `feature/E2E-101-alpha`   | integration | pre command + post manual | `PromoE2EAlphaTest`, `PromoE2EBetaTest` | -                        |
| S2    | #7           | `feature/E2E-102-beta`    | integration | post command              | -                                       | `NO_DELTA`               |
| S3    | #8           | `feature/E2E-103-gamma`   | integration | pre command               | `PromoE2EBetaTest`                      | `PURGE_FLOW_VERSIONS`    |
| S4    | #9           | `feature/E2E-201-delta`   | uat         | pre command + post manual | `PromoE2EAlphaTest`                     | -                        |
| S5    | #10          | `feature/E2E-202-epsilon` | uat         | post command              | -                                       | -                        |
| S6    | #11          | `feature/E2E-301-hotfix`  | preprod     | pre command + post manual | `PromoE2EBetaTest`                      | `FLOW_DELETE_INTERVIEWS` |

S1 declares its two test classes in **two separate yaml blocks** of its description.

Eight more Pull Requests exercise the edge cases: the conflicting pair on the shared
`CustomLabels` file and on `NOTES.md` (#17, #18), the retrofit (#16), a hand-named branch (#20), a
retargeted promotion (#21), a story that receives a sync merge (#23) next to the story that landed
in the meantime (#24) and its second merge (#25), the full major-to-major merge (#26), and two
Pull Requests kept open for the flag-off comparison (#27, #28).

## The promotions

| Promotion | Pull Request | Branch                                   | Carries            | Outcome                                                  |
|-----------|--------------|------------------------------------------|--------------------|-----------------------------------------------------------|
| P1        | #12          | `promotion/integration/uat/2026-09-07-1`  | #6, #8            | merged, deployed to uat                                    |
| P2        | #13          | `promotion/uat/preprod/2026-09-07-1`      | #9                | merged, deployed to preprod                                |
| P3        | #14          | `promotion/uat/preprod/2026-09-07-2`      | #6, #8            | the merge commit of P1, one level of nesting               |
| P4        | #15          | `promotion/preprod/main/2026-09-07-1`     | #9, #6, #8, #11   | merged, deployed to main, two levels of nesting            |
| P5        | #19          | `promotion/integration/uat/2026-09-07-2`  | #18               | assembled with conflict markers on purpose, then abandoned |
| P6        | #22          | `promotion/integration/uat/2026-09-07-3`  | #18               | superseded #19 and abandoned it                            |

___

## What this run found

### One Azure DevOps defect, found and fixed inside the run

**The Azure DevOps Pull Request list API truncates every description at 400 characters, with no
marker saying so.** Everything sfdx-hardis reads out of a description is then silently lost.

It showed up first on the "already promoted" check. After promotion #13 (carrying story #9) was
merged into `preprod`, assembling another promotion from `uat` offered #9 again with an empty
`Already promoted by` column:

```
Pull Requests | Title      | Author           | Commit  | Date                 | Already promoted by
#6, #8        | S1 alpha   | Nicolas Vuillamy | a01f969 | 2026-09-07T16:59:00Z |
#9            | S4 delta   | Nicolas Vuillamy | 0d36ebc | 2026-09-07T17:02:04Z |
#10           | S5 epsilon | Nicolas Vuillamy | 49ea53b | 2026-09-07T17:02:52Z |
```

`listAlreadyPromotedPullRequests` reads the `promotionPullRequests` declaration from the
description of every promotion merged into the target branch. A one-line instrumentation of that
loop gave the answer:

```
DBGPROMO merged 13 promotion/uat/preprod/2026-09-07-1 counts=true ids=null desclen=402
```

The Pull Request was found, the branch name matched, and the declaration parsed to `null` because
the description handed back by the list API was 402 characters long instead of 941. The same
comparison across the whole repository:

| Pull Request | length from the list API | real length |
|--------------|--------------------------|-------------|
| #13          | 406                      | 941         |
| #14          | 400                      | 739         |
| #15          | 411                      | 1663        |

A promotion branch writes its declaration below the navigation block and the introduction
paragraph. On the go-live promotion #15 the `promotionPullRequests` block starts at character
**688**, so the copy the list API returns does not contain the word at all.

What that breaks, beyond the already-promoted check: `listPullRequestsInGoLive` and
`listPullRequestsInBranchSinceLastMerge` both build their result from the same list call, so on
Azure a retrofit or a major-to-major merge would expand **no** carried Pull Request, and the
`deploymentApexTestClasses` blocks and custom behavior keywords of ordinary stories would be lost
the same way as soon as their description passes 400 characters.

Fixed in `AzureDevopsProvider.completeTruncatedDescription`: whenever a listed description is long
enough to have been cut, the single Pull Request API (which returns the whole thing) is called
again for that Pull Request. Applied in `listPullRequests`, in `collectMergedPrsForCommits` (the
shared tail of the go-live and since-last-merge listings) and in the "find the Pull Request from
the current commit" path of `getPullRequestInfo`. Six unit tests cover it in
`test/common/gitProvider/azureDevopsListDescription.test.ts`.

After the fix, the same command answers:

```
#9  | S4 delta | ... | promotion/uat/preprod/2026-09-07-1
[sfdx-hardis] 1 Pull Request(s) are already carried by another promotion branch to this target
branch and are left out: #9 -> promotion/uat/preprod/2026-09-07-1.
Use --include-already-promoted to promote them again
```

`check-diagram-azure.cjs` re-reads full descriptions the same way, so the harness does not hide the
problem it is meant to catch.

### No other Azure-specific defect

Everything the GitHub and GitLab runs prove, the Azure run proves identically, including the
provider code paths that had never been called against a real Azure DevOps: creating a promotion
Pull Request, finding the open promotion of the same step, abandoning it when it is superseded,
posting and updating the Deployment Actions thread, and building the comment anchors.

The three defects the GitHub run found are confirmed fixed here from a differently shaped history:
the two yaml blocks of #6 are both read, the go-live #15 carries all four static resources
(`E2E_S1`, `E2E_S3`, `E2E_S4`, `E2E_S6`) and all four action files, and the candidate grouping
`#9` / `#6, #8` / `#11` attributes the cherry-picked commits to the merge that carried them.

### Observations, not filed as defects

- **A Pull Request description is capped at 4000 characters on Azure DevOps.** The promotion
  assembled with `--on-conflict commit-with-markers` embeds the coding-agent prompt in its
  description and reached **3690** characters. A promotion carrying more stories, or a conflict on
  more files, would go past the cap. Not hit by this run, written into the runbook.
- **The description of a completed Pull Request cannot be edited** (Azure answers TF401181). The
  placeholder deployment comment created by the validation job is what makes the navigation links
  survive the merge, and it did: the Deployment Actions comment on #6 links to thread `92`
  (validation) and `93` (deployment) with the epoch-seconds anchors Azure uses.
- **Quick Deploy on Azure.** `getBranchDeploymentCheckId` matched the validation deployment id to
  the merge commit and several deployment jobs ran `DELTA + Quick Deploy`. Three others were
  refused by Salesforce (`Job ID can't be used for quick deployment`) and fell back to a normal
  deployment, which is the expected fallback and not a promotion branches matter.

___

## Test groups

| Group                                     | Expected                                                                             | Result                                                                                        |
|-------------------------------------------|--------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------|
| Provider detection                        | Azure picked from `SYSTEM_ACCESSTOKEN`, repository from `BUILD_REPOSITORY_ID`         | OK on every job                                                                                   |
| Feature branch validation and deployment  | `Pull Request scope: 1 Pull Request(s) (#N)` and nothing else                         | OK for #6..#11                                                                                    |
| Two yaml blocks in a description          | both are read                                                                         | OK on #6: `PromoE2EAlphaTest` and `PromoE2EBetaTest`                                              |
| `NO_DELTA`                                | `Delta deployment has been disabled`, `Deployment mode: FULL`                         | OK on #7, validation and deployment                                                               |
| `PURGE_FLOW_VERSIONS`                     | extra pre-deploy action, skipped in validation, run in deployment                     | OK on #8                                                                                          |
| Manual actions in a validation job        | `Skipping ...: deployment-only action`                                                | OK everywhere                                                                                     |
| Promotion Pull Request creation           | branch pushed, Pull Request opened with the declaration and the carried table          | OK: #12, #13, #14, #15, #19, #22                                                                  |
| Promotion validation and deployment       | scope = declared + the promotion itself                                               | OK: #12 (`#6, #8, #12`), #13 (`#9, #13`), #14 (`#6, #8, #14`), #15 (`#9, #6, #8, #11, #15`)        |
| Keyword inheritance                       | only the keywords of the carried stories                                              | OK: #12 inherits `PURGE_FLOW_VERSIONS` from #8 and not `NO_DELTA` from #7; #15 inherits both       |
| Test classes of a promotion               | union of the carried Pull Requests, `RunSpecifiedTests`                               | OK                                                                                                |
| Deployment action state                   | the comment lands on the **story** Pull Request, one column per org branch            | OK: #6 shows `integration` and `uat` columns and one pending manual box per branch                |
| Comment navigation after the merge        | the links survive, Azure anchors are `discussionId=<thread>#<epoch seconds>`          | OK on #6                                                                                          |
| Promotion carrying a promotion            | the stories of the inner promotion are in the scope                                   | OK on #14 and #15                                                                                 |
| Promotion number is not a candidate       | passing #13, #14 is refused, naming the real candidates                               | OK: `Pull Request(s) #13, #14 are not among the Pull Requests waiting for promotion`               |
| Grouped merge commit                      | the numbers nobody asked for are named **before** cherry-picking, and declared        | OK on #14 and #15: `cherry-picking it also carries #6, which were not requested`                   |
| Retrofit `main` -> `integration`          | the promotion is expanded, then every already shipped story is named                  | OK on #16: `Promotion Pull Request 15 adds 4 carried Pull Request(s)`, then four `already deployed` |
| Release notes of the go-live              | the User Stories, not the vehicles                                                    | OK: 4 Pull Requests (#6, #8, #9, #11); 5 with `--include-promotions`, #15 added                    |
| Already promoted                          | marked in the table, `--include-already-promoted` named, no branch created            | **failed, fixed**, then OK                                                                        |
| Empty cherry-pick                         | `Nothing to cherry-pick`, no branch, exit 0                                           | OK                                                                                                |
| Empty cherry-pick, dirty report folder    | same result with `hardis-report/` untracked                                           | OK, the folder was untracked at that moment                                                       |
| Conflict, agent default                   | promotion undone, no leftover branch, both files named                                | OK on #18: `NOTES.md, force-app/main/default/labels/CustomLabels.labels-meta.xml`                  |
| Conflict outside `force-app`              | the gate still catches it                                                             | OK, `NOTES.md` named                                                                              |
| Conflict, kept                            | Pull Request created, prompt file written and embedded                                | OK: #19, `hardis-report/promotion-conflicts-prompt-2026-09-07_17-30-14-772Z.md`                    |
| Marker guard                              | the job fails naming the files                                                        | OK: `still contains git conflict markers in 2 file(s)`                                            |
| Marker guard, solved                      | the job passes                                                                        | OK, scope `#18, #19`                                                                              |
| Committed conflict prompt report          | the gate ignores it                                                                   | OK: the prompt report was committed on the promotion branch and the gate stayed silent            |
| Feature off                               | one informational line, scope = the Pull Request alone                                | OK on #19                                                                                         |
| Hand-named branch                         | warning, treated as a feature branch, declaration ignored                             | OK on #20, scope `#20` alone                                                                      |
| Retargeted promotion                      | warning naming the mismatch, scope = the Pull Request alone                           | OK on #21, the declared #6 and #8 did not run their actions against production                    |
| Unreadable declaration                    | warning and skip, not a failure                                                       | OK: `Pull Request #9999 declared by promotion Pull Request 19 was not found: skipped`              |
| Sync merge inside a story                 | the candidate lists the story only                                                    | OK: #23 alone, #24 on its own row                                                                 |
| Branch merged twice                       | listed once, never with a `-` row                                                     | OK: #24 and #25, one row each                                                                     |
| Supersede an open promotion               | the open one is closed, its stories offered again with no mark                        | OK: #22 abandoned #19, state `abandoned`, no `--include-already-promoted` needed                   |
| Restricted `allowedPromotionSteps`        | a forbidden source and a forbidden target are both refused, naming the allowed steps  | OK: `Promotions from integration are not allowed`, `A promotion from uat to main is not allowed`   |
| `allowedPromotionSteps` not declared      | the command stops, asking for the list and linking to the doc                         | OK, before listing anything                                                                       |
| Full merge after a partial promotion      | already promoted stories skipped, the never promoted one arrives                      | OK on #26, see below                                                                              |
| `promotion:list-candidates`               | the candidate table without assembling anything                                       | OK from `uat`                                                                                     |
| Single place in the diagram               | each number in one branch only                                                        | OK, see below                                                                                     |
| Flag-off regression                       | `TOTAL DIFFERING LINES: 0`                                                            | 10 lines, all from the description fix, see below                                                 |

### A full major-to-major merge after a partial promotion

#26 merges `uat` into `preprod` in full, after #9 had been promoted alone by #13 and #6, #8 by #14.

- The deployment scope is `#12, #9, #10, #24, #23, #25, #13, #14, #11, #26, #6, #8`: the promotion
  #12 is expanded, and #10 (S5 epsilon), which had never been promoted, arrives for the first time.
- #9, #11, #6 and #8 are each reported as `already deployed through promotion branch(es) ...` and
  their deployment actions are skipped.
- The post-deploy action of #10 runs for the first time in `preprod`.
- After the merge, `promotion:create uat -> preprod` answers `No Pull Request merged into uat is
  waiting for promotion to preprod`: the merge base moved and the pipeline is back to a clean state.

### Single place in the diagram

`check-diagram-azure.cjs`, written for this run, feeds the extension's own compiled helpers with
the real Pull Requests read from the Azure DevOps API:

```
Branch      | node counter | Pull Requests listed
integration | 4            | #18, #17, #16, #7
uat         | 4            | #25, #24, #23, #10
preprod     | 0            |
main        | 4            | #9, #6, #8, #11

OK: every Pull Request number appears in a single branch
With 'show already promoted' on: integration=6 uat=7 preprod=4 main=4
With 'show merge and promotion Pull Requests' on: integration=4 uat=5 preprod=3 main=5
```

Same shape as GitHub and GitLab: the four go-live stories are listed under `main` and nowhere else,
and both toggles bring back strictly more.

### Flag-off regression

Four passes of the same three jobs plus the release notes, alternating the sfdx-hardis checkout
between `feat/promotion-branches` and `origin/main`, with `enablePromotionBranches: false` in the
checked-out tree:

```
check-feature-pr27.log: 122 lines vs 122 lines, only in A: 0, only in B: 0
check-major-pr28.log:   160 lines vs 162 lines, only in A: 4, only in B: 6
deploy-uat.log:         173 lines vs 173 lines, only in A: 0, only in B: 0
release-notes.log:       70 lines vs  70 lines, only in A: 0, only in B: 0
release-notes.md:        37 lines vs  37 lines, only in A: 0, only in B: 0
TOTAL DIFFERING LINES: 10
```

Not zero, and the ten lines are worth reading rather than waving away. The **Pull Request scope is
identical on both sides** for #28 (`#15, #6, #7, #8, #16, #17, #18, #28`), so promotion branches,
switched off, still change nothing. What differs is the Apex test class selection:

```
A> [sfdx-hardis][SmartDeploy] No test class selected from PRs, keeping previous test level
B> [sfdx-hardis][SmartDeploy] Test classes selected from PRs:
B>  - PromoE2EAlphaTest
B>  - PromoE2EBetaTest
```

`enableDeploymentApexTestClasses` reads `deploymentApexTestClasses` out of the description of every
Pull Request in the scope, which on `main` comes back truncated. The branch under test picks the
classes up because of the fix above. So the ten lines are the description fix repairing a feature
that has nothing to do with promotion branches and was broken on Azure DevOps before this run, not
a promotion branches regression. On a repository whose descriptions all stay under 400 characters
the two runs are identical.

___

## What this run did not cover

- **The interactive paths.** Everything ran with `--agent`. The confirmation before superseding an
  open promotion, the conflict prompt and the dirty-tree stash/commit prompt are covered by unit
  tests, not by this run.
- **The websocket button** on Pull Request creation: no websocket server in a CLI run.
- **The pipeline webview itself**: the diagram rules are checked through the extension's compiled
  helpers, not by clicking in VS Code. The extension was not modified by this run and its suite was
  not re-run.
- **Azure Pipelines itself.** The jobs are reproduced locally with the pipeline variables, which is
  what the provider reads, but no `azure-pipelines.yml` ran on a Microsoft-hosted agent. In
  particular `SYSTEM_JOB_DISPLAY_NAME`, `BUILD_BUILDID` and the job URLs they build were set to
  fixed values.
- **Branch policies and required reviewers.** The test repository has none, so a promotion Pull
  Request that needs an approval before completing was not exercised; every completion used
  `bypassPolicy: true`.
- **Work items.** `getPullRequestWorkItemRefs` and the attachments work item used for image uploads
  are called on a project with no work item linked to any Pull Request.
- **The 4000 character description cap.** Approached (3690) but not crossed.
- **One org for four branches**, as on GitHub and GitLab: deployment action state is keyed by org
  **branch**, so the matrix is right, but the four levels are not four distinct orgs.
- **`FLOW_DELETE_INTERVIEWS` end to end.** Its inheritance is verified; the interview deletion it
  authorizes needs a Flow in destructive changes, which this project does not have.
- **Bitbucket**, still code reading and unit tests only.

## Harness added for Azure DevOps

Three scripts, committed with the `promotion-branches-e2e` skill so the next run does not have to
rebuild them:

| Script                    | What it does                                                                                                                      |
|---------------------------|-----------------------------------------------------------------------------------------------------------------------------------|
| `e2e-lib-azure.sh`        | `az_check`, `az_deploy`, `az_promote`, `az_release_notes`, `az_pr_create`, `az_pr_merge`, the merge-ref wait and the completion wait |
| `check-diagram-azure.cjs` | the single-place-in-the-diagram check, reading Pull Requests (full descriptions included) from the Azure DevOps API                |
| `ab-run-azure.sh`         | the flag-off comparison passes                                                                                                    |

`build-repo.sh` and `stories.sh` are shared with the GitHub and GitLab runs: the repository content
and the six stories are provider agnostic.

Notes for anyone rerunning this against Azure DevOps, all written into the runbook:

- Push with the token in the remote URL: `https://azure:<PAT>@dev.azure.com/<org>/<project>/_git/<repo>`.
- `refs/pull/<id>/merge` is recomputed asynchronously, and completing a Pull Request is
  asynchronous too. `az_check` and `az_pr_merge` wait for both.
- Complete with `mergeStrategy: noFastForward`, never squash, or the `-x` trailers are lost.
- Python on Windows does not resolve the git bash `/tmp` path. Keep the Pull Request body files
  under a real Windows path, or Azure answers `Both a source and target reference is required`.
- `bash ab-run-azure.sh` is a child process and does not inherit sourced functions, so the script
  sources the library sitting next to it.

## Suite counts after the fix

- sfdx-hardis: **1802 unit tests passing** (1796 before, 6 added for the fix), lint clean.
- vscode-sfdx-hardis: not modified by this run.
