# Promotion branches: end to end test on GitLab

**Date:** 2026-09-07
**Project under test:** `nicolas.vuillamy/sfdx-hardis-promo-e2e-gl-1` (private, id 4431, on the
self-hosted `gitlab.hardis-group.com`), created empty for this run
**Salesforce org:** `nicolas.vuillamy.c8024b5deb9f@agentforce.com` (developer org, shared with the GitHub run)
**sfdx-hardis:** `feat/promotion-branches`, `b7eafe9b4`
**vscode-sfdx-hardis:** `feat/promotion-branches`, `0a54f042`

This is the **first time the GitLab path of the feature has been exercised against a real GitLab**.
Every previous run was GitHub only, and GitLab was covered by code reading and unit tests. Every
job below is a real `deploy:smart` against the org, run locally with the GitLab CI variables set
(`CI_SFDX_HARDIS_GITLAB_TOKEN`, `CI_SERVER_URL`, `CI_PROJECT_ID`, `CI_MERGE_REQUEST_IID`), which is
what the git provider reads.

The merge request numbering starts at **!2**: !1 was created and deleted while setting the harness
up, which is a useful accident, it proves nothing assumes the first story is number 1.

___

## The pipeline

Same shape as the GitHub run: `integration` -> `uat` -> `preprod` -> `main`, one org,
`enablePromotionBranches: true`, delta deployment on, Apex test classes on, merge method "merge
commit" and squash disabled at project level so the `-x` trailers of the cherry-picks survive.

| Story | Merge request | Branch                    | Target      | Actions                   | Test classes                            | Keyword                  |
|-------|---------------|---------------------------|-------------|---------------------------|-----------------------------------------|--------------------------|
| S1    | !2            | `feature/E2E-101-alpha`   | integration | pre command + post manual | `PromoE2EAlphaTest`, `PromoE2EBetaTest` | -                        |
| S2    | !3            | `feature/E2E-102-beta`    | integration | post command              | -                                       | `NO_DELTA`               |
| S3    | !4            | `feature/E2E-103-gamma`   | integration | pre command               | `PromoE2EBetaTest`                      | `PURGE_FLOW_VERSIONS`    |
| S4    | !5            | `feature/E2E-201-delta`   | uat         | pre command + post manual | `PromoE2EAlphaTest`                     | -                        |
| S5    | !6            | `feature/E2E-202-epsilon` | uat         | post command              | -                                       | -                        |
| S6    | !7            | `feature/E2E-301-hotfix`  | preprod     | pre command + post manual | `PromoE2EBetaTest`                      | `FLOW_DELETE_INTERVIEWS` |

## The promotions

| Promotion | Merge request | Branch                                   | Carries         | Outcome                                     |
|-----------|---------------|------------------------------------------|-----------------|---------------------------------------------|
| P1        | !8            | `promotion/integration/uat/2026-09-07-1` | !2, !4          | merged, deployed to uat                     |
| P2        | !9            | `promotion/uat/preprod/2026-09-07-1`     | !5              | merged, deployed to preprod                 |
| P3        | !10           | `promotion/uat/preprod/2026-09-07-2`     | !4, !2          | the merge commit of P1, one level of nesting |
| P4        | !11           | `promotion/preprod/main/2026-09-07-1`    | !5, !4, !2, !7  | merged, deployed to main                    |
| P5        | !15           | `promotion/integration/uat/2026-09-07-2` | !14             | assembled with conflict markers on purpose  |
| P6        | !18           | `promotion/integration/uat/2026-09-07-3` | !14             | superseded !15 and closed it                |

___

## What this run found

**No GitLab-specific product defect.** Every behavior the GitHub run proves, the GitLab run proves
identically, including the three code paths that had never been called against a real GitLab
before: creating the promotion merge request, finding the open promotion of the same step, and
closing it when it is superseded.

The three defects the GitHub run found were fixed before this run started, and this run is the
independent confirmation that the fixes are provider agnostic:

- **Two yaml blocks in a description.** `!2` declares `PromoE2EAlphaTest` in one block and
  `PromoE2EBetaTest` in a second one. The validation job selects both.
- **A promotion two levels down.** Assembling the go-live from `preprod` offered
  `!5` / `!4, !2` / `!7`, with the stories of the nested promotion !10 correctly attributed to the
  merge that carried them. The promotion branch of !11 holds all four static resources
  (`E2E_S1`, `E2E_S3`, `E2E_S4`, `E2E_S6`), which is the check that failed on GitHub before the fix.
- **Graph attribution of cherry-picked commits.** Same result, from a differently shaped history.

### What the run found about the harness, not the product

GitLab writes `refs/merge-requests/<iid>/merge` **lazily**. After a push to the source branch, the
ref still points at the previous merge, and `GET /merge_requests/:iid/merge_ref` hands back the
stale `commit_id` while the new one is being computed. A validation job run at that moment
validates a tree without the commit that was just pushed, and the failure looks like a product bug.
It cost three misleading results in this run: three stories whose deployment actions "were not
found" and one marker guard that "did not see" the conflicts that had just been solved.

