# Promotion branches: end to end test on Bitbucket Cloud

**Date:** 2026-09-07 / 2026-09-08
**Repository under test:** `galerieslafayette/test-prom-e2e` (private, reset to the runbook base project for this run)
**Salesforce org:** `nicolas.vuillamy.c8024b5deb9f@agentforce.com` (developer org, shared with the GitHub, GitLab and Azure runs)
**sfdx-hardis:** `feat/promotion-branches`, `b7acc0840` at the start, `d99043d6d` after the four fixes below
**vscode-sfdx-hardis:** `feat/promotion-branches`, `06ba32f8` (not modified by this run)

This is the **first time the Bitbucket path of the feature has been exercised against a real
Bitbucket Cloud**. Every job below is a real `deploy:smart` against that org, run locally with the
Bitbucket Pipelines variables set (`CI_SFDX_HARDIS_BITBUCKET_TOKEN`, `BITBUCKET_WORKSPACE`,
`BITBUCKET_REPO_SLUG`, `BITBUCKET_PR_ID`), which is what the git provider reads.

___

## The pipeline

Same shape as the three previous runs: `integration` -> `uat` -> `preprod` -> `main`, one org,
`enablePromotionBranches: true`, `allowedPromotionSteps` with the three steps, delta deployment on,
Apex test classes on. Every Pull Request merged with `merge_strategy: merge_commit` and
`close_source_branch: false`, so the `-x` trailers of the cherry-picks survive.

| Story | Pull Request | Branch                    | Target      | Actions                   | Test classes                            | Keyword                  |
|-------|--------------|---------------------------|-------------|---------------------------|-----------------------------------------|--------------------------|
| S1    | #1           | `feature/E2E-101-alpha`   | integration | pre command + post manual | `PromoE2EAlphaTest`, `PromoE2EBetaTest` | -                        |
| S2    | #2           | `feature/E2E-102-beta`    | integration | post command              | -                                       | `NO_DELTA`               |
| S3    | #3           | `feature/E2E-103-gamma`   | integration | pre command               | `PromoE2EBetaTest`                      | `PURGE_FLOW_VERSIONS`    |
| S4    | #4           | `feature/E2E-201-delta`   | uat         | pre command + post manual | `PromoE2EAlphaTest`                     | -                        |
| S5    | #5           | `feature/E2E-202-epsilon` | uat         | post command              | -                                       | -                        |
| S6    | #6           | `feature/E2E-301-hotfix`  | preprod     | pre command + post manual | `PromoE2EBetaTest`                      | `FLOW_DELETE_INTERVIEWS` |

S1 declares its two test classes in **two separate yaml blocks** of its description.

