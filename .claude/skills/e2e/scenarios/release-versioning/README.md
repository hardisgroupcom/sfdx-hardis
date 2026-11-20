# Release versioning: end to end test

Proves, in real CI jobs running sfdx-hardis built from the branch under test (GitHub Actions and
GitLab CI), that a deployment to a major branch declaring `releaseVersioning: true` creates the right
version tag on the deployed commit, in the default format and in the tag formats of each branch, that
production gets a Release with its release notes, and that `sf hardis:project:version:list` and the
DevOps Pipeline of vscode-sfdx-hardis show the versions. After each step, the DevOps Pipeline is
captured: the captures, and an animated timeline built from them, show how the versions evolve.

Two parts, each on a throwaway repository of its own, on the pipeline
`integration -> uat -> preprod -> main` where uat, preprod and main declare `releaseVersioning: true`:

| Part      | What it proves                                                                                              | Duration, per provider |
|-----------|-------------------------------------------------------------------------------------------------------------|------------------------|
| `default` | The default format (`v1.4.0-rc.2`): the version rules, one counter per version shared by every branch       | About 1h15             |
| `custom`  | Tag formats per branch, their variables, CI/CD variable overrides, a name taken by hand, an ignored format | About 1h30             |

Run each part on GitHub and on GitLab. Azure DevOps and Bitbucket have no Release object and go
through the same rules: the GitHub and GitLab runs cover them, except the tag API of each provider.

## Part `default`

The repository starts with a tag made by hand, `v1.3.0` on main (no sfdx-hardis message: it counts
for the numbering, on no branch).

| Step | Action                                                     | Expected tag  | Captured                       |
|------|------------------------------------------------------------|---------------|--------------------------------|
| a01  | A story into integration, promote integration to uat       | `v1.4.0-rc.1` | pipeline, uat Release tab      |
| a02  | A second story, promote integration to uat                 | `v1.4.0-rc.2` | pipeline                       |
| a03  | Promote uat to preprod                                     | `v1.4.0-rc.3` | pipeline                       |
| a04  | A third story, promote integration to uat                  | `v1.5.0-rc.1` | pipeline                       |
| a05  | Promote preprod to main                                    | `v1.4.0`      | pipeline, Releases tab         |
| a06  | A hotfix branch merged into preprod                        | `v1.4.1-rc.1` | pipeline                       |
| a07  | Promote preprod to main                                    | `v1.4.1`      | pipeline                       |
| a08  | preprod merged back into uat (a Pull Request preprod -> uat) | `v1.5.0-rc.2` | pipeline                     |
| a09  | Promote uat to preprod                                     | `v1.5.0-rc.3` | pipeline                       |
| a10  | A story, promote integration to uat                        | `v1.6.0-rc.1` | pipeline, Releases, uat and preprod Release tabs |

Steps a08 and a09 use plain Pull Requests: the backpromote and promotion branch paths of the same
rules are proven by the [promotion-branches scenario](../promotion-branches/README.md) and the unit
tests (`releaseVersionRules.test.ts`).

## Part `custom`

The branch configs declare:

```yaml
# config/.sfdx-hardis.yml
releaseVersioningMinimumVariables:
  PI: 2
  IT: 4
# config/branches/.sfdx-hardis.uat.yml
releaseVersioningTagFormat: v{MAJ}.{MIN}.{PATCH}-pi{PI}-it{IT}-uat-rc{RC}
# config/branches/.sfdx-hardis.preprod.yml
releaseVersioningTagFormat: v{MAJ}.{MIN}.{PATCH}-rc{RC}-{BRANCH}
# config/branches/.sfdx-hardis.main.yml: ignored, with a warning
releaseVersioningTagFormat: v{MAJ}.{MIN}.{PATCH}-main-rc{RC}
```

