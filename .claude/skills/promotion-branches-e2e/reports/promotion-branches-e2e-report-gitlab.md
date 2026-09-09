# Promotion branches: end to end test on GitLab

**Date:** 2026-09-09 (supersedes the runs of 2026-09-07 and 2026-09-08)
**Project under test:** `nicolas.vuillamy/sfdx-hardis-promo-e2e-gl-3` (id 4436, private, created empty for this run) on `gitlab.hardis-group.com`
**Salesforce org:** `nicolas.vuillamy.c8024b5deb9f@agentforce.com` (developer org, shared with the other providers)
**sfdx-hardis:** `fix/promotion-split-sync-merges`, `ac317e170`
**vscode-sfdx-hardis:** `fix/config-conflict-markers`, `0fd07cf0`

Every job below is a real `deploy:smart` against that org, run locally with the GitLab CI variables
set (`CI_SFDX_HARDIS_GITLAB_TOKEN`, `CI_SERVER_URL`, `CI_PROJECT_ID`, `CI_MERGE_REQUEST_IID`),
which is what the git provider reads. Merge requests are merged with a merge commit, never
squashed, so the `-x` trailers of the cherry-picks survive.

This run also carries the new **pipeline checkpoints**: six points where what the vscode-sfdx-hardis
DevOps Pipeline shows is asserted by driving the extension's own `PipelineDataProvider` against the
real project.

___

## The pipeline

`integration` -> `uat` -> `preprod` -> `main`, one org, `enablePromotionBranches: true`,
`allowedPromotionSteps` with the three steps, delta deployment on, Apex test classes on.

| Story | Merge Request | Branch                    | Target      | Actions                   | Test classes                            | Keyword                  |
|-------|---------------|---------------------------|-------------|---------------------------|-----------------------------------------|--------------------------|
| S1    | !1            | `feature/E2E-101-alpha`   | integration | pre command + post manual | `PromoE2EAlphaTest`, `PromoE2EBetaTest` | -                        |
| S2    | !2            | `feature/E2E-102-beta`    | integration | post command              | -                                       | `NO_DELTA`               |
| S3    | !3            | `feature/E2E-103-gamma`   | integration | pre command               | `PromoE2EBetaTest`                      | `PURGE_FLOW_VERSIONS`    |
| S4    | !4            | `feature/E2E-201-delta`   | uat         | pre command + post manual | `PromoE2EAlphaTest`                     | -                        |
| S5    | !5            | `feature/E2E-202-epsilon` | uat         | post command              | -                                       | -                        |
| S6    | !6            | `feature/E2E-301-hotfix`  | preprod     | pre command + post manual | `PromoE2EBetaTest`                      | `FLOW_DELETE_INTERVIEWS` |

S1 declares its two test classes in **two separate yaml blocks** of its description.

Nine more merge requests exercise the edge cases: the retrofit (!11), the conflicting pair
(!12, !13), a hand-named branch (!16), a retargeted promotion (!17), a story carrying a sync merge
of its own (!19) and its second merge (!20), the ordinary `integration -> uat` sync (!21), the full
`uat -> preprod` merge (!22) and the major-to-major merge request kept open for the flag-off
comparison (!23).

## The promotions

| Promotion | Merge Request | Branch                                   | Carries      | Outcome                                                                        |
|-----------|---------------|------------------------------------------|--------------|----------------------------------------------------------------------------------|
| P1        | !7            | `promotion/integration/uat/2026-09-08-1` | !1, !3       | merged, deployed to uat                                                          |
| P2        | !8            | `promotion/uat/preprod/2026-09-08-1`     | !4           | merged, deployed to preprod                                                      |
| P3        | !9            | `promotion/uat/preprod/2026-09-08-2`     | !3           | merged, deployed to preprod: a story P1 had carried, promoted alone              |
| P4        | !10           | `promotion/preprod/main/2026-09-08-1`    | !4, !3, !6   | merged, deployed to main, two levels of vehicle under it                         |
| P5        | !14           | `promotion/integration/uat/2026-09-08-2` | !13          | assembled with conflict markers on purpose, solved, then superseded              |
| P6        | -             | `promotion/integration/uat/2026-09-08-3` | !12          | the Pull Request creation case: branch pushed, creation refused, link printed     |
| P7        | !15           | `promotion/integration/uat/2026-09-08-4` | !12          | the supersede run, which closed !14. Left open                                    |
| P8        | !18           | `promotion/uat/preprod/2026-09-08-100`   | !5           | the allowed step of the restricted configuration. Left open                       |

___

## What this run found

### A guard that could never fire

