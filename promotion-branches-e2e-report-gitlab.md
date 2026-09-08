# Promotion branches: end to end test on GitLab

**Date:** 2026-09-08 (re-run; the previous GitLab run of 2026-09-07 is superseded by this one)
**Project under test:** `nicolas.vuillamy/sfdx-hardis-promo-e2e-gl-2` (private, id 4433, on the self-hosted `gitlab.hardis-group.com`), created empty for this run
**Salesforce org:** `nicolas.vuillamy.c8024b5deb9f@agentforce.com` (developer org, shared with the three other providers)
**sfdx-hardis:** `feat/promotion-branches`, `4ee287470` at the start, `5b870e1aa` after the three fixes below
**vscode-sfdx-hardis:** `feat/promotion-branches`, `06ba32f8` (not modified by this run)

Every job below is a real `deploy:smart` against that org, run locally with the GitLab CI variables
set (`CI_SFDX_HARDIS_GITLAB_TOKEN`, `CI_SERVER_URL`, `CI_PROJECT_ID`, `CI_MERGE_REQUEST_IID`), which
is what the git provider reads. Project set to merge commits with squash disabled, so the `-x`
trailers of the cherry-picks survive.

___

## The pipeline

| Story | Merge request | Branch                    | Target      | Actions                   | Test classes                            | Keyword                  |
|-------|---------------|---------------------------|-------------|---------------------------|-----------------------------------------|--------------------------|
| S1    | !1            | `feature/E2E-101-alpha`   | integration | pre command + post manual | `PromoE2EAlphaTest`, `PromoE2EBetaTest` | -                        |
| S2    | !2            | `feature/E2E-102-beta`    | integration | post command              | -                                       | `NO_DELTA`               |
| S3    | !3            | `feature/E2E-103-gamma`   | integration | pre command               | `PromoE2EBetaTest`                      | `PURGE_FLOW_VERSIONS`    |
| S4    | !4            | `feature/E2E-201-delta`   | uat         | pre command + post manual | `PromoE2EAlphaTest`                     | -                        |
| S5    | !5            | `feature/E2E-202-epsilon` | uat         | post command              | -                                       | -                        |
| S6    | !6            | `feature/E2E-301-hotfix`  | preprod     | pre command + post manual | `PromoE2EBetaTest`                      | `FLOW_DELETE_INTERVIEWS` |

## The promotions

| Promotion | Merge request | Branch                                   | Carries         | Outcome                                                  |
|-----------|---------------|------------------------------------------|-----------------|-----------------------------------------------------------|
| P1        | !7            | `promotion/integration/uat/2026-09-07-1`  | !1, !3         | merged, deployed to uat                                    |
| P2        | !8            | `promotion/uat/preprod/2026-09-07-1`      | !4             | merged, deployed to preprod                                |
| P3        | !9            | `promotion/uat/preprod/2026-09-07-2`      | !3, !1         | the merge commit of P1, one level of nesting               |
| P4        | !10           | `promotion/preprod/main/2026-09-07-1`     | !4, !3, !1, !6 | merged, deployed to main, two levels of nesting            |
| P5        | !14           | `promotion/integration/uat/2026-09-07-2`  | !13            | assembled with conflict markers on purpose, then closed    |
| P6        | !17           | `promotion/integration/uat/2026-09-07-3`  | !13            | superseded !14 and closed it                               |

___

## What this run found

**No promotion branches defect.** Every promotion behavior is correct, including the four fixes
landed during the Bitbucket run. What this run did find, through the new Pull Request comment
audit, is **three defects in the comments sfdx-hardis writes**, none of them specific to promotion
branches and all of them affecting every user of the product.

### 1. A dead job link in every comment

`967851c22`. Every sfdx-hardis comment ended with:

```
_Powered by [sfdx-hardis](https://sfdx-hardis.cloudity.com) from job [undefined](undefined)_
```

