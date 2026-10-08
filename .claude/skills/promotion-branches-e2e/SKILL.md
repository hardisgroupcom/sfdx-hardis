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

| File                                      | Use                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
|-------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `reference/runbook.md`                    | The full procedure: repository layout, the six User Stories, the run order, what to assert in each log, the edge cases, the traps. **Read it before starting.**                                                                                                                                                                                                                                                                                                             |
| `scripts/build-repo.sh`                   | Writes the base project, the four major branches and the config. Provider agnostic.                                                                                                                                                                                                                                                                                                                                                                                         |
| `scripts/stories.sh`                      | `story_branch` and `story_actions`: the six User Stories and the action files that travel with them. Provider agnostic.                                                                                                                                                                                                                                                                                                                                                     |
| `scripts/e2e-lib.sh`                      | GitHub job simulators: `e2e_check`, `e2e_deploy`, `e2e_promote`, `e2e_release_notes`, `e2e_grep`. Source it.                                                                                                                                                                                                                                                                                                                                                                |
| `scripts/e2e-lib-gitlab.sh`               | The same for GitLab, plus `gl_mr_create`, `gl_mr_merge` and the merge-ref wait GitLab needs.                                                                                                                                                                                                                                                                                                                                                                                |
| `scripts/e2e-lib-azure.sh`                | The same for Azure DevOps (`az_*`), plus `az_pr_create`, `az_pr_merge`, `az_pr_abandon` and the merge-ref wait. `AZ_TOKEN` defaults to `AZURE_PERSONAL_ACCESS_TOKEN` (environment, then `.env`), `AZ_REPO_ID` is read by name when empty.                                                                                                                                                                                                                                   |
| `scripts/e2e-lib-bitbucket.sh`            | The same for Bitbucket Cloud (`bb_*`), plus `bb_pr_create`, `bb_pr_merge`, `bb_pr_decline`, `bb_remote_url` and the checkout of a Pull Request merge (Bitbucket has no merge ref). `BB_TOKEN` / `BB_EMAIL` default to `ATLASSIAN_TOKEN` / `ATLASSIAN_EMAIL` (environment, then `.env`); `BB_WORKSPACE` is always required.                                                                                                                                                  |
| `scripts/check-pipeline.cjs`              | Drives the extension's own PipelineDataProvider against the test repository and asserts what the DevOps Pipeline shows at a point of the run.                                                                                                                                                                                                                                                                                                                               |
| `scripts/check-pr-modal.cjs`              | Makes the calls of the single Pull Request modal (`action:list --with-status --with-workflows` with the token only, the extension's `completePullRequestsWithActions`) for every open and merged Pull Request, and compares its Deployment Actions, Validation, Code Quality and Deployment tabs with the comments the provider holds (section 4ter). Reads the comments of the four providers (`PROVIDER=github|gitlab|azure|bitbucket`), or run it as `p_pr_modal_check`. |
| `scripts/check-diagram.cjs`               | Feeds the extension's compiled helpers with the real Pull Requests and asserts the "single place in the diagram" rule.                                                                                                                                                                                                                                                                                                                                                      |
| `scripts/check-diagram-gitlab.cjs`        | The same, reading merge requests from the GitLab API.                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `scripts/check-diagram-azure.cjs`         | The same, reading Pull Requests from the Azure DevOps API.                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `scripts/check-diagram-bitbucket.cjs`     | The same, reading Pull Requests from the Bitbucket Cloud API.                                                                                                                                                                                                                                                                                                                                                                                                               |
| `scripts/check-backpromote-plan.cjs`      | Asserts a `hardis:work:backpromote ... --json` document (plan version 3: plan, prepare, run, confirm, reset) against the expectations of `reference/backpromote/*.json` (section 6bis).                                                                                                                                                                                                                                                                                     |
| `scripts/check-backpromote-comments.cjs`  | Asserts the "Backpromotes" Pull Request comments of a `dump_pr_comments` dump: one comment per Pull Request, its sandbox rows and action rows (section 6bis, C1 to C4).                                                                                                                                                                                                                                                                                                     |
| `scripts/check-backpromote-identical.cjs` | Asserts the identical actions of a backpromote `--plan --json` document or run result: `identicalTo`, one key per action, the outcome of each key (section 6sexies).                                                                                                                                                                                                                                                                                                        |
| `scripts/promotion-provider.sh`           | Provider neutral job names (`p_check`, `p_deploy`, `p_promote`, `p_open`, `p_merge`, `p_wait_merge_ref`, `p_pr_modal_check`...) over the GitHub, GitLab, Azure DevOps or Bitbucket library, picked with `PROVIDER=github|gitlab|azure|bitbucket`. The section scripts below call nothing else, so they run on the four.                                                                                                                                                     |
| `scripts/promotion-run.sh`                | Sections 3, 4 and 4bis scripted: the six stories, the four promotions, the release notes, the retrofit, an assertion per job log and a pipeline check per step.                                                                                                                                                                                                                                                                                                             |
| `scripts/promotion-edge.sh`               | Section 6 scripted in five groups (`g1` to `g5`) that build on each other, run after `promotion-run.sh`.                                                                                                                                                                                                                                                                                                                                                                    |
| `scripts/deployment-actions-run.sh`       | Section 6quater scripted: the manual action gate of validations, a failed action retried with `action:run`, `set-status` (also ahead in the next branch), the promotion forecast and the developer org runs. After `promotion-run.sh`.                                                                                                                                                                                                                                      |
| `scripts/identical-actions-run.sh`        | Section 6sexies: an action shared by several stories runs once in the promotion to uat; a repeat inside one story, another phase, a reused id, a copy after a failure, the forecast, the re-run, the branch config, the validation job, the backpromote. After `promotion-run.sh`.                                                                                                                                                                                          |
| `scripts/section-lib.sh`                  | The assertion helpers of the section scripts (`record`, `assert_log`, `job`, `cli`, `status_check`, `open_story`). Sourced by `deployment-actions-run.sh` and `identical-actions-run.sh`.                                                                                                                                                                                                                                                                                   |
| `scripts/check-action-status.cjs`         | Asserts an `action:list --with-status [--forecast] [--with-backpromotes] --json` document: statuses, notes, forecasts and the identical action of a copy, the promotion carried, Backpromotes rows.                                                                                                                                                                                                                                                                         |
| `scripts/ci-workflows-prepare.cjs` | The CI files of the real CI section, per provider (`--provider github|gitlab|azure|bitbucket`): the sfdx-hardis templates plus a step that links the branch under test, and the `SFDX_AUTH_URL_<BRANCH>` logins. Parses every file back and checks it; the Bitbucket file is also validated against Atlassian's JSON schema. Details per provider in its header. |
| `scripts/ci-workflows-run.sh` | Section 6quinquies: the gate, the checkbox, a real draft, the deployment, the promotion and its forecast, the same action in two stories, then the PR modal and pipeline checks, run by REAL CI jobs in a repository of its own. `PROVIDER=github|gitlab|azure|bitbucket`, everything else from `.env`. Provider neutral: it calls the `ci_*` functions of `ci-provider-<provider>.sh`. Each job is recorded as "real CI" or "simulated (...)" in the result lines and in `$LOGS/ci-jobs.tsv`, with its queue time apart from its run time. |
| `scripts/ci-provider-github.sh` | The GitHub Actions side of section 6quinquies: create the repository with Actions off, secrets, wait for a workflow run, re-run it, tick a checkbox. Its header lists the `ci_*` interface a new provider implements. `REPO` is picked when not set. |
| `scripts/ci-provider-gitlab.sh`           | The GitLab CI side: the project in `GITLAB_E2E_GROUP` on `GITLAB_E2E_HOST` (environment, then `.env`), CI/CD variables, a project access token as `CI_SFDX_HARDIS_GITLAB_TOKEN`, pushes with `ci.skip`, CI lint, waits on merge request and push pipelines, job retry, job traces without colors.                                                                                                                                                                           |
| `scripts/ci-provider-azure.sh` | The Azure Pipelines side: the repository, the two pipeline definitions and their secret variables through REST, a preview of both before any job, the permission of the build service, a build validation policy on each major branch, waits that tolerate the single free parallel job (queue time logged apart), re-queue of the policy, cancel of superseded builds. `AZURE_E2E_CI_TOKEN=system|pat`. |
| `scripts/ci-provider-bitbucket.sh` | The Bitbucket Pipelines side: the repository, Pipelines turned on through the API, secured repository variables, waits on pull request and branch pipelines, and the build minutes fallback: once the free minutes are used up, every remaining job runs through `bb_check` / `bb_deploy` on the same Pull Request and is recorded as "simulated (build minutes used up)". |
| `scripts/env-lib.sh`, `scripts/env-lib.cjs` | Settings for every script: the environment, else `.env` at the root of the working copy, else defaults derived from where the skill sits (`ORG` from `E2E_ORG`, `DEV`, `EXT`, `WORK` / `LOGS` / `EXPECT` under the OS temp dir). No path of a computer is written in the skill. |
| `scripts/preflight.sh` | Read-only check of a computer before a run: tools, working copies, `.env`, logins and tokens of each provider, GitLab runners, Salesforce orgs. OK / MISSING / WARN per item and the command that fixes each MISSING. `--provider <p>` for one provider. |
| `reference/env.example` | Every variable the skill reads, by provider: what it is for, where to get it, required or optional. Names only. |
| `scripts/timing-report.cjs`               | Performance tables of a run: `timings.tsv` (every job and backpromote call) and the backpromote progress files, median and worst per step, slowest calls.                                                                                                                                                                                                                                                                                                                   |
| `scripts/ab-run.sh`                       | Runs the same CI jobs with a given CLI checkout and stores the logs.                                                                                                                                                                                                                                                                                                                                                                                                        |
| `scripts/ab-run-gitlab.sh`                | The same on GitLab.                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `scripts/ab-run-azure.sh`                 | The same on Azure DevOps.                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `scripts/ab-run-bitbucket.sh`             | The same on Bitbucket Cloud.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `scripts/audit-pr-comments.cjs`           | The Pull Request comment audit, shared by the four providers. Fed by the `dump_pr_comments` of each library.                                                                                                                                                                                                                                                                                                                                                                |
| `scripts/check-comments-visual.cjs`       | The visual check of the Pull Request comments (section 5quater): one comment of every type the run produced, opened as the provider draws it, pictured folded and unfolded, its DOM compared with its source (tables, folded sections, checkboxes, images, no markdown left as text). Azure DevOps and Bitbucket through a Chrome with remote debugging, logged in; GitHub and GitLab through their markdown API, headless. |
| `scripts/ab-diff.py`                      | Normalises two log folders and diffs them: the flag-off regression proof.                                                                                                                                                                                                                                                                                                                                                                                                   |

## Before starting

**On a new computer, first** (runbook section 0):

1. Copy the `.env` of the computer that already runs the test to the root of the sfdx-hardis working
   copy. It holds every setting and token; `reference/env.example` names them.
2. Do the logins `.env` cannot carry: `gh auth login`, `glab auth login --hostname <GITLAB_E2E_HOST>`,
   `sf org login web --alias <E2E_ORG>`; `yarn install` here; clone vscode-sfdx-hardis next to this
   working copy on the matching branch and `yarn install && yarn compile` there.
3. Run `bash .claude/skills/promotion-branches-e2e/scripts/preflight.sh` (add `--provider <p>` for
   one provider). It is read-only and prints, for each MISSING item, the command that fixes it.
   Fix and run it again until nothing is MISSING. Run it before every run on any computer: it also
   catches an expired token, a stopped GitLab runner or an extension that is not compiled.

Ask the user only for what preflight and `.env` do not answer:

- which **providers** to run, when they have not said. GitHub alone is the quick pass; each of
  GitLab, Azure DevOps and Bitbucket Cloud is the only way its own provider code gets exercised;
- the **repository name**, if they care. Otherwise it is picked, incrementing `<n>` past the ones
  that exist: `<gh login>/sfdx-hardis-promo-e2e-<n>` on GitHub, `<user>/sfdx-hardis-promo-e2e-gl-<n>`
  on GitLab, `sfdx-hardis-promo-e2e-az-<n>` in `AZ_PROJECT` of `AZ_ORG`,
  `sfdx-hardis-promo-e2e-bb-<n>` in `BB_WORKSPACE` (project `BB_PROJECT_KEY`). The real CI section
  picks its own (`-ci-<n>`, `-ci-gl-<n>`, `-ci-az-<n>`, `-ci-bb-<n>`);
- for backpromote (Beta), a **Dev Hub** when `E2E_ORG` is not one (`DEVHUB` in `.env`): backpromote
  refuses production orgs and major branch orgs, and a scratch org tracks its sources, which is what
  the "pending org changes are saved first" step needs.

Check yourself the sfdx-hardis branch under test (it must be pushed for real CI, whose jobs clone
it) and that the vscode-sfdx-hardis working copy is on the matching branch. A read-only proof of the
Azure and Bitbucket wiring, without creating anything, is in runbook section 8quater.

**Never reuse a previous test repository.** Each run starts from a fresh private repository, so a
failure cannot be an artefact of the previous run's state.

## Process

1. **Read `reference/runbook.md` in full.** It holds the decisions that make the run meaningful
   (development branch named `integration` so stories arrive through a child branch,
   `hardis-report/` deliberately not gitignored, one static resource per story, never squash).
2. **Pick the provider and name the repository**. Nothing else is exported: `ORG`, `DEV`, `EXT`,
   `API`, `WORK`, `LOGS` and `EXPECT` come from `.env` and `scripts/env-lib.sh` (the work folders
   are `<OS temp dir>/promo-e2e-<provider>`, `-logs` and `-expect`, and must not exist yet).

   ```bash
   export PROVIDER=github REPO="<owner>/sfdx-hardis-promo-e2e-<n>"        # GitHub
   export PROVIDER=gitlab PROJECT_ID=<id> PROJECT_PATH=<group/name> GL_HOST=https://<host> GL_TOKEN="$(glab config get token --host <host>)"
   export PROVIDER=azure AZ_REPO_NAME="sfdx-hardis-promo-e2e-az-<n>"      # AZ_ORG, AZ_PROJECT, token: .env
   export PROVIDER=bitbucket BB_REPO="sfdx-hardis-promo-e2e-bb-<n>"       # BB_WORKSPACE, token: .env
   source .claude/skills/promotion-branches-e2e/scripts/promotion-provider.sh   # the job simulators, by hand
   ```

   Create the repository as runbook sections 2, 8, 8bis and 8ter say, then the scripted sections
   (`promotion-run.sh`...) run with those same variables. The real CI section needs less, it creates
   its repository itself:

   ```bash
   PROVIDER=<github|gitlab|azure|bitbucket> bash .claude/skills/promotion-branches-e2e/scripts/ci-workflows-run.sh
   ```

   | Section                                    | GitHub | GitLab | Azure DevOps | Bitbucket Cloud |
   |--------------------------------------------|--------|--------|--------------|-----------------|
   | 3, 4, 4bis `promotion-run.sh`              | yes    | yes    | yes          | yes             |
   | 6 `promotion-edge.sh g1..g6`               | yes    | yes    | yes          | yes             |
   | 6quater `deployment-actions-run.sh`        | yes    | yes    | yes          | yes             |
   | 6sexies `identical-actions-run.sh`         | yes    | yes    | yes          | yes             |
   | 6bis `backpromote-setup.sh` / `-steps.sh`  | yes    | yes    | yes          | yes             |
   | 4ter `check-pr-modal.cjs`                  | yes    | yes    | yes          | yes             |
   | 7bis `check-diagram*.cjs`                  | yes    | yes    | yes          | yes             |
   | 6quinquies `ci-workflows-run.sh` (real CI) | yes    | yes    | yes          | yes, then simulated |

   "yes" for Azure DevOps and Bitbucket means scripted and checked for syntax and wiring on
   2026-10-08, not run live yet; so does "yes" for real CI (6quinquies) on GitLab, Azure DevOps and
   Bitbucket: see "Known gaps". Bitbucket real CI uses the free build minutes of the workspace, then
   runs the remaining jobs through the simulator and says so job by job.

3. **Build the repository and the stories** (runbook sections 2 and 3).
4. **Run the pipeline** (runbook section 4), asserting each log as you go with `e2e_grep`. Do not
   batch the assertions to the end: a wrong scope early makes every later log meaningless.
5. **Run the edge cases** (runbook section 6). These are where the defects have been.
5bis. **Audit the Pull Request comments** (runbook section 5bis). The job logs say what the command
   decided; the audit says what the reviewer reads. Four of the defects of 2026-09-08 came from it,
   and none of them was visible in a job log.
5bis-vis. **Look at the comments as the provider draws them** (runbook section 5quater):
   `check-comments-visual.cjs <comments.json> <out dir>` on every repository whose Pull Requests carry
   comments (sections, backpromote, real CI), then **read every picture it wrote**. The audit reads
   the markdown; only this sees a table left in pipes, a folded section that does not fold or a
   checkbox drawn as `[ ]`. Azure DevOps and Bitbucket need a Chrome started with
   `--remote-debugging-port=9222` and a profile of its own, logged in to the provider: ask the user
   to log in there before the run when they will be away. No Chrome, or not logged in: "not
   covered" for that provider, never "OK".
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
   `PROVIDER=<p> bash ci-workflows-run.sh`, in a repository and work folders of its own, picked by
   the script. The simulators prove the CLI; this proves the CI files a project really runs, with
   the branch linked by `sf plugins link`. `github` (GitHub Actions), `gitlab` (GitLab CI, a project
   created in `GITLAB_E2E_GROUP` on `GITLAB_E2E_HOST`, whose group runners run the jobs), `azure`
   (Azure Pipelines: one free parallel job, the builds queue, count three to four hours) or
   `bitbucket` (Bitbucket Pipelines while the 50 free build minutes last, then the simulator). In
   the report, give each job its mode from `$LOGS/ci-jobs.tsv`: "real CI" or "simulated (build
   minutes used up)". A simulated job is not a proof of the CI file.
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
- **Start again by yourself after a memory stop.** When a section, a real CI wait or any background
  command is stopped because the computer is short on memory, do not end the run and do not wait
  to be asked: read the free memory, wait and read it again while it is short, then go on from the
  last completed step (`promo-vars.sh`, `bp-vars.sh` and `ci-vars.sh` hold the numbers a rerun
  needs; a section that cannot be resumed starts again on a new repository). Keep one heavy local
  run at a time while memory is short, and say in the report what was started again and why.
