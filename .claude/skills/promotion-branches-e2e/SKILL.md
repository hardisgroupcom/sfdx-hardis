---
name: promotion-branches-e2e
description: Run the hardcore end to end test of the promotion branches feature, and of backpromote (Beta), against real Salesforce orgs and a throwaway private GitHub, GitLab, Azure DevOps or Bitbucket Cloud repository, then write the report. Use when promotion branches (enablePromotionBranches, hardis:project:promotion:create) or backpromote (hardis:work:backpromote, the VS Code Backpromote panel) changed and must be proven again, or when the user asks for the promotion branches / backpromote end to end / hardcore test.
argument-hint: "[org username] [repo slug] [what to focus on]"
allowed-tools: Bash, Read, Grep, Glob, Edit, Write, AskUserQuestion
user-invocable: true
model: opus
---

# Promotion branches: end to end test

Rebuild, from nothing, a four level pipeline that exercises every path of the promotion branches
feature against a real Salesforce org, assert every job log, then write the report. Roughly
45 minutes of wall clock.

The design of the feature itself is in the `promotion-branches` skill: read it first if you have
not already, so you know what each assertion is protecting.

## What this skill contains

| File                                        | Use                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
|---------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `reference/runbook.md`                      | The full procedure: repository layout, the six User Stories, the run order, what to assert in each log, the edge cases, the traps. **Read it before starting.**                                                                                                                                                                                                                                                                                                             |
| `scripts/build-repo.sh`                     | Writes the base project, the four major branches and the config. Provider agnostic.                                                                                                                                                                                                                                                                                                                                                                                         |
| `scripts/stories.sh`                        | `story_branch` and `story_actions`: the six User Stories and the action files that travel with them. Provider agnostic.                                                                                                                                                                                                                                                                                                                                                     |
| `scripts/e2e-lib.sh`                        | GitHub job simulators: `e2e_check`, `e2e_deploy`, `e2e_promote`, `e2e_release_notes`, `e2e_grep`. Source it.                                                                                                                                                                                                                                                                                                                                                                |
| `scripts/e2e-lib-gitlab.sh`                 | The same for GitLab, plus `gl_mr_create`, `gl_mr_merge` and the merge-ref wait GitLab needs.                                                                                                                                                                                                                                                                                                                                                                                |
| `scripts/e2e-lib-azure.sh`                  | The same for Azure DevOps (`az_*`), plus `az_pr_create`, `az_pr_merge`, `az_pr_abandon` and the merge-ref wait. `AZ_TOKEN` defaults to `AZURE_PERSONAL_ACCESS_TOKEN` (environment, then `.env`), `AZ_REPO_ID` is read by name when empty.                                                                                                                                                                                                                                   |
| `scripts/e2e-lib-bitbucket.sh`              | The same for Bitbucket Cloud (`bb_*`), plus `bb_pr_create`, `bb_pr_merge`, `bb_pr_decline`, `bb_remote_url` and the checkout of a Pull Request merge (Bitbucket has no merge ref). `BB_TOKEN` / `BB_EMAIL` default to `ATLASSIAN_TOKEN` / `ATLASSIAN_EMAIL` (environment, then `.env`); `BB_WORKSPACE` is always required.                                                                                                                                                  |
| `scripts/check-pipeline.cjs`                | Drives the extension's own PipelineDataProvider against the test repository and asserts what the DevOps Pipeline shows at a point of the run.                                                                                                                                                                                                                                                                                                                               |
| `scripts/check-pr-modal.cjs`                | Makes the calls of the single Pull Request modal (`action:list --with-status --with-workflows` with the token only, the extension's `completePullRequestsWithActions`) for every open and merged Pull Request, and compares its Deployment Actions, Validation, Code Quality and Deployment tabs with the comments the provider holds (section 4ter). Reads the comments of the four providers (`PROVIDER=github|gitlab|azure|bitbucket`), or run it as `p_pr_modal_check`. |
| `scripts/check-diagram.cjs`                 | Feeds the extension's compiled helpers with the real Pull Requests and asserts the "single place in the diagram" rule.                                                                                                                                                                                                                                                                                                                                                      |
| `scripts/check-diagram-gitlab.cjs`          | The same, reading merge requests from the GitLab API.                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `scripts/check-diagram-azure.cjs`           | The same, reading Pull Requests from the Azure DevOps API.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `scripts/check-diagram-bitbucket.cjs`       | The same, reading Pull Requests from the Bitbucket Cloud API.                                                                                                                                                                                                                                                                                                                                                                                                               |
| `scripts/check-backpromote-plan.cjs`        | Asserts a `hardis:work:backpromote ... --json` document (plan version 3: plan, prepare, run, confirm, reset) against the expectations of `reference/backpromote/*.json` (section 6bis).                                                                                                                                                                                                                                                                                     |
| `scripts/check-backpromote-comments.cjs`    | Asserts the "Backpromotes" Pull Request comments of a `dump_pr_comments` dump: one comment per Pull Request, its sandbox rows and action rows (section 6bis, C1 to C4).                                                                                                                                                                                                                                                                                                     |
| `scripts/check-backpromote-identical.cjs`   | Asserts the identical actions of a backpromote `--plan --json` document or run result: `identicalTo`, one key per action, the outcome of each key (section 6sexies).                                                                                                                                                                                                                                                                                                        |
| `scripts/promotion-provider.sh`             | Provider neutral job names (`p_check`, `p_deploy`, `p_promote`, `p_open`, `p_merge`, `p_wait_merge_ref`, `p_pr_modal_check`...) over the GitHub, GitLab, Azure DevOps or Bitbucket library, picked with `PROVIDER=github|gitlab|azure|bitbucket`. The section scripts below call nothing else, so they run on the four.                                                                                                                                                     |
| `scripts/promotion-run.sh`                  | Sections 3, 4 and 4bis scripted: the six stories, the four promotions, the release notes, the retrofit, an assertion per job log and a pipeline check per step.                                                                                                                                                                                                                                                                                                             |
| `scripts/promotion-edge.sh`                 | Section 6 scripted in five groups (`g1` to `g5`) that build on each other, run after `promotion-run.sh`.                                                                                                                                                                                                                                                                                                                                                                    |
| `scripts/deployment-actions-run.sh`         | Section 6quater scripted: the manual action gate of validations, a failed action retried with `action:run`, `set-status` (also ahead in the next branch), the promotion forecast and the developer org runs. After `promotion-run.sh`.                                                                                                                                                                                                                                      |
| `scripts/identical-actions-run.sh`          | Section 6sexies: an action shared by several stories runs once in the promotion to uat; a repeat inside one story, another phase, a reused id, a copy after a failure, the forecast, the re-run, the branch config, the validation job, the backpromote. After `promotion-run.sh`.                                                                                                                                                                                          |
| `scripts/section-lib.sh`                    | The assertion helpers of the section scripts (`record`, `assert_log`, `job`, `cli`, `status_check`, `open_story`). Sourced by `deployment-actions-run.sh` and `identical-actions-run.sh`.                                                                                                                                                                                                                                                                                   |
| `scripts/check-action-status.cjs`           | Asserts an `action:list --with-status [--forecast] [--with-backpromotes] --json` document: statuses, notes, forecasts and the identical action of a copy, the promotion carried, Backpromotes rows.                                                                                                                                                                                                                                                                         |
| `scripts/ci-workflows-prepare.cjs`          | The GitHub Actions workflows of the CI section: the sfdx-hardis templates plus a step that links the branch under test and `SFDX_AUTH_URL_<BRANCH>` logins.                                                                                                                                                                                                                                                                                                                 |
| `scripts/ci-workflows-run.sh`               | Section 6quinquies: the gate, the checkbox, a real draft, the deployment, the promotion and its forecast, the same action in two stories, run by REAL GitHub Actions jobs in a repository of its own.                                                                                                                                                                                                                                                                       |
| `scripts/timing-report.cjs`                 | Performance tables of a run: `timings.tsv` (every job and backpromote call) and the backpromote progress files, median and worst per step, slowest calls.                                                                                                                                                                                                                                                                                                                   |
| `scripts/ab-run.sh`                         | Runs the same CI jobs with a given CLI checkout and stores the logs.                                                                                                                                                                                                                                                                                                                                                                                                        |
| `scripts/ab-run-gitlab.sh`                  | The same on GitLab.                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `scripts/ab-run-azure.sh`                   | The same on Azure DevOps.                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `scripts/ab-run-bitbucket.sh`               | The same on Bitbucket Cloud.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `scripts/audit-pr-comments.cjs`             | The Pull Request comment audit, shared by the four providers. Fed by the `dump_pr_comments` of each library.                                                                                                                                                                                                                                                                                                                                                                |
| `scripts/ab-diff.py`                        | Normalises two log folders and diffs them: the flag-off regression proof.                                                                                                                                                                                                                                                                                                                                                                                                   |

## Before starting

Ask the user only for what you cannot find yourself:

- the **Salesforce org** to deploy to (an authenticated org alias or username);
- for backpromote (Beta), a **Dev Hub** to create the developer's scratch orgs from (the org above
  when it has Dev Hub enabled): backpromote refuses production orgs and major branch orgs, and a
  scratch org tracks its sources, which is what the "pending org changes are saved first" step needs;
