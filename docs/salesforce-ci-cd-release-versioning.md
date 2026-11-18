---
title: Release versioning (Beta)
description: With sfdx-hardis, give every deployment to UAT, preprod and production a semver version, from the first test campaign to the go live, with GitHub and GitLab Releases and versions on the DevOps Pipeline
---

<!-- markdownlint-disable MD013 -->

## Release versioning (Beta)

Testers, release managers and business owners talk about the same release from the first test campaign until production: each deployment to a versioned major branch creates a semver tag on the deployed commit.

- UAT and preprod get release candidates: `v1.5.0-rc.1`, `v1.5.0-rc.2`, `v1.5.0-rc.3`
- Production gets the plain version: `v1.5.0`, with a GitHub or GitLab Release holding its release notes

The version shows in the Pull Request comment of the deployment, in the deployment notification, on the branches and orgs of the VS Code DevOps Pipeline and, if you ask for it, on the tickets.

- [Activate it](#activate-it)
- [How a version is chosen](#how-a-version-is-chosen)
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

Then give the deployment jobs the [permissions they need](#permissions-of-the-cicd-jobs).

### How a version is chosen

The version only depends on the existing tags, on the branch deployed, and on where its Pull Request comes from. No version file is committed: there is nothing to merge or to keep in sync between branches.

A release cycle on a pipeline `int -> uat -> preprod -> main`, where uat, preprod and main declare `releaseVersioning: true`, after `v1.3.0`:

| Deployment                                       | Version       | Why                                                                                 |
|--------------------------------------------------|---------------|-------------------------------------------------------------------------------------|
| int promoted to uat                              | `v1.4.0-rc.1` | The first deployment to uat after `v1.3.0` opens release 1.4.0                      |
| int promoted to uat again                        | `v1.4.0-rc.2` | Same release, next release candidate                                                |
| uat promoted to preprod                          | `v1.4.0-rc.3` | One release candidate counter per version, shared by every branch                   |
| int promoted to uat                              | `v1.5.0-rc.1` | Release 1.4.0 moved up to preprod: uat opens the next one                           |
| preprod promoted to main                         | `v1.4.0`      | Production gets the plain version of the release it receives                        |
| hotfix merged into preprod                       | `v1.4.1-rc.1` | Nothing waits in preprod for production: the hotfix starts a patch                  |
| preprod promoted to main                         | `v1.4.1`      |                                                                                     |
| hotfix backpromoted to uat, with new work        | `v1.5.0-rc.2` | Release 1.5.0 is still in uat                                                       |
| uat promoted to preprod                          | `v1.5.0-rc.3` |                                                                                     |
| int promoted to uat                              | `v1.6.0-rc.1` | Release 1.5.0 moved up: uat opens release 1.6.0                                     |

The rules behind it:

- **Lowest versioned branch** (uat): it adds release candidates to its open release until a tag of that release exists on a higher branch, or the release is in production. The next deployment then opens the next minor version.
- **Middle branches** (preprod): a promotion from the branch below (or a [promotion branch](salesforce-devops-promotion-branches.md) built from it) takes the version coming up. Anything else is a hotfix: it joins the release waiting there for production, or starts the next patch of production when nothing waits.
- **Highest versioned branch** (main): it gets the plain version of the newest release candidate reachable from the deployed commit and not released yet. When a release overtook another one in preprod, only the newest is released, and its release notes start from the previous production version.
- **Major versions**: set `releaseVersioningMinimumVersion: 2.0.0`.
- A deployment job run again on a commit that already has its version tag creates no new tag.
- When two jobs compute the same version at the same time, the second one sees the tag exists and takes the next one.

Each tag is an annotated tag whose message says which branch and which org it was deployed to, when, from which Pull Request and by which job. Tags created by hand count for the numbering, without a branch.

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

The release notes of any version can also be generated by hand: `sf hardis:doc:release-notes --mode post --release-tag v1.5.0-rc.3`. A release candidate starts from the previous version of its own branch.

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