`CI_JOB_NAME` and `CI_JOB_URL` only exist inside a GitLab CI job. A run from a developer machine,
or from a CI system other than GitLab's own - both supported, since the provider is picked from
`CI_SFDX_HARDIS_GITLAB_TOKEN` and not from being inside GitLab CI - has neither, and the values
were interpolated anyway.

Not GitLab specific. The same audit over the GitHub run's comments shows **30 comments** ending in
`from job [null](null)`, and Bitbucket would print `[null](...)` the same way with its build number
unset. The four providers now share one helper, and the footer simply does not mention a job when
there is none to point at:

```
_Powered by [sfdx-hardis](https://sfdx-hardis.cloudity.com)_
```

### 2. The same absent job name inside the message key

`8aac25552`. The key that identifies a comment so a re-run updates it read
`deployment-check-undefined-22` on GitLab and `deployment-check-null-1` on GitHub. A project whose
jobs sometimes carry a job name and sometimes do not then produced two different keys for what is
the same comment. A stable placeholder replaces the missing name: `deployment-check-job-22`.

### 3. Renaming a CI job duplicated every comment

`5b870e1aa`, and the most serious of the three. Because the key carries the job name, GitHub and
GitLab, which matched **only** on the exact key, could not find the comment they had written under
another job name. They left it in place and added a second one next to it. The Azure DevOps
provider had already solved this with a fallback on the comment **kind**; GitHub and GitLab now do
the same.

This run reproduced it directly. Fixing defect 2 changed the key, and the very next validation job
posted a second validation comment on !22 rather than updating the first. With the fallback in
place, the upgrade path is clean, proved on !23:

```
BEFORE: MR 23 comments: 1
   message-key deployment-check-undefined-23
AFTER:  MR 23 comments: 1
   message-key deployment-check-job-23 | Powered by [sfdx-hardis](https://sfdx-hardis.cloudity.com)_
```

A comment written by the previous release is **updated in place**, keeping its position and its
permalink, and gains the corrected footer.

### The audit's remaining findings, and why they stay

```
664 checks over 23 Pull Requests (gitlab)
31 FINDING(S)
  28  contains /\bundefined\b/
   2  manual action e2e-manual-1 is marked skipped in uat
   1  #22: 2 validation comments, expected at most 1
```

None of the three is a live defect:

- The **28 `undefined`** are in comments written earlier in this very run, by the CLI before defects
  1 and 2 were fixed. sfdx-hardis rewrites a comment only when a job touches that Pull Request
  again, so they keep the old text until then. Every comment written after the fix is clean, proved
  live on !20, !22 and !23.
- The **`⚪` on !1** is the pending manual action defect of the Bitbucket report, written here by the
  flag-off passes that deliberately run the pre-fix `origin/main` CLI. The fix stops new corruption
  but does not repair an entry already written.
- The **two validation comments on !22** are the intermediate state described in defect 3, created
  between the key fix and the lookup fix. The shipped code does not produce them.

___

## Test groups