`gl_check` now polls until the merge ref actually contains the head of the source branch, and the
trap is written into the runbook. GitHub has the same behavior but recovers in a second or two;
GitLab can take much longer.

The machine also produced two transient `getaddrinfo() thread failed to start` failures, one during
a `git push` and one during a `curl`. Both were retried and succeeded. They are local DNS hiccups,
not GitLab and not sfdx-hardis.

### One observation, not filed as a defect

A promotion assembled at 01:24 CEST on 7 September is named
`promotion/integration/uat/2026-09-06-1`: `buildPromotionBranchName` takes the day from
`toISOString()`, which is UTC. It reads as "yesterday" to whoever assembled it. Making it local
would tie the branch name to the timezone of whatever machine or runner assembles it, and two
people in different zones could then produce two branches with the same counter on what they each
call the same day. UTC is the safer of the two, so this is left alone and written down here so the
next reader does not think it is a bug.

___

## Test groups

| Group                                    | Expected                                                                          | Result                                                                                   |
|------------------------------------------|-----------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------|
| Provider detection                       | GitLab picked from `CI_SFDX_HARDIS_GITLAB_TOKEN`, project from `CI_PROJECT_ID`      | OK on every job                                                                              |
| Feature branch validation and deployment | `Pull Request scope: 1 Pull Request(s) (#N)` and nothing else                      | OK for !2..!7                                                                                |
| Two yaml blocks in a description         | both are read                                                                      | OK: `PromoE2EAlphaTest` and `PromoE2EBetaTest`                                               |
| `NO_DELTA`                               | `Delta deployment has been disabled`, `Deployment mode: FULL`                      | OK on !3                                                                                     |
| `PURGE_FLOW_VERSIONS`                    | extra pre-deploy action, skipped in validation, run in deployment                  | OK on !4                                                                                     |
| Manual actions in a validation job       | `Skipping ...: deployment-only action`                                             | OK everywhere                                                                                |
| Promotion merge request creation         | branch pushed, MR opened with the `promotionPullRequests` block and the table      | OK: !8, !9, !10, !11, !15, !18                                                               |
| Promotion validation and deployment      | scope = declared + the promotion                                                   | OK: !8 (`#2, #4, #8`), !9 (`#5, #9`), !10 (`#4, #2, #10`), !11 (`#5, #4, #2, #7, #11`)        |
| Keyword inheritance                      | only the keywords of the carried stories                                           | OK: !8 inherits `PURGE_FLOW_VERSIONS` and not `NO_DELTA`; !11 inherits both keywords          |
| Test classes of a promotion              | union of the carried merge requests, `RunSpecifiedTests`                           | OK                                                                                           |
| Deployment action state                  | the note lands on the **story** merge request, one column per org branch           | OK: !2 shows `integration` and `uat` columns and one pending manual box per branch            |
| Promotion carrying a promotion           | the stories of the inner promotion are in the scope                                | OK on !10 and !11                                                                            |
| Retrofit `main` -> `integration`         | the promotion is expanded, then every already shipped story is named               | OK on !12: `Promotion Pull Request 11 adds 2 carried Pull Request(s)`, then four `already deployed` lines |
| Release notes of the go-live             | the User Stories, not the vehicles                                                 | OK: 4 merge requests (!2, !4, !5, !7); 5 with `--include-promotions`, !11 added                |
| Already promoted                         | marked in the table, `--include-already-promoted` named, no branch created         | OK                                                                                           |
| Empty cherry-pick                        | `Nothing to cherry-pick`, no branch, exit 0                                        | OK                                                                                           |
| Empty cherry-pick, dirty report folder   | same result with `hardis-report/` untracked                                        | OK                                                                                           |
| Conflict, agent default                  | promotion undone, no leftover branch                                               | OK on !14, both conflicting files named                                                      |
| Conflict outside `force-app`             | the gate still catches it                                                          | OK, `NOTES.md` named next to `CustomLabels.labels-meta.xml`                                  |
| Conflict, kept                           | merge request created, prompt file written and embedded                            | OK: !15                                                                                      |
| Marker guard                             | the job fails naming the files                                                     | OK: `2 file(s): NOTES.md, force-app/main/default/labels/CustomLabels.labels-meta.xml`        |
| Marker guard, solved                     | the job passes                                                                     | OK, once the merge ref caught up                                                             |
| Feature off                              | one informational line, scope = the merge request alone                            | OK on !15                                                                                    |
| Hand-named branch                        | warning, treated as a feature branch, declaration ignored                          | OK on !16                                                                                    |
| Retargeted promotion                     | warning naming the mismatch, scope = the merge request alone                       | OK on !17                                                                                    |
| Grouped merge commit                     | the numbers nobody asked for are named before cherry-picking, and declared         | OK on !10 and !11                                                                            |
| Unreadable declaration                   | warning and skip, not a failure                                                    | OK: `#9999 ... was not found: skipped`, scope `#14, #15`                                     |
| Sync merge inside a story                | the candidate lists the story only                                                 | OK: !28 alone, !29 on its own row                                                            |
| Branch merged twice                      | listed once, never with a `-` row                                                  | OK: !20 and !21, one row each                                                                |
| Supersede an open promotion              | the open one is **closed**, its stories offered again with no mark                 | OK: !18 closed !15, state `closed`, no `--include-already-promoted` needed                   |
| Full merge after a partial promotion     | see below                                                                          | OK on !22                                                                                    |
| Single place in the diagram              | each number in one branch only                                                     | OK, see below                                                                                |
| Flag-off regression                      | `TOTAL DIFFERING LINES: 0`                                                         | OK, see below                                                                                |

