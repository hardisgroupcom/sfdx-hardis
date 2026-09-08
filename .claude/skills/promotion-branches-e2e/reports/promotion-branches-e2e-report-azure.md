# Promotion branches: end to end test on Azure DevOps

**Date:** 2026-09-08 (re-run; the first Azure run of 2026-09-07 is superseded by this one)
**Repository under test:** `nicolasvuillamy/tests-sfdx-hardis/sfdx-hardis-promo-e2e-az-2` (private, created empty for this run)
**Salesforce org:** `nicolas.vuillamy.c8024b5deb9f@agentforce.com` (developer org, shared with the three other providers)
**sfdx-hardis:** `feat/promotion-branches`, `cf311c06b` at the start, `4752b64fd` after the fix below
**vscode-sfdx-hardis:** `feat/promotion-branches`, `06ba32f8` (not modified by this run)

Every job below is a real `deploy:smart` against that org, run locally with the Azure Pipelines
variables set (`SYSTEM_ACCESSTOKEN`, `SYSTEM_COLLECTIONURI`, `SYSTEM_TEAMPROJECT`,
`BUILD_REPOSITORY_ID`, `SYSTEM_PULLREQUEST_PULLREQUESTID`), which is what the git provider reads.

Pull Request ids are unique per **organization** on Azure DevOps, so this fresh repository starts at
**#29**. Nothing in the feature assumes the first story is number 1.

___

## The pipeline

| Story | Pull Request | Branch                    | Target      | Actions                   | Test classes                            | Keyword                  |
|-------|--------------|---------------------------|-------------|---------------------------|-----------------------------------------|--------------------------|
| S1    | #29          | `feature/E2E-101-alpha`   | integration | pre command + post manual | `PromoE2EAlphaTest`, `PromoE2EBetaTest` | -                        |
| S2    | #30          | `feature/E2E-102-beta`    | integration | post command              | -                                       | `NO_DELTA`               |
| S3    | #31          | `feature/E2E-103-gamma`   | integration | pre command               | `PromoE2EBetaTest`                      | `PURGE_FLOW_VERSIONS`    |
| S4    | #32          | `feature/E2E-201-delta`   | uat         | pre command + post manual | `PromoE2EAlphaTest`                     | -                        |
| S5    | #33          | `feature/E2E-202-epsilon` | uat         | post command              | -                                       | -                        |
| S6    | #34          | `feature/E2E-301-hotfix`  | preprod     | pre command + post manual | `PromoE2EBetaTest`                      | `FLOW_DELETE_INTERVIEWS` |

## The promotions

| Promotion | Pull Request | Branch                                   | Carries            | Outcome                                                    |
|-----------|--------------|------------------------------------------|--------------------|------------------------------------------------------------|
| P1        | #35          | `promotion/integration/uat/2026-09-08-1` | #29, #31           | merged, deployed to uat                                    |
| P2        | #36          | `promotion/uat/preprod/2026-09-08-1`     | #32                | merged, deployed to preprod                                |
| P3        | #37          | `promotion/uat/preprod/2026-09-08-2`     | #29, #31           | the merge commit of P1, one level of nesting               |
| P4        | #38          | `promotion/preprod/main/2026-09-08-1`    | #32, #29, #31, #34 | merged, deployed to main, two levels of nesting            |
| P5        | #42          | `promotion/integration/uat/2026-09-08-2` | #41                | assembled with conflict markers on purpose, then abandoned |
| P6        | #45          | `promotion/integration/uat/2026-09-08-3` | #41                | superseded #42 and abandoned it                            |

___

## What this run found

**No promotion branches defect, and no Azure defect.** The truncated-description fix of the first
Azure run holds on a fresh repository: the promotion candidate table, the already-promoted marks
and the retrofit expansion are all correct.

One unrelated rough edge, found by the flag-off comparison and fixed inside the run:

### An unknown code coverage was reported as an error

`4752b64fd`. Whenever a deployment ran Apex tests with a coverage formatter, the log carried:

```
Warning: unable to convert Unknown into string
orgCoverage.toFixed is not a function
```

The `json-summary` coverage file holds the string `"Unknown"` when there was nothing to measure.
`getCoverageFromJsonFile` called `toFixed` on it, threw, and the catch reported a plain situation
as a warning plus an **error** line. An unknown or unparseable coverage is now simply read as "no
coverage to report", and the two lines are gone, proved on a re-run of the same job.

Not promotion branches related: it shows on every `deploy:smart` that runs Apex tests, on every
provider.

___

## Test groups

