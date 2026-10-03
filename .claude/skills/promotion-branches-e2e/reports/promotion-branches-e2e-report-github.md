# Promotion branches, deployment actions and backpromote: end to end test on GitHub

**Date:** 2026-10-03 (supersedes the run of 2026-10-02)
**Why this run:** the deployment action features of sfdx-hardis #2268 and vscode-sfdx-hardis #542:
the manual action gate of validations, `action:run` and `action:set-status` (also ahead and in
another org), the forecast of the next promotion, the developer org runs. This run is also the first
one through **real GitHub Actions workflows** (new section 6quinquies).

**Repositories under test (private, created empty for this run):**

- promotion branches, sections 4, 6, 6quater, 7bis, 7ter: `nvuillam/sfdx-hardis-promo-e2e-27`
- real CI workflows, section 6quinquies: `nvuillam/sfdx-hardis-promo-e2e-26`
- backpromote (Beta), section 6bis: `nvuillam/sfdx-hardis-promo-e2e-29`
- dead setups, see "What the run found": `-21` (stopped on request), `-22` (compromised by a memory
  stop and a network outage), `-23`, `-24`, `-25` (CI section setup traps), `-28` (DNS failure)

**Salesforce org:** `nicolas.vuillamy.c8024b5deb9f@agentforce.com` (developer org, Dev Hub). Scratch
orgs `promo-e2e-dev` (also `DEV_ORG` of 6quater group D) and `promo-e2e-dev2`.
**sfdx-hardis:** `feat/recover-failed-actions`, up to `e31cb616d`, through `bin/dev.js` locally and
linked with `sf plugins link` in the CI workflows.
**vscode-sfdx-hardis:** `feat/recover-failed-actions`, `86b18d4e`, compiled with `yarn compile`.

Every simulated job is a real `deploy:smart`, `promotion:create`, `action:run`, `action:set-status`,
`action:list` or `work:backpromote` against the org, run locally with the GitHub Actions variables
set. Section 6quinquies runs the jobs in GitHub Actions themselves. GitHub only.

___

## Counts

| Section                                                                          | Checks | OK         | FAIL |
|----------------------------------------------------------------------------------|--------|------------|------|
| 3, 4 and 4bis: stories, promotions, two go-lives, release notes, retrofit, pipeline | 42     | 42         | 0    |
| 6: edge cases, groups g1 to g6                                                   | 47     | 46         | 1    |
| 6quater: gate, recovery, set-status ahead, forecast, developer org (third pass)  | 21     | 21         | 0    |
| 6quinquies: the same features through real GitHub Actions workflows              | 15     | 15         | 0    |
| 7bis: single place in the diagram                                                | 1      | 1          | 0    |
| 6bis: backpromote B0 to B17, C1 to C4                                            | 63     | 59         | 4    |
| 7ter: flag-off A/B against `origin/main` (`a236259ef`)                           | 5 files compared, passes 2 and 3 | `TOTAL DIFFERING LINES: 0` | 0 |

None of the remaining failures is a product defect: 52a is a race in the test script (fixed), the
four backpromote ones are network and resource failures of the workstation, replayed below.

___

## What the run found

### Product defects, fixed in this run

1. **The forecast of the next promotion said "Waiting for you" for post-deployment manual actions**
   (reported from the real repository). A post-deployment step cannot be done before the metadata it
   completes is deployed. New forecast code `after-merge`, shown "After the merge" with no Mark as
   done button and not counted as to do. Proven on real CI (W5b, W6c) and by 6quater C3.
2. **The GitHub workflow templates did not run deployment actions at all.** The jobs run in the
   sfdx-hardis container, where git refuses the checkout ("detected dubious ownership"): sfdx-hardis
   cannot read which Pull Requests are deployed and skips their actions, green. The training fork
   carried the workaround; the shipped `check-deploy.yml` and `process-deploy.yml` did not. Both now
   declare `safe.directory` (`fb3d4d998`). Found by section 6quinquies, the first run through CI.
