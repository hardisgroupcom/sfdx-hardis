<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:action:set-status

## Description


## Command Behavior

**Records a failed (or stopped) deployment action as done by hand in an org branch.**

When an action failed during a deployment job and was then performed by hand, this command records it as done in the "Deployment Actions" comment of its Pull Request, so later deployments to that org do not run it again.

- The status becomes `success`, with a note such as "Failed in CI, then closed by hand by Jane Doe (jane@acme.com) on 2026-10-03 14:05 UTC."
- An action that failed, was not run because a previous action failed, or is a manual action waiting for someone, can be closed.
- An action with no status yet in a major branch (or skipped there) can be marked as done ahead of the deployment: before a promotion to preprod, for instance, mark the pre-deployment manual actions you already did there, and the validation and deployment jobs of preprod skip them. The note reads "Marked as done by Jane Doe (jane@acme.com) on 2026-10-03 14:05 UTC, before any deployment to preprod."
- With `--target-org` set to a developer org (and no `--org-branch`), the action is recorded as done in that org: a row of the "Backpromotes" comment of the Pull Request, for that sandbox and org id, so a backpromote or a run in that org skips it.
- With `--select-org`, the command asks where the action was done: a major branch where it is not done yet, or a developer org authenticated on this computer. The VS Code Deployment Actions tab uses it for **Mark as done in another org**. A manual action gets the note "Manual action marked as done by Jane Doe (jane@acme.com) on 2026-10-03 14:05 UTC."
- Its checkboxes in the "Failed actions" lists of the Pull Request comments are ticked.
- Closing an action does not run the actions its failure stopped: run them with [hardis:project:action:run](https://sfdx-hardis.cloudity.com/hardis/project/action/run/).
- Without `--pr` and `--action-id`, it proposes the recent Pull Requests whose actions failed in the org branch, then their failed actions.

Ticking the checkbox of a failed or manual action in a Pull Request comment does the same at the next sfdx-hardis job, without naming who ticked it.

See [Recover a failed action](https://sfdx-hardis.cloudity.com/salesforce-devops-work-on-user-story-deployment-actions/#recover-a-failed-action).

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:project:action:set-status --agent --pr 123 --action-id abc-123 --org-branch integration --status success
```

Required in agent mode:

- `--pr`, `--action-id`
- `--org-branch` or `--target-org`

<details markdown="1">
<summary>Technical explanations</summary>

- Reads the state of the Pull Request from its "Deployment Actions" comment, rewrites the entry of the action for the org branch, and runs the checkbox sync on the comments of the Pull Request.
- No org work is done. The org, when there is one, gives the Salesforce username written in the note, and the org branch when `--org-branch` is not passed.
- A git provider token is required.
</details>

<!-- training-links:start -->

## Learn by doing

The free [Salesforce DevOps with sfdx-hardis](https://sfdx-hardis-training.github.io) course runs this command, click by click, on an org of your own:

- [Lab 3.3 - Read the deployment log, and what .forceignore hides from it](https://sfdx-hardis-training.github.io/en/level-3-release-manager/3-3-deploy-to-integration-and-read-the-log/)

<!-- training-links:end -->


## Parameters

| Name              |  Type   | Description                                                                                                                   | Default | Required | Options |
|:------------------|:-------:|:------------------------------------------------------------------------------------------------------------------------------|:-------:|:--------:|:-------:|
| action-id         | option  | Id of the action                                                                                                              |         |          |         |
| agent             | boolean | Run in non-interactive mode for agents and automation                                                                         |         |          |         |
| debug<br/>-d      | boolean | Activate debug mode (more logs)                                                                                               |         |          |         |
| flags-dir         | option  | Import flag values from a directory.                                                                                          |         |          |         |
| json              | boolean | Format output as json.                                                                                                        |         |          |         |
| note              | option  | Text added to the note recorded with the status                                                                               |         |          |         |
| org-branch        | option  | Org branch the action was done in (ex: integration). Without it, the org branch of --target-org, or that developer org itself |         |          |         |
| pr                | option  | Number of the Pull Request the action comes from                                                                              |         |          |         |
| select-org        | boolean | Choose where the action was done: a major branch where it is not done yet, or a developer org authenticated on this computer  |         |          |         |
| skipauth          | boolean | Skip authentication check when a default username is required                                                                 |         |          |         |
| status            | option  | New status of the action                                                                                                      | success |          | success |
| target-org<br/>-o | option  | Username or alias of the target org.                                                                                          |         |          |         |
| websocket         | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                                                     |         |          |         |

## Examples

```shell
$ sf hardis:project:action:set-status
```

```shell
$ sf hardis:project:action:set-status --agent --pr 123 --action-id abc-123 --org-branch integration --status success
```