- the **repository slug** to create, if they care about the name. Otherwise pick
  `<gh login>/sfdx-hardis-promo-e2e-<n>`, incrementing `<n>` past the ones that already exist;
  on GitLab, `<user>/sfdx-hardis-promo-e2e-gl-<n>`; on Azure DevOps,
  `sfdx-hardis-promo-e2e-az-<n>` inside the team project `tests-sfdx-hardis` of the organization
  `nicolasvuillamy` (`-az-1` to `-az-6` exist, the next free one is `-az-7`); on Bitbucket Cloud,
  `sfdx-hardis-promo-e2e-bb-<n>` in the workspace `sfdxhardistest`, project key `TES`;
- which **providers** to run, when they have not said. GitHub alone is the quick pass; each of
  GitLab, Azure DevOps and Bitbucket Cloud is the only way its own provider code gets exercised.

Check yourself: `gh auth status`, `glab auth status`, the tokens in `.env` (Azure DevOps:
`AZURE_PERSONAL_ACCESS_TOKEN`; Bitbucket: `ATLASSIAN_TOKEN` and `ATLASSIAN_EMAIL`, which the Azure and
Bitbucket libraries read on their own when `AZ_TOKEN` / `BB_TOKEN` are not set), `sf org list`, the
sfdx-hardis branch under test, and whether the vscode-sfdx-hardis working copy is on the matching
branch and compiled (`yarn compile`), which the diagram check needs. A read-only proof of the Azure and
Bitbucket wiring, without creating anything, is in runbook section 8quater.

