# Handoff: release versioning

Work in progress, to continue on another computer. **Delete this file before merging PR #2498.**

## Where things are

| Repository         | Branch                    | Pull Request                                                  | Last commit |
|--------------------|---------------------------|---------------------------------------------------------------|-------------|
| sfdx-hardis        | `feat/release-versioning` | https://github.com/hardisgroupcom/sfdx-hardis/pull/2498       | `95727d11`  |
| vscode-sfdx-hardis | `feat/release-versioning` | https://github.com/hardisgroupcom/vscode-sfdx-hardis/pull/622 | `1c5055e`   |

Done: analysis, design, implementation, code review (high) of the CLI PR and its fixes.

Still to do on the first part:

- Code review of the extension PR #622 (not run yet)
- Look at the DevOps Pipeline panel in a running VS Code, light and dark themes
- Run the `release-versioning` e2e scenario (`.claude/skills/e2e/scenarios/release-versioning/README.md`): scripts written (`rv-e2e.sh`, `PART=default` and `PART=custom`, GitHub and GitLab, DevOps Pipeline captured after each step), never run yet. Prerequisites: `sf plugins link` of this branch, the extension built (`yarn dev && yarn compile`), Pillow
- CI of both PRs has not run yet
- The local commitlint hook crashes (`yargs_1.default.options is not a function`), commits still go through
- Left from the review: the Azure DevOps provider builds the repository web URL in two places (merging them changes an existing function)
- 16 unit tests fail locally: 15 blocked by the corporate proxy (403), 1 JIRA test that also fails on main

## Decisions already made (do not reopen)

- Release candidate scheme: release candidates below the highest versioned branch (`v1.5.0-rc.3`), plain version on it (`v1.5.0`).
- Only branches whose branch config declares `releaseVersioning: true` are versioned. Their order comes from `mergeTargets`: roles `first`, `middle`, `final`.
- One minor per release, opened on the first versioned branch (UAT) once the previous release has moved up. Hotfixes go through preprod and give a patch.
- `v` prefix, initial version configurable (`releaseVersioningInitialVersion`, default `1.0.0`), `releaseVersioningMinimumVersion` to start a major.
- Tags and Releases go through the git provider REST API (no push from CI), annotated tag message `sfdx-hardis release version <tag>` with `branch`, `org`, `deployedAt`, `pullRequest`, `jobUrl`.
- Tags and provider Releases are always on with `releaseVersioning: true`. Versions on tickets are opt-in: `releaseVersioningTicketVersions: none | allCandidates | finalOnly`, default `none` (JIRA fix versions, labels elsewhere).
- Release notes and the Release only when the deployment to the highest versioned branch succeeds. The release notes notification (Slack, Teams, email) is sent after the Release, with a "View Release" button. Every versioned deployment notification has a `Release version` line.
- Performance of the DevOps Pipeline: `version:list` only calls the git provider with `--with-links`; the extension builds the links itself, runs the command after the first paint, and caches the result per panel session.
- GitHub workflow template keeps `contents: read`, with a comment to switch to `write` when versioning is on.

Main code: `src/common/utils/releaseVersionRules.ts` (pure rules, unit tested in `test/common/utils/releaseVersionRules.test.ts`), `src/common/utils/releaseVersionUtils.ts` (git and provider I/O), `src/commands/hardis/project/version/list.ts`, wiring in `src/commands/hardis/project/deploy/smart.ts`. Docs: `docs/salesforce-ci-cd-release-versioning.md`. Extension: `src/utils/pipeline/releaseVersionUtils.ts` and the pipeline LWC.

## Custom tag formats per branch (implemented)

Analysis, design (`release-versioning-tag-formats-design.md`, its 5 choices validated) and implementation done in both repositories, same branches, same PRs. Still to do: a code review of this part, and a custom-format step in the e2e scenario once its scripts exist. The extension work was done in a worktree (`C:/git/vscode-sfdx-hardis-rv`): the main clone kept a local `.claude/settings.json` change. Both keys are in Pipeline Settings (a key/value editor for `releaseVersioningMinimumVariables`), and CI/CD variables override them (`SFDX_HARDIS_RELEASE_VERSIONING_TAG_FORMAT`, `SFDX_HARDIS_RELEASE_VERSIONING_VAR_<NAME>`, `..._VAR_<BRANCH>_<NAME>`), as minimums like the config.

### Goal

Each versioned branch below production chooses the format of its release candidate tags (`v1.0.0-pi2-it4-uat-rc1` in UAT, `v1.0.0-rc1-preprod` in preprod). Production keeps `vX.Y.Z`.

### Requirements

1. `releaseVersioningTagFormat`, project default and branch override. Default `v{MAJ}.{MIN}.{PATCH}-rc.{RC}` (the current tags). Built-in placeholders `{MAJ}` `{MIN}` `{PATCH}` `{RC}` (required) and `{BRANCH}` (git branch name, `/` written `-`). Any other `{NAME}` is a custom variable. Allowed characters: letters, digits, `.`, `_`, `-` (valid git tag, JIRA fix version and ticket label).
2. The highest versioned branch (main) keeps `vX.Y.Z`: the template is ignored there, with a warning.
3. Release candidate counter per tag text: next rc = 1 + highest rc among tags of the same version with the same text around `{RC}`. UAT `pi2-it4-uat-rc1..rc3`, preprod restarts at `rc1`, a new PI or IT restarts at `rc1`. Two branches with the same template share one counter, so tags never collide.
4. Custom variables (`{PI}`, `{IT}`) never change on their own: a tag carries the values of the previous tags. They change only when a PR changes the configured minimum (e.g. `releaseVersioningMinimumVariables: {PI: 3, IT: 1}`), the next tag then takes them. Compared together in template order like a semver: PI 3 / IT 1 is above PI 2 / IT 5. Lowering the config later has no effect.
5. A template variable with no value in previous tags nor in the config: warning, no tag, the deployment goes on.
6. The numbering never depends on the template: sfdx-hardis writes `version`, `rc` and the variables in the annotated tag message and reads them back from there. Tags not created by sfdx-hardis count only in plain semver form (`v1.3.0`, `v1.3.0-rc.2`). No reading of existing hand-made custom tags.
7. An invalid template never fails a deployment: warning, default format.

### Impacts

- Code: `src/common/utils/releaseVersionRules.ts` (template formatting, counter per text, variables), `src/common/utils/releaseVersionUtils.ts` (read template and variables minimum of each branch, structured tag message). Check every use of `version.rc` for ordering (`nextRcNumber`, `compareTagsNewestFirst`, `findPreviousVersionTag`, final base choice): rc numbers are no longer unique per version.
- JSON schema: 2 keys. Docs page `docs/salesforce-ci-cd-release-versioning.md`, descriptions of `deploy:smart` and `version:list`, CHANGELOG (extend the existing release versioning line).
- i18n: 4 warning keys in 9 locales (invalid template, invalid variable value, template ignored on production branch, variable without value).
- Unit tests: the UAT / preprod example as a full scenario, with a PI change.
- PR comment, notifications, tickets, Releases: no change, they show the tag name.
- VS Code extension: config editor gets the 2 keys (`sfdxHardisConfigHelper.ts`, project and branch scope), schema copy, tests with a custom tag. It never parses tags (uses `tag` and `prerelease` from `version:list --json`), `SAFE_RELEASE_TAG` already accepts these characters.
- Training: none.
