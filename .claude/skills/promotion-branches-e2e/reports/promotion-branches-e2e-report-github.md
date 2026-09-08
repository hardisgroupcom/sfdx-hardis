# Promotion branches: end to end test on GitHub

**Date:** 2026-09-08 (re-run; the previous GitHub run of 2026-09-07 is superseded by this one)
**Repository under test:** `nvuillam/sfdx-hardis-promo-e2e-5` (private, created empty for this run)
**Salesforce org:** `nicolas.vuillamy.c8024b5deb9f@agentforce.com` (developer org, shared with the three other providers)
**sfdx-hardis:** `feat/promotion-branches`, `79e35f3f5`
**vscode-sfdx-hardis:** `feat/promotion-branches`, `06ba32f8` (not modified by this run)

This is the **confirmation run**: the previous GitHub run found and fixed three defects, and the
Bitbucket run that came before this one fixed four more. This run starts from a fresh repository
with all seven fixes in place, so what it proves is the shipped behavior, not a work in progress.

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

Eleven more Pull Requests exercise the edge cases: the retrofit (#11), the conflicting pair (#12,
#13), a hand-named branch (#15), a retargeted promotion (#16), a story receiving a sync merge (#18)
next to the story that landed in the meantime (#19) and its second merge (#20), the full
major-to-major merge (#21), and two Pull Requests kept open for the flag-off comparison (#22, #23).

## The promotions

| Promotion | Pull Request | Branch                                   | Carries        | Outcome                                                 |
|-----------|--------------|------------------------------------------|----------------|---------------------------------------------------------|
| P1        | #7           | `promotion/integration/uat/2026-09-07-1` | #1, #3         | merged, deployed to uat                                 |
| P2        | #8           | `promotion/uat/preprod/2026-09-07-1`     | #4             | merged, deployed to preprod                             |
| P3        | #9           | `promotion/uat/preprod/2026-09-07-2`     | #3, #1         | the merge commit of P1, one level of nesting            |
| P4        | #10          | `promotion/preprod/main/2026-09-07-1`    | #4, #3, #1, #6 | merged, deployed to main, two levels of nesting         |
| P5        | #14          | `promotion/integration/uat/2026-09-07-2` | #13            | assembled with conflict markers on purpose, then closed |
| P6        | #17          | `promotion/integration/uat/2026-09-07-3` | #13            | superseded #14 and closed it                            |

___

## What this run found

**No new defect.** Every behavior the runbook asks for is correct on the first attempt, including
the four fixes the Bitbucket run had just landed, which this run confirms are provider agnostic:

- **The refused cherry-pick** message is not reached here: the conflict on #13 is a real content
  conflict and is reported as one, naming both files.
- **The Pull Request listing** is GitHub's own, which was never truncated; the candidate table
  resolves every title and marks every already promoted story.
- **The skipped action guard** holds: #4 and #6 keep `👋 waiting` for their manual actions in every
  org branch they reached, through the whole run.

### The one finding of the comment audit, and where it comes from

```
654 checks over 23 Pull Requests (github)
1 FINDING(S):
  - #1: manual action e2e-manual-1 is marked skipped in uat: it left the pending list and can no
    longer be ticked
```

This is defect 5 of the Bitbucket report, and it was written **by the flag-off comparison itself**.
That comparison alternates the sfdx-hardis checkout between `feat/promotion-branches` and
`origin/main`, and `origin/main` does not have the fix. The job that wrote it is identifiable:

```
ab-main2/check-major-pr23.log
  Pull Request scope: 8 Pull Request(s) (#10, #1, #2, #3, #11, #12, #13, #23)
  Skipping E2E manual step of PR 1 (from PR #1): deployment-only action (context
  process-deployment-only), and this is the validation job
```

`ab-main2` is the **last** pass of the four, and it is a pre-fix CLI. The two passes run with the
fixed CLI produced the same log line and did not corrupt anything.

Two things follow, and both matter for the release:

- The defect is real on `main` today, and it is **not Bitbucket specific**: a validation job on the
  target branch is enough to trigger it, which is the commonest job of all.
- The fix stops new corruption but **does not repair an entry already written**. #1 keeps its `⚪`
  in this repository, and so will every project that already hit this. Worth deciding before the
  release whether a manual action recorded `skipped` should be rendered as waiting again.

___

## Test groups

| Group                                    | Expected                                                                       | Result                                                                                              |
|------------------------------------------|--------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------|
| Feature branch validation and deployment | `Pull Request scope: 1 Pull Request(s) (#N)` and nothing else                  | OK for #1..#6                                                                                       |
| Two yaml blocks in a description         | both are read                                                                  | OK on #1: `PromoE2EAlphaTest` and `PromoE2EBetaTest`                                                |
| `NO_DELTA`                               | `Delta deployment has been disabled`, `Deployment mode: FULL`                  | OK on #2, validation and deployment                                                                 |
| `PURGE_FLOW_VERSIONS`                    | extra pre-deploy action, skipped in validation, run in deployment              | OK on #3                                                                                            |
| Manual actions in a validation job       | `Skipping ...: deployment-only action`                                         | OK everywhere                                                                                       |
| Promotion Pull Request creation          | branch pushed, Pull Request opened with the declaration and the carried table  | OK: #7, #8, #9, #10, #14, #17                                                                       |
| Promotion validation and deployment      | scope = declared + the promotion itself                                        | OK: #7 (`#1, #3, #7`), #8 (`#4, #8`), #9 (`#3, #1, #9`), #10 (`#4, #3, #1, #6, #10`)                |
| Keyword inheritance                      | only the keywords of the carried stories                                       | OK: #7 inherits `PURGE_FLOW_VERSIONS` and not `NO_DELTA`; #10 inherits both keywords                |
| Test classes of a promotion              | union of the carried Pull Requests, `RunSpecifiedTests`                        | OK                                                                                                  |
| Go-live branch content                   | the four static resources and the four action files                            | OK on #10                                                                                           |
| Deployment action state                  | the comment lands on the **story** Pull Request, one column per org branch     | OK: #4 and #6 clean, #1 carries the legacy `⚪` described above                                      |
| Promotion carrying a promotion           | the stories of the inner promotion are in the scope                            | OK on #9 and #10                                                                                    |
| Grouped merge commit                     | the numbers nobody asked for are named **before** cherry-picking, and declared | OK on #9 and #10                                                                                    |
| Retrofit `main` -> `integration`         | the promotion is expanded, then every already shipped story is named           | OK on #11: `Promotion Pull Request 10 adds 4 carried Pull Request(s)`, then four `already deployed` |
| Release notes of the go-live             | the User Stories, not the vehicles                                             | OK: 4 Pull Requests (#1, #3, #4, #6); 5 with `--include-promotions`, #10 added                      |
| Already promoted                         | marked in the table, `--include-already-promoted` named, no branch created     | OK                                                                                                  |
| Empty cherry-pick                        | `Nothing to cherry-pick`, no branch, exit 0                                    | OK                                                                                                  |
| Empty cherry-pick, dirty report folder   | same result with `hardis-report/` untracked                                    | OK                                                                                                  |
| Conflict, agent default                  | promotion undone, both files named                                             | OK on #13: `NOTES.md, force-app/main/default/labels/CustomLabels.labels-meta.xml`                   |
| Conflict outside `force-app`             | the gate still catches it                                                      | OK, `NOTES.md` named                                                                                |
| Conflict, kept                           | Pull Request created, prompt file written and embedded                         | OK: #14                                                                                             |
| Marker guard                             | the job fails naming the files                                                 | OK: `still contains git conflict markers in 2 file(s)`                                              |
| Marker guard, solved                     | the job passes                                                                 | OK, scope `#13, #14`                                                                                |
| Committed conflict prompt report         | the gate ignores it                                                            | OK, committed on the promotion branch and the gate stayed silent                                    |
| Feature off                              | one informational line, scope = the Pull Request alone                         | OK on #14                                                                                           |
| Hand-named branch                        | warning, treated as a feature branch, declaration ignored                      | OK on #15                                                                                           |
| Retargeted promotion                     | warning naming the mismatch, scope = the Pull Request alone                    | OK on #16, the declared stories did not run their actions against production                        |
| Unreadable declaration                   | warning and skip, not a failure                                                | OK: `Pull Request #9999 ... was not found: skipped`                                                 |
| Sync merge inside a story                | the candidate lists the story only                                             | OK: #18 alone, #19 on its own row                                                                   |
| Branch merged twice                      | listed once, never with a `-` row                                              | OK: #19 and #20, one row each                                                                       |
| Supersede an open promotion              | the open one is closed, its stories offered again with no mark                 | OK: #17 closed #14, state `closed merged=false`                                                     |
| Restricted `allowedPromotionSteps`       | a forbidden source and a forbidden target are both refused                     | OK, both name the allowed steps                                                                     |
| `allowedPromotionSteps` not declared     | the command stops, asking for the list and linking to the doc                  | OK                                                                                                  |
| Full merge after a partial promotion     | already promoted stories skipped, the never promoted one arrives               | OK on #21, see below                                                                                |
| `promotion:list-candidates`              | the candidate table without assembling anything                                | OK from `uat`                                                                                       |
| Pull Request comment audit               | consistent comments, navigation and action state                               | 654 checks, one finding (the legacy `⚪` above)                                                      |
| Single place in the diagram              | each number in one branch only                                                 | OK, see below                                                                                       |
| Flag-off regression                      | `TOTAL DIFFERING LINES: 0`                                                     | OK                                                                                                  |

### A full major-to-major merge after a partial promotion

#21 merges `uat` into `preprod` in full, after #4 had been promoted alone by #8 and #1, #3 by #9.

- The validation scope is `#4, #5, #7, #18, #19, #20, #21, #1, #3`: the promotion #7 is expanded,
  and #5 (S5 epsilon), which had never been promoted, arrives for the first time.
- #4, #1 and #3 are each reported as `already deployed through promotion branch(es) ...` and their
  deployment actions are skipped.
- The post-deploy action of #5 runs for the first time in `preprod`.
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

Identical shape to Bitbucket and Azure DevOps on the same scenario.

### Flag-off regression

```
check-feature-pr22.log: 121 lines vs 121 lines, only in A: 0, only in B: 0
check-major-pr23.log:   160 lines vs 160 lines, only in A: 0, only in B: 0
deploy-uat.log:         169 lines vs 169 lines, only in A: 0, only in B: 0
release-notes.log:       71 lines vs  71 lines, only in A: 0, only in B: 0
release-notes.md:        37 lines vs  37 lines, only in A: 0, only in B: 0
TOTAL DIFFERING LINES: 0
```

A GitHub project that does not enable promotion branches gets exactly the jobs it got before.

___

## What this run did not cover

- **The interactive paths.** Everything ran with `--agent`.
- **The websocket button** on Pull Request creation: no websocket server in a CLI run.
- **The pipeline webview itself**: checked through the extension's compiled helpers, not by clicking.
- **GitHub Actions itself.** The jobs are reproduced locally with the workflow variables, which is
  what the provider reads, but no workflow ran on a GitHub runner.
- **Branch protection and required reviews.** The test repository has none.
- **One org for four branches.**
- **`FLOW_DELETE_INTERVIEWS` end to end.** Its inheritance is verified; the interview deletion it
  authorizes needs a Flow in destructive changes, which this project does not have.

## Suite counts

- sfdx-hardis: **1823 unit tests passing**, lint clean.
- vscode-sfdx-hardis: not modified by this run.
