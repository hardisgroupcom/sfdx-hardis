# Promotion branches with replacement rules and deployment actions: end to end test

Proves that the three features work together, in real CI jobs (GitHub Actions or GitLab CI) running
sfdx-hardis built from the branch under test: stories carrying replacement rules and deployment
actions are promoted `integration -> uat -> preprod -> main` with promotion branches, and after every
deployment job the org is read. About 1h30 per provider, most of it waiting for the 12 CI jobs.

Each feature has its own scenario ([promotion-branches](../promotion-branches/README.md),
[replacement-rules](../replacement-rules/README.md), [deployment-actions](../deployment-actions/README.md)).
This one only proves what none of them can: what happens where they meet.

- A promotion validation and deployment use the rules of the **target** of the promotion (the
  branch file of uat, the issue value of preprod, the include and exclude filters, the secret of the
  branch), never the ones of the branch the stories came from.
- A rule added by a story travels with it; a rule change of a story that is not promoted does not.
- The deployment actions of the stories travel with each promotion and run once per org branch.
- Pre-deployment actions run before the rules (a command sees the files of git, a removal from
  `package.xml` takes a file out of reach of the rules); post-deployment actions run after the files
  are put back, and an Apex action reads the replaced value in the org.
- No secret value reaches a job log or a Pull Request comment, at any level.

## What this scenario contains

| File                           | Use                                                                                                                                                                                      |
|--------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `scripts/pra-e2e.sh`           | The run: steps `org repo s1 s2 s3 uat preprod main extension report`, one line per assertion in `$LOGS/results.txt`, `$LOGS/report.md`.                                                  |
| `scripts/pra-build-project.sh` | The sample project: promotion branches and delta deployments on, the rules, the labels and the Apex class they change. Its header has the table of the value each rule gives per branch. |
| `reports/`                     | One report per run and provider (copy `$LOGS/report.md` there, named `<date>-<run>.md`).                                                                                                 |

It reuses the CI harness of the promotion-branches scenario: `env-lib.sh`, `ci-workflows-prepare.cjs`,
`ci-provider-<provider>.sh` (create the remote, wait for a job), `promotion-provider.sh` (open, merge,
promote, `p_cli`), `section-lib.sh` (`assert_log`, `status_check`, `promo_number`).

## Prerequisites

- Those of the promotion-branches real CI section (`preflight.sh --provider <p>` passes): `gh auth
  login`, or `GITLAB_E2E_HOST` / `GITLAB_E2E_GROUP` and a glab token, an online GitLab runner.
- A Dev Hub with one free scratch org per provider run (`DEVHUB`). Check with
  `sf limits api display -o <hub>`: `ActiveScratchOrgs`. The default `DevHub` is often full; the
  `E2E_ORG` of `.env` is a Dev Hub too.
- The branch under test pushed to `hardisgroupcom/sfdx-hardis`.

## Run it

```sh
DEVHUB=<hub> PROVIDER=github bash .claude/skills/e2e/scenarios/promotion-rules-actions/scripts/pra-e2e.sh
DEVHUB=<hub> PROVIDER=gitlab bash .claude/skills/e2e/scenarios/promotion-rules-actions/scripts/pra-e2e.sh
# replay steps of a run: its numbers are in $LOGS/pra-vars.sh and $LOGS/ci-vars.sh
PROVIDER=github RUN=pra-e2e-github-1 STEPS="main extension report" bash .../pra-e2e.sh
```

`PRA_TEST_LEVEL=RunLocalTests` adds a test class to S1 and makes every validation quick-deployable:
each deployment job must then quick deploy the validation of its target (`<label>-QUICK` checks).
With the default `NoTestRun`, Salesforce refuses the quick deploy and every job falls back to a full
deployment: run both modes, they are the two paths a real pipeline takes.

The two providers can run at the same time: each has its scratch org (`pra-e2e-<provider>`), its
repository and its folders (`<OS temp>/<run>` and `<run>-logs`). Run them in the background and watch
the `| FAIL |` lines. A replayed check adds a line; the report keeps the last one of each id.