The previous session added `gitlabProjectIdMismatch`: a `CI_PROJECT_ID` left over from another
repository in a local `.env` makes every API call answer about that other project, and creating a
merge request then fails with `{"source_branch":["does not exist"]}` seconds after the branch was
pushed. The guard compares the configured project id with the git remote and self-heals.

This run reproduced the misconfiguration and **the guard stayed silent**. The reason is the
condition that decides whether to auto-detect at all:

```ts
if (!process.env.CI_SERVER_URL || !process.env.CI_PROJECT_ID) {
  await GitlabProvider.autoDetectSettings();
}
```

The check lives inside `autoDetectSettings`, which only runs when something is **missing**. A
`.env` file carrying both `CI_SERVER_URL` and `CI_PROJECT_ID` (which is how people write `.env`
files) skipped it entirely, so the guard protected exactly nobody in the case it was written for.

Fixed by also running the detection when `GITLAB_CI` is not set, since inside a real GitLab CI job
that variable is always present and the environment is authoritative:

```ts
if (!process.env.CI_SERVER_URL || !process.env.CI_PROJECT_ID || !process.env.GITLAB_CI) {
```

After the fix, the same misconfiguration is caught and corrected:

```
[GitLab] CI_PROJECT_ID 4433 points to the project nicolas.vuillamy/sfdx-hardis-promo-e2e-gl-2,
while the git remote of this repository is nicolas.vuillamy/sfdx-hardis-promo-e2e-gl-3. Using the
project id 4436 of the git remote instead: remove CI_PROJECT_ID from your environment or your .env
file to stop seeing this warning.
```

### The Pull Request creation link, proven live

Before that fix landed, the misconfiguration gave a clean run of the "creation refused" path: the
branch was pushed, the retries ran, the provider's own reason was reported, and the one-click
creation link was printed with everything already filled in.

```
[Git Provider] New attempt in 5s (2/4): the git provider may not have indexed the branch that was just pushed
... (4/4)
The Pull Request could not be created automatically ({"source_branch":["does not exist"]}). The branch
promotion/integration/uat/2026-09-08-3 is pushed: create the Pull Request to uat in your git provider,
and paste the description saved in ...
Create it in one click, everything is already filled in (source branch, target branch, title, description):
https://gitlab.hardis-group.com/.../-/merge_requests/new?merge_request%5Bsource_branch%5D=promotion%2F...
&merge_request%5Btarget_branch%5D=uat&merge_request%5Btitle%5D=...&merge_request%5Bdescription%5D=...
promotionPullRequests%3A+%5B12%5D...
```

The URL carries the `promotionPullRequests` block, which is what the deployment jobs read. Note
that after the guard fix this particular way of provoking a refusal self-heals, which is the point
of the guard; the evidence above was captured before it landed, with the same shipped retry and
link code.

### A harness bug, fixed in the runbook scripts

`ab-run-gitlab.sh` relied on the caller having sourced `e2e-lib-gitlab.sh`, but `bash script.sh` is
a child process and inherits no functions, so the flag-off comparison silently ran nothing
(`gl_fetch_merge_ref: command not found`, `exit=127`). It now sources the library sitting next to
it, exactly like `ab-run-azure.sh` already did.

___

## The DevOps Pipeline, before and after every promotion operation

`scripts/check-pipeline.cjs` drives the extension's `PipelineDataProvider` against the real
project, then reads the counter bubbles and the merge edges back out of the mermaid it produced.

| Checkpoint              | integration | uat        | preprod | main       | arrows                                    | Result |
|-------------------------|-------------|------------|---------|------------|---------------------------------------------|--------|
| `pipeline-before-p1`    | !1, !2, !3  | -          | -       | -          | none                                        | OK     |
| `pipeline-p1-open`      | !1, !2, !3  | -          | -       | -          | `integration>uat` draws **!7**              | OK     |
| `pipeline-after-p1`     | !2          | !1, !3     | -       | -          | none                                        | OK     |
| `pipeline-before-p3`    | !2          | !1, !3, !5 | !4      | -          | none                                        | OK     |
| `pipeline-after-golive` | !2          | !1, !5     | -       | !3, !4, !6 | none                                        | OK     |
| `pipeline-final`        | -           | -          | 8 stories | !3, !4, !6 | `integration>uat` !15, `uat>preprod` !18   | OK     |

The same conclusions as on GitHub hold here, against the GitLab provider's own fetching: an open
promotion is drawn on the arrow of its step and takes nothing out of the source branch until it is
merged; after the merge the stories are listed in the branch they reached and nowhere else; what
the pipeline lists at `pipeline-before-p3` is exactly what the next `promotion:create` offered; and
the retargeted promotion (!17) and the hand-named branch (!16) are drawn on no arrow.