| Step | Action                                                                          | Expected tag             | What it proves                                                     |
|------|---------------------------------------------------------------------------------|--------------------------|--------------------------------------------------------------------|
| c01  | A story, promote integration to uat                                             | `v1.0.0-pi2-it4-uat-rc1` | The format of uat, PI and IT from the config                       |
| c02  | `v1.0.0-pi2-it4-uat-rc2` pushed by hand first, then a story, promote to uat     | `v1.0.0-pi2-it4-uat-rc3` | A name taken by hand: the provider refuses it, the job retries     |
| c03  | Promote uat to preprod                                                          | `v1.0.0-rc1-preprod`     | Another text, its own counter; `{BRANCH}`                          |
| c04  | A story that sets `IT: 5` in the project config, promote to uat                 | `v1.1.0-pi2-it5-uat-rc1` | A config change reaches uat with its promotion; 1.1.0 opens        |
| c05  | A hotfix merged into preprod                                                    | `v1.0.0-rc2-preprod`     | The hotfix joins the release waiting in preprod                    |
| c06  | Promote preprod to main                                                         | `v1.0.0`                 | Production keeps the plain version, its format ignored with a warning, Release created |
| c07  | CI/CD variables `..._VAR_PI=3`, `..._VAR_IT=1`, a story, promote to uat         | `v1.1.0-pi3-it1-uat-rc1` | A new PI without a Pull Request; PI 3 / IT 1 is above PI 2 / IT 5  |
| c08  | CI/CD variable `..._VAR_UAT_IT=2`, a story, promote to uat                      | `v1.1.0-pi3-it2-uat-rc1` | The variable of one branch wins over the variable of every branch |
| c09  | `..._VAR_UAT_IT=1`, a story, promote to uat                                     | `v1.1.0-pi3-it2-uat-rc2` | Lowering a value has no effect: the tags hold IT 2                 |
| c10  | CI/CD variable `..._TAG_FORMAT=v{MAJ}.{MIN}.{PATCH}-{BRANCH}-rc.{RC}`, promote to uat | `v1.1.0-uat-rc.1`  | The format of every branch from a CI/CD variable; a new text restarts at 1 |
| c11  | That variable removed, promote uat to preprod                                   | `v1.1.0-rc1-preprod`     | preprod uses its own format again                                  |
| c12  | Promote preprod to main                                                         | `v1.1.0`                 | Release notes from `v1.0.0`                                        |

The `..._VAR_` variables are `SFDX_HARDIS_RELEASE_VERSIONING_VAR_<NAME>` and
`SFDX_HARDIS_RELEASE_VERSIONING_VAR_<BRANCH>_<NAME>`: repository variables on GitHub, project
variables on GitLab. The run removes them at its start and at its end.

## What each step checks

- Exactly one new tag on the remote, the expected one, on the merge commit of the Pull Request.
- Its annotated message: `sfdx-hardis release version <tag>`, `branch:`, `version:`, `rc:` (release
  candidates only) and, in the custom part, `variables: PI=.. IT=..`.
- The deployment log names the version (`Release version of this deployment: <tag>`), and the
  deployment comment of the Pull Request names the tag.
- The deployments of integration create no tag. The validation of the first promotion creates none.
- On production (a05, a07, c06, c12): the GitHub / GitLab Release exists with the PDF and the XLSX.
- The DevOps Pipeline, run headless on the clone, shows the current tag of each versioned branch
  before it is captured (`<step>-pipeline.png`), plus the Releases tab and the Release version tab
  of a branch where the table says so. The last step (a10, c12) also captures each view of the
  switch (Major branches, Feature branches, Dev orgs) and the diagram with the Versions button off,
  with no version chip left on it. Every version chip must be readable: a contrast of at least
  4.5 between its text and its background. Reading the text of the chips is not enough: on
  2026-11-19 the text was in the page and painted in the color of its background.

Then, without CI job:

- `local` (custom part): `hardis:project:version:list` of the branch under test on the clone gives the
  next version of uat with `SFDX_HARDIS_RELEASE_VERSIONING_VAR_PI=7` in the environment
  (`*-pi7-it1-uat-rc1`), falls back to the default format with a warning for an invalid uat format,
  and gives no next version for a format variable without value (`{SPRINT}`).
- `version-list`: the current version of each branch and the whole history, the hand-made custom tag
  of c02 excluded (tags made by hand only count in plain semver form).
- `timeline`: `timeline.gif`, the DevOps Pipeline after each step with its caption.

## Run it

```bash
cd .claude/skills/e2e/scenarios/release-versioning/scripts
PART=default PROVIDER=github bash rv-e2e.sh
PART=custom PROVIDER=github bash rv-e2e.sh
PART=custom PROVIDER=gitlab bash rv-e2e.sh
# replay steps of a run
PART=custom PROVIDER=github RUN=<run> STEPS="c12 version-list timeline report" bash rv-e2e.sh
```

