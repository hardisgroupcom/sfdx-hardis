# Promotion branches and backpromote: end to end test on GitHub

**Date:** 2026-10-02 (supersedes the run of 2026-09-13)
**Why this run:** issue #2260. The DevOps Pipeline counted a story carried by a merged promotion in
the branch it left once the branch it reached had gone live, and the upcoming promotion notes
listed it. Fixed in sfdx-hardis #2262 and vscode-sfdx-hardis #538.

**Repositories under test (private, created empty for this run):**

- promotion branches: `nvuillam/sfdx-hardis-promo-e2e-18`
- backpromote (Beta): `nvuillam/sfdx-hardis-promo-e2e-20` (`-19` was abandoned: its setup merged
  the stories, then could not create the second scratch org, see "What the run found")

**Salesforce org:** `nicolas.vuillamy.c8024b5deb9f@agentforce.com` (developer org, Dev Hub). Scratch
orgs `promo-e2e-dev` and `promo-e2e-dev2`, created by this run (the previous ones had expired).
**sfdx-hardis:** `fix/promotion-already-promoted-pipeline-and-notes`, `fbd675222`, through
`bin/dev.js`.
**vscode-sfdx-hardis:** `fix/promotion-count-after-go-live`, `d978c2a1`, compiled with `yarn compile`.

Every job is a real `deploy:smart`, `promotion:create`, `promotion:list-candidates`,
`doc:release-notes` or `work:backpromote` against the org, run locally with the GitHub Actions
variables set. GitHub only: GitLab, Azure DevOps and Bitbucket were not run.

___

## Counts

| Section                                                                              | Checks                           | OK                         | FAIL |
|--------------------------------------------------------------------------------------|----------------------------------|----------------------------|------|
| 3, 4 and 4bis: stories, promotions, two go-lives, release notes, retrofit, pipeline  | 42                               | 41                         | 1    |
| 6: edge cases, groups g1 to g5                                                       | 44                               | 42                         | 2    |
| 6: edge group g6, full merge of uat into preprod, plus a pipeline check              | 4                                | 4                          | 0    |
| 5bis: Pull Request comment audit                                                     | 676 checks over 35 Pull Requests | all                        | 0    |
| 7bis: single place in the diagram                                                    | 1                                | 1                          | 0    |
| 6bis: backpromote B0 to B16, C1 to C4, on `-20`                                      | 63                               | 62                         | 1    |
| 7ter: flag-off A/B against `origin/main` (`045f727aa`), second pair                  | 5 files compared                 | `TOTAL DIFFERING LINES: 0` | 0    |

The four failures are not product defects. One came from the workstation running out of memory,
three from expectations the product had moved past. Each is explained below. The counts are the
first pass: the corrected assertions were checked against the saved logs, not by a second run.

___

## The scenario of issue #2260

Seven stories. S7 is new in this run: a second hotfix merged into `preprod` and promoted to `main`
on its own, so that the first go-live promotion (P4) is in no window any more. That is the state of
the reporter's repository.

| Checkpoint                     | integration | uat        | preprod    | main       |
|--------------------------------|-------------|------------|------------|------------|
| `pipeline-before-p1`           | #1, #2, #3  | -          | -          | -          |
| `pipeline-after-p1`            | #2          | #1, #3     | -          | -          |
| `pipeline-before-p3`           | #2          | #1, #3, #5 | #4         | -          |
| `pipeline-after-p3`            | #2          | #1, #5     | #3, #4     | -          |
| `pipeline-p4-open`             | #2          | #1, #5     | #3, #4, #6 | -          |
| `pipeline-after-golive`        | #2          | #1, #5     | -          | #3, #4, #6 |
| `pipeline-after-second-golive` | #2          | #1, #5     | -          | #7         |
| `pipeline-after-retrofit`      | #2, #13     | #1, #5     | -          | #7         |

`pipeline-after-second-golive` is the proof: P4 (#11) has left the `main` window, which shows the
latest go-live only, and `preprod` was never merged into `main` directly. #3, #4 and #6 come back in
neither `preprod` nor `uat`. `promotion:create` from `preprod` offered #7 and left out what P4 had
shipped, so the view and the command agree.

Edge group g6 then merges `uat` into `preprod` directly: the job names the stories already promoted,
`list-candidates` answers that nothing is left waiting, and the pipeline shows `uat` and
`integration` empty with everything listed in `preprod`.

Release notes of the go-live list #3, #4 and #6, not the vehicle #11; `--include-promotions` adds
#11 next to them.

___

## What the run found

1. **`check-retrofit` exited 1 (assertion 23a).** The deployment action `echo "E2E post-deploy of
   PR 7"` failed with `Command failed` and no output. The workstation was out of memory at that
   moment (the harness stopped the script seconds later), and the same action ran in every other
   job. The scope assertions of that job are in its log: P4 expanded into #4, #3, #6, and each story
   named as already deployed through its promotion. Not re-run: the retrofit Pull Request was
   merged by then. Runbook trap added.
2. **Edge case 35, "Pull Request creation refused" (two assertions).** With no provider token and no
   `gh` CLI the command now stops with "Promotion branches need the git provider connection" before
   it creates anything, since #2236. The case still expected a pushed branch and a creation link.
   The script now asserts the refusal and that no promotion branch was pushed; the runbook keeps the
   "refused by a connected provider" case as a separate row, not scripted.
3. **Backpromote B2, "production org".** A Developer Edition org is accepted as a dev environment
   since #2239 (org type `developer`). The step expected `blocked`. New expectation
   `reference/backpromote/developer-edition.json`, checked against the saved plan: all checks pass.
4. **The Dev Hub caps the active scratch orgs at 3, and the CI of sfdx-hardis uses the same Dev
   Hub.** Two `CI-hardis-nut-shared-*` orgs left by Pull Request runs plus the first developer org
   made the second `sf org create scratch` fail with `LIMIT_EXCEEDED`, after `backpromote-setup.sh`
   had merged its stories, which cost repository `-19`. One CI org of a finished run was deleted
   (`ActiveScratchOrg`), and the section ran on `-20`. Runbook trap added.

No product defect was found.

___

## What this run did not cover

- **GitLab, Azure DevOps and Bitbucket.** The fix adds `listMergedPullRequestsIntoBranch` to the
  four providers of the extension; only the GitHub one ran live. The reporter of #2260 is on
  Bitbucket, whose only test token is still scoped to a repository that no longer exists.
- **The four failed assertions were not run a second time.** They were read against the saved logs
  after the corrections.
- **A real production org refused by backpromote** (`refused-production.json`): the harness only
  has Developer Edition orgs, which are accepted.
- **Pull Request creation refused by a connected provider**, with the link to the creation form.
- **The upcoming promotion notes in branch mode** (`--source-branch uat --target-branch preprod`),
  the CLI change of #2262: covered by unit tests only. The release notes this run generates are the
  post mode of a go-live.
- The four pipeline levels share one Salesforce org, so deployment action state is keyed by org
  **branch**, not by distinct orgs.
- The pipeline webview is exercised through its own data provider, its compiled helpers and its
  unit tests, not by clicking: the mermaid is asserted as text, never rendered.
- The Backpromote panel is not clicked, and the terminal prompts of step B17 were not answered.
- No timing report: the run used `bin/dev.js` on a workstation short on memory, so its durations
  mean nothing.

## Suites

- sfdx-hardis: promotion and release notes suites, 143 passing.
- vscode-sfdx-hardis: 576 passing.
