# Promotion branches: end to end test on Bitbucket Cloud

> **Not re-run on 2026-09-09.** The test repository was deleted, so this report is the one of
> 2026-09-08 and does not cover the five fixes of the 2026-09-09 cycle, nor the pipeline
> checkpoints. The three other providers were re-run.

**Date:** 2026-09-08 (re-run; the first Bitbucket run of 2026-09-07 is summarized under "What the first run found")
**Repository under test:** `galerieslafayette/test-prom-e2e` (private), reset to the runbook base project for this run
**Salesforce org:** `nicolas.vuillamy.c8024b5deb9f@agentforce.com` (developer org, shared with the three other providers)
**sfdx-hardis:** `feat/promotion-branches`, `2c2ffa6ea` at the start, unchanged by this run
**vscode-sfdx-hardis:** `feat/promotion-branches`, `06ba32f8` (not modified by this run)

Every job below is a real `deploy:smart` against that org, run locally with the Bitbucket Pipelines
variables set (`CI_SFDX_HARDIS_BITBUCKET_TOKEN`, `BITBUCKET_WORKSPACE`, `BITBUCKET_REPO_SLUG`,
`BITBUCKET_PR_ID`), which is what the git provider reads.

**The repository is reused, not new.** The Bitbucket access token is scoped to this one repository,
so a second one cannot be created. The repository was reset instead: every branch but `main`
deleted, and the base project force-pushed. The consequences are called out where they show.

___

## The pipeline

| Story | Pull Request | Branch                    | Target      | Actions                   | Test classes                            | Keyword                  |
|-------|--------------|---------------------------|-------------|---------------------------|-----------------------------------------|--------------------------|
| S1    | #24          | `feature/E2E-101-alpha`   | integration | pre command + post manual | `PromoE2EAlphaTest`, `PromoE2EBetaTest` | -                        |
| S2    | #25          | `feature/E2E-102-beta`    | integration | post command              | -                                       | `NO_DELTA`               |
| S3    | #26          | `feature/E2E-103-gamma`   | integration | pre command               | `PromoE2EBetaTest`                      | `PURGE_FLOW_VERSIONS`    |
| S4    | #27          | `feature/E2E-201-delta`   | uat         | pre command + post manual | `PromoE2EAlphaTest`                     | -                        |
| S5    | #28          | `feature/E2E-202-epsilon` | uat         | post command              | -                                       | -                        |
| S6    | #29          | `feature/E2E-301-hotfix`  | preprod     | pre command + post manual | `PromoE2EBetaTest`                      | `FLOW_DELETE_INTERVIEWS` |

## The promotions

| Promotion | Pull Request | Branch                                   | Carries            | Outcome                                                                                    |
|-----------|--------------|------------------------------------------|--------------------|--------------------------------------------------------------------------------------------|
| P1        | #30          | `promotion/integration/uat/2026-09-08-1` | #24, #26           | merged, deployed to uat. Closed the **previous run's** stale open promotion #17 on the way |
| P2        | #31          | `promotion/uat/preprod/2026-09-08-1`     | #27                | merged, deployed to preprod                                                                |
| P3        | #32          | `promotion/uat/preprod/2026-09-08-2`     | #26, #24           | the merge commit of P1, one level of nesting                                               |
| P4        | #33          | `promotion/preprod/main/2026-09-08-1`    | #27, #26, #24, #29 | merged, deployed to main, two levels of nesting                                            |
| P5        | #37          | `promotion/integration/uat/2026-09-08-2` | #36                | assembled with conflict markers on purpose, then declined                                  |
| P6        | #39          | `promotion/integration/uat/2026-09-08-3` | #36                | superseded #37 and declined it                                                             |

___

## What the first run found, and what this one confirms

The first Bitbucket run (2026-09-07) found **five defects**, four of them Bitbucket specific. All
five are fixed and this run exercises the fixed code from a clean pipeline:

| Defect                                                             | Commit      | Confirmed here                                                                |
|--------------------------------------------------------------------|-------------|-------------------------------------------------------------------------------|
| A cherry-pick git refused was reported as a conflict with no files | `cb7e8d6de` | the conflict on #36 is a real one and names both files                        |
| `listPullRequests` read a single page                              | `356992aa4` | every candidate title resolves, no `PR #n` placeholder                        |
| `listPullRequests` ignored the target branch filter                | `356992aa4` | the retargeted promotion is not counted as a promotion that reached `preprod` |
| Bitbucket drops `state` when `q` is present                        | `356992aa4` | no merged promotion reported as still open                                    |
| A skipped action erased a pending manual action                    | `d99043d6d` | see the audit below                                                           |