3. **`action:run --org-branch <major> --target-org <org>` refused when the branch config declares no
   org**, with "No org of ? (branch preprod) is authenticated". It now takes the org passed, and asks
   for `--target-org` with a clear message when none is passed (`e31cb616d`, three unit tests).

### Test script defects, fixed

- g6 validated the full merge Pull Request before GitHub wrote `refs/pull/<n>/merge` (52a): it now
  waits for the merge ref like the other groups. 52a could not be replayed after the fact: the
  validation reads the scope from the provider, which had moved on. 52b and 52c passed.
- 6quater, pass 1 and 2 on `-27`: `e2e-recovery-ok.txt` made `promotion:create` refuse the working
  copy (now in `.git/info/exclude`); a shared `flaky.cjs` never reached uat with a later story (now
  one per story); the repository declared no org per branch, so `--dev-org` could not refuse a major
  org (now declared, like a real project); B6 needed `--allow-branch-mismatch` to reach the refusal it
  tests. `DA_RUN=<n>` replays the section on the same repository. Pass 3: 21/21.
- 6quinquies setup: CI login needs `targetUsername` in the branch configs, and `sf org display
  --verbose` now redacts `sfdxAuthUrl` (the script uses `sf org auth show-sfdx-auth-url`).

### Environment

- The workstation ran short of memory several times. Claude Code reported the background runs as
  stopped, but the processes went on. At those moments a bare `echo` action failed, git could not
  start its DNS thread, and the GitHub API answered `fetch failed`. `-22` was abandoned for that
  reason, and its 23a and 23b passed on `-27`. An edit of the `-22` working copy while its run was
  still alive caused 23b there: never touch the working copy of a running section.
- When the GitHub API is down, `deploy:smart` deploys the metadata without the deployment actions of
  the Pull Requests, then fails on the next API call. Not changed here; worth a look.

### Backpromote failures, replayed

| Step        | First run                  | Replay                                                                                   |
|-------------|----------------------------|------------------------------------------------------------------------------------------|
| B3-plan-s1  | `sgd` "not a valid sha" during the memory stop | plan built, version 3, progress written; only "already run" differs (B4 ran since) |
| B3-progress | no `retrieve` line         | OK, 14 progress lines                                                                    |
| B5-confirm  | `fetch failed`             | OK                                                                                       |
| C2-comments | the confirm never ran      | the original org row is done; a second row belongs to the refreshed sandbox of B16      |

___

## Real CI workflows (section 6quinquies, `-26`)

| Check | Result                                                                                         |
|-------|------------------------------------------------------------------------------------------------|
| W0    | the jobs run `sfdx-hardis (link) /tmp/sfdx-hardis`                                             |
| W1    | the validation stops on the pending pre-deployment manual action; the comment shows why        |
| W2    | the checkbox ticked through the API, Re-run all jobs: recorded as done, green                  |
| W3    | a GitHub draft with no "draft" in its title is only warned (the provider's draft flag)        |
| W4    | the deployment job fails on the flaky command and stops the next ones; statuses read back      |
| W5    | the promotion to uat stops until the manual action is done in uat; forecast "after the merge" |
| W6    | `set-status --org-branch uat`, the re-run passes, the forecast says done                       |
| W7    | the promotion deploys the commands with the fix that travelled with it                        |

___

## What this run did not cover

- **GitLab, Azure DevOps and Bitbucket**, for the simulators and for real CI. The draft flag of
  GitLab, Azure DevOps and Bitbucket is unit tested only.
- **52a** (see above), and the backpromote steps only replayed after the fact.
- **The VS Code panel is not clicked**: Mark as done, Run in another org and the Next promotion
  switch run the commands asserted here; the panel itself was checked on the data of the real
  repository with the read-only harness and by its unit tests.
- **The interactive prompts** of `action:run --select-org` and `action:set-status --select-org`.
- The four pipeline levels share one Salesforce org, so deployment action state is keyed by org
  **branch**, not by distinct orgs.
- No timing report: the workstation was short on memory, durations mean nothing.

## Suites

- sfdx-hardis: full unit suite 2383 passing, 0 failing.
- vscode-sfdx-hardis: 601 passing.