### A full major-to-major merge after a partial promotion

!22 merges `uat` into `preprod` in full, after !5 had been promoted alone by !9 and !4, !2 by !10.

- The deployment scope is `#5, #6, #8, #7, #9, #10, #22, #2, #4`: the promotion !8 is expanded, and
  !6 (S5 epsilon), which had never been promoted, arrives for the first time.
- !5, !7, !2 and !4 are each reported as `already deployed through promotion branch(es) ...` and
  their deployment actions are skipped.
- The post-deploy action of !6 runs for the first time in `preprod`.
- After the merge, `promotion:create uat -> preprod` answers `No Pull Request merged into uat is
  waiting for promotion to preprod`.

### Single place in the diagram

`check-diagram-gitlab.cjs`, written for this run, feeds the extension's own compiled helpers with
the real merge requests read from the GitLab API:

```
Branch      | node counter | Pull Requests listed
integration | 12           | #29, #28, #26, #25, #23, #21, #20, #19, #14, #13, #12, #3
uat         | 1            | #6
preprod     | 0            |
main        | 4            | #5, #4, #2, #7

OK: every Pull Request number appears in a single branch
With 'show already promoted' on: integration=14 uat=4 preprod=4 main=4
With 'show merge and promotion Pull Requests' on: integration=12 uat=2 preprod=3 main=5
```

Same shape as GitHub: the four go-live stories are listed under `main` and nowhere else, and both
toggles bring back strictly more.

### Flag-off regression

Four passes of the same three jobs plus the release notes, alternating the sfdx-hardis checkout
between `feat/promotion-branches` and `origin/main`, with `enablePromotionBranches: false` in the
checked-out tree:

```
check-feature-mr31.log: 124 lines vs 124 lines, only in A: 0, only in B: 0
check-major-mr32.log:   175 lines vs 175 lines, only in A: 0, only in B: 0
deploy-uat.log:         172 lines vs 172 lines, only in A: 0, only in B: 0
release-notes.log:       73 lines vs  73 lines, only in A: 0, only in B: 0
release-notes.md:        37 lines vs  37 lines, only in A: 0, only in B: 0
TOTAL DIFFERING LINES: 0
```

A GitLab project that does not enable promotion branches gets exactly the jobs it got before.

___

## What this run did not cover

- **The interactive paths.** Everything ran with `--agent`.
- **The websocket button** on Pull Request creation: no websocket server in a CLI run.
- **The pipeline webview itself**: checked through the extension's compiled helpers and its 329
  unit tests, not by clicking.
- **GitLab CI itself.** The jobs are reproduced locally with the CI variables, which is what the
  provider reads, but no `.gitlab-ci.yml` pipeline actually ran on the GitLab runners.
- **Approval rules and protected branches.** The test project has none, so a promotion merge
  request that needs approval before merging was not exercised.
- **One org for four branches**, as on GitHub.
- **Azure DevOps and Bitbucket**, still code reading and unit tests only.

## Harness added for GitLab

Three scripts, committed with the `promotion-branches-e2e` skill so the next run does not have to
rebuild them:

| Script                     | What it does                                                                                  |
|----------------------------|-----------------------------------------------------------------------------------------------|
| `e2e-lib-gitlab.sh`        | `gl_check`, `gl_deploy`, `gl_promote`, `gl_release_notes`, `gl_mr_create`, `gl_mr_merge`, and the merge-ref wait |
| `check-diagram-gitlab.cjs` | the single-place-in-the-diagram check, reading merge requests from the GitLab API              |
| `ab-run-gitlab.sh`         | the flag-off comparison passes                                                                 |

`build-repo.sh` and `stories.sh` are shared with the GitHub run: the repository content and the six
stories are provider agnostic.

Two notes for anyone rerunning this against a self-hosted GitLab:

- Python's `urllib` refuses the corporate CA of `gitlab.hardis-group.com`; `curl` and node accept
  it. Every API call in the harness goes through `curl`.
- Python on Windows does not resolve the git bash `/tmp` path. Keep the body files under a real
  Windows path.