**Never reuse a previous test repository.** Each run starts from a fresh private repository, so a
failure cannot be an artefact of the previous run's state.

## Process

1. **Read `reference/runbook.md` in full.** It holds the decisions that make the run meaningful
   (development branch named `integration` so stories arrive through a child branch,
   `hardis-report/` deliberately not gitignored, one static resource per story, never squash).
2. **Set the environment and source the library**:

   ```bash
   export ORG="..." REPO="..." WORK="/c/tmp/promo-e2e" LOGS="/c/tmp/promo-e2e-logs"
   export DEV="C:/git/sfdx-hardis/bin/dev.js"
   source .claude/skills/promotion-branches-e2e/scripts/e2e-lib.sh
   ```

   The scripted sections take `PROVIDER=github|gitlab|azure|bitbucket` and the variables of that
   provider's library instead (runbook sections 6ter, 8, 8bis and 8ter).

   | Section                                    | GitHub | GitLab | Azure DevOps | Bitbucket Cloud |
   |--------------------------------------------|--------|--------|--------------|-----------------|
   | 3, 4, 4bis `promotion-run.sh`              | yes    | yes    | yes          | yes             |
   | 6 `promotion-edge.sh g1..g6`               | yes    | yes    | yes          | yes             |
   | 6quater `deployment-actions-run.sh`        | yes    | yes    | yes          | yes             |
   | 6sexies `identical-actions-run.sh`         | yes    | yes    | yes          | yes             |
   | 6bis `backpromote-setup.sh` / `-steps.sh`  | yes    | yes    | yes          | yes             |
   | 4ter `check-pr-modal.cjs`                  | yes    | yes    | yes          | yes             |
   | 7bis `check-diagram*.cjs`                  | yes    | yes    | yes          | yes             |
   | 6quinquies `ci-workflows-run.sh` (real CI) | yes    | no     | no           | no              |

   "yes" for Azure DevOps and Bitbucket means scripted and checked for syntax and wiring on
   2026-10-08, not run live yet: see "Known gaps".

