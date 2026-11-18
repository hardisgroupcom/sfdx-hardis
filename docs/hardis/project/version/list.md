---
title: "hardis:project:version:list - List release versions"
description: "Lists the release versions of the project: the version deployed on each versioned major branch, the version each promotion would create, and the history of the version tags."
---
<!-- This file has been generated with command 'sf hardis:doc:plugin:generate'. Please do not update it manually or it may be overwritten -->
# hardis:project:version:list

## Description


## Command Behavior

**Lists the release versions of the project: the version deployed on each versioned major branch, the version each promotion would create, and the history of the version tags.**

With [release versioning (Beta)](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-release-versioning/), each successful deployment on a major branch whose branch config declares `releaseVersioning: true` creates a semver tag: release candidates (`v1.5.0-rc.3`) on every versioned branch but the highest one, plain versions (`v1.5.0`) on the highest one (usually main).

The command:

- fetches the tags of the remote repository (skip it with `--no-fetch`);
- gives, for each versioned branch, its role in the chain (`first`, `middle`, `final`) and the version last deployed in its org;
- computes, for each major branch merged into a versioned branch, the version the next promotion would create, with the same rules as a deployment job;
- lists the version tags, newest first, with the branch, the org, the deployment date, the Pull Request and the job that created them, in a report file;
- with `--with-links`, adds the web URL of each tag and Release. It is off by default, since building the git provider client can call its API.

Nothing is written: no tag is created, no org is called. Without `--with-links`, only git is called: one fetch of the tags, then local reads.

The DevOps Pipeline of the VS Code extension reads it with `--json` to show the versions on the branch and org nodes, the version each promotion will create, and the Releases tab.

<details markdown="1">
<summary>Technical explanations</summary>

- The tags are read with `git for-each-ref refs/tags`: a version tag created by a deployment is an annotated tag whose message starts with `sfdx-hardis release version` and holds the branch, the org, the date, the Pull Request and the job URL.
- Tags that are not semver (`v2.0`, `release-x`) are ignored. Semver tags created by hand count for the numbering, with no branch.
- The version a promotion would create is computed from the tags reachable from `origin/<source branch>`, as the deployment job computes it from the deployed commit.
- With `--json`, the result holds `enabled`, `initialVersion`, `minimumVersion`, `branches` (`branchName`, `role`, `current`, `nextOnPromotion`) and `history`. Each version entry has `tag`, `version`, `prerelease`, `branchName`, `commit`, `deployedAt`, `org`, `pullRequest`, `jobUrl`, `tagUrl` and `releaseUrl`.
</details>

### Agent Mode

Supports non-interactive execution with `--agent`:

```sh
sf hardis:project:version:list --agent --json
```

In agent mode:

- No flag is required: the command never prompts.
- Use `--json` and read `branches` to know which version is in which org, and `nextOnPromotion` to know the version a promotion will create.


## Reports

The command writes these reports in the `hardis-report` folder of the project: a CSV file, and its Excel copy (XLSX) in the `xls` sub-folder.

### Release versions

One row per version tag of the repository, newest first: version, branch, deployment date, Pull Request and org.

Files: `release-versions-*.csv`, `xls/release-versions-*.xlsx`

## Parameters

| Name          |  Type   | Description                                                                                              | Default | Required | Options |
|:--------------|:-------:|:---------------------------------------------------------------------------------------------------------|:-------:|:--------:|:-------:|
| agent         | boolean | Run in non-interactive mode for agents and automation                                                    |         |          |         |
| debug<br/>-d  | boolean | Activate debug mode (more logs)                                                                          |         |          |         |
| fetch         | boolean | Fetch the tags of the remote repository first (use --no-fetch to read the local tags only)               |         |          |         |
| flags-dir     | option  | Import flag values from a directory.                                                                     |         |          |         |
| history-limit | option  | Number of version tags returned in the history, newest first                                             |   50    |          |         |
| json          | boolean | Format output as json.                                                                                   |         |          |         |
| skipauth      | boolean | Skip authentication check when a default username is required                                            |         |          |         |
| websocket     | option  | Websocket host:port for VsCode SFDX Hardis UI integration                                                |         |          |         |
| with-links    | boolean | Also return the web URL of each tag and Release (builds the git provider client, which can call its API) |         |          |         |

## Examples

```shell
$ sf hardis:project:version:list
```

```shell
$ sf hardis:project:version:list --json
```

```shell
$ sf hardis:project:version:list --no-fetch --history-limit 200
```

```shell
$ sf hardis:project:version:list --with-links --json
```

```shell
$ sf hardis:project:version:list --agent --json
```


