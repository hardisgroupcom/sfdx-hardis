<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:action:run

## Description


## Command Behavior

**Runs one post-deployment action again, outside of a deployment job, after it failed or was stopped by a failure.**

When a post-deployment action fails after the merge of a Pull Request, the metadata is already deployed: re-running the whole deployment job is not needed. This command runs only the chosen action in the org, and records the result in the "Deployment Actions" comment of its Pull Request, with who ran it.

- The org branch comes from the org: the major branch whose `config/branches/.sfdx-hardis.<branch>.yml` has the same `instanceUrl`, or the current git branch for a dev org. With `--org-branch`, an org of that instance already authenticated on this computer is used.
- The action definition is read from the current checkout. When the org is a major org and the current branch is another one, the command warns and asks for confirmation.
- Without `--pr` and `--action-id`, it proposes the recent Pull Requests whose actions failed in the org branch, then their failed actions.
- An action with a `customUsername` runs as that user: when this computer is not authenticated with it, the command offers to log in with it, and checks the login used the right user.
- Once the action succeeds, it offers to run the actions its failure stopped: only the next one, or all of them.
- A pre-deployment action, or an action that only runs during validation jobs, cannot be retried.

Anyone authenticated to the org can retry an action, production included. A git provider token is required, to record the result in the Pull Request.

To close an action that was done by hand, use [hardis:project:action:set-status](https://sfdx-hardis.cloudity.com/hardis/project/action/set-status/). To fix a wrong definition, move the action to a fix Pull Request with `sf hardis:project:action:update --move-to-pr`.

See [Recover a failed action](https://sfdx-hardis.cloudity.com/salesforce-devops-work-on-user-story-deployment-actions/#recover-a-failed-action).

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:project:action:run --agent --pr 123 --action-id abc-123 --org-branch integration --next all
```

Required in agent mode:

- `--pr`, `--action-id`
- `--org-branch` or `--target-org`
- `--allow-branch-mismatch` when the current branch is not the org branch

Defaults applied: `--next none`. The confirmations are skipped with a warning. An action whose `customUsername` is not authenticated on this computer fails instead of prompting for a login.

<details markdown="1">
<summary>Technical explanations</summary>

- Loads the state of the Pull Request from its "Deployment Actions" comment, then runs the action with the same code as a deployment job (branch filters, references to the outputs of other actions, validity checks, execution, state).
- The outputs other actions of the Pull Request persisted in the org are replayed, so references to them still resolve.
- The `sf` commands started by the action target the org through the `SF_TARGET_ORG` environment variable of the process: the default org of the project is not changed.
- The state entry carries a note such as "Run locally by Jane Doe (jane@acme.com) on 2026-10-03 14:05 UTC."
- The stopped actions come from the failed entry (`stoppedActions`) and from the `blockedBy` link of each stopped entry.
</details>

<!-- training-links:start -->

## Learn by doing

The free [Salesforce DevOps with sfdx-hardis](https://sfdx-hardis-training.github.io) course runs this command, click by click, on an org of your own:

- [Lab 3.3 - Read the deployment log, and what .forceignore hides from it](https://sfdx-hardis-training.github.io/en/level-3-release-manager/3-3-deploy-to-integration-and-read-the-log/)

<!-- training-links:end -->


## Parameters

| Name                  |  Type   | Description                                                                                                                 |                 Default                  | Required |       Options        |
|:----------------------|:-------:|:----------------------------------------------------------------------------------------------------------------------------|:----------------------------------------:|:--------:|:--------------------:|
| action-id             | option  | Id of the action to run                                                                                                     |                                          |          |                      |
| agent                 | boolean | Run in non-interactive mode for agents and automation                                                                       |                                          |          |                      |
| allow-branch-mismatch | boolean | Run even when the current git branch is not the branch of the org (the definition is read from the current branch)          |                                          |          |                      |
| debug<br/>-d          | boolean | Activate debug mode (more logs)                                                                                             |                                          |          |                      |
| flags-dir             | option  | undefined                                                                                                                   |                                          |          |                      |
| json                  | boolean | Format output as json.                                                                                                      |                                          |          |                      |
| next                  | option  | Once the action succeeded, run none, the next one, or all the actions its failure stopped                                   |                                          |          | none<br/>one<br/>all |
| org-branch            | option  | Major branch of the org to run the action in (ex: integration). Uses an org of that instance authenticated on this computer |                                          |          |                      |
| pr                    | option  | Number of the Pull Request the action comes from                                                                            |                                          |          |                      |
| skipauth              | boolean | Skip authentication check when a default username is required                                                               |                                          |          |                      |
| target-org<br/>-o     | option  | undefined                                                                                                                   | veurtio+demo.73193ee31bf8@agentforce.com |          |                      |
| websocket             | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                                                   |                                          |          |                      |

## Examples

```shell
$ sf hardis:project:action:run
```

```shell
$ sf hardis:project:action:run --pr 123 --action-id abc-123 --org-branch integration
```

```shell
$ sf hardis:project:action:run --agent --pr 123 --action-id abc-123 --org-branch integration --next all
```