| Group                                    | Expected                                                                       | Result                                                                                              |
|------------------------------------------|--------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------|
| Provider detection                       | Azure picked from `SYSTEM_ACCESSTOKEN`, repository from `BUILD_REPOSITORY_ID`  | OK on every job                                                                                     |
| Feature branch validation and deployment | `Pull Request scope: 1 Pull Request(s) (#N)` and nothing else                  | OK for #29..#34                                                                                     |
| Two yaml blocks in a description         | both are read                                                                  | OK on #29: `PromoE2EAlphaTest` and `PromoE2EBetaTest`                                               |
| `NO_DELTA`                               | `Delta deployment has been disabled`, `Deployment mode: FULL`                  | OK on #30                                                                                           |
| `PURGE_FLOW_VERSIONS`                    | extra pre-deploy action, skipped in validation, run in deployment              | OK on #31                                                                                           |
| Manual actions in a validation job       | `Skipping ...: deployment-only action`                                         | OK everywhere                                                                                       |
| Truncated description (first run's fix)  | the promotion declaration is read past Azure's 400 character list cut          | OK: #38 declares four stories and every one is found                                                |
| Promotion Pull Request creation          | branch pushed, Pull Request opened with the declaration and the carried table  | OK: #35, #36, #37, #38, #42, #45                                                                    |
| Promotion validation and deployment      | scope = declared + the promotion itself                                        | OK: #35 (`#29, #31, #35`), #36 (`#32, #36`), #37 (`#29, #31, #37`), #38 (`#32, #29, #31, #34, #38`) |
| Keyword inheritance                      | only the keywords of the carried stories                                       | OK: #35 inherits `PURGE_FLOW_VERSIONS` and not `NO_DELTA`; #38 inherits both                        |
| Test classes of a promotion              | union of the carried Pull Requests, `RunSpecifiedTests`                        | OK                                                                                                  |
| Go-live branch content                   | the four static resources and the four action files                            | OK on #38                                                                                           |
| Deployment action state                  | the comment lands on the **story** Pull Request, one column per org branch     | OK, four columns on #29, #32 and #34                                                                |
| Promotion carrying a promotion           | the stories of the inner promotion are in the scope                            | OK on #37 and #38                                                                                   |
| Grouped merge commit                     | the numbers nobody asked for are named **before** cherry-picking, and declared | OK on #37 and #38                                                                                   |
| Retrofit `main` -> `integration`         | the promotion is expanded, then every already shipped story is named           | OK on #39: `Promotion Pull Request 38 adds 4 carried Pull Request(s)`, then four `already deployed` |
| Release notes of the go-live             | the User Stories, not the vehicles                                             | OK: 4 Pull Requests (#29, #31, #32, #34); 5 with `--include-promotions`, #38 added                  |
| Already promoted                         | marked in the table, `--include-already-promoted` named, no branch created     | OK                                                                                                  |
| Empty cherry-pick                        | `Nothing to cherry-pick`, no branch, exit 0                                    | OK                                                                                                  |
| Empty cherry-pick, dirty report folder   | same result with `hardis-report/` untracked                                    | OK                                                                                                  |
| Conflict, agent default                  | promotion undone, both files named                                             | OK on #41                                                                                           |
| Conflict outside `force-app`             | the gate still catches it                                                      | OK, `NOTES.md` named                                                                                |
| Conflict, kept                           | Pull Request created, prompt file written and embedded                         | OK: #42                                                                                             |
| Marker guard                             | the job fails naming the files                                                 | OK: `still contains git conflict markers in 2 file(s)`                                              |
| Marker guard, solved                     | the job passes                                                                 | OK, scope `#41, #42`                                                                                |
| Committed conflict prompt report         | the gate ignores it                                                            | OK                                                                                                  |
| Feature off                              | one informational line, scope = the Pull Request alone                         | OK on #42                                                                                           |
| Hand-named branch                        | warning, treated as a feature branch, declaration ignored                      | OK on #43                                                                                           |
| Retargeted promotion                     | warning naming the mismatch, scope = the Pull Request alone                    | OK on #44                                                                                           |
| Unreadable declaration                   | warning and skip, not a failure                                                | OK on #42: `Pull Request #9999 ... was not found: skipped`                                          |
| Sync merge inside a story                | the candidate lists the story only                                             | OK: #46 alone, #47 on its own row                                                                   |
| Branch merged twice                      | listed once, never with a `-` row                                              | OK: #47 and #48, one row each                                                                       |
| Supersede an open promotion              | the open one is closed, its stories offered again with no mark                 | OK: #45 abandoned #42, status `abandoned`                                                           |
| Restricted `allowedPromotionSteps`       | a forbidden source and a forbidden target are both refused                     | OK, both name the allowed steps                                                                     |
| `allowedPromotionSteps` not declared     | the command stops, asking for the list and linking to the doc                  | OK                                                                                                  |
| Full merge after a partial promotion     | already promoted stories skipped, the never promoted one arrives               | OK on #49, see below                                                                                |
| `promotion:list-candidates`              | the candidate table without assembling anything                                | OK from `uat`                                                                                       |
| Pull Request comment audit               | consistent comments, navigation and action state                               | 740 checks, two findings, both the known pre-fix manual action state, see below                     |
| Single place in the diagram              | each number in one branch only                                                 | OK, see below                                                                                       |
| Flag-off regression                      | `TOTAL DIFFERING LINES: 0`                                                     | 16 lines, all from the first run's Azure fix, see below                                             |

### A full major-to-major merge after a partial promotion

#49 merges `uat` into `preprod` in full, after #32 had been promoted alone by #36 and #29, #31 by #37.

- The validation scope is `#35, #32, #33, #47, #46, #48, #49, #29, #31`: the promotion #35 is
  expanded, and #33 (S5 epsilon), which had never been promoted, arrives for the first time.
- #32, #29 and #31 are each reported as `already deployed through promotion branch(es) ...` and
  their deployment actions are skipped.
- The post-deploy action of #33 runs for the first time in `preprod`.
- After the merge, `promotion:create uat -> preprod` answers `No Pull Request merged into uat is
  waiting for promotion to preprod`.

### Pull Request comment audit

```
740 checks over 23 Pull Requests (azure)
2 FINDING(S):
  - #34: manual action e2e-manual-34 is marked skipped in uat
  - #29: manual action e2e-manual-29 is marked skipped in uat
```

Both are the pending manual action defect fixed during the Bitbucket run, written here by the
flag-off passes that deliberately run the pre-fix `origin/main` CLI. The job is identifiable:

```
ab-main2/check-major-pr51.log
  Pull Request scope: 8 Pull Request(s) (#38, #29, #30, #31, #39, #40, #41, #51)
```

`ab-main2` is a pre-fix CLI. Everything the fixed CLI wrote in this run is clean, and the shipped
code does not produce the state.

### Single place in the diagram

```
Branch      | node counter | Pull Requests listed
integration | 4            | #41, #40, #39, #30
uat         | 4            | #48, #47, #46, #33
preprod     | 0            |
main        | 4            | #32, #29, #31, #34

OK: every Pull Request number appears in a single branch
With 'show already promoted' on: integration=6 uat=7 preprod=4 main=4
With 'show merge and promotion Pull Requests' on: integration=4 uat=5 preprod=3 main=5
```

The same counters as GitHub, GitLab and Bitbucket on the same scenario, with Azure's own numbering.

### Flag-off regression

```
check-feature-pr50.log: 122 lines vs 122 lines, only in A: 0, only in B: 0
check-major-pr51.log:   156 lines vs 161 lines, only in A: 4, only in B: 9
deploy-uat.log:         170 lines vs 173 lines, only in A: 0, only in B: 3
release-notes.log:       70 lines vs  70 lines, only in A: 0, only in B: 0
release-notes.md:        37 lines vs  37 lines, only in A: 0, only in B: 0
TOTAL DIFFERING LINES: 16
```

Not zero, and for the same reason as the first Azure run. The **Pull Request scope is identical on
both sides**, so promotion branches, switched off, still change nothing. What differs is:

- **13 lines**: `origin/main` selects no Apex test class where the branch selects two. That is the
  first Azure run's truncated-description fix repairing `enableDeploymentApexTestClasses`, a feature
  unrelated to promotion branches that was broken on Azure DevOps before this work.
- **3 lines**: the coverage lines that follow from actually running those tests, including the two
  the coverage fix above has since removed.

On a repository whose Pull Request descriptions all stay under 400 characters the two runs are
identical.

___

## What this run did not cover

- **The interactive paths.** Everything ran with `--agent`.
- **The websocket button** on Pull Request creation.
- **The pipeline webview itself**: checked through the extension's compiled helpers.
- **Azure Pipelines itself.** The jobs are reproduced locally with the pipeline variables;
  `SYSTEM_JOB_DISPLAY_NAME`, `BUILD_BUILDID` and the job URLs they build were fixed values.
- **Branch policies and required reviewers.** Every completion used `bypassPolicy: true`.
- **Work items.** No work item is linked to any Pull Request of the test project.
- **The 4000 character description cap.** Approached in the first run (3690), not crossed.
- **One org for four branches.**
- **`FLOW_DELETE_INTERVIEWS` end to end.**

## The counterpart in vscode-sfdx-hardis

Asked whether any of the CLI fixes had a counterpart in the extension, the answer turned out to be
**yes for this one**, and it was live.

`GitProviderAzure.collectMergedPRsForCommits` and `listOpenPullRequests` both list Pull Requests
through `gitApi.getPullRequests`, the same truncating endpoint, and `convertToPullRequest` copies
`pr.description` straight into the `PullRequest` objects that `orgConfigUtils` feeds to
`expandPullRequestsWithPromotions` and `buildPromotionIndex`. Those helpers parse
`promotionPullRequests` out of the description, so on Azure DevOps the DevOps Pipeline expanded no
promotion, marked no story as already promoted, and displayed wrong branch counters, for exactly
the same reason as the CLI.

The end to end harness had hidden it: `check-diagram-azure.cjs` re-reads full descriptions itself
before calling the extension helpers, so it exercised the helpers with data the extension would
never have had.

Fixed in vscode-sfdx-hardis `648a1bf5` with the same approach, and covered by 7 tests
(`src/test/suite/azureListDescription.test.ts`); the extension suite is at **350 passing**.

The other nine fixes have no counterpart: the extension posts and reads no Pull Request comment,
writes no deployment action state, cherry-picks nothing and parses no coverage. Its Bitbucket
provider was already paginating and already putting `state` inside the `q` expression, which is
what the CLI had to be taught.

## Suite counts

- sfdx-hardis: **1837 unit tests passing**, lint clean.
- vscode-sfdx-hardis: not modified by this run.