Two checks run at every checkpoint with no expectations at all: a merge request number is listed in
one branch and one only, and every counter bubble equals the length of the list under it.

___

## Test groups

| Group                                    | Expected                                                                       | Result                                                                                        |
|------------------------------------------|--------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------|
| Provider detection                       | GitLab picked from `CI_SFDX_HARDIS_GITLAB_TOKEN`, project from `CI_PROJECT_ID` | OK on every job                                                                               |
| Feature branch validation and deployment | `Pull Request scope: 1 Pull Request(s) (#N)` and nothing else                  | OK for !1..!6                                                                                 |
| Two yaml blocks in a description         | the union of both is selected                                                  | OK on !1: `PromoE2EAlphaTest` and `PromoE2EBetaTest`                                          |
| `NO_DELTA`                               | `Delta deployment has been disabled`, `Deployment mode: FULL`                  | OK on !2                                                                                      |
| `PURGE_FLOW_VERSIONS`                    | extra pre-deploy action, skipped in validation, run in deployment              | OK on !3, then on !7 and !9 by inheritance                                                    |
| Manual actions in a validation job       | `Skipping ...: deployment-only action`                                         | OK everywhere                                                                                 |
| Merge-ref lag                            | a validation run seconds after a push must not read the previous merge         | OK: `gl_check` waits, no stale tree in the whole run                                          |
| Promotion Merge Request creation         | branch pushed, merge request opened with the declaration and the carried table | OK: !7, !8, !9, !10, !14, !15, !18                                                            |
| Promotion validation and deployment      | scope = declared + the promotion itself                                        | OK: !7 (`#1, #3, #7`), !8 (`#4, #8`), !9 (`#3, #9`), !10 (`#4, #3, #6, #10`)                   |
| Keyword inheritance                      | only the keywords of the carried stories                                       | OK: !7 inherits `PURGE_FLOW_VERSIONS` from !3 and **not** `NO_DELTA` from !2, which stayed     |
| Test classes of a promotion              | union of the carried merge requests, `RunSpecifiedTests`                       | OK on !7 and !10                                                                              |
| One candidate row per User Story         | a sync merge and a promotion merged into its target are opened up              | OK: from `uat`, !1 and !3 are two rows, never one row for the whole `integration -> uat` sync  |
| Story brought in by a promotion          | promoting `3` carries S3 alone                                                 | OK on P3: one cherry-pick, `assembled with 1 User Story(ies): #3`                              |
| Two levels of vehicle                    | the stories under an inner promotion are candidates of their own               | OK: from `preprod`, !4, !3 and !6 are offered, never !8, !9 or !10                             |
| Back-merge from the target branch        | stays a single row                                                             | OK: the retrofit row `#11, #6, #3, #4` is never opened up                                      |
| Sync merge inside a story                | the candidate lists the story only                                             | OK: !19 alone                                                                                  |
| Branch merged twice                      | listed once, never once with its number and once as a `-` row                  | OK: !19 and !20, one row each                                                                  |
| A story offered twice                    | one row per User Story after a sync merge re-delivers a promoted story         | OK: after !21, !1 and !3 appear once each (the `dropOfferedTwice` fix of this cycle)            |
| Retrofit `main` -> `integration`         | the promotion is expanded, then every already shipped story is named           | OK on !11: `Promotion Pull Request 10 adds 3 carried Pull Request(s)`, then three `already deployed` |
| Release notes of the go-live             | the User Stories, not the vehicles                                             | OK: 3 merge requests (!3, !4, !6); 4 with `--include-promotions`, !10 added                     |
| Already promoted                         | marked in the table, `--include-already-promoted` named, no branch created     | OK, exit 1                                                                                     |
| Empty cherry-pick                        | `Nothing to cherry-pick`, no branch, exit 0                                    | OK                                                                                             |
| Conflict, agent default                  | promotion undone, both files named                                             | OK on !13: `NOTES.md` and the labels file named                                                 |
| Conflict outside `force-app`             | the gate still catches it                                                      | OK, `NOTES.md` named in both the conflict and the marker gate                                    |
| Conflict, kept                           | merge request created, prompt file written and embedded                        | OK: !14                                                                                        |
| Conflict answered once for all           | `Applying the conflict handling chosen earlier`                                 | OK through `--on-conflict commit-with-markers`                                                  |
| Marker guard                             | job fails naming the files **and the validation comment says so**              | OK: 2 files named, and the note carries the failure banner, the branch, the count and the list  |
| Marker guard, solved                     | the job passes                                                                 | OK, scope `#13, #14`                                                                            |
| Committed conflict prompt report         | the gate ignores it                                                            | OK                                                                                             |
| Deployment from a promotion branch       | the job stops naming the branch and `DEPLOY_BRANCHES`                          | OK, and `--check` on the same branch still runs                                                 |
| Pull Request creation refused            | branch pushed, the provider's own reason, a one-click creation link            | OK, see above                                                                                   |
| Stale `CI_PROJECT_ID`                    | detected and replaced by the project of the git remote                         | OK after the fix of this run                                                                    |
| Feature off                              | one informational line, scope = the merge request alone                        | OK on !15                                                                                       |
| Hand-named branch                        | warning, treated as a feature branch, declaration ignored                      | OK on !16                                                                                       |
| Retargeted promotion                     | warning naming the mismatch, scope = the merge request alone                   | OK on !17: "named for target preprod but its Pull Request targets main"                          |
| Unreadable declaration                   | warning and skip, not a failure                                                | OK: `#9999 ... was not found: skipped`, the job still passed                                     |
| Supersede an open promotion              | the open one is closed **after** the new one exists                            | OK: !15 created, then !14 closed                                                                 |
| Restricted `allowedPromotionSteps`       | a forbidden source and a forbidden target are refused, the allowed one works   | OK, all three                                                                                    |
| `allowedPromotionSteps` not declared     | the command stops, asking for the list and linking to the doc                  | OK                                                                                              |
| `promotion:list-candidates`              | the candidate table, creating nothing                                          | OK from `uat` and from `integration`                                                             |
| Full merge after a partial promotion     | already promoted stories skipped, the never promoted ones arrive, nothing left | OK on !22, then `No Pull Request merged into uat is waiting for promotion to preprod`             |
| DevOps Pipeline before and after         | section above                                                                  | OK, six checkpoints                                                                              |
| Single place in the diagram              | each number in one branch only                                                 | OK, and the two toggles both raise the counts                                                    |
| Merge request comment audit              | consistent comments, navigation and action state                               | **631 checks, zero findings**                                                                     |
| Flag-off regression                      | `TOTAL DIFFERING LINES: 0`                                                     | 33 lines, all explained, see below                                                               |