| Group                                     | Expected                                                                       | Result                                                                                        |
|-------------------------------------------|--------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------|
| Provider detection                        | GitLab picked from `CI_SFDX_HARDIS_GITLAB_TOKEN`, project from `CI_PROJECT_ID`  | OK on every job                                                                                     |
| Feature branch validation and deployment  | `Pull Request scope: 1 Pull Request(s) (#N)` and nothing else                   | OK for !1..!6                                                                                       |
| Two yaml blocks in a description          | both are read                                                                   | OK on !1: `PromoE2EAlphaTest` and `PromoE2EBetaTest`                                                |
| `NO_DELTA`                                | `Delta deployment has been disabled`, `Deployment mode: FULL`                   | OK on !2                                                                                            |
| `PURGE_FLOW_VERSIONS`                     | extra pre-deploy action, skipped in validation, run in deployment               | OK on !3                                                                                            |
| Manual actions in a validation job        | `Skipping ...: deployment-only action`                                          | OK everywhere                                                                                       |
| Promotion merge request creation          | branch pushed, merge request opened with the declaration and the carried table   | OK: !7, !8, !9, !10, !14, !17                                                                       |
| Promotion validation and deployment       | scope = declared + the promotion itself                                         | OK: !7 (`#1, #3, #7`), !8 (`#4, #8`), !9 (`#3, #1, #9`), !10 (`#4, #3, #1, #6, #10`)                 |
| Keyword inheritance                       | only the keywords of the carried stories                                        | OK: !7 inherits `PURGE_FLOW_VERSIONS` and not `NO_DELTA`; !10 inherits both                          |
| Test classes of a promotion               | union of the carried merge requests, `RunSpecifiedTests`                        | OK                                                                                                  |
| Go-live branch content                    | the four static resources and the four action files                             | OK on !10                                                                                           |
| Deployment action state                   | the note lands on the **story** merge request, one column per org branch        | OK                                                                                                  |
| Promotion carrying a promotion            | the stories of the inner promotion are in the scope                             | OK on !9 and !10                                                                                    |
| Grouped merge commit                      | the numbers nobody asked for are named **before** cherry-picking, and declared  | OK on !9 and !10                                                                                    |
| Retrofit `main` -> `integration`          | the promotion is expanded, then every already shipped story is named            | OK on !11: `Promotion Pull Request 10 adds 4 carried Pull Request(s)`, then four `already deployed`  |
| Release notes of the go-live              | the User Stories, not the vehicles                                              | OK: 4 merge requests (!1, !3, !4, !6); 5 with `--include-promotions`, !10 added                      |
| Already promoted                          | marked in the table, `--include-already-promoted` named, no branch created      | OK                                                                                                  |
| Empty cherry-pick                         | `Nothing to cherry-pick`, no branch, exit 0                                     | OK                                                                                                  |
| Empty cherry-pick, dirty report folder    | same result with `hardis-report/` untracked                                     | OK                                                                                                  |
| Conflict, agent default                   | promotion undone, both files named                                              | OK on !13: `NOTES.md, force-app/main/default/labels/CustomLabels.labels-meta.xml`                    |
| Conflict outside `force-app`              | the gate still catches it                                                       | OK, `NOTES.md` named                                                                                |
| Conflict, kept                            | merge request created, prompt file written and embedded                         | OK: !14                                                                                             |
| Marker guard                              | the job fails naming the files                                                  | OK: `still contains git conflict markers in 2 file(s)`                                              |
| Marker guard, solved                      | the job passes                                                                  | OK, scope `#13, #14`, and the merge-ref wait did its job on the first attempt                       |
| Committed conflict prompt report          | the gate ignores it                                                             | OK                                                                                                  |
| Feature off                               | one informational line, scope = the merge request alone                         | OK on !14                                                                                           |
| Hand-named branch                         | warning, treated as a feature branch, declaration ignored                       | OK on !15                                                                                           |
| Retargeted promotion                      | warning naming the mismatch, scope = the merge request alone                    | OK on !16                                                                                           |
| Unreadable declaration                    | warning and skip, not a failure                                                 | OK on !17: `Pull Request #9999 ... was not found: skipped`                                          |
| Sync merge inside a story                 | the candidate lists the story only                                              | OK: !18 alone, !19 on its own row                                                                   |
| Branch merged twice                       | listed once, never with a `-` row                                               | OK: !19 and !20, one row each                                                                       |
| Supersede an open promotion               | the open one is closed, its stories offered again with no mark                  | OK: !17 closed !14, state `closed`                                                                  |
| Restricted `allowedPromotionSteps`        | a forbidden source and a forbidden target are both refused                      | OK, both name the allowed steps                                                                     |
| `allowedPromotionSteps` not declared      | the command stops, asking for the list and linking to the doc                   | OK                                                                                                  |
| Full merge after a partial promotion      | already promoted stories skipped, the never promoted one arrives                | OK on !21, see below                                                                                |
| `promotion:list-candidates`               | the candidate table without assembling anything                                 | OK from `uat`                                                                                       |
| Pull Request comment audit                | consistent comments, navigation and action state                                | **found three defects**, all fixed, see above                                                       |
| Single place in the diagram               | each number in one branch only                                                  | OK, see below                                                                                       |
| Flag-off regression                       | `TOTAL DIFFERING LINES: 0`                                                      | OK                                                                                                  |