**This run found no new defect.** Every group of the runbook passes.

___

## Test groups

| Group                                    | Expected                                                                       | Result                                                                                              |
|------------------------------------------|--------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------|
| Provider detection                       | Bitbucket picked from the token, repository from `BITBUCKET_REPO_SLUG`         | OK on every job                                                                                     |
| Feature branch validation and deployment | `Pull Request scope: 1 Pull Request(s) (#N)` and nothing else                  | OK for #24..#29                                                                                     |
| Merge job Pull Request resolution        | the merged Pull Request found without `BITBUCKET_PR_ID`                        | OK, through the branch search fallback                                                              |
| Two yaml blocks in a description         | both are read                                                                  | OK on #24: `PromoE2EAlphaTest` and `PromoE2EBetaTest`                                               |
| `NO_DELTA`                               | `Delta deployment has been disabled`, `Deployment mode: FULL`                  | OK on #25                                                                                           |
| `PURGE_FLOW_VERSIONS`                    | extra pre-deploy action, skipped in validation, run in deployment              | OK on #26                                                                                           |
| Manual actions in a validation job       | `Skipping ...: deployment-only action`                                         | OK everywhere                                                                                       |
| Promotion Pull Request creation          | branch pushed, Pull Request opened with the declaration and the carried table  | OK: #30, #31, #32, #33, #37, #39                                                                    |
| Promotion validation and deployment      | scope = declared + the promotion itself                                        | OK: #30 (`#24, #26, #30`), #31 (`#27, #31`), #32 (`#26, #24, #32`), #33 (`#27, #26, #24, #29, #33`) |
| Keyword inheritance                      | only the keywords of the carried stories                                       | OK: #30 inherits `PURGE_FLOW_VERSIONS` and not `NO_DELTA`; #33 inherits both                        |
| Test classes of a promotion              | union of the carried Pull Requests, `RunSpecifiedTests`                        | OK                                                                                                  |
| Go-live branch content                   | the four static resources and the four action files                            | OK on #33                                                                                           |
| Deployment action state                  | the comment lands on the **story** Pull Request, one column per org branch     | OK                                                                                                  |
| Promotion carrying a promotion           | the stories of the inner promotion are in the scope                            | OK on #32 and #33                                                                                   |
| Grouped merge commit                     | the numbers nobody asked for are named **before** cherry-picking, and declared | OK on #32 and #33                                                                                   |
| Retrofit `main` -> `integration`         | the promotion is expanded, then every already shipped story is named           | OK on #34: `Promotion Pull Request 33 adds 2 carried Pull Request(s)`, then four `already deployed` |
| Release notes of the go-live             | the User Stories, not the vehicles                                             | OK: 4 Pull Requests (#24, #26, #27, #29); 5 with `--include-promotions`, #33 added                  |
| Already promoted                         | marked in the table, `--include-already-promoted` named, no branch created     | OK                                                                                                  |
| Empty cherry-pick                        | `Nothing to cherry-pick`, no branch, exit 0                                    | OK                                                                                                  |
| Empty cherry-pick, dirty report folder   | same result with `hardis-report/` untracked                                    | OK                                                                                                  |
| Conflict, agent default                  | promotion undone, both files named                                             | OK on #36                                                                                           |
| Conflict outside `force-app`             | the gate still catches it                                                      | OK, `NOTES.md` named                                                                                |
| Conflict, kept                           | Pull Request created, prompt file written and embedded                         | OK: #37                                                                                             |
| Marker guard                             | the job fails naming the files                                                 | OK: `still contains git conflict markers in 2 file(s)`                                              |
| Marker guard, solved                     | the job passes                                                                 | OK, scope `#36, #37`                                                                                |
| Committed conflict prompt report         | the gate ignores it                                                            | OK                                                                                                  |
| Feature off                              | one informational line, scope = the Pull Request alone                         | OK on #37                                                                                           |
| Hand-named branch                        | warning, treated as a feature branch, declaration ignored                      | OK on #15, see the reused-repository note below                                                     |
| Retargeted promotion                     | warning naming the mismatch, scope = the Pull Request alone                    | OK on #38                                                                                           |
| Unreadable declaration                   | warning and skip, not a failure                                                | OK on #37: `Pull Request #9999 ... was not found: skipped`                                          |
| Sync merge inside a story                | the candidate lists the story only                                             | OK: #40 alone, #41 on its own row                                                                   |
| Branch merged twice                      | listed once, never with a `-` row                                              | OK: #41 and #42, one row each                                                                       |
| Supersede an open promotion              | the open one is closed, its stories offered again with no mark                 | OK: #39 declined #37, state `DECLINED`                                                              |
| Restricted `allowedPromotionSteps`       | a forbidden source and a forbidden target are both refused                     | OK, both name the allowed steps                                                                     |
| `allowedPromotionSteps` not declared     | the command stops, asking for the list and linking to the doc                  | OK                                                                                                  |
| Full merge after a partial promotion     | already promoted stories skipped, the never promoted one arrives               | OK on #43, see below                                                                                |
| `promotion:list-candidates`              | the candidate table without assembling anything                                | OK from `uat`                                                                                       |
| Pull Request comment audit               | consistent comments, navigation and action state                               | 1241 checks over 44 Pull Requests, two findings, both known, see below                              |
| Single place in the diagram              | each number in one branch only                                                 | OK, see below                                                                                       |
| Flag-off regression                      | `TOTAL DIFFERING LINES: 0`                                                     | 6 lines, all from the coverage fix, see below                                                       |

### A full major-to-major merge after a partial promotion

#43 merges `uat` into `preprod` in full, after #27 had been promoted alone by #31 and #24, #26 by #32.

- The validation scope is `#23, #28, #30, #27, #41, #40, #42, #43, #24, #26`: the promotion #30 is
  expanded, and #28 (S5 epsilon), which had never been promoted, arrives for the first time.
- #27, #24 and #26 are each reported as `already deployed through promotion branch(es) ...` and
  their deployment actions are skipped.
- The post-deploy action of #28 runs for the first time in `preprod`.
- After the merge, `promotion:create uat -> preprod` answers `No Pull Request merged into uat is
  waiting for promotion to preprod`.

`#23` in that scope is the previous run's `integration -> uat` Pull Request, matched by its source
branch. A reused-repository artefact: it does not happen on a fresh repository, and the three other
providers show no equivalent.

### Pull Request comment audit

```
1241 checks over 44 Pull Requests (bitbucket)
2 FINDING(S):
  - #24: manual action e2e-manual-24 is marked skipped in uat
  - #1:  manual action e2e-manual-1  is marked skipped in uat
```

- **#1** belongs to the previous run and was already reported there.
- **#24** was written by the flag-off passes that deliberately run the pre-fix `origin/main` CLI.
  All five passes log the skip; only the three `ab-main*` ones, which are pre-fix, write it into the
  state, and `ab-main3` ran last. The fixed CLI was proved not to create it: a deployment that
  skipped four actions of #27 left its manual action `👋` in every branch it had reached.

The fix prevents new corruption; it does not repair an entry already written. Both entries stay
`⚪` in this repository.

### Single place in the diagram

Read with `MIN_PR=24`, which drops the previous run's Pull Requests:

```
Branch      | node counter | Pull Requests listed
integration | 4            | #36, #35, #34, #25
uat         | 4            | #28, #42, #40, #41
preprod     | 0            |
main        | 4            | #27, #26, #24, #29

OK: every Pull Request number appears in a single branch
With 'show already promoted' on: integration=6 uat=7 preprod=4 main=4
With 'show merge and promotion Pull Requests' on: integration=4 uat=5 preprod=3 main=5
```

The same counters as GitHub, GitLab and Azure DevOps on the same scenario.

### Flag-off regression

```
check-feature-pr22.log: 130 lines vs 128 lines, only in A: 2, only in B: 0
check-major-pr44.log:   189 lines vs 187 lines, only in A: 2, only in B: 0
deploy-uat.log:         185 lines vs 183 lines, only in A: 2, only in B: 0
release-notes.log:       81 lines vs  81 lines, only in A: 0, only in B: 0
release-notes.md:        37 lines vs  37 lines, only in A: 0, only in B: 0
TOTAL DIFFERING LINES: 6
```

Not zero, and every one of the six lines is the same pair, present only on `origin/main`:

```
A> Warning: unable to convert Unknown into string
A> orgCoverage.toFixed is not a function
```

That is the coverage fix `4752b64fd` removing two lines `main` still prints. Promotion branches,
switched off, change nothing.

> An earlier pass of this comparison produced 33 differing lines. Twenty-seven of them came from
> `sfdx-git-delta` failing on the `main` side with `git config exited 3221225794`, a Windows
> DLL-initialisation exit code, while the machine was under the memory pressure that also killed
> the background job running the comparison. The pass was re-run on a quiet machine and the release
> notes then matched line for line. Worth knowing before reading a diff of this kind as a product
> difference.

___

## What this run did not cover

- **The interactive paths.** Everything ran with `--agent`.
- **The websocket button** on Pull Request creation.
- **The pipeline webview itself**: checked through the extension's compiled helpers.
- **Bitbucket Pipelines itself.** The jobs are reproduced locally with the pipeline variables;
  `BITBUCKET_BUILD_NUMBER` was a fixed value, so every job link points at pipeline 1.
- **The "Pull Request Commit Links" app.** Not installed, so the merge job uses the branch search
  fallback; that fallback is what this run proved, not the primary path.
- **A brand new repository.** The token is repository-scoped, so the repository is reset rather than
  created. Two artifacts follow, both benign and both visible above: an old Pull Request matched by
  its source branch in a deployment scope, and Bitbucket **reopening** the previous run's declined
  Pull Request (#15) instead of creating a new number when the same two branches are used again.
- **Branch permissions and required approvals.** The test repository has none.
- **One org for four branches.**
- **`FLOW_DELETE_INTERVIEWS` end to end.**

## Suite counts

- sfdx-hardis: **1837 unit tests passing**, lint clean.
- vscode-sfdx-hardis: not modified by this run.

___

## Appendix: the five defects of the first Bitbucket run, in detail

Kept here because the evidence exists nowhere else, and four of the five are Bitbucket specific.

### 1. A cherry-pick git refused was reported as a conflict with no files (`cb7e8d6de`)

Promoting the conflict story answered `Cherry-pick conflict on #13 (...) (-)`. `(-)` is the list of
conflicting files, empty because there was no conflict: git had refused the cherry-pick outright.

```
error: The following untracked working tree files would be overwritten by merge:
	hardis-report/apex-coverage-results.json
	... 11 more
Please move or remove them before you merge.
```

That is the runbook's deliberate "hardis-report is not gitignored" setup in a shape nobody had hit:
the commit carried report files while the working tree held untracked copies of the same paths. git
leaves no `CHERRY_PICK_HEAD` and no conflicted path there, so the code fell into the conflict branch
anyway. An agent aborted on `(-)`; a human would have been offered three ways to solve a conflict
that did not exist. `cherryPickCandidates` now checks whether git actually started, and reports the
reason git gave.

### 2. Bitbucket listed only the first page of Pull Requests (`356992aa4`)

`listPullRequests` called the API once and used `response.data.values`, one page, though the
provider already had a `fetchAllPages` helper. Older Pull Requests fell off the listing, so the
candidate table showed the placeholder `PR #5` and `PR #7` instead of `S5 epsilon` and `S3 gamma`.
The same listing feeds `listAlreadyPromotedPullRequests`, so on any repository with more Pull
Requests than one page an already promoted story would have been offered for promotion again.

### 3. Bitbucket ignored the target branch filter (`356992aa4`)

The `targetBranch` filter was accepted and never used, so a caller asking for the promotions that
reached `preprod` was handed the promotions of every branch. Concretely, the **retargeted** branch
`promotion/uat/preprod/2026-09-07-9`, whose Pull Request targets `main`, was counted as having
reached `preprod`:

```
#7, #3, #1 PR #7 [ce8fbac]: #3, #1 are already carried by promotion/uat/preprod/2026-09-07-9
```

A false "already promoted" silently leaves stories out of a promotion.

### 4. Bitbucket drops `state` as soon as `q` is present (`356992aa4`)

Found while fixing 3: adding the target branch as a `q` expression made the answers worse. Asking
for the **open** promotions of `preprod` returned the **merged** ones, so `list-candidates`
announced two already shipped promotions as still in flight. Proved against the API:

| Query                                                      | Answer                   |
|------------------------------------------------------------|--------------------------|
| `state=OPEN`                                               | #17, #16, #15 (all OPEN) |
| `state=OPEN` **and** `q=destination.branch.name="preprod"` | #6, #9, #8 (all MERGED)  |
| `q=state="OPEN" AND destination.branch.name="preprod"`     | empty, which is correct  |

The state now goes inside the `q` expression, never next to it.

### 5. A pending manual action lost its checkbox (`d99043d6d`)

The Deployment Actions comment of the first story ended with four org branch columns and only three
pending checkboxes:

```
| E2E manual step of PR 1 | post-deploy | 👋 integration | ⚪ uat | 👋 preprod | 👋 main |
```

`uat` had been `👋 waiting`. A later job whose scope held the story skipped the action as "already
run in uat", and the skip was written over the manual entry, dropping it from the "Pending manual
actions" list: no checkbox left to tick, and a skip displayed for a step nobody performed.

`upsertActionInState` already refused to let a skip overwrite a `success`, with a comment saying
"a skip is the absence of an outcome, not an outcome". The guard covered only `success`; it now
covers every recorded outcome, a pending `manual` and a `failed` included. Proved live afterwards:
a deployment that skipped four actions left the manual one `👋` in all four branches.
