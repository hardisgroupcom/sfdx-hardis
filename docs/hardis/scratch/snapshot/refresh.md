<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:scratch:snapshot:refresh

## Description

## Command Behavior

**Takes a Dev Hub org snapshot of a scratch org that holds the current commit of a major branch, so that Pull Request scratch orgs are created from it.**

Run it in CI on every push to a major branch. It does nothing unless the branch config sets `useScratchOrgSnapshot: true`, so the same job can run on every major branch.

Key functionalities:

- **Snapshot of the branch head:** Creates an empty scratch org with [hardis:scratch:create](https://sfdx-hardis.cloudity.com/hardis/scratch/create/) (full deployment, permission sets, Apex init scripts, init data), takes a snapshot of it, waits until the snapshot is Active, then deletes the scratch org.
- **One snapshot per branch and commit:** The snapshot name is `SH`, the first 7 characters of the commit sha and 6 characters of a hash of the branch name, and its description holds the branch and the full sha. Running it again on the same commit does nothing.
- **Pruning:** Keeps the newest `scratchOrgSnapshotKeep` Active snapshots of the branch (default 2) and deletes the older ones. Keeping more lets Pull Requests whose branch is behind the target branch use a snapshot too, but every snapshot counts in the active snapshots allocation of the Dev Hub.
- **Daily limit:** The `DailyOrgSnapshots` and `ActiveOrgSnapshots` limits of the Dev Hub are read before the source org is created. When one has nothing left, or the Dev Hub still refuses the snapshot because of a limit, it logs a warning and ends without error: Pull Requests keep using the previous snapshot, with a larger delta.

The Pull Request side is in [hardis:scratch:create](https://sfdx-hardis.cloudity.com/hardis/scratch/create/): in CI, it creates the scratch org from the newest Active snapshot of the target branch whose commit is in the history of the Pull Request, and deploys only what changed since that commit.

Requirements: Scratch Org Snapshots enabled on the Dev Hub, and the full git history in the Pull Request jobs.

<details markdown="1">
<summary>Technical explanations</summary>

- The scratch org of the snapshot is created with the environment variable `SFDX_HARDIS_SCRATCH_SNAPSHOT_DISABLED=true`, so it never comes from a previous snapshot: every snapshot is a deployment from empty.
- `sf org create snapshot` has no wait option: the command polls `OrgSnapshot.Status` every 30 seconds until `Active` or `Error`, for at most `SCRATCH_ORG_SNAPSHOT_WAIT` minutes (default 60).
- A previous snapshot with the same name that is not Active (a failed run) is deleted first, so the name can be used again.
</details>

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:scratch:snapshot:refresh --agent
```

The command has no prompt.



## Parameters

| Name                  |  Type   | Description                                                                                                       | Default | Required | Options |
|:----------------------|:-------:|:------------------------------------------------------------------------------------------------------------------|:-------:|:--------:|:-------:|
| agent                 | boolean | Run in non-interactive mode for agents and automation                                                             |         |          |         |
| debug<br/>-d          | boolean | Activate debug mode (more logs)                                                                                   |         |          |         |
| flags-dir             | option  | Import flag values from a directory.                                                                              |         |          |         |
| json                  | boolean | Format output as json.                                                                                            |         |          |         |
| skipauth              | boolean | Skip authentication check when a default username is required                                                     |         |          |         |
| target-dev-hub<br/>-v | option  | Username or alias of the Dev Hub org. Not required if the `target-dev-hub` configuration variable is already set. |         |   true   |         |
| websocket             | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                                         |         |          |         |

## Examples

```shell
$ sf hardis:scratch:snapshot:refresh
```

```shell
$ sf hardis:scratch:snapshot:refresh --agent
```