### Merge request comment audit

```
631 checks over 22 Pull Requests (gitlab)
OK: every sfdx-hardis Pull Request comment is consistent
```

Nothing to report: one comment per kind, no leaked placeholder, a navigation block linking to the
comments of the same merge request, one column and one pending checkbox per org branch, no manual
action left `skipped`, and every promotion naming the stories it carries.

### Flag-off regression

Three pairs were run (`branch`/`main`, `branch2`/`main2`, `branch3`/`main3`), and the third,
in steady state, compared:

```
deploy-uat.log:    174 lines vs 185 lines, only in A: 1, only in B: 12
release-notes.log:  71 lines vs  75 lines, only in A: 0, only in B: 4
release-notes.md:   36 lines vs  36 lines, only in A: 0, only in B: 0
TOTAL DIFFERING LINES: 33
```

Not zero, and every line is accounted for:

| Count | Line                                                                     | What it is                                                                                      |
|-------|--------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------|
| 31    | `git config --null --show-origin --get-all remote.origin.url`            | the stale `CI_PROJECT_ID` guard fixed in this run: outside a GitLab CI job the git remote is read to check which project the API is talking to. Intended, and paid by local runs only, never inside a job |
| 1     | `"message": "Source validate did not run tests in the org"`              | quick-deploy state in the Salesforce org between two passes                                       |
| 1     | `"message": "There have been deploys in the org since the source validate happened"` | the same                                                                            |

No line comes from promotion branches code. A project that does not set `enablePromotionBranches`
gets the jobs it got before, plus one git read per command when it runs GitLab commands outside
GitLab CI.

___

## What this run did not cover

- **The interactive "commit this and every following conflict" answer.** Exercised through
  `--on-conflict commit-with-markers`, which walks the same `rememberedChoice` code, and through
  the unit tests of the prompt answer. The prompt itself needs a terminal the harness does not have.
- **An octopus merge (three or more parents).** Git resolves the attempts into two-parent merges by
  fast-forwarding the first side; the guard that leaves such a merge whole stays a unit test.
- **GitLab CI itself.** The jobs are reproduced locally with the CI variables set, which is what the
  git provider reads. No `.gitlab-ci.yml` ran, so the `DEPLOY_BRANCHES` anchoring trap is proven by
  the new deployment guard rather than by a real pipeline.
- **The pipeline webview by clicking.** Exercised through its own data provider and its unit tests;
  the mermaid is asserted as text, never rendered.
- **The four pipeline levels share one Salesforce org**, so deployment action state is keyed by org
  **branch**, not by distinct orgs.

## Suite counts

- sfdx-hardis, the six promotion suites: **122 passing**.
- vscode-sfdx-hardis, the two promotion suites: **37 passing**.