## What each step proves

| Step        | Proves                                                                                                                                                                                                                                                                                                 |
|-------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `org`       | A scratch org for the four branches; one secret value per branch, never printed.                                                                                                                                                                                                                       |
| `repo`      | The project, the CI files linking the branch under test, `PRA_SECRET_<BRANCH>` as secrets or CI/CD variables, the preprod value of `pra-issue` in the git provider issue (`replacement:update --layer issue`).                                                                                         |
| `s1`        | A story touching every label and the Apex class, with four actions made by `action:create --agent`: a pre command (context all) and a post command that print whether they see the files of git, an Apex script writing the label value it reads, a manual step. The integration values reach the org. |
| `s2`        | A story adding a label and the rule for it in `config/.sfdx-hardis.yml`, with a removal of the Apex class from `package.xml` for main only. The new rule applies in its own validation; the removal does not run outside main.                                                                         |
| `s3`        | A story changing the default value of `pra-issue`, never promoted: integration gets `s3-value`, the other branches never do.                                                                                                                                                                           |
| `uat`       | Promotion of S1 and S2: the promotion branch holds the rule of S2 and not the value of S3; validation and deployment use the uat branch file value and `pra-uat-only`; the actions of S1 run in uat; their statuses.                                                                                   |
| `preprod`   | The issue value and the preprod value of the story rule; `pra-uat-only` no longer applies (the org gets the git value back).                                                                                                                                                                           |
| `main`      | `pra-not-main` excluded (git value back); the main-only removal takes the Apex class out of the deployment, so `pra-apex-host` finds nothing and the org keeps the preprod host.                                                                                                                       |
| `extension` | The Pull Request modal tabs (`check-pr-modal.cjs`) and the DevOps Pipeline (S3 alone in integration, no open promotion).                                                                                                                                                                               |
| `report`    | `$LOGS/report.md`, with the CI jobs table.                                                                                                                                                                                                                                                             |

## Traps

- The four branches share one org: each org check reads the values the last deployment left, so the
  checks must run right after their deployment job, never batched at the end.
- Delta deployments (also between major branches): a label is only deployed, and only changed by a
  rule, when the promotion carries a change of it. S1 touches every rule-bound item for that reason;
  a story that touches nothing a rule covers proves nothing about the rule.
- The commands print a word built at run time (`GIT""_VALUE`): the command text itself is in the log,
  and must never satisfy the assertion.
- Account `Site` holds what the Apex action read: a long text field (`Description`) cannot be filtered
  in SOQL.
- GitHub secrets reach a step only through its `env`: the run maps `PRA_SECRET_<BRANCH>` in both
  workflows. GitLab CI/CD variables reach the jobs as they are.
- The clone is made with `core.autocrlf false`: on Windows git would otherwise check the files out
  with CRLF, and an edit that looks for `
` silently does nothing (run 1 shipped S2 without its
  label that way). Every story edit is checked before its commit, and the run stops if one did not apply.
- `sf org display` of a scratch org says `"status": "Active"`, without `connectedStatus`: test both,
  or the org step logs out a live org and then hits the Dev Hub limit.
- A GitLab job that fails with `ENOSPC` / `no space left on device` ran on a shared runner whose disk
  was full (seen at night, while other projects run their nightly jobs). The run retries such a job
  up to twice and records a SKIP line `<label>-INFRA-<n>` for each retry; a retried job that passes
  is a proof, the SKIP line says the first attempt was not one.
- Stopping a background run of the harness does not always stop the bash script under it: find it by
  its `RUN` (`/proc/<pid>/environ`) and kill its process tree, or it keeps merging and deploying.
- Never edit `pra-e2e.sh` while a run reads it. To run two variants at once, run each from a copy
  in the same folder (`pra-e2e-run-<name>.tmp.sh`, removed afterwards).
- After the run, delete the repository and the scratch org (`sf org delete scratch -o pra-e2e-<provider> --no-prompt`)
  once the reports are written, unless the user wants to look at them.
