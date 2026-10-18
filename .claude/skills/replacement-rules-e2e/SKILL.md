---
name: replacement-rules-e2e
description: Run the end to end test of replacement rules (Beta) - a scratch org, a throwaway private GitHub repository running the sfdx-hardis CI workflows built from the branch under test, and every rule pattern proven in the org (values per org, branch file override, secrets from CI variables, regex in Apex, XML removal, built-in Flow ends and unknown user permissions, issue override, warnings, default values of a developer deployment, preview and list). Use when replacement rules (replacementRules, hardis:project:replacement:*, the VS Code Replacement Rules panel, the built-in rules) changed and must be proven again, or when the user asks for the replacement rules end to end test.
argument-hint: "[run name] [steps]"
allowed-tools: Bash, Read, Grep, Glob, Edit, Write
user-invocable: true
model: opus
---

# Replacement rules: end to end test

Proves, against a real scratch org and real GitHub Actions jobs, that every pattern of replacement
rules does what the documentation says. About 35 minutes, most of it waiting for the two CI jobs
(each one clones, builds and links the sfdx-hardis branch under test).

The feature: `docs/salesforce-devops-config-replacement-rules.md`, the code in
`src/common/replacementRules/`, the engine entry `applyReplacementRules` (`ruleEngine.ts`).

## What this skill contains

| File                          | Use                                                                                                                                                                                                                                                                 |
|-------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `scripts/rr-e2e.sh`           | The run: steps `org repo issue check deploy assert-org preview local report`, one assertion per line of `$LOGS/results.tsv`, the report in `$LOGS/report.md`.                                                                                                       |
| `scripts/rr-build-project.sh` | The sample project: custom labels, an Apex class, a Permission Set holding a user permission no org has, a Flow with Winter '27 `<ends>`, `sourceApiVersion` 67.0, one rule per pattern in `config/.sfdx-hardis.yml`, an override in the `integration` branch file. |
| `reports/`                    | One report per run (copy `$LOGS/report.md` there, named `<date>-<run>.md`).                                                                                                                                                                                         |

It reuses the harness of the `promotion-branches-e2e` skill (same `.env`, same GitHub login):
`env-lib.sh` (settings), `ci-workflows-prepare.cjs` (the sfdx-hardis GitHub workflows plus a step
that clones, builds and links the branch under test, and the `SFDX_AUTH_URL_<BRANCH>` logins) and
`ci-provider-github.sh` (waits for a workflow run, saves its log).

## Prerequisites

- `gh auth login` with an account that can create private repositories.
- A connected Dev Hub (`DEVHUB`, default `DevHub`) with one free scratch org.
- The branch under test pushed to `hardisgroupcom/sfdx-hardis` (the CI jobs clone it).
- `node bin/dev.js` works in this working copy (`yarn install` done): the issue, preview, list and
  local deployment steps run the working copy.

## Run it

```sh
bash .claude/skills/replacement-rules-e2e/scripts/rr-e2e.sh
# replay some steps of a run (its settings are kept in $LOGS/run.env)
RUN=rr-e2e-1 STEPS="assert-org local report" bash .claude/skills/replacement-rules-e2e/scripts/rr-e2e.sh
```

Run it in the background (it takes more than ten minutes) and watch `[FAIL]` lines of its output.
Settings: `DEVHUB`, `RR_ORG` (scratch org alias, default `rr-e2e-int`, reused while active),
`SFDX_HARDIS_BRANCH` (default: current branch), `REPO` (default
`<gh login>/sfdx-hardis-rr-e2e-<n+1>`), `RUN` (folders `$TMP/<run>` and `$TMP/<run>-logs`).

## What each step proves

| Step         | Proves                                                                                                                                                                                                                                                                                                                                                                                                                                    |
|--------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `org`        | The scratch org exists (created for 2 days when missing); its auth URL logs the four major branches in.                                                                                                                                                                                                                                                                                                                                   |
| `repo`       | The sample project, the CI workflows of the branch under test, `RR_E2E_SECRET_INTEGRATION` mapped in the env of the sfdx-hardis steps, a private repository with `main integration uat preprod`, the secrets.                                                                                                                                                                                                                             |
| `issue`      | `hardis:project:replacement:update --layer issue` creates the "sfdx-hardis Replacement Rules" issue with an override; a `secret` in the issue is refused.                                                                                                                                                                                                                                                                                 |
| `check`      | Pull Request to `integration`: the validation job applies the rules of the target branch (each rule id in the log, built-in Flow ends and unknown user permissions included), restores the files, warns about the missing secret; the validation comment has the "Replacement rules for `integration`" section with the missing secret and the required rule warnings and the issue origin; the secret value is in no log and no comment. |
| `deploy`     | Merge: the deployment job succeeds, the secret value is in no log and no comment.                                                                                                                                                                                                                                                                                                                                                         |
| `assert-org` | Queries of the org: labels hold the branch file value, the single value, the secret, the issue value, the git value for the missing secret; Apex holds the replaced host (every match); the Permission Set is deployed despite its unknown user permission, ViewSetup removed for integration; the Flow with `<ends>` is deployed at API 67.0.                                                                                            |
| `preview`    | `hardis:project:replacement:preview` lists what each rule changes and writes nothing; `list` shows the issue override and never a secret value.                                                                                                                                                                                                                                                                                           |
| `local`      | `hardis:project:deploy:smart` from a feature branch on the developer's computer: the `default` values reach the org, the git value for a secret no local variable holds, ViewSetup kept (the rule is for integration only), files restored.                                                                                                                                                                                               |
| `report`     | `$LOGS/report.md`.                                                                                                                                                                                                                                                                                                                                                                                                                        |

A check that cannot run says SKIP with the reason, never OK.

## Traps

- The CI jobs build sfdx-hardis from GitHub: push the branch before the run, or the jobs test an older
  commit.
- GitHub masks secrets in job logs by itself: the secret checks prove that sfdx-hardis does not print
  the value elsewhere (Pull Request comments, list output), not the runner masking.
- `sourceApiVersion` 67.0 makes the deployment API version 67.0 (the lowest of the org, the project and
  the package.xml), so the built-in rule `builtin-flow-ends` must run even on a Winter '27 org.
- An expired scratch org may still answer `sf org display` with `Deleted`: the `org` step logs it out
  and creates a new one.
- Recent sf CLI versions hide secrets in `sf org display --verbose`: the auth URL comes from
  `sf org auth show-sfdx-auth-url` (the `org` step does it). A secret holding "[REDACTED] Use 'sf org
  auth show-sfdx-auth-url'..." makes the CI login fail with "You may have to define targetUsername".
- sf may print a warning (update available) before its JSON: parse from the first brace.
- Never edit `rr-e2e.sh` while it runs: bash reads the script as it goes, and the run breaks with
  "command not found" lines. Fix it after the run, then replay the steps with `RUN=<run> STEPS=...`.
- The GitHub search index lags behind a new issue: find the rules issue by listing open issues.
- A Permission Set deployed with ViewSetup can read false in a scratch org even with a plain
  `sf project deploy`: the include filter is checked in the logs, not in the org.
- The local deployment runs with `CI=true`, which skips the interactive org confirmation of
  `deploy:smart` (`--agent` would only validate).
- After the run, delete the repository (`gh repo delete <repo> --yes`) and the scratch org
  (`sf org delete scratch -o rr-e2e-int --no-prompt`) once the report is written, unless the user wants
  to look at them.
