<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:dev-org:list

## Description


## Command Behavior

**Lists the developer sandboxes and scratch orgs of the project, the major branch each of them targets, and how many Pull Requests were merged into that branch since the org last received a backpromote.**

The list lives in a "Development Orgs Dashboard" of the git provider: an issue on GitHub and GitLab, a work item on Azure DevOps, a dedicated Pull Request on Bitbucket. sfdx-hardis fills it on its own: [hardis:work:new](https://sfdx-hardis.cloudity.com/hardis/work/new/), [hardis:work:save](https://sfdx-hardis.cloudity.com/hardis/work/save/), [hardis:work:backpromote](https://sfdx-hardis.cloudity.com/hardis/work/backpromote/) and [hardis:org:create](https://sfdx-hardis.cloudity.com/hardis/org/create/) register the org they work with, and a release manager registers or edits one with [hardis:project:dev-org:register](https://sfdx-hardis.cloudity.com/hardis/project/dev-org/register/).

For each org, the command shows:

- the target branch, the owner and the users;
- the Pull Requests merged into the target branch since the last backpromote of the org from that branch, or since the org was registered. A Pull Request that only moves others (a major branch merged into the next one, a promotion) counts as one, with the Pull Requests it carries;
- the last backpromote and the last activity. An org with no activity for `devOrgsStaleDays` days (30 by default) is marked stale. Removing it stays a decision of the release manager.

The merged Pull Requests are listed again by the deployment job of a major branch after each merge. `--refresh` lists them again now, from the git provider.

Read more in the [Development orgs](https://sfdx-hardis.cloudity.com/salesforce-devops-dev-orgs/) documentation.

<details markdown="1">
<summary>Technical explanations</summary>

- The dashboard holds one comment per org and one per target branch (the merged Pull Requests). The data of a comment is a base64url token, so no markup of the provider can alter it. The body of the dashboard is rebuilt from the comments at every write: never edit it by hand.
- The newest comment of an org is the one that counts, so a comment that its writer was not allowed to delete changes nothing. A removal is written as a comment too.
- A sandbox registered under a new org id with the name of a registered one is its refresh: it replaces the old entry, as a new sandbox. An expired scratch org leaves the list.
- `isMine` is true when the git user of the checkout (`user.email`) is the owner or one of the users.
- The merged Pull Requests are read with the provider listing filtered on the merge date, from the oldest start date of the orgs of the branch, at most 180 days back.
- With `--json`, `devOrgs` holds `enabled`, `dashboardUrl`, `currentUser`, `staleDays`, `orgs` (`orgId`, `orgType`, `name`, `alias`, `instanceUrl`, `expirationDate`, `targetBranch`, `owner`, `users`, `featureBranches`, `registeredAt`, `lastActivityAt`, `lastBackpromote`, `isMine`, `stale`, `startDate`, `behind`), `branches` and `warnings`. `behind` is null until the merged Pull Requests of the target branch are listed from the start date of the org. `errorKind` is `noGitProvider` when no git provider token is available.
- The registry is on by default. `enableDevOrgsRegistry: false` turns it off.
</details>

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:project:dev-org:list --agent
```

The command asks nothing in any mode: `--agent` only states it. Use `--refresh` to list the merged Pull Requests again, `--target-branch` and `--mine` to filter.


## Parameters

| Name          |  Type   | Description                                                                                                   | Default | Required | Options |
|:--------------|:-------:|:--------------------------------------------------------------------------------------------------------------|:-------:|:--------:|:-------:|
| agent         | boolean | Run in non-interactive mode for agents and automation                                                         |         |          |         |
| debug<br/>-d  | boolean | Activate debug mode (more logs)                                                                               |         |          |         |
| flags-dir     | option  | Import flag values from a directory.                                                                          |         |          |         |
| json          | boolean | Format output as json.                                                                                        |         |          |         |
| mine          | boolean | Only the orgs whose owner or users include the git user of the checkout                                       |         |          |         |
| refresh       | boolean | List again the Pull Requests merged into the target branches, from the git provider, and update the dashboard |         |          |         |
| skipauth      | boolean | Skip authentication check when a default username is required                                                 |         |          |         |
| target-branch | option  | Only the orgs that target this branch                                                                         |         |          |         |
| websocket     | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                                     |         |          |         |

## Examples

```shell
$ sf hardis:project:dev-org:list
```

```shell
$ sf hardis:project:dev-org:list --mine
```

```shell
$ sf hardis:project:dev-org:list --refresh --target-branch integration
```

```shell
$ sf hardis:project:dev-org:list --agent
```