3. **Build the repository and the stories** (runbook sections 2 and 3).
4. **Run the pipeline** (runbook section 4), asserting each log as you go with `e2e_grep`. Do not
   batch the assertions to the end: a wrong scope early makes every later log meaningless.
5. **Run the edge cases** (runbook section 6). These are where the defects have been.
5bis. **Audit the Pull Request comments** (runbook section 5bis). The job logs say what the command
   decided; the audit says what the reviewer reads. Four of the defects of 2026-09-08 came from it,
   and none of them was visible in a job log.
5ter. **Check the DevOps Pipeline before and after every promotion operation**
   (runbook section 4bis): `pipeline_check <label> <expectations.json>`. The job logs and the Pull
   Request comments say nothing about the view the release manager actually reads.
5ter-bis. **Check the single Pull Request modal tabs** (runbook section 4ter): `check-pr-modal.cjs` on
   every repository whose Pull Requests carry comments (the sections repository and the CI one), once
   their sections are over. Deployment Actions, Validation, Code Quality and Deployment must show what
   the provider holds, for merged Pull Requests as much as open ones. Never skip it: a comment that
   exists and does not show in the modal is invisible to every other check.
5bis-bis. **Run the deployment actions section** (runbook section 6quater): `deployment-actions-run.sh`,
   after `promotion-run.sh`. It turns `failValidationOnPendingManualActions` on (off by default),
   checks that a pre-deployment manual action stops the validation (not on a draft), the retry of
   a failed action, `set-status` here and ahead in the next branch, the forecast of the next promotion, and, with `DEV_ORG`, the runs in a developer org.
5bis-ter. **Run the same features through real CI** (runbook section 6quinquies):
   `ci-workflows-run.sh`, with its own `REPO`, `WORK` and `LOGS`. The simulators prove the CLI; this
   proves the workflows a project really runs, with the branch linked by `sf plugins link`.
5bis-quater. **Run the identical actions section** (runbook section 6sexies): `identical-actions-run.sh`,
   after `promotion-run.sh`. Eight stories promoted together to uat: the action they share runs once
   (the counter file says how many times it really ran), an action written twice in one story runs
   twice, a reused id runs for each story, and a copy met after a failure is recorded as done. Then
   the backpromote of that window, the same action in the branch config and in a story, and the
   validation job running an action with context `all`.
5quater. **Run backpromote (Beta)** (runbook section 6bis): `backpromote-setup.sh` then
   `backpromote-steps.sh`, against scratch orgs created from the Dev Hub. Steps B0 to B16: no git
   provider token, refused orgs (major branch org, production), refused parent branch, the first plan
   with no history and its progress file, the run from S1 with the deployment actions and the
   "Backpromotes" comments, up to date and a manual action confirmed, the default start after a new
   story, a file that differs overwritten, the org version kept then offered again, the agent protocol
   (`waitingForMerges`, solve, run again, branch pushed), the panel protocol (`--prepare`, refused
   while markers remain, run), a deletion skipped then applied, an excluded item that comes back, a
   dirty working tree stashed, a refreshed sandbox (same name, other org id), the scan limit and the
   reset. Assert each JSON document with `backpromote_check` and the comments with
   `backpromote_comments_check` (C1 to C4).
6. **Check the diagram rule**: `node scripts/check-diagram.cjs <owner>/<repo> integration,uat,preprod,main`
   (`check-diagram-gitlab.cjs` / `check-diagram-azure.cjs` / `check-diagram-bitbucket.cjs` for the
   other three providers).
7. **Run the flag-off A/B regression check** (runbook section 7ter). `TOTAL DIFFERING LINES: 0`,
   or 1 when a merged branch is named `promotion/...`.
