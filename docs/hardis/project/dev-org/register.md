<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:dev-org:register

## Description


## Command Behavior

**Registers a developer sandbox or a scratch org in the development orgs list of the project, or changes its target branch, owner and users.**

The list lives in a "Development Orgs Dashboard" of the git provider (an issue, an Azure DevOps work item, or a dedicated Pull Request on Bitbucket). It tells the owner of each org when Pull Requests were merged into its target branch since its last [backpromote](https://sfdx-hardis.cloudity.com/salesforce-devops-backpromote/). See [hardis:project:dev-org:list](https://sfdx-hardis.cloudity.com/hardis/project/dev-org/list/).

sfdx-hardis registers an org on its own when a developer starts a User Story in it ([hardis:work:new](https://sfdx-hardis.cloudity.com/hardis/work/new/)), saves it ([hardis:work:save](https://sfdx-hardis.cloudity.com/hardis/work/save/)), runs a backpromote, or creates a sandbox with [hardis:org:create](https://sfdx-hardis.cloudity.com/hardis/org/create/). This command is for the release manager who creates a sandbox and assigns it, or who fixes an entry:

- `--target-org` registers an org you are connected to (the default org when omitted);
- `--org-id` edits a registered org without connecting to it;
- `--target-branch` sets the only target branch of the org;
- `--owner` sets the owner, `--users` replaces the users, `--add-user` and `--remove-user` change them one at a time. A person is written `Name <email>`, or a bare email.

A production org, or the org of a major branch, is never registered. A sandbox registered under a new org id with the name of a registered one is a refreshed sandbox: it replaces the old entry, as a new sandbox.

Read more in the [Development orgs](https://sfdx-hardis.cloudity.com/salesforce-devops-dev-orgs/) documentation.

<details markdown="1">
<summary>Technical explanations</summary>

- The org is identified by its org id. Its name is the sandbox name read from its instance URL, or the alias of a scratch org.
- The new comment of the org is written before the old one is deleted: a delete that fails (a comment written by another account) loses nothing, the newest comment is the one that counts.
- The dashboard is created at the first registration. Its body is rebuilt from the comments at every write.
- Requires a git provider token (`GITHUB_TOKEN`, `CI_SFDX_HARDIS_GITLAB_TOKEN`, `SYSTEM_ACCESSTOKEN` or `CI_SFDX_HARDIS_BITBUCKET_TOKEN`).
- With `--json`, `devOrg` holds the registered entry, `created` says whether it is new and `dashboardUrl` links the dashboard.
</details>

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:project:dev-org:register --agent --target-org my-dev-sandbox --target-branch integration --owner "Jane Doe <jane.doe@example.com>"
```

In agent mode, nothing is asked: the target branch is `--target-branch`, else the registered one, else `developmentBranch`; the owner of a new entry is `--owner`, else the git user of the checkout; the users only change with `--users`, `--add-user` or `--remove-user`.


## Parameters

| Name              |  Type   | Description                                                                              | Default | Required | Options |
|:------------------|:-------:|:-----------------------------------------------------------------------------------------|:-------:|:--------:|:-------:|
| add-user          | option  | Adds one user ("Name <email>" or an email)                                               |         |          |         |
| agent             | boolean | Run in non-interactive mode for agents and automation                                    |         |          |         |
| debug<br/>-d      | boolean | Activate debug mode (more logs)                                                          |         |          |         |
| flags-dir         | option  | Import flag values from a directory.                                                     |         |          |         |
| json              | boolean | Format output as json.                                                                   |         |          |         |
| org-id            | option  | Org id of a registered org to edit, without connecting to it                             |         |          |         |
| owner             | option  | Owner of the org: "Name <email>" or an email                                             |         |          |         |
| remove-user       | option  | Removes the user with this email                                                         |         |          |         |
| skipauth          | boolean | Skip authentication check when a default username is required                            |         |          |         |
| target-branch     | option  | The major branch the org targets                                                         |         |          |         |
| target-org<br/>-o | option  | Username or alias of the target org.                                                     |         |          |         |
| users             | option  | Users of the org, comma-separated ("Name <email>" or emails). Replaces the current users |         |          |         |
| websocket         | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                |         |          |         |

## Examples

```shell
$ sf hardis:project:dev-org:register
```

```shell
$ sf hardis:project:dev-org:register --target-org my-dev-sandbox --target-branch integration --owner "Jane Doe <jane.doe@example.com>"
```

```shell
$ sf hardis:project:dev-org:register --org-id 00D000000000001AAA --add-user "John Smith <john.smith@example.com>"
```

```shell
$ sf hardis:project:dev-org:register --agent --target-org my-dev-sandbox --target-branch integration
```