Run it in the background and watch the `[FAIL]` lines. `CAPTURE=0` skips the captures (about two
minutes each: a VS Code window opens on a hidden desktop on Windows).

The scripts reuse the CI harness of the [promotion-branches scenario](../promotion-branches/README.md),
never copied: `env-lib.sh`, `ci-workflows-prepare.cjs`, `ci-provider-<provider>.sh`,
`promotion-provider.sh` and `section-lib.sh`. The captures run the `releaseVersionsReal.test.ts` suite
of vscode-sfdx-hardis (`SFDX_HARDIS_REAL_RELEASE_VERSIONS=true`).

## Prerequisites

- Those of the promotion-branches real CI section for the provider (`preflight.sh --provider <p>`).
- One throwaway org for the four branches: a scratch org from `DEVHUB`, created by the run unless
  `RV_ORG` names one.
- The branch under test pushed to `hardisgroupcom/sfdx-hardis` (the CI jobs clone it), and linked
  locally (`sf plugins link <this working copy>`, after `yarn build`): the extension runs
  `sf hardis:project:version:list`, which the released plugin may not have.
- vscode-sfdx-hardis cloned next to this working copy (or `EXT`), on the branch of the feature, built
  with `yarn dev && yarn compile`.
- Python with Pillow for the timeline (`pip install pillow`), else the step says SKIP.

## Traps

- GitHub passes no repository variable to a job unless the workflow maps it: the run adds the
  `SFDX_HARDIS_RELEASE_VERSIONING_*` lines to the `env` of `process-deploy.yml`, and gives the job
  `contents: write`. A project that sets these variables on GitHub must do the same.
- The CI/CD variables are minimums like the config: lowering one never lowers a tag. To start a new
  PI, set every variable that changes (PI and IT), not only PI.
- The DevOps Pipeline computes the next versions on the computer, without the CI/CD variables of the
  provider: the next version chips of c07 to c10 show the values of the config, not those of the
  variables. The current version chips come from the tags and are right.
- The hand-made tag of c02 is lightweight and in a custom format: `version:list` never lists it, and
  the deployment job only learns that the name is taken when the provider refuses it.
- One org for the four branches: the org nodes of the DevOps Pipeline all point to it, each with the
  version of its own branch.
- A run stopped from outside (Claude Code stops background commands when memory runs low, mostly
  during a capture) can go on as an orphan: its bash processes keep running the steps. Before you
  replay steps with `RUN=`, stop every `bash` running `rv-e2e.sh` and every process under
  `.vscode-test`. Two copies on one repository race: each opens the Pull Request of the other, reads
  the tags before the other's tag appears, and their captures share the VS Code debug connection,
  which answers `Unexpected server response: 500` (2026-11-19).
- A step replayed after its story was merged reuses that Pull Request (`PR_<step>_story` in
  `run.env`) instead of committing the same change again; its `-INTEGRATION-NO-TAG` check says SKIP.
- The captures are what fills the memory: one VS Code of the test harness, plus
  `sf hardis:project:version:list` (about 550 MB, 36 s on a real repository). Keep about 4 GB free
  before a run.

## Reports

Nothing of a run is committed. The `report` step writes `report.md` (the results, the captures in
step order and the timeline), `results-last.tsv`, `meta.json`, `shots/` and `timeline.gif` into
`hardis-report/e2e/release-versioning/<run>/` of the working copy, which git ignores.

Once the runs are done, show them in one claude.ai artifact, private to the user until they share it:

```bash
cd .claude/skills/e2e/scenarios/release-versioning/scripts
python rv-showcase.py ../../../../../../hardis-report/e2e/release-versioning/showcase \
  ../../../../../../hardis-report/e2e/release-versioning/<run> [<run> ...] --findings findings.json
```

`findings.json` lists what the runs found: `[{"kind": "bug" | "fixed" | "question" | "harness" | "environment",
"title": "...", "text": "..."}]`. The script writes `index.html` and `shots/<run>/*.png`, the
captures cropped to the editor area. Publish the folder with `publish_files` of the claude-artifacts
server (`index.html` and every capture as `shots/<run>/<file>`), or republish the artifact of the
last batch with its slug. The page lists the runs; for each one, its steps with the tag created, the
DevOps Pipeline after the step picked (with the other captures of the step), a play button that
walks the steps, and every check. Give the user the link, and put it in the Pull Request.