8. **Write the report** in this skill's `reports/` folder, one per provider:
   `.claude/skills/promotion-branches-e2e/reports/promotion-branches-e2e-report-github.md`,
   `…-gitlab.md`, `…-azure.md` and `…-bitbucket.md`. Never write them at the repository root.
   Pipeline under test, the stories, the promotions performed, a table per test group with expected
   versus result (backpromote steps B0 to B9 included), what the run found, what it did not cover,
   and the suite counts. Overwrite the previous reports.

## Rules for the run

- **Fix what you find, inside the run.** Every previous run found real defects. When a job log
  disagrees with the runbook, decide which one is wrong: fix the product, or fix the runbook and
  say so in the report.
- **Be autonomous.** Do not stop to ask whether to continue.
- **Report honestly.** A check that could not be run is "not covered", never "OK". The report's
  "What this run did not cover" section is not optional.
- **Update the runbook** whenever you hit a trap that cost you time, so the next run does not.

## Known gaps of every run so far

State them again in the report unless you close them:

- The four providers were all run live on 2026-09-07 and 2026-09-08; GitHub and GitLab again on
  2026-09-13, with sections 3, 4 and 6 scripted. Bitbucket has not been run since 2026-09-08. Since
  2026-10-08 the Atlassian API token of `.env` (`ATLASSIAN_TOKEN` / `ATLASSIAN_EMAIL`) is valid in
  the workspace `sfdxhardistest`: `GET /user`, the workspace repositories, its project `TES` and
  `git ls-remote` as `x-bitbucket-api-token-auth` answer. Repository creation is still unproven
  until the next run tries it.
- The four pipeline levels share one Salesforce org, so deployment action state is keyed by org
  **branch**, not by distinct orgs.
- The pipeline webview is exercised through its own data provider (section 4bis), its compiled
  helpers and its unit tests, not by clicking: the mermaid is asserted as text, never rendered.
- Backpromote (Beta) ran on GitHub and GitLab (2026-09-13). Its Bitbucket and Azure DevOps hooks
  exist in the libraries but have never run. Its VS Code panel is not clicked: the panel reads the
  same `--json` documents the run asserts, and its command builder, greying rules and marker watch
  are unit tested. The terminal prompts of step B17 are only covered when someone answers them by
  hand. The retry of a comment read after a dropped connection only runs when the provider drops one.
- Section 6sexies (identical actions, sfdx-hardis#2271) ran on GitHub and GitLab on 2026-10-04,
  twice on GitHub (`IA_RUN=2`), and W9 ran it through real GitHub Actions. Identical copies of custom
  function actions with outputs, and of actions with a `customUsername`, are unit tested only.
- The single Pull Request window (section 4ter, since 2026-10-07) is checked through the calls the
  extension makes, not rendered. Its Code Quality tab is never exercised: nothing in the run posts a
  MegaLinter comment. The window of a promotion or major-to-major Pull Request is not compared.
- Azure DevOps has not run since 2026-09-09. The PAT of `.env` (`AZURE_PERSONAL_ACCESS_TOKEN`)
  works again on 2026-10-08: it can create and delete repositories, contribute, create branches and
  contribute to Pull Requests in `nicolasvuillamy/tests-sfdx-hardis`. It is custom scoped, so
  Variable Groups, Service Connections and Graph answer 401, which the run does not need.
- Since 2026-10-08 `scripts/promotion-provider.sh` maps the four providers, so sections 4, 4bis,
  4ter, 6, 6bis, 6quater and 6sexies are scripted on Azure DevOps and Bitbucket too, but none of them
  has run there yet: the first run on each will find what syntax checks cannot (provider timing,
  API answers). Section 6quinquies (real CI) stays GitHub Actions only: no Azure Pipelines or
  Bitbucket Pipelines workflow is generated for it.
- Bitbucket Cloud has no merge ref: its validation job merges the target into the source itself, as
  a `pull-requests:` pipeline does, so a stale-ref defect cannot show there. Its merge job finds the
  Pull Request through the branch search fallback, since the "Pull Request Commit Links" app is not
  installed in the test workspace.

$ARGUMENTS