- **Commit as you go.** Every fix of the product or of the skill is committed on the branch under
  test when it is made, and pushed: the real CI jobs clone that branch, so a fix that is not pushed
  is not in what they run.
- **Never edit a section script while it runs**: bash reads it as it goes, and the run stops on a
  syntax error at whatever line the edit moved.
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
  API answers).
- Section 6quinquies (real CI) ran live on GitHub Actions only. Its GitLab CI side
  (`ci-provider-gitlab.sh`) was built on 2026-10-08 and checked for syntax, with read-only calls
  and the CI lint API (the generated files are valid, a push to `main` selects `deploy_to_org`
  only), but has never run a pipeline: the first run proves the runners (reaching github.com, npm
  and ghcr.io, the time of the link step), the masking of the auth URL, the project access token
  and its notes edited by the person running the test, the draft warning and W2 on a retried job.
  Azure Pipelines (`ci-provider-azure.sh`) and Bitbucket Pipelines (`ci-provider-bitbucket.sh`)
  were built on 2026-10-08 too and have never run either. Azure: the generated YAML was only parsed
  locally (no pipeline existed in the project to preview against; the run previews both definitions
  before its first job); to prove: the Build scope of the PAT, the free parallel job, the link step
  in a container job, the build service posting Pull Request threads (it had no Contribute to pull
  requests permission on 2026-10-08; the run tries to grant it), and W2, where the PAT user ticks a
  comment of the build service (`AZURE_E2E_CI_TOKEN=pat` when Azure refuses). Bitbucket: the file is
  valid against Atlassian's schema; to prove: the JSON state of a pipeline out of minutes (the
  fallback reads a `PAUSED` / `HALTED` stage or a minutes message), the cache of the link step,
  pipelines on a draft. With 50 minutes, most Bitbucket jobs of a run are simulated: say how many.
  The runbook lists these under "Unproven until the first run" for each provider.
- Portability (2026-10-08): no path of a computer is left in the scripts, `SKILL.md` or the runbook;
  `preflight.sh` passed on Windows (Git Bash). macOS and Linux are untested: the scripts only use
  `cygpath` when it exists, but `date -d` (GitLab project token expiry), `date +%s%3N` (timings) and
  `sed -i` are GNU forms that macOS needs `coreutils` / `gnu-sed` for.
- Bitbucket Cloud has no merge ref: its validation job merges the target into the source itself, as
  a `pull-requests:` pipeline does, so a stale-ref defect cannot show there. Its merge job finds the
  Pull Request through the branch search fallback, since the "Pull Request Commit Links" app is not
  installed in the test workspace.

$ARGUMENTS
