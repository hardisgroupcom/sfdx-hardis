---
title: Release versioning
description: With sfdx-hardis, give every deployment to UAT, preprod and production a semver version, from the first test campaign to the go live, with GitHub and GitLab Releases and versions on the DevOps Pipeline
---

<!-- markdownlint-disable MD013 -->

## Release versioning

Testers, release managers and business owners talk about the same release from the first test campaign until production: each deployment to a versioned major branch creates a semver tag on the deployed commit.

- UAT and preprod get release candidates: `v1.5.0-rc.1`, `v1.5.0-rc.2`, `v1.5.0-rc.3`, or names in [your own format](#tag-format-of-release-candidates) (`v1.5.0-pi2-it4-uat-rc1`)
- Production gets the plain version: `v1.5.0`, with a GitHub or GitLab Release holding its release notes

The version shows in the Pull Request comment of the deployment, in the deployment notification, on the branches and orgs of the VS Code DevOps Pipeline and, if you ask for it, on the tickets.

- [Activate it](#activate-it)
- [How a version is chosen](#how-a-version-is-chosen)
- [Tag format of release candidates](#tag-format-of-release-candidates)
- [Permissions of the CI/CD jobs](#permissions-of-the-cicd-jobs)
- [Releases and release notes](#releases-and-release-notes)
- [Versions on tickets (optional)](#versions-on-tickets-optional)
- [See the versions](#see-the-versions)
- [Limits](#limits)

### Activate it

Declare `releaseVersioning: true` in the branch config of each major branch that handles versions. Branches that do not declare it (an integration branch, for example) keep working as before and get no version.

```yaml
# config/branches/.sfdx-hardis.uat.yml
releaseVersioning: true

# config/branches/.sfdx-hardis.preprod.yml
releaseVersioning: true

# config/branches/.sfdx-hardis.main.yml
releaseVersioning: true
```

The order of the branches comes from their `mergeTargets`. The highest versioned branch of the chain (usually main) gets plain versions, every other versioned branch gets release candidates.

Optional settings, in `config/.sfdx-hardis.yml`:

| Setting                           | Default | Use                                                                                                                                                      |
|-----------------------------------|---------|----------------------------------------------------------------------------------------------------------------------------------------------------------|
| `releaseVersioningInitialVersion` | `1.0.0` | First version when the repository has no semver tag. A repository that already has tags (`v1.3.0` or `1.3.0`) carries on from the highest one.         |
| `releaseVersioningMinimumVersion` |         | Set it to `2.0.0` to start a major version. A computed version below it is raised to it. Once that version exists, the setting has no more effect.       |
| `releaseVersioningTicketVersions` | `none`  | Write the versions on tickets: `allCandidates` or `finalOnly`. See [Versions on tickets](#versions-on-tickets-optional).                                  |

`releaseVersioningTagFormat` and `releaseVersioningMinimumVariables` name the release candidates: see [Tag format of release candidates](#tag-format-of-release-candidates).

Then give the deployment jobs the [permissions they need](#permissions-of-the-cicd-jobs).

### How a version is chosen

The version only depends on the existing tags, on the branch deployed, and on where its Pull Request comes from. No version file is committed: there is nothing to merge or to keep in sync between branches.

A release cycle on a pipeline `int -> uat -> preprod -> main`, where uat, preprod and main declare `releaseVersioning: true`, after `v1.3.0`:

| Deployment                                       | Version       | Why                                                                                 |
|--------------------------------------------------|---------------|-------------------------------------------------------------------------------------|
| int promoted to uat                              | `v1.4.0-rc.1` | The first deployment to uat after `v1.3.0` opens release 1.4.0                      |
| int promoted to uat again                        | `v1.4.0-rc.2` | Same release, next release candidate                                                |
| uat promoted to preprod                          | `v1.4.0-rc.3` | uat and preprod have the same tag format: they share one counter                    |
| int promoted to uat                              | `v1.5.0-rc.1` | Release 1.4.0 moved up to preprod: uat opens the next one                           |
| preprod promoted to main                         | `v1.4.0`      | Production gets the plain version of the release it receives                        |
| hotfix merged into preprod                       | `v1.4.1-rc.1` | Nothing waits in preprod for production: the hotfix starts a patch                  |
| preprod promoted to main                         | `v1.4.1`      |                                                                                     |
| hotfix backpromoted to uat, with new work        | `v1.5.0-rc.2` | Release 1.5.0 is still in uat                                                       |
| uat promoted to preprod                          | `v1.5.0-rc.3` |                                                                                     |
| int promoted to uat                              | `v1.6.0-rc.1` | Release 1.5.0 moved up: uat opens release 1.6.0                                     |

The rules behind it:

- **Lowest versioned branch** (uat): it adds release candidates to its open release until a tag of that release exists on a higher branch, or the release is in production. The next deployment then opens the next minor version.
- **Middle branches** (preprod): a promotion from the branch below (or a [promotion branch](salesforce-devops-promotion-branches.md) built from it) takes the version coming up. Anything else is a hotfix, including a higher branch merged back into it: it joins the release waiting there for production, or starts the next patch of production when nothing waits.
- **Highest versioned branch** (main): it gets the plain version of the newest release candidate reachable from the deployed commit and not released yet. A promotion branch cherry-picks its User Stories, so nothing of its source is reachable: it gets the version last deployed on that source. When a release overtook another one in preprod, only the newest is released, and its release notes start from the previous production version.
- **Major versions**: set `releaseVersioningMinimumVersion: 2.0.0`.
- A deployment job run again on a commit that already has its version tag creates no new tag. On the highest versioned branch, it publishes the Release only when the first run could not create it.
- A shallow clone (the default of GitLab CI) is completed with its history first, so the release candidates older than the clone depth are found.
- When two jobs compute the same version at the same time, the second one sees the tag exists and takes the next one.

Each tag is an annotated tag whose message says which branch and which org it was deployed to, when, from which Pull Request and by which job, with its version, release candidate number and variables. Tags created by hand count for the numbering, without a branch, when their name is a plain semver version (`v1.3.0`, `v1.3.0-rc.2`).

### Tag format of release candidates

By default, release candidates are named `v{MAJ}.{MIN}.{PATCH}-rc.{RC}`. Set `releaseVersioningTagFormat` to name them your own way: in `config/.sfdx-hardis.yml` for every versioned branch, or in the config of one branch for that branch only.

```yaml
# config/branches/.sfdx-hardis.uat.yml
releaseVersioning: true
releaseVersioningTagFormat: v{MAJ}.{MIN}.{PATCH}-pi{PI}-it{IT}-uat-rc{RC}
releaseVersioningMinimumVariables:
  PI: 2
  IT: 4

# config/branches/.sfdx-hardis.preprod.yml
releaseVersioning: true
releaseVersioningTagFormat: v{MAJ}.{MIN}.{PATCH}-rc{RC}-preprod

# config/branches/.sfdx-hardis.main.yml
releaseVersioning: true
```

| Placeholder                    | Value                                                                              |
|--------------------------------|------------------------------------------------------------------------------------|
| `{MAJ}`, `{MIN}`, `{PATCH}`    | The version, chosen by the [rules above](#how-a-version-is-chosen). Required.      |
| `{RC}`                         | The release candidate number. Required.                                            |
| `{BRANCH}`                     | The git branch name, `/` written `-`: `release/uat` gives `release-uat`.          |
| Any other `{NAME}` (`{PI}`...) | A custom variable, from `releaseVersioningMinimumVariables` and the previous tags. |

The release cycle of this config, with no tag at the start:

| Deployment                                    | Tag                      | Why                                                                       |
|-----------------------------------------------|--------------------------|---------------------------------------------------------------------------|
| int promoted to uat                           | `v1.0.0-pi2-it4-uat-rc1` | First release, PI and IT from the config                                  |
| int promoted to uat, twice                    | `v1.0.0-pi2-it4-uat-rc3` | Same release, same text: next release candidates                          |
| uat promoted to preprod                       | `v1.0.0-rc1-preprod`     | Another text: its own counter starts at 1                                 |
| A Pull Request sets `IT: 5`, int to uat       | `v1.1.0-pi2-it5-uat-rc1` | 1.0.0 moved up to preprod: uat opens 1.1.0, with IT 5                     |
| hotfix merged into preprod                    | `v1.0.0-rc2-preprod`     | The hotfix joins the release waiting in preprod                           |
| preprod promoted to main                      | `v1.0.0`                 | Production always gets the plain version                                  |
| A Pull Request sets `PI: 3, IT: 1`, int to uat | `v1.1.0-pi3-it1-uat-rc1` | Release 1.1.0 is still open, but the text is new: the counter restarts   |
| A Pull Request sets `PI: 2, IT: 9`, int to uat | `v1.1.0-pi3-it1-uat-rc2` | The tags hold PI 3 / IT 1 already: lowering the config has no effect     |
| uat promoted to preprod                       | `v1.1.0-rc1-preprod`     |                                                                           |
| preprod promoted to main                      | `v1.1.0`                 | Its release notes start from `v1.0.0`                                     |

The rules:

- **The format**: `{MAJ}`, `{MIN}`, `{PATCH}` and `{RC}` once each, two placeholders never side by side, and only letters, digits, `.`, `_` and `-` around them, so the name is a valid git tag, JIRA fix version and ticket label. An invalid format logs a warning and the branch uses the default one: it never fails a deployment.
- **One counter per tag text**: the next release candidate is 1 + the highest one among the tags of the same version with the same text around `{RC}`. A new PI, a new iteration or another branch gives a new text, and its counter starts at 1. Two branches with the same format share one counter, so their tags never collide. Changing the format also restarts the counter.
- **Variables never change on their own**: a tag takes the values of the previous tags. They change when a Pull Request raises `releaseVersioningMinimumVariables`, and the next tag takes the new values. They compare together, in the order of the format, like a semver: PI 3 / IT 1 is above PI 2 / IT 5. A value set in a branch config replaces the project value of the same variable.
- **A variable with no value**, neither in the previous tags nor in the config: warning, no tag, and the deployment goes on.
- **Production** (the highest versioned branch) always gets `v1.5.0`: a format set in its branch config is ignored, with a warning.
- **CI/CD variables** override the config, for example to start a new PI without a Pull Request:

    | Variable                                              | Overrides                                                                                                      |
    |-------------------------------------------------------|----------------------------------------------------------------------------------------------------------------|
    | `SFDX_HARDIS_RELEASE_VERSIONING_TAG_FORMAT`           | `releaseVersioningTagFormat` of every versioned branch but production                                          |
    | `SFDX_HARDIS_RELEASE_VERSIONING_VAR_<NAME>`           | The value of `{NAME}` in `releaseVersioningMinimumVariables`, for every branch: `..._VAR_PI=3`                 |
    | `SFDX_HARDIS_RELEASE_VERSIONING_VAR_<BRANCH>_<NAME>`  | The same for one branch, over the previous one: `..._VAR_UAT_IT=1`. `release/uat` is written `RELEASE_UAT`     |

    A variable value is still a minimum: the tags win when they hold higher values, and lowering it has no effect. Set every variable that changes (`PI` and `IT` for a new PI), not only the first one. The DevOps Pipeline of VS Code computes the next versions on your computer, without the variables of your CI/CD server.
- **sfdx-hardis never reads a version from a custom tag name**: the version, the release candidate number and the variables are written in the message of each tag, and read from there. A tag created by hand counts only when its name is a plain semver version.

### Permissions of the CI/CD jobs

Tags and Releases are created through the API of the git provider, with the token sfdx-hardis already uses for Pull Request comments: the job never pushes. The token needs one more permission.

| Git provider    | Tag                 | Release at production                                                      | What to change                                                                                                    |
|-----------------|---------------------|----------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------|
| GitHub          | Git refs API        | GitHub Release, PDF and XLSX attached                                      | In `.github/workflows/process-deploy.yml`, replace `contents: read` by `contents: write`                           |
| GitLab          | Repository tags API | GitLab Release, PDF and XLSX as release links                              | `CI_SFDX_HARDIS_GITLAB_TOKEN` with the `api` scope; the Maintainer role when `v*` tags are protected              |
| Azure DevOps    | Annotated tags API  | No Release object: the release notes stay in the artifacts of the job      | Give the Build Service the **Create tag** permission on the repository                                            |
| Bitbucket Cloud | Refs tags API       | No Release object: the release notes stay in the artifacts of the job      | `CI_SFDX_HARDIS_BITBUCKET_TOKEN` with the `repository:write` scope                                                |

Jenkins and the other CI servers use the git provider of the repository.

A missing permission never fails the deployment: the metadata is already in the org. The job logs a warning and the deployment goes on without a version.

### Releases and release notes

When the deployment to the highest versioned branch succeeds, the job runs [hardis:doc:release-notes](hardis/doc/release-notes.md) for the new version, then creates the Release:

- the Markdown of the release notes is the body of the Release
- the PDF and the XLSX are attached
- the release notes cover the previous production version to the new one: `v1.4.1` to `v1.5.0`, never one of its own release candidates
- the release notes notification (Slack, Teams, email...) is sent once the Release exists: its summary, the PDF and the XLSX, and a **View Release** button

If the release notes cannot be generated, the Release is still created, with a link to the comparison between the two versions and to the job.

The release notes of any version can also be generated by hand: `sf hardis:doc:release-notes --mode post --release-tag v1.5.0-rc.3`. A release candidate starts from the version deployed on its own branch just before it.

### Versions on tickets (optional)

Off by default. With `releaseVersioningTicketVersions`, the tickets referenced by the deployed Pull Requests get the version:

| Value           | UAT and preprod                                  | main                   |
|-----------------|--------------------------------------------------|------------------------|
| `none`          | Nothing                                          | Nothing                |
| `allCandidates` | Each release candidate: `v1.5.0-rc.2`, `v1.5.0-rc.3` | `v1.5.0`           |
| `finalOnly`     | Nothing                                          | `v1.5.0`               |

- **JIRA**: a fix version of the project of the ticket, created when missing, and marked released with the date of the day when main is deployed. With `allCandidates`, the release candidates also appear in the release list of the project.
- **ServiceNow, Aha!, Azure Boards**: a label or a tag on the record.

### See the versions

- **Pull Request comment** of the deployment: `Release version: v1.5.0-rc.3`, linked to the tag.
- **Deployment notification** (Slack, Teams, email...): the same line, for every versioned deployment, release candidates included.
- **Release notes notification**: for each production version, with the release notes files and a link to the Release.
- **VS Code DevOps Pipeline**: the version deployed on each versioned branch and org, the version each promotion will create, and a **Releases** tab listing the versions.
- **Command line**: [hardis:project:version:list](hardis/project/version/list.md) lists the version of each branch, the version each promotion would create, and the history of the version tags.

```sh
sf hardis:project:version:list
sf hardis:project:version:list --json
```

### Limits

- Projects that deploy before the merge (deploy before merge mode) get no version: the deployed commit is not on the branch yet.
- Azure DevOps and Bitbucket have no Release object: the version is a tag, and the release notes stay in the artifacts of the job.
- Two branches merged into the same one (uat and uatrun into preprod) can open two releases at the same time.
- Tags created by hand in a custom format (`v1.5.0-pi2-rc1`) are not read: only plain semver names count.
- In the JSON of `hardis:project:version:list`, `version` is the semver form (`1.5.0-rc.1`): with tag formats, two release candidates of two branches can share it. `tag` is the name to rely on.