Twelve more Pull Requests exercise the edge cases: the retrofit (#11), the conflicting pair on the
shared `CustomLabels` file and on `NOTES.md` (#12, #13), a hand-named branch (#15), a retargeted
promotion (#16), a story that receives a sync merge (#18) next to the story that landed in the
meantime (#19) and its second merge (#20), the full major-to-major merge (#21), and two Pull
Requests kept open for the flag-off comparison (#22, #23).

## The promotions

| Promotion | Pull Request | Branch                                   | Carries         | Outcome                                                    |
|-----------|--------------|------------------------------------------|-----------------|-------------------------------------------------------------|
| P1        | #7           | `promotion/integration/uat/2026-09-07-1`  | #1, #3         | merged, deployed to uat                                      |
| P2        | #8           | `promotion/uat/preprod/2026-09-07-1`      | #4             | merged, deployed to preprod                                  |
| P3        | #9           | `promotion/uat/preprod/2026-09-07-2`      | #3, #1         | the merge commit of P1, one level of nesting                 |
| P4        | #10          | `promotion/preprod/main/2026-09-07-1`     | #4, #3, #1, #6 | merged, deployed to main, two levels of nesting              |
| P5        | #14          | `promotion/integration/uat/2026-09-07-2`  | #13            | assembled with conflict markers on purpose, then declined    |
| P6        | #17          | `promotion/integration/uat/2026-09-07-3`  | #13            | superseded #14 and declined it                               |

___

## What this run found

**Four defects, all reproduced from a real job log, all fixed inside the run and covered by unit
tests.** Three of them are Bitbucket specific; the last two are provider agnostic and were simply
surfaced first here.

### 1. A cherry-pick git refused was reported as a conflict with no files

`d99043d6d`'s parent, `cb7e8d6de`. Promoting #13 answered:

```
Error (SfError): Cherry-pick conflict on #13 S8 conflict B (teste2e) [f95d43a] (-):
the promotion has been undone.
```

`(-)` is the list of conflicting files, and it was empty because there was no conflict. git had
refused the cherry-pick outright:

```
error: The following untracked working tree files would be overwritten by merge:
	hardis-report/apex-coverage-results.json
	... 11 more
Please move or remove them before you merge.
```

That is the exact case the runbook builds on purpose, in a shape nobody had hit: `hardis-report/`
is deliberately **not** gitignored, so the commit being cherry-picked carried report files while the
working tree held untracked copies of the same paths. git leaves no `CHERRY_PICK_HEAD` and no
conflicted path in that situation, so `listConflictFiles()` returned nothing and the code fell into
the conflict branch anyway. An agent aborted on `(-)`, and a human would have been offered three
ways to solve a conflict that did not exist.

`cherryPickCandidates` now checks whether git actually started the cherry-pick, and reports the
reason git gave instead:

```
Error (SfError): git refused to cherry-pick #13 S8 conflict B (teste2e) [f95d43a], so there is
nothing to solve on the branch and the promotion has been undone. git says:
error: The following untracked working tree files would be overwritten by merge:
...
```

### 2. Bitbucket listed only the first page of Pull Requests

`356992aa4`. `BitbucketProvider.listPullRequests` called the API once and used `response.data.values`,
which is one page. The provider already had a `fetchAllPages` helper; this method did not use it.

The damage was visible in the promotion candidate table: the older Pull Requests fell off the
listing (sorted by `-updated_on`) so their titles could not be resolved and the table showed the
placeholder `PR #5` and `PR #7` instead of `S5 epsilon` and `S3 gamma`. The same listing is what
`listAlreadyPromotedPullRequests` reads, so on any repository with more Pull Requests than one page
a story already carried by a promotion would have been offered for promotion again.

### 3. Bitbucket ignored the target branch filter

Same commit. `listPullRequests` accepted a `targetBranch` filter and never used it. Every caller
asking for "the promotions that reached `preprod`" was handed the promotions of every branch. The
run made it concrete: the **retargeted** promotion branch `promotion/uat/preprod/2026-09-07-9`,
whose Pull Request targets `main`, was counted as a promotion that had reached `preprod`:

```
#7, #3, #1 PR #7 [ce8fbac]: #3, #1 are already carried by promotion/uat/preprod/2026-09-07-9
```

That is a false "already promoted", which silently leaves stories out of a promotion.

### 4. Bitbucket drops `state` as soon as `q` is present

Same commit, found while fixing #3. Adding the target branch as a `q` expression made the answers
worse, not better: asking for the **open** promotions of `preprod` returned the **merged** ones, so
`promotion:list-candidates` announced

```
A promotion from uat to preprod is already open (#9 ..., #8 ...)
```

about two promotions that had already shipped. Proved directly against the API:

| Query                                            | Answer            |
|--------------------------------------------------|-------------------|
| `state=OPEN`                                     | #17, #16, #15 (all OPEN) |
| `state=OPEN` **and** `q=destination.branch.name="preprod"` | #6, #9, #8 (all MERGED)  |
| `q=state="OPEN" AND destination.branch.name="preprod"`     | empty, which is correct  |

The state now goes inside the `q` expression, never next to it, and a defensive filter drops
anything the API returns that does not match.

### 5. A pending manual action lost its checkbox

`d99043d6d`. The Deployment Actions comment of #1 ended the run with four org branch columns and
only **three** pending checkboxes:

```
| E2E manual step of PR 1 | post-deploy | 👋 integration | ⚪ uat | 👋 preprod | 👋 main |
```

`uat` had been `👋 waiting` earlier in the run. A later deployment job whose scope held #1 skipped
the action as "already run in uat", and the skip was written over the manual entry. The action then
left the "Pending manual actions" list: the release manager had no checkbox left to tick, and the
branch displayed a skip for a step nobody had performed.

`upsertActionInState` already refused to let a skip overwrite a `success`, with a comment saying
"a skip is the absence of an outcome, not an outcome". The guard only covered `success`. It now
covers every recorded outcome, a pending `manual` and a `failed` included.

Proved live after the fix: a deployment on `preprod` that skipped four actions of #4 left its manual
action `👋` in all four branches.

> **Not repaired retroactively.** The fix stops the state from being corrupted, it does not restore
> a state already written. #1 still shows `⚪` for `uat` in the test repository, and any project that
> already hit this keeps its stale entry until someone edits the comment. Worth deciding before the
> release whether a manual action recorded `skipped` should be rendered as waiting again.

___

## Pull Request comment audit

This run added a check the previous ones did not have: the sfdx-hardis comments themselves.
`scripts/audit-pr-comments.cjs` reads a provider agnostic dump of every Pull Request and its
comments, and asserts, without being told:

- **at most one** validation comment, one deployment comment and one Deployment Actions comment per
  Pull Request, so a re-run updates in place and never appends a second one;
- a validation and a deployment comment on every Pull Request that went through both jobs;
- **no leaked value** in any comment: `undefined`, `NaN`, `[object Object]`, or an i18n `{{placeholder}}`
  that was never interpolated;
- a **well formed navigation block**: present as soon as two comments exist, the current one in
  bold, the others as links, and every link addressing **this** Pull Request and not another;
- one **column per org branch** in the Deployment Actions table, one **pending checkbox** per branch
  that is waiting, no checkbox for a branch that is not, and no manual action left `skipped`;
- no **duplicated action row**;
- a promotion Pull Request that **names every story it carries**, in its description and in the
  scope its validation comment reports, and a story Pull Request that never declares
  `promotionPullRequests`.

On the final Bitbucket state: **654 checks over 23 Pull Requests**, one finding, which is the
un-repaired `⚪` of defect 5 above. Everything else is consistent.

The same audit is now part of the runbook for all four providers.

___

## Test groups

| Group                                     | Expected                                                                       | Result                                                                                  |
|-------------------------------------------|--------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------|
| Provider detection                        | Bitbucket picked from the token, repository from `BITBUCKET_REPO_SLUG`          | OK on every job                                                                               |
| Feature branch validation and deployment  | `Pull Request scope: 1 Pull Request(s) (#N)` and nothing else                   | OK for #1..#6                                                                                 |
| Merge job Pull Request resolution         | the merged Pull Request found without `BITBUCKET_PR_ID`                        | OK, through `getMergedPullRequestForBranch` (no "Pull Request Commit Links" app installed)     |
| Two yaml blocks in a description          | both are read                                                                   | OK on #1: `PromoE2EAlphaTest` and `PromoE2EBetaTest`                                          |
| `NO_DELTA`                                | `Delta deployment has been disabled`, `Deployment mode: FULL`                   | OK on #2, validation and deployment                                                           |
| `PURGE_FLOW_VERSIONS`                     | extra pre-deploy action, skipped in validation, run in deployment               | OK on #3                                                                                      |
| Manual actions in a validation job        | `Skipping ...: deployment-only action`                                          | OK everywhere                                                                                 |
| Promotion Pull Request creation           | branch pushed, Pull Request opened with the declaration and the carried table    | OK: #7, #8, #9, #10, #14, #17                                                                 |
| Promotion validation and deployment       | scope = declared + the promotion itself                                         | OK: #7 (`#1, #3, #7`), #8 (`#4, #8`), #9 (`#3, #1, #9`), #10 (`#4, #3, #1, #6, #10`)           |
| Keyword inheritance                       | only the keywords of the carried stories                                        | OK: #7 inherits `PURGE_FLOW_VERSIONS` from #3 and not `NO_DELTA` from #2; #10 inherits both    |
| Test classes of a promotion               | union of the carried Pull Requests, `RunSpecifiedTests`                         | OK                                                                                            |
| Go-live branch content                    | the four static resources and the four action files                             | OK on #10                                                                                     |
| Deployment action state                   | the comment lands on the **story** Pull Request, one column per org branch      | OK, with defect 5 above                                                                       |
| Promotion carrying a promotion            | the stories of the inner promotion are in the scope                             | OK on #9 and #10                                                                              |
| Grouped merge commit                      | the numbers nobody asked for are named **before** cherry-picking, and declared  | OK on #9 and #10                                                                              |
| Retrofit `main` -> `integration`          | the promotion is expanded, then every already shipped story is named            | OK on #11: `Promotion Pull Request 10 adds 4 carried Pull Request(s)`, then four `already deployed` |
| Release notes of the go-live              | the User Stories, not the vehicles                                              | OK: 4 Pull Requests (#1, #3, #4, #6); 5 with `--include-promotions`, #10 added                 |
| Already promoted                          | marked in the table, `--include-already-promoted` named, no branch created      | OK                                                                                            |
| Empty cherry-pick                         | `Nothing to cherry-pick`, no branch, exit 0                                     | OK                                                                                            |
| Empty cherry-pick, dirty report folder    | same result with `hardis-report/` untracked                                     | OK                                                                                            |
| Cherry-pick refused by git                | the reason git gave, not an empty conflict                                      | **failed, fixed**, then OK                                                                    |
| Conflict, agent default                   | promotion undone, no leftover branch, both files named                          | OK on #13: `NOTES.md, force-app/main/default/labels/CustomLabels.labels-meta.xml`              |
| Conflict outside `force-app`              | the gate still catches it                                                       | OK, `NOTES.md` named                                                                          |
| Conflict, kept                            | Pull Request created, prompt file written and embedded                          | OK: #14                                                                                       |
| Marker guard                              | the job fails naming the files                                                  | OK: `still contains git conflict markers in 2 file(s)`                                        |
| Marker guard, solved                      | the job passes                                                                  | OK, scope `#13, #14`                                                                          |
| Committed conflict prompt report          | the gate ignores it                                                             | OK, committed on the promotion branch and the gate stayed silent                              |
| Feature off                               | one informational line, scope = the Pull Request alone                          | OK on #14                                                                                     |
| Hand-named branch                         | warning, treated as a feature branch, declaration ignored                       | OK on #15                                                                                     |
| Retargeted promotion                      | warning naming the mismatch, scope = the Pull Request alone                     | OK on #16, and see defect 3                                                                   |
| Unreadable declaration                    | warning and skip, not a failure                                                 | OK: `Pull Request #9999 ... was not found: skipped`                                           |
| Sync merge inside a story                 | the candidate lists the story only                                              | OK: #18 alone, #19 on its own row                                                             |
| Branch merged twice                       | listed once, never with a `-` row                                               | OK: #19 and #20, one row each                                                                 |
| Supersede an open promotion               | the open one is closed, its stories offered again with no mark                  | OK: #17 declined #14, state `DECLINED`                                                        |
| Restricted `allowedPromotionSteps`        | a forbidden source and a forbidden target are both refused                      | OK, both name the allowed steps                                                               |
| `allowedPromotionSteps` not declared      | the command stops, asking for the list and linking to the doc                   | OK                                                                                            |
| Full merge after a partial promotion      | already promoted stories skipped, the never promoted one arrives                | OK on #21, see below                                                                          |
| `promotion:list-candidates`               | the candidate table without assembling anything                                 | OK from `uat`, and it is where defects 2, 3 and 4 showed                                      |
| Pull Request comment audit                | consistent comments, navigation and action state                                | 654 checks, one finding (defect 5, un-repaired)                                               |
| Single place in the diagram               | each number in one branch only                                                  | OK, see below                                                                                 |
| Flag-off regression                       | `TOTAL DIFFERING LINES: 0`                                                      | OK                                                                                            |

### A full major-to-major merge after a partial promotion

#21 merges `uat` into `preprod` in full, after #4 had been promoted alone by #8 and #1, #3 by #9.

- The validation scope is `#7, #5, #4, #19, #18, #20, #21, #1, #3`: the promotion #7 is expanded,
  and #5 (S5 epsilon), which had never been promoted, arrives for the first time.
- #4, #1 and #3 are each reported as `already deployed through promotion branch(es) ...` and their
  deployment actions are skipped.
- The post-deploy action of #5 runs for the first time in `preprod`.
- After the merge, `promotion:create uat -> preprod` answers `No Pull Request merged into uat is
  waiting for promotion to preprod`.

### Single place in the diagram

`check-diagram-bitbucket.cjs`, written for this run, feeds the extension's own compiled helpers with
the real Pull Requests read from the Bitbucket API:

```
Branch      | node counter | Pull Requests listed
integration | 4            | #13, #12, #11, #2
uat         | 4            | #5, #20, #18, #19
preprod     | 0            |
main        | 4            | #4, #3, #1, #6

OK: every Pull Request number appears in a single branch
With 'show already promoted' on: integration=6 uat=7 preprod=4 main=4
With 'show merge and promotion Pull Requests' on: integration=4 uat=5 preprod=3 main=5
```

Same shape as the three other providers: the four go-live stories are listed under `main` and
nowhere else, and both toggles bring back strictly more.

### Flag-off regression

Four passes of the same three jobs plus the release notes, alternating the sfdx-hardis checkout
between `feat/promotion-branches` and `origin/main`, with `enablePromotionBranches: false`:

```
check-feature-pr22.log: 130 lines vs 130 lines, only in A: 0, only in B: 0
check-major-pr23.log:   191 lines vs 191 lines, only in A: 0, only in B: 0
deploy-uat.log:         185 lines vs 185 lines, only in A: 0, only in B: 0
release-notes.log:       81 lines vs  81 lines, only in A: 0, only in B: 0
release-notes.md:        37 lines vs  37 lines, only in A: 0, only in B: 0
TOTAL DIFFERING LINES: 0
```

A Bitbucket project that does not enable promotion branches gets exactly the jobs it got before.

___

## What this run did not cover

- **The interactive paths.** Everything ran with `--agent`.
- **The websocket button** on Pull Request creation: no websocket server in a CLI run.
- **The pipeline webview itself**: checked through the extension's compiled helpers, not by clicking.
  The extension was not modified by this run.
- **Bitbucket Pipelines itself.** The jobs are reproduced locally with the pipeline variables, which
  is what the provider reads, but no `bitbucket-pipelines.yml` ran on a Bitbucket runner.
  `BITBUCKET_BUILD_NUMBER` was set to a fixed value, so every job link in the comments points at
  pipeline 1.
- **The "Pull Request Commit Links" app.** Not installed on the test workspace, so
  `listPullrequestsForCommit` fails and the merge job falls back to the branch search. That fallback
  is therefore the path this run proved, not the primary one.
- **Branch permissions and required approvals.** The test repository has none.
- **One org for four branches**, as on the three other providers.
- **`FLOW_DELETE_INTERVIEWS` end to end.** Its inheritance is verified; the interview deletion it
  authorizes needs a Flow in destructive changes, which this project does not have.

## Harness added for Bitbucket

| Script                        | What it does                                                                                     |
|-------------------------------|--------------------------------------------------------------------------------------------------|
| `e2e-lib-bitbucket.sh`        | `bb_check`, `bb_deploy`, `bb_promote`, `bb_release_notes`, `bb_pr_create`, `bb_pr_merge`, `dump_pr_comments` |
| `check-diagram-bitbucket.cjs` | the single-place-in-the-diagram check, paginated over the Bitbucket API                          |
| `ab-run-bitbucket.sh`         | the flag-off comparison passes                                                                   |
| `audit-pr-comments.cjs`       | the Pull Request comment audit, shared by all four providers                                     |

Traps met, all written into runbook section 8ter:

- **Bitbucket Cloud publishes no merge ref.** Neither `refs/pull-requests/<id>/merge` nor `.../from`
  is fetchable and `git ls-remote` advertises none of them. A `pull-requests:` pipeline checks out
  the **source** branch and merges the destination into it, so that is what `bb_checkout_pr_merge`
  reproduces. This is the one place where the Bitbucket harness differs in kind from the other three.
- **A classic Atlassian API token does not work**: it answers `API Token provided has no Bitbucket
  scopes`. Use an API token with Bitbucket scopes (Basic auth with the account email) or a
  workspace/repository Access Token (Bearer, no email).
- **The REST API and `git push` do not take the same username.** The API wants the Atlassian account
  email; git refuses it. Use `https://x-token-auth:<token>@bitbucket.org/<workspace>/<repo>.git`.
- **A workspace over its user limit is read-only**, with a bare HTTP 402 on push and nothing in the
  API to warn you. The first workspace tried for this run was in that state.

## Suite counts after the fixes

- sfdx-hardis: **1823 unit tests passing** (1802 before, 21 added for the four fixes), lint clean.
- vscode-sfdx-hardis: not modified by this run.
