---
name: promotion-branches-e2e
description: Run the hardcore end to end test of the promotion branches feature against a real Salesforce org and a throwaway private GitHub, GitLab or Azure DevOps repository, then write the report. Use when promotion branches (enablePromotionBranches, hardis:project:promotion:create) changed and must be proven again, or when the user asks for the promotion branches end to end / hardcore test.
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

| File                               | Use                                                                                                                                                             |
|------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `reference/runbook.md`             | The full procedure: repository layout, the six User Stories, the run order, what to assert in each log, the edge cases, the traps. **Read it before starting.** |
| `scripts/build-repo.sh`            | Writes the base project, the four major branches and the config. Provider agnostic.                                                                             |
| `scripts/stories.sh`               | `story_branch` and `story_actions`: the six User Stories and the action files that travel with them. Provider agnostic.                                         |
| `scripts/e2e-lib.sh`               | GitHub job simulators: `e2e_check`, `e2e_deploy`, `e2e_promote`, `e2e_release_notes`, `e2e_grep`. Source it.                                                    |
| `scripts/e2e-lib-gitlab.sh`        | The same for GitLab, plus `gl_mr_create`, `gl_mr_merge` and the merge-ref wait GitLab needs.                                                                    |
| `scripts/check-pipeline.cjs`       | Drives the extension's own PipelineDataProvider against the test repository and asserts what the DevOps Pipeline shows at a point of the run.                    |
| `scripts/check-diagram.cjs`        | Feeds the extension's compiled helpers with the real Pull Requests and asserts the "single place in the diagram" rule.                                          |
| `scripts/check-diagram-gitlab.cjs` | The same, reading merge requests from the GitLab API.                                                                                                           |
| `scripts/ab-run.sh`                | Runs the same CI jobs with a given CLI checkout and stores the logs.                                                                                            |
| `scripts/ab-run-gitlab.sh`         | The same on GitLab.                                                                                                                                             |
| `scripts/ab-run-azure.sh`          | The same on Azure DevOps.                                                                                                                                       |
| `scripts/ab-run-bitbucket.sh`      | The same on Bitbucket Cloud.                                                                                                                                    |
| `scripts/audit-pr-comments.cjs`    | The Pull Request comment audit, shared by the four providers. Fed by the `dump_pr_comments` of each library.                                                    |
| `scripts/ab-diff.py`               | Normalises two log folders and diffs them: the flag-off regression proof.                                                                                       |

## Before starting

Ask the user only for what you cannot find yourself:

- the **Salesforce org** to deploy to (an authenticated org alias or username);
- the **repository slug** to create, if they care about the name. Otherwise pick
  `<gh login>/sfdx-hardis-promo-e2e-<n>`, incrementing `<n>` past the ones that already exist;
  on GitLab, `<user>/sfdx-hardis-promo-e2e-gl-<n>`; on Azure DevOps,
  `sfdx-hardis-promo-e2e-az-<n>` inside an existing team project;
- which **providers** to run, when they have not said. GitHub alone is the quick pass; each of
  GitLab and Azure DevOps is the only way its own provider code gets exercised.

Check yourself: `gh auth status`, `glab auth status`, the Azure DevOps PAT in `.env`
(`AZURE_PERSONAL_ACCESS_TOKEN`), `sf org list`, the sfdx-hardis branch under test, and whether the vscode-sfdx-hardis working copy is on the matching branch and compiled
(`yarn compile`), which the diagram check needs.

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
6. **Check the diagram rule**: `node scripts/check-diagram.cjs <owner>/<repo> integration,uat,preprod,main`
   (`check-diagram-gitlab.cjs` / `check-diagram-azure.cjs` for the other two providers).
7. **Run the flag-off A/B regression check** (runbook section 7ter). `TOTAL DIFFERING LINES: 0`,
   or 1 when a merged branch is named `promotion/...`.
8. **Write the report** in this skill's `reports/` folder, one per provider:
   `.claude/skills/promotion-branches-e2e/reports/promotion-branches-e2e-report-github.md`,
   `…-gitlab.md`, `…-azure.md` and `…-bitbucket.md`. Never write them at the repository root.
   Pipeline under test, the stories, the promotions performed, a table per test group with expected
   versus result, what the run found, what it did not cover, and the suite counts. Overwrite the
   previous reports.

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

- The four providers were all run live on 2026-09-07 and 2026-09-08. Bitbucket is the only one
  whose repository has to be reused between runs, because its access token is repository-scoped;
  see runbook section 8ter for the two artefacts that follow.
- The four pipeline levels share one Salesforce org, so deployment action state is keyed by org
  **branch**, not by distinct orgs.
- The pipeline webview is exercised through its own data provider (section 4bis), its compiled
  helpers and its unit tests, not by clicking: the mermaid is asserted as text, never rendered.

$ARGUMENTS