### A full major-to-major merge after a partial promotion

!21 merges `uat` into `preprod` in full, after !4 had been promoted alone by !8 and !1, !3 by !9.

- The validation scope is `#4, #5, #7, #18, #19, #20, #21, #1, #3`: the promotion !7 is expanded,
  and !5 (S5 epsilon), which had never been promoted, arrives for the first time.
- !4, !1 and !3 are each reported as `already deployed through promotion branch(es) ...` and their
  deployment actions are skipped.
- The post-deploy action of !5 runs for the first time in `preprod`.
- After the merge, `promotion:create uat -> preprod` answers `No Pull Request merged into uat is
  waiting for promotion to preprod`.

### Single place in the diagram

```
Branch      | node counter | Pull Requests listed
integration | 4            | #13, #12, #11, #2
uat         | 4            | #20, #19, #18, #5
preprod     | 0            |
main        | 4            | #4, #3, #1, #6

OK: every Pull Request number appears in a single branch
With 'show already promoted' on: integration=6 uat=7 preprod=4 main=4
With 'show merge and promotion Pull Requests' on: integration=4 uat=5 preprod=3 main=5
```

Identical, number for number, to the GitHub run on the same scenario.

### Flag-off regression

```
check-feature-mr22.log: 121 lines vs 121 lines, only in A: 0, only in B: 0
check-major-mr23.log:   160 lines vs 160 lines, only in A: 0, only in B: 0
deploy-uat.log:         167 lines vs 167 lines, only in A: 0, only in B: 0
release-notes.log:       71 lines vs  71 lines, only in A: 0, only in B: 0
release-notes.md:        37 lines vs  37 lines, only in A: 0, only in B: 0
TOTAL DIFFERING LINES: 0
```

___

## What this run did not cover

- **The interactive paths.** Everything ran with `--agent`.
- **The websocket button** on merge request creation: no websocket server in a CLI run.
- **The pipeline webview itself**: checked through the extension's compiled helpers.
- **GitLab CI itself.** The jobs are reproduced locally with the CI variables, which is what the
  provider reads, but no `.gitlab-ci.yml` ran on a GitLab runner. `CI_JOB_NAME` and `CI_JOB_URL`
  were left unset on purpose, which is what exposed defects 1 and 2 - a real GitLab CI job sets
  both, so keeping them unset is the harsher and more useful test.
- **Approval rules and protected branches.** The test project has none.
- **One org for four branches.**
- **`FLOW_DELETE_INTERVIEWS` end to end.**

## Traps met, written into the runbook

- **Python on Windows decodes stdin with the system codepage.** Piping a GitLab API answer into
  `json.load(sys.stdin)` mangles every emoji in a merge request description and can produce a lone
  surrogate, after which the API answers `400 Bad Request` on the update. Read the bytes and decode
  them as UTF-8: `json.loads(sys.stdin.buffer.read().decode('utf-8'))`.
- **`ab-run-gitlab.sh` is a child process** and does not inherit the functions the caller sourced.
  It now sources the library sitting next to it, like the Azure and Bitbucket ones.
- The **merge-ref wait** of `gl_check` did its job: no misleading validation result this time,
  where the previous GitLab run lost three.

## Suite counts after the fixes

- sfdx-hardis: **1837 unit tests passing** (1823 before, 14 added for the three fixes), lint clean.
- vscode-sfdx-hardis: not modified by this run.
