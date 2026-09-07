# Promotion branches: end to end test on GitHub

**Date:** 2026-09-07
**Repository under test:** `nvuillam/sfdx-hardis-promo-e2e-4` (private, created empty for this run)
**Salesforce org:** `nicolas.vuillamy.c8024b5deb9f@agentforce.com` (developer org, shared with the GitLab run)
**sfdx-hardis:** `feat/promotion-branches`, `09ea5583c` at the start, `b7eafe9b4` after the fixes below
**vscode-sfdx-hardis:** `feat/promotion-branches`, `0a54f042` (the merge conflicts feature folded into PR #504)

Every job below is a real `deploy:smart` against that org, run locally with the GitHub Actions
variables set, which is what the git provider reads: the CLI cannot tell the difference.

___

## The pipeline

Four major branches, `integration` -> `uat` -> `preprod` -> `main`, all deployed to the same org,
`enablePromotionBranches: true`, delta deployment on, Apex test classes on.

Fifteen User Stories were created. The six of the runbook drive the pipeline:

| Story | Pull Request | Branch                    | Target      | Actions                   | Test classes                            | Keyword                  |
|-------|--------------|---------------------------|-------------|---------------------------|-----------------------------------------|--------------------------|
| S1    | #1           | `feature/E2E-101-alpha`   | integration | pre command + post manual | `PromoE2EAlphaTest`, `PromoE2EBetaTest` | -                        |
| S2    | #2           | `feature/E2E-102-beta`    | integration | post command              | -                                       | `NO_DELTA`               |
| S3    | #3           | `feature/E2E-103-gamma`   | integration | pre command               | `PromoE2EBetaTest`                      | `PURGE_FLOW_VERSIONS`    |
| S4    | #4           | `feature/E2E-201-delta`   | uat         | pre command + post manual | `PromoE2EAlphaTest`                     | -                        |
| S5    | #5           | `feature/E2E-202-epsilon` | uat         | post command              | -                                       | -                        |
| S6    | #6           | `feature/E2E-301-hotfix`  | preprod     | pre command + post manual | `PromoE2EBetaTest`                      | `FLOW_DELETE_INTERVIEWS` |

S1 declares its two test classes in **two separate yaml blocks** of its description.

The nine others exercise the edge cases: conflicts on a shared file (#13, #14), a conflict
outside `force-app` (#15, #16), a branch that receives a sync merge (#20) next to the story that
landed in the meantime (#21), a branch merged twice (#22 then #23), and two open Pull Requests for
the flag-off comparison (#27, #28).

## The promotions

| Promotion | Pull Request | Branch                                | Carries        | Outcome                                                   |
|-----------|--------------|---------------------------------------|----------------|-----------------------------------------------------------|
| P1        | #7           | `promotion/integration/uat/2026-09-06-1` | #1, #3      | merged, deployed to uat                                    |
| P2        | #8           | `promotion/uat/preprod/2026-09-06-1`     | #4          | merged, deployed to preprod                                |
| P3        | #9           | `promotion/uat/preprod/2026-09-06-2`     | #3, #1      | the merge commit of P1, one level of nesting               |
| P4 (bad)  | #10          | `promotion/preprod/main/2026-09-06-1`    | #4,#1,#3,#6 | **declared four stories and carried two**, see defect 3    |
| P4        | #11          | `promotion/preprod/main/2026-09-06-2`    | #4,#3,#1,#6 | merged, deployed to main. #10 closed automatically         |
| P5        | #17          | `promotion/integration/uat/2026-09-07-1` | #14, #16    | assembled with conflict markers on purpose                 |
| P6        | #24, #25     | `promotion/integration/uat/2026-09-07-2/-3` | #20      | the supersede case                                         |

___

## What this run found

Three defects, all reproduced from a real job log, all fixed inside the run and covered by unit
tests. They are in `b7eafe9b4`, "fix(ci-cd): attribute a cherry-picked commit to the merge that
carried it".

### 1. A second yaml block replaced the first instead of adding to it

Pull Request #1 declares `PromoE2EAlphaTest` in one yaml block and `PromoE2EBetaTest` in a second
one added below it. The validation job selected `PromoE2EBetaTest` alone: `Object.assign` over the
blocks let the later one overwrite the whole array, so a release manager appending a block to name
one more test class silently removed the ones already declared.

Fixed in `getYamlFromPrDescription`: a list adds to the list already there, without duplicates;
anything else still takes the value of the last block. The job now selects both classes.

### 2. A promotion two levels down carried no Pull Request number at all

Assembling the go-live from `preprod` offered this candidate:

```
Pull Requests | Title
--------------|------------------------------------------------------------------------
#4            | S4 delta
-             | Merge pull request #9 from nvuillam/promotion/uat/preprod/2026-09-06-2
#6            | S6 hotfix
```

The middle row has no number, so it cannot be selected: #1 and #3 could never reach `main`.
A promotion merged into the source branch arrives as one cherry-picked merge commit that names the
promotion, and the promotion is dropped as a vehicle, which left the group empty.

Fixed with `expandPromotionsInGroups`: a promotion in a candidate group is replaced by the Pull
Requests its `promotionPullRequests` block declares (recursively, a promotion can carry a
promotion) **before** the vehicles are dropped.

### 3. Commits were attributed to a merge by date, not by the graph

With defect 2 fixed the candidate list was still wrong: the merge of promotion #8 claimed
`#4, #1, #3` and the merge of promotion #9 claimed `#3, #1`. `listMergedPrsWithCommits` decided
which commits a first-parent merge brought in by comparing **author dates**. A cherry-picked commit
keeps the author date it had on the branch it came from, so it is older than the merge before it
and lands in the wrong window. Promotion branches are made of nothing but cherry-picks, so this is
the normal case.

The damage was concrete. Promotion #10 was assembled from that wrong grouping: it declared
`promotionPullRequests: [4, 3, 1, 6]` while its branch held only

```
force-app/main/default/staticresources/E2E_S4.resource
force-app/main/default/staticresources/E2E_S6.resource
```

Two of the four declared stories were missing from the branch. Their deployment actions would have
run, their Apex test classes would have been selected, the release notes would have listed them,
and none of their metadata would have shipped.

Fixed with `attributeCommitsToFirstParents`: the commits of a merge are read from
`git rev-list --parents`, walking the graph and stopping at the other first-parent commits, oldest
merge first so a shared commit belongs to the merge that brought it in. `listMergedPrsWithCommits`
is also what `hardis:project:backpromote` builds its list from, so the fix reaches beyond
promotions.

After the fix, the same command produced `#4` / `#3, #1` / `#6`, and promotion #11 carries all four
static resources.

### One observation, not filed as a defect

A promotion assembled at 01:24 CEST on 7 September is named
`promotion/integration/uat/2026-09-06-1`: `buildPromotionBranchName` takes the day from
`toISOString()`, which is UTC. It reads as "yesterday" to whoever assembled it. Making it local
would tie the branch name to the timezone of whatever machine or runner assembles it, and two
people in different zones could then produce two branches with the same counter on what they each
call the same day. UTC is the safer of the two, so this is left alone and written down here so the
next reader does not think it is a bug.

## What the run also found, outside the product

- **`ab-run.sh` cannot live in the repository under test.** The flag-off comparison checks out
  `origin/main`, which takes `.claude/skills/` away with it, and the second half of the pair runs
  nothing. Copy the scripts elsewhere first. Written into the runbook.
- **The runbook's nested promotion step is stale.** It says to promote P1's own number from `uat`.
  Since promotion Pull Requests became vehicles, that number is no longer a candidate and the
  command answers `Pull Request(s) #7 are not among the Pull Requests waiting for promotion`, which
  is the right answer. Select one of the stories the promotion carried instead. Runbook updated.

___

## Test groups

| Group                                     | Expected                                                                                    | Result                                                                                                 |
|-------------------------------------------|---------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------|
| Feature branch validation and deployment  | `Pull Request scope: 1 Pull Request(s) (#N)` and nothing else                               | OK for #1..#6                                                                                            |
| `NO_DELTA`                                | `Delta deployment has been disabled for this Pull Request`, `Deployment mode: FULL`         | OK on #2, validation and deployment                                                                      |
| `PURGE_FLOW_VERSIONS`                     | extra pre-deploy action `Purge Flow Versions (added from PR config)`                        | OK on #3, skipped in validation, run in deployment                                                       |
| Manual actions in a validation job        | `Skipping ...: deployment-only action`                                                      | OK everywhere                                                                                            |
| Two yaml blocks in a description          | both are read                                                                               | **failed, fixed**, then OK: `PromoE2EAlphaTest` and `PromoE2EBetaTest`                                   |
| Promotion validation and deployment       | `X Pull Request(s) declared in its description`, scope = declared + the promotion            | OK on #7 (`#1, #3, #7`), #8 (`#4, #8`), #9 (`#3, #1, #9`), #11 (`#4, #3, #1, #6, #11`)                    |
| Keyword inheritance                       | only the keywords of the carried stories                                                     | OK: #7 inherits `PURGE_FLOW_VERSIONS` from #3 and not `NO_DELTA` from #2; #11 inherits both keywords      |
| Test classes of a promotion               | union of the carried Pull Requests, `RunSpecifiedTests`                                      | OK                                                                                                       |
| Deployment action state                   | the state lands on the **story** Pull Request, one column per org branch                     | OK: #1 shows `integration` and `uat` columns and one pending manual box per branch                       |
| Promotion carrying a promotion            | the stories of the inner promotion are in the scope                                          | OK on #9 and #11                                                                                         |
| Retrofit `main` -> `integration`          | the promotion is expanded, then every already shipped story is named                         | OK on #12: `Promotion Pull Request 11 adds 4 carried Pull Request(s)`, then four `already deployed` lines |
| Release notes of the go-live              | the User Stories, not the vehicles                                                           | OK: 4 Pull Requests (#1, #3, #4, #6); 5 with `--include-promotions`, #11 added                            |
| Already promoted                          | marked in the table, `--include-already-promoted` named, no branch created                   | OK                                                                                                       |
| Empty cherry-pick                         | `Nothing to cherry-pick`, no branch, exit 0                                                  | OK                                                                                                       |
| Empty cherry-pick, dirty report folder    | same result with `hardis-report/` untracked                                                  | OK                                                                                                       |
| Conflict, agent default                   | promotion undone, no leftover branch                                                         | OK on #14                                                                                                |
| Conflict, kept                            | Pull Request created, prompt file written and embedded                                       | OK: #17, `hardis-report/promotion-conflicts-prompt-*.md`                                                 |
| Marker guard                              | the job fails naming the files                                                               | OK: `2 file(s): NOTES.md, force-app/main/default/labels/CustomLabels.labels-meta.xml`                    |
| Conflict outside `force-app`              | the gate still catches it                                                                    | OK, `NOTES.md` is named                                                                                  |
| Marker guard, solved                      | the job passes                                                                               | OK                                                                                                       |
| Committed report holding the word markers | the gate ignores it                                                                          | OK: the prompt report was committed on the branch and the gate stayed silent, it only matches line starts |
| Feature off                               | one informational line, scope = the Pull Request alone                                       | OK on #17                                                                                                |
| Hand-named branch                         | warning, treated as a feature branch, declaration ignored                                    | OK on #18                                                                                                |
| Retargeted promotion                      | warning naming the mismatch, scope = the Pull Request alone                                  | OK on #19, the declared stories did not run their actions against production                            |
| Grouped merge commit                      | the numbers nobody asked for are named **before** cherry-picking, and declared               | OK on #9 and #11                                                                                         |
| Unreadable declaration                    | warning and skip, not a failure                                                              | OK: `#9999 ... was not found: skipped`, scope `#20, #24`                                                 |
| Sync merge inside a story                 | the candidate lists the story only                                                           | OK: #20 alone, #21 on its own row                                                                        |
| Branch merged twice                       | listed once, never with a `-` row                                                            | OK: #22 and #23, one row each                                                                            |
| Supersede an open promotion               | the open one is closed, its stories are offered again with no mark                           | OK twice: #10 closed by #11, #24 closed by #25, no `--include-already-promoted` needed                   |
| Single place in the diagram               | each number in one branch only                                                               | OK, see below                                                                                            |
| Full merge after a partial promotion      | new case, see below                                                                          | OK                                                                                                       |
| Flag-off regression                       | `TOTAL DIFFERING LINES: 0`                                                                   | OK                                                                                                       |

### New case added to the runbook: a full major-to-major merge after a partial promotion

The question this answers is "we promoted some stories, then decided to ship the whole branch, does
the pipeline still add up?". Pull Request #26 merges `uat` into `preprod` in full after #4 had been
promoted alone by #8 and #1, #3 by #9.

- The validation scope is `#4, #5, #7, #26, #1, #3`: the promotion #7 is expanded, and #5, which
  had never been promoted, arrives for the first time.
- #4, #1 and #3 are each reported as `already deployed through promotion branch(es) ...`, and their
  deployment actions are skipped.
- The post-deploy action of #5 runs for the first time in `preprod`.
- After the merge, `promotion:create uat -> preprod` answers `No Pull Request merged into uat is
  waiting for promotion to preprod`: the merge base moved and the pipeline is back to a clean state.

### Single place in the diagram

`check-diagram.cjs` feeds the extension's own compiled helpers with the real Pull Requests:

```
Branch      | node counter | Pull Requests listed
integration | 10           | #23, #22, #21, #20, #16, #15, #14, #13, #12, #2
uat         | 1            | #5
preprod     | 0            |
main        | 4            | #4, #3, #1, #6

OK: every Pull Request number appears in a single branch
With 'show already promoted' on: integration=12 uat=4 preprod=4 main=4
With 'show merge and promotion Pull Requests' on: integration=10 uat=2 preprod=3 main=5
```

### Flag-off regression

Four passes of the same three jobs plus the release notes, alternating the sfdx-hardis checkout
between `feat/promotion-branches` and `origin/main`, with `enablePromotionBranches: false` in the
checked-out tree:

```
check-feature-pr27.log: 124 lines vs 124 lines, only in A: 0, only in B: 0
check-major-pr28.log:   169 lines vs 169 lines, only in A: 0, only in B: 0
deploy-uat.log:         174 lines vs 174 lines, only in A: 0, only in B: 0
release-notes.log:       73 lines vs  73 lines, only in A: 0, only in B: 0
release-notes.md:        37 lines vs  37 lines, only in A: 0, only in B: 0
TOTAL DIFFERING LINES: 0
```

A project that does not enable promotion branches gets exactly the jobs it got before.

___

## What this run did not cover

- **The interactive paths.** Everything ran with `--agent`. The confirmation before superseding an
  open promotion, the conflict prompt and the dirty-tree stash/commit prompt are covered by unit
  tests and by a previous run with a stubbed prompt, not by this one.
- **The websocket button.** `promotion:create` sends a websocket message so the VS Code UI shows a
  button to the new Pull Request. There is no websocket server in a CLI run, so the message is
  built but nothing receives it.
- **The pipeline webview itself.** The diagram rules are checked through the extension's compiled
  helpers and its 329 unit tests, not by clicking in VS Code.
- **One org for four branches.** Deployment action state is keyed by org **branch**, so the matrix
  is right, but the four levels are not four distinct orgs.
- **Azure DevOps and Bitbucket.** GitHub and GitLab were both exercised live in this session; those
  two are still covered by code reading and unit tests only.
- **`FLOW_DELETE_INTERVIEWS` end to end.** Its inheritance is verified; the interview deletion it
  authorizes needs a Flow in destructive changes, which this project does not have.

## Suite counts after the fixes

- sfdx-hardis: **1784 unit tests passing** (1773 before, 11 added for the three fixes), lint clean.
- vscode-sfdx-hardis: **329 unit tests passing**, lint clean.
