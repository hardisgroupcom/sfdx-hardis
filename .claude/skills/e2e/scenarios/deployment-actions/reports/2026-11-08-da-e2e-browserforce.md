# Deployment action types e2e - 2026-11-08 (browser type, user-access-policy through Browserforce)

Branch under test: sfdx-hardis `feat/browser-deployment-action` (#2461), with Browserforce linked in every
CI job from `nvuillam/sfdx-browserforce-plugin` `feat/agent-harness-and-plugins-description` (amtrack/sfdx-browserforce-plugin#776),
since the Browserforce release with `plugins list`, the `apply --json` changes and `applyToAll` is not published yet.
Real GitHub Actions jobs, one scratch org (`da-e2e-int`).

## Runs

| Run | Repository           | Result                    | What it found                                                                                                                                                                                                                                                                                                                                                                                                                                         |
|-----|----------------------|---------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 1   | sfdx-hardis-da-e2e-4 | stopped                   | `sf browserforce apply --json` refused `--json` ("Nonexistent flag: --json"): `BrowserforceCommand.init()` parsed the base flags only. **Product defect, fixed in Browserforce** (88ae70f).                                                                                                                                                                                                                                                           |
| 2   | (none)               | stopped at `org`          | Harness: the reused scratch org reported its earlier deployments as source tracking conflicts. Fixed: the base project deploy passes `--ignore-conflicts`.                                                                                                                                                                                                                                                                                            |
| 3   | sfdx-hardis-da-e2e-5 | stopped                   | Apply To All: `locator('#apply_policy_btn')` resolved to 2 elements (top and bottom button rows of the classic page), Playwright strict mode refused the click. **Product defect, fixed in Browserforce** (364901d): first button. Proven locally against the org: a new `UserAccessChange` row and the permission set given back. The deployment rerun of this run, still running on GitHub after the stop, then applied the whole chain in real CI. |
| 4   | sfdx-hardis-da-e2e-6 | 57 OK, 8 FAIL             | Every action ran; 7 failures came from an empty `deploy.log` (`gh run view --log` answered nothing right after the run). **Harness fixed**: job logs read from the API when that happens. The 8th: run-batch launched no job because one completed less than 3 hours earlier in the reused org (as designed); the check now says SKIP with that reason.                                                                                               |
| 5   | sfdx-hardis-da-e2e-7 | **64 OK, 0 FAIL, 1 SKIP** | Clean. The org density was set back to Comfy before the run, so the browser action had a real change to make.                                                                                                                                                                                                                                                                                                                                         |

## What run 5 proves for the browser type and user-access-policy

- `action:create --agent --type browser --browser-setting densitySettings --browser-config '{"density":"${DA_E2E_DENSITY}"}'`: context `all`, the reference stored (not a value), the variables to declare per major branch in the result.
- Validation job: `Dry run: would change density to "****"`, nothing changed in the org, no policy activated.
- Deployment job: `Changed accessPolicies ... "active":true` (activate only), `Changed accessPolicies ... "applyToAll":true`, `Changed density to "****"` (the value of the secret `DA_E2E_DENSITY_INTEGRATION`, passed through the workflow env); the dry run of the validation did not count as run in the org.
- Rerun of the deployment job: both user-access-policy actions run again (every deployment), the browser action skipped as already run (once per org).
- In the org: policy Active, a new `UserAccessChange`, the permission set given back by Apply To All.

## Not covered

- The VS Code Browser editor (clicked by nobody here; its screenshots are reviewed in vscode-sfdx-hardis#610).
- The released Browserforce and the sfdx-hardis Docker image with Browserforce installed: both unpublished. CI used the released `sfdx-hardis-ubuntu:latest` image with the branches linked.
- `data` and `publish-community` (as in every run of this scenario).
- Run 5 reused the scratch org of runs 1 to 4, so run-batch's "completed less than 3 hours ago" rule applied (SKIP).

## Run 5 report

- sfdx-hardis branch: feat/browser-deployment-action (4e73149b5)
- repository: https://github.com/nvuillam/sfdx-hardis-da-e2e-7 (Pull Request #1)
- org: da-e2e-int
- result: 64 OK, 0 FAIL

| Check                                     | Result | Detail                                                                                                             |
|-------------------------------------------|--------|--------------------------------------------------------------------------------------------------------------------|
| ORG                                       | OK     | org da-e2e-int ready                                                                                               |
| PREPARE-DEPLOY                            | OK     | org reset before the DEPLOY job: policy Active, last access change 2026-11-08T03:37:48.000+0000                    |
| REPO                                      | OK     | repository nvuillam/sfdx-hardis-da-e2e-7, branches integration main preprod uat, 4 logins, Actions on              |
| CREATE-pre-command                        | OK     | action:create --agent pre-command                                                                                  |
| CREATE-pre-remove                         | OK     | action:create --agent pre-remove                                                                                   |
| CREATE-post-apex                          | OK     | action:create --agent post-apex                                                                                    |
| CREATE-post-run-batch                     | OK     | action:create --agent post-run-batch                                                                               |
| CREATE-post-schedule                      | OK     | action:create --agent post-schedule                                                                                |
| CREATE-post-uap                           | OK     | action:create --agent post-uap                                                                                     |
| CREATE-post-browser                       | OK     | action:create --agent post-browser                                                                                 |
| CREATE-post-manual                        | OK     | action:create --agent post-manual                                                                                  |
| REFUSE-PHASE                              | OK     | a user-access-policy action is refused before the deployment                                                       |
| REFUSE-FLAG                               | OK     | a run-batch flag is refused on another type                                                                        |
| YAML-UAP-ONCE                             | OK     | the user-access-policy action runs at every deployment                                                             |
| YAML-RUN-BATCH                            | OK     | run-batch parameters collected by its provider                                                                     |
| YAML-REMOVE                               | OK     | remove-packagexml-items items stored                                                                               |
| YAML-BROWSER-CONTEXT                      | OK     | the browser action runs in checks too                                                                              |
| YAML-BROWSER-VARIABLE                     | OK     | the variable reference is stored, not a value                                                                      |
| CREATE-BROWSER-VARIABLES                  | OK     | action:create lists the variables to declare per major branch                                                      |
| CHECK                                     | OK     | validation job succeeded                                                                                           |
| CHECK-PRE-COMMAND                         | OK     | pre command (context all) runs in the validation                                                                   |
| CHECK-REMOVE                              | OK     | remove-packagexml-items runs in the validation                                                                     |
| CHECK-NO-UAP                              | OK     | no policy activated nor applied by a validation                                                                    |
| CHECK-BROWSER-DRY-RUN                     | OK     | the browser action only read the org in the validation                                                             |
| CHECK-BROWSER-NOT-APPLIED                 | OK     | the validation changed no setting                                                                                  |
| CHECK-NO-PROJECT-ONCE                     | OK     | no deployment-only command in a validation                                                                         |
| CHECK-COMMENT-DA-E2E-pre-command          | OK     | action listed in the Pull Request comments                                                                         |
| CHECK-COMMENT-DA-E2E-remove-skipped-class | OK     | action listed in the Pull Request comments                                                                         |
| CHECK-COMMENT-DA-E2E-apex-account         | OK     | action listed in the Pull Request comments                                                                         |
| CHECK-COMMENT-DA-E2E-run-batch            | OK     | action listed in the Pull Request comments                                                                         |
| CHECK-COMMENT-DA-E2E-schedule-batch       | OK     | action listed in the Pull Request comments                                                                         |
| CHECK-COMMENT-DA-E2E-policy-apply-to-all  | OK     | action listed in the Pull Request comments                                                                         |
| CHECK-COMMENT-DA-E2E-browser-density      | OK     | action listed in the Pull Request comments                                                                         |
| CHECK-COMMENT-DA-E2E-manual-step          | OK     | action listed in the Pull Request comments                                                                         |
| DEPLOY                                    | OK     | deployment job succeeded                                                                                           |
| DEP-PRE-COMMAND                           | OK     | pre command run by the validation is not run again                                                                 |
| DEP-REMOVE                                | OK     | E2ESkipped removed from the deployment package                                                                     |
| DEP-PROJECT-ONCE                          | OK     | project command ran                                                                                                |
| DEP-PROJECT-UAP-RAN                       | OK     | project policy action (no runOnlyOnceByOrg key) ran                                                                |
| DEP-UAP-BROWSERFORCE                      | OK     | Browserforce activated the policy and applied it to all users in the CI container                                  |
| DEP-BROWSER                               | OK     | the browser action applied densitySettings                                                                         |
| DEP-BROWSER-NOT-SKIPPED                   | OK     | the dry run of the validation did not count as run                                                                 |
| DEP-SCHEDULE                              | OK     | schedule-batch scheduled the class                                                                                 |
| ORG-POLICY                                | OK     | policy Active after the deployment                                                                                 |
| ORG-UAC                                   | OK     | new UserAccessChange (2026-11-08T03:57:37.000+0000)                                                                |
| ORG-PSA                                   | OK     | Apply To All gave the permission set back (1)                                                                      |
| ORG-APEX-BATCH                            | SKIP   | apex created the account; run-batch launched no job, one completed in this org less than 3 hours ago (as designed) |
| ORG-CRON                                  | OK     | E2EBatch_Schedule scheduled (1)                                                                                    |
| ORG-SKIPPED                               | OK     | E2ESkipped not deployed (0)                                                                                        |
| DEP-COMMENT-MANUAL                        | OK     | manual step to do in integration, in the deployment comment                                                        |
| DEP-COMMENT-FAILED                        | OK     | no failed action in the comments                                                                                   |
| PREPARE-RERUN                             | OK     | org reset before the RERUN job: policy Active, last access change 2026-11-08T03:57:37.000+0000                     |
| RERUN                                     | OK     | deployment job rerun succeeded                                                                                     |
| RERUN-PRE-ONCE                            | OK     | pre command skipped: already run in the org                                                                        |
| RERUN-APEX-ONCE                           | OK     | apex action skipped: already run                                                                                   |
| RERUN-BATCH-ONCE                          | OK     | run-batch skipped: already run                                                                                     |
| RERUN-PROJECT-ONCE                        | OK     | project command (no runOnlyOnceByOrg key, once per org by default) skipped                                         |
| RERUN-PROJECT-UAP-RAN                     | OK     | project policy action (no runOnlyOnceByOrg key, every deployment for its type) ran again                           |
| RERUN-PR-UAP-RAN                          | OK     | PR policy action runs again                                                                                        |
| RERUN-UAP-APPLIED                         | OK     | Browserforce activated and applied the policy again                                                                |
| RERUN-BROWSER-ONCE                        | OK     | browser action skipped: already run in the org                                                                     |
| RERUN-ORG-PSA                             | OK     | permission set given back again (1)                                                                                |
| RERUN-ORG-POLICY                          | OK     | policy Active after the rerun                                                                                      |
| RERUN-ORG-UAC                             | OK     | new UserAccessChange (2026-11-08T04:04:58.000+0000)                                                                |
| RERUN-ORG-APEX                            | OK     | apex action not run twice (0)                                                                                      |
