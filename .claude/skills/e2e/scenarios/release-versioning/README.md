# Release versioning: end to end test

Proves, in real CI jobs running sfdx-hardis built from the branch under test (GitHub Actions and
GitLab CI), that a deployment to a major branch declaring `releaseVersioning: true` creates the right
semver tag on the deployed commit, that production gets a Release with its release notes, and that
`sf hardis:project:version:list` and the DevOps Pipeline of vscode-sfdx-hardis show the versions.
About 1 hour per provider, most of it waiting for the CI jobs.

What it proves, on a pipeline `int -> uat -> preprod -> main` where uat, preprod and main declare
`releaseVersioning: true` and the repository starts with a hand-made tag `v1.3.0` on main:

| Step | Action                                                     | Expected tag  |
|------|------------------------------------------------------------|---------------|
| 1    | Merge a story into int, promote int to uat                 | `v1.4.0-rc.1` |
| 2    | Merge a second story, promote int to uat                   | `v1.4.0-rc.2` |
| 3    | Promote uat to preprod                                     | `v1.4.0-rc.3` |
| 4    | Merge a third story, promote int to uat                    | `v1.5.0-rc.1` |
| 5    | Promote preprod to main                                    | `v1.4.0`      |
| 6    | Merge a hotfix branch into preprod                         | `v1.4.1-rc.1` |
| 7    | Promote preprod to main                                    | `v1.4.1`      |
| 8    | Backpromote preprod into uat (`sf hardis:work:backpromote`) | `v1.5.0-rc.2` |
| 9    | Promote uat to preprod with a promotion branch (subset)    | `v1.5.0-rc.3` |
| 10   | Promote int to uat                                         | `v1.6.0-rc.1` |

At each step:

- `git ls-remote --tags` has the expected tag, on the merge commit of the deployed branch, and
  `git tag -n20 <tag>` shows the message `sfdx-hardis release version <tag>` with the branch, the org,
  the Pull Request and the job URL.
- The deployment comment of the Pull Request has the line `Release version: <tag>`, linked to the tag.
- int deployments create no tag.
- Validation jobs (`deploy:smart --check`) create no tag, and a nightly major branch check creates none.

At steps 5 and 7: the GitHub / GitLab Release exists, its body is the release notes from the previous
plain version (`v1.3.0`, then `v1.4.0`: never a release candidate), the PDF and the XLSX are attached.

Then:

- Run the deployment job of uat again on the same commit: no new tag (`already-tagged` in the log).
- Start two deployment jobs at the same time (uat and preprod hotfix) on a version they could share:
  one tag each, the second job logs the retry.
- Remove `contents: write` (GitHub) or the `api` scope (GitLab): the deployment stays green, the log
  has the `releaseVersionTagFailed` warning.
- With `releaseVersioningTicketVersions: allCandidates` and a JIRA project, the story tickets get the
  rc fix versions, then the final one marked released at step 7. With the default (`none`), nothing
  is written on tickets.
- `sf hardis:project:version:list --json` in a fresh clone: `branches` gives `uat v1.6.0-rc.1`,
  `preprod v1.5.0-rc.3`, `main v1.4.1`; `nextOnPromotion` gives `int -> v1.6.0-rc.2`,
  `uat -> v1.6.0-rc.2`, `preprod -> v1.5.0`; `history` has the ten tags plus `v1.3.0`.
- The DevOps Pipeline of vscode-sfdx-hardis (on the branch of the feature): version chips on uat,
  preprod and main and on their orgs, none on int and none in the Dev orgs view, the next version
  chips on the promotion links, the Releases tab with eleven rows.

## Run it

Reuse the CI harness of the [promotion-branches scenario](../promotion-branches/README.md), never
copied: `env-lib.sh`, `ci-workflows-prepare.cjs` (the GitHub workflow must get `contents: write`),
`ci-provider-<provider>.sh`, `promotion-provider.sh` and `check-pipeline.cjs`. The scripts of this
scenario (`scripts/rv-build-project.sh`, `scripts/rv-e2e.sh`) are written on its first run, one
assertion per line of `$LOGS/results.tsv`, following `major-branch-check/scripts/mbc-e2e.sh`.

## Prerequisites

- Those of the promotion-branches real CI section for the provider (`preflight.sh --provider <p>`).
- Three throwaway orgs (scratch orgs from `DEVHUB`) for uat, preprod and main; int can share the uat org.
- The branch under test pushed to `hardisgroupcom/sfdx-hardis` (the CI jobs clone it).
- vscode-sfdx-hardis cloned next to this working copy, on the branch of the feature, compiled.

## Reports

Copy `$LOGS/report.md` into `reports/<date>-<run>.md`.
