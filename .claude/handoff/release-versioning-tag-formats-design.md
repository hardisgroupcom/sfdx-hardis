# Design: custom tag formats per branch (release versioning)

Follows the analysis in `release-versioning.md` ("Next step: custom tag formats per branch"). Same branches, same PRs (#2498, extension #622). Delete with the handoff file before merging.

## Overview

Each versioned branch below the highest one renders its release candidate tags from a template, `releaseVersioningTagFormat` (project default, branch override), default `v{MAJ}.{MIN}.{PATCH}-rc.{RC}`. The version rules stay as they are: they still pick a base version (`1.4.0`) from the role of the branch. Two things change. The rc number becomes a counter per rendered text: same version and same text around `{RC}`. Custom variables (`{PI}`, `{IT}`) come from the previous sfdx-hardis tags, raised by `releaseVersioningMinimumVariables`. sfdx-hardis never parses a custom tag name: it writes `version`, `rc` and `variables` in the annotated tag message and reads them back from there. Plain semver tag names (`v1.3.0`, `v1.3.0-rc.2`) are still read from the name, for tags made by hand.

## Rules, as implemented

### Template

- Allowed: literal `[A-Za-z0-9._-]` and placeholders `{NAME}`, `NAME` = `[A-Za-z][A-Za-z0-9_]*` (case-sensitive).
- `{MAJ}`, `{MIN}`, `{PATCH}`, `{RC}`: each exactly once. `{BRANCH}`: optional, at most once.
- Any other placeholder is a custom variable, at most once each, in template order.
- Two placeholders cannot touch (`{MIN}{PATCH}`): at least one literal between them, so a rendered name never reads as another version.
- The rendered name must be a valid git tag: does not start with `-` or `.`, no `..`, does not end with `.` or `.lock`. Checked on the template with placeholders replaced by `0`.
- `{BRANCH}`: the git branch name (`release/uat`), every character outside `[A-Za-z0-9._-]` written `-` (`release-uat`).
- Invalid template: warning `releaseVersionInvalidTagFormat`, the branch uses the default format. Never fails the deployment.
- Highest versioned branch (role `final`): always `vX.Y.Z`. Warning `releaseVersionTagFormatIgnoredOnFinalBranch` **only when its own branch config sets `releaseVersioningTagFormat`**. A project-level format is documented as "release candidates only", so production does not warn on every deployment.

### Release candidate counter

For a branch with format `F`, base version `B` and variables `V`:

```
render(rc) = F with MAJ/MIN/PATCH from B, BRANCH, V, RC = rc
next rc    = 1 + max { tag.rc : tag.version base == B and tag.name == render(tag.rc) }   (1 when none)
then, while render(rc) is a name already taken (takenTagNames), rc++
```

- No regex on tag names, no stored "key": a tag counts when re-rendering it with its own rc gives back its own name.
- Default format: `render(rc)` = `v1.4.0-rc.{rc}`. Every semver rc tag of that base counts, made by hand or not, so the current behavior (one counter per version, shared by every branch) is unchanged.
- Two branches with the same rendered text share a counter. UAT `pi2-it4-uat-rc1..3`, preprod `rc1-preprod` restarts at 1, a new PI restarts at 1.
- `takenTagNames`: the names the git provider answered `alreadyExists` for in the retry loop of `handlePostDeploymentReleaseVersion`. Covers a tag made by hand with the exact rendered name, which the counter cannot see. Today the loop would compute the same name three times and give up.

### Custom variables

For the variables `[PI, IT]` of a format (template order):

- Candidates: the `variables` of every sfdx-hardis tag (any branch, any version), plus the configured minimum of the deployed branch (`releaseVersioningMinimumVariables`, branch value over project value, key by key).
- Each candidate is a tuple in template order. Tuples compare element by element: both integers, numeric order; otherwise `localeCompare(..., { numeric: true })`. Only a candidate with a value for every variable counts (a tag of another format with only `{PI}` is skipped).
- The highest tuple wins. Lowering the config later has no effect: the tags already hold a higher tuple.
- If no candidate is complete: decision `reason: 'missing-variables'`, `version: null`, `missingVariables` (the variables the config does not give). The caller logs `releaseVersionTagVariableMissing`, creates no tag, and the deployment goes on.
- A config value outside `[A-Za-z0-9._-]+`: existing warning `releaseVersionInvalidConfig`, the value is ignored.

Example: tags hold `PI=2 IT=5`. A PR sets `{PI: 3, IT: 1}`. Next tag: `pi3-it1`, rc 1. Later the config is set back to `{PI: 2, IT: 9}`: the tags still hold `3/1`, so it stays `pi3-it1`.

### Tag message

```
sfdx-hardis release version v1.0.0-pi2-it4-uat-rc1

branch: uat
version: 1.0.0
rc: 1
variables: PI=2 IT=4
org: ...
deployedAt: ...
pullRequest: ...
jobUrl: ...
```

`rc` is omitted on a plain version, and `variables` when there are none. Values cannot hold spaces or `=` (allowed characters), so `NAME=value` separated by spaces parses safely.

### Reading tags (`listVersionTags`)

- Annotated tag with an sfdx-hardis message that has `version:` (and `rc:`): version from the message, whatever the name.
- Otherwise: version from the name, only in plain semver form (current behavior). A sfdx-hardis message without `version:` (tags made by this PR's earlier commits) also falls back on the name.
- Anything else is ignored. A hand-made `v1.0.0-pi2-rc1` is not read.

### Orderings that assumed one rc per version

| Function                  | Today                                                    | Change                                                                                                                                                                                              |
|---------------------------|----------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `nextRcNumber`            | max rc of the base + 1                                   | Replaced by the counter above                                                                                                                                                                       |
| `findPreviousVersionTag`  | rc tag: highest version below it on the same branch      | rc tag managed by sfdx-hardis: the tag deployed on the same branch just before it (`compareTagsNewestFirst`, date strictly older). `pi3-it1-rc1` then starts from `pi2-it4-rc3`, not from nothing. Plain versions: unchanged |
| `compareTagsNewestFirst`  | date, then version                                       | date, then version, then name, so the order is stable                                                                                                                                               |
| `chooseFinalBase`, `hasMovedUp`, `highestBase`, `highestPlainVersion` | bases only                     | No change                                                                                                                                                                                           |
| `computeNextReleaseVersion` "already-tagged" | commit + branch                       | No change                                                                                                                                                                                           |

## Files to modify (sfdx-hardis)

### `src/common/utils/releaseVersionRules.ts`

- Types:
  - `VersionTag`: add `variables: Record<string, string>`.
  - `VersionTagMetadata`: add `version: ReleaseVersion` and `variables: Record<string, string>`.
  - `ReleaseVersionSettings`: add `tagFormats: Record<string, ParsedTagFormat>` and `minimumVariables: Record<string, Record<string, string>>`, keyed by config branch name. A branch missing there gets the default format and no minimum.
  - `ReleaseVersionContext`: add `takenTagNames?: string[]`.
  - `ReleaseVersionDecision`: add `variables: Record<string, string>` and `missingVariables?: string[]`.
  - `ReleaseVersionReason`: add `'missing-variables'`.
- New exports:
  - `DEFAULT_TAG_FORMAT`
  - `parseTagFormat(text): ParsedTagFormat | null`, with `ParsedTagFormat = { text, parts: Array<{ literal } | { placeholder }>, variables: string[] }`
  - `formatTagName(format, version, branch, variables)`
  - `toTagBranchSegment(branch)`
  - `compareVariableTuples(a, b, names)`
  - `isValidTagVariableValue(value)`
- `computeNextReleaseVersion`: after the base is chosen, the final branch keeps `formatReleaseVersion(base)`. The other roles resolve the variables (or return `missing-variables`), compute the rc with the counter, and render the name.
- `formatVersionTagMessage` / `parseVersionTagMessage`: the `version`, `rc` and `variables` lines. The parser also returns `version` (or null when missing).
- `nextRcNumber` → `nextRcNumberForFormat(tags, base, render, takenTagNames)`, private. `resolveTemplateVariables` is private too.
- `findPreviousVersionTag`, `compareTagsNewestFirst`: as in the table.
- Header comment: say the tag name follows the format of the branch and the numbering lives in the tag message.
- Method order: the new public exports go after `computeNextReleaseVersion` in call order. Private helpers go after `listReachableUp`.

### `src/common/utils/releaseVersionUtils.ts`

- `readReleaseVersionSettings(commandRef, majorOrgs, graph)`:
  - Reads `releaseVersioningTagFormat` and `releaseVersioningMinimumVariables` from `getConfig("project")` and from each major org (`listMajorOrgs()` already returns the branch config properties). The branch value wins; for variables, key by key.
  - Parses each format, warns on invalid formats and values, and warns about a format set on the final branch.
  - Both callers already have `majorOrgs` and `graph`: pass them in.
- `handlePostDeploymentReleaseVersion`:
  - Keeps a `takenTagNames` list across attempts and passes it in the context.
  - On `missing-variables`, warns and returns null.
  - Writes `version`, `rc` and `variables` in the message.
- `listVersionTags`: reads the version from the message first (see above), and fills `variables`.
- `ReleaseVersionEntry` / `ReleaseVersionResult`: add `variables: Record<string, string>`. `version` keeps its semver form (`1.0.0-rc.1`). That is no longer unique with custom formats: the doc of `version:list` says so, and `tag` stays the identifier.
- `simulatePromotions`: no change. A missing variable gives no `nextOnPromotion` entry.

### `src/common/utils/releaseNotesUtils.ts`

- `findPreviousSemverTag`: today it goes through the version rules only when `parseReleaseVersion(currentTag)` succeeds. A custom tag (`v1.0.0-rc1-preprod`) would fall into the `git tag --sort=-v:refname` fallback, whose regex `^v?\d+\.\d+\.\d+` matches it and picks a wrong previous tag.
- Change: use the rules when `versionTags` contains `currentTag` or the name parses. `versionTags` is loaded before the test when it was not passed in.

### `config/sfdx-hardis.jsonschema.json`

- `releaseVersioningTagFormat`:
  - Type string, pattern `^[A-Za-z0-9._{}-]+$` (the full check is in code), default `v{MAJ}.{MIN}.{PATCH}-rc.{RC}`.
  - Examples: `v{MAJ}.{MIN}.{PATCH}-pi{PI}-it{IT}-uat-rc{RC}`, `v{MAJ}.{MIN}.{PATCH}-rc{RC}-{BRANCH}`.
  - Description: project default and branch override; ignored on the highest versioned branch; placeholders.
- `releaseVersioningMinimumVariables`:
  - Type object, `additionalProperties` string or integer matching the allowed characters.
  - Example `{PI: 3, IT: 1}`.
  - Description: values never go down, and the next tag takes the new values.
- Both with `docUrl`, after `releaseVersioningMinimumVersion`.

### Docs and descriptions

- `docs/salesforce-ci-cd-release-versioning.md`:
  - New section `### Tag format of release candidates`, after "How a version is chosen": the placeholders, the rules, the UAT / preprod example with a PI change (a table like the existing one), what happens on production, missing variables, and an invalid format.
  - Fix the "one release candidate counter per version, shared by every branch" sentence and row: one counter per tag text, which is the same thing with the default format.
  - "Limits": tags made by hand count only in plain semver form.
- `src/commands/hardis/project/deploy/smart.ts` description (line 470): one sentence on custom formats.
- `src/commands/hardis/project/version/list.ts` description: `variables` in the JSON, and `version` being the semver form.
- `CHANGELOG.md`: extend the existing "Release versioning" line, using the `changelog` skill. No new line.
- `yarn build:doc --commands hardis:project:deploy:smart hardis:project:version:list`, then `yarn build:llms-txt`.

## New files

None.

## i18n keys (9 locales, alphabetical)

| Key                                            | English                                                                                                                                                                                         |
|------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `releaseVersionInvalidTagFormat`               | `Invalid releaseVersioningTagFormat "{{format}}" for branch {{branch}}: it must contain {MAJ}, {MIN}, {PATCH} and {RC} once, separated by text, with only letters, digits, ".", "_", "-" and {NAME} variables. The default format {{defaultFormat}} is used.` |
| `releaseVersionTagFormatIgnoredOnFinalBranch`  | `releaseVersioningTagFormat is ignored on {{branch}}: the highest versioned branch always gets plain versions ({{example}}).`                                                                    |
| `releaseVersionTagVariableMissing`             | `No value for {{variables}} in the tag format of {{branch}}: no version tag is created. Set it in releaseVersioningMinimumVariables.`                                                            |

The `{MAJ}`-style placeholders in the first key are literal text, not i18next interpolation (i18next only interpolates `{{...}}`). The translations must keep them as they are. The `i18n-translate` agent runs only once `en.json` is final (see memory).

## Dependencies

None.

## Testing approach

`test/common/utils/releaseVersionRules.test.ts`, new `describe('custom tag formats')`:

1. `parseTagFormat`: default, custom variables in order, `{BRANCH}`, and rejections (missing `{RC}`, duplicate `{MIN}`, touching placeholders, `/`, leading `-`, `..`).
2. Full scenario with UAT `v{MAJ}.{MIN}.{PATCH}-pi{PI}-it{IT}-uat-rc{RC}`, preprod `v{MAJ}.{MIN}.{PATCH}-rc{RC}-preprod`, main default, config `{PI: 2, IT: 4}`:
   - uat: `v1.0.0-pi2-it4-uat-rc1`, then `-rc2` and `-rc3`
   - preprod: `v1.0.0-rc1-preprod`
   - config set to `{PI: 3, IT: 1}`, uat: `v1.1.0-pi3-it1-uat-rc1`
   - main: `v1.0.0`
   - hotfix into preprod: `v1.0.1-rc1-preprod`
   - config lowered to `{PI: 2, IT: 9}`: still `pi3-it1`
3. Same format on two branches: one shared counter, no collision.
4. Missing variable: `missing-variables`, no tag name.
5. A format on the final branch is ignored (`v1.0.0`).
6. `takenTagNames` skips a name taken by hand.
7. Tag message round trip with `version`, `rc` and `variables`; a message without `version` falls back on the name.
8. `findPreviousVersionTag` across a PI change on the same branch.
9. Regression: the existing ten-deployment cycle passes unchanged with the default format.

Then:

- `yarn compile`, `yarn lint`, `yarn test:only` on the release versioning and release notes tests.
- The `release-versioning` e2e scenario gains a custom-format step when its scripts are written. That is still pending in the handoff, not part of this step.

## VS Code extension impact

Small. On branch `feat/release-versioning` (local clone is on `main`: check the branch out first), PR #622:

- `src/utils/pipeline/sfdxHardisConfigHelper.ts`: `{ name: "releaseVersioningTagFormat", scopes: ["global", "branch"] }` and `{ name: "releaseVersioningMinimumVariables", scopes: ["global", "branch"] }`, after `releaseVersioningMinimumVersion`.
  - Check that the config editor handles an object value (`additionalProperties`). If it does not, the key is listed for display only, or `releaseVersioningMinimumVariables` stays out of the editor and the docs say to edit the YAML. Decide when implementing, after reading how other object keys are edited.
- `resources/sfdx-hardis.jsonschema.json`: copy of the CLI schema.
- `src/utils/pipeline/releaseVersionUtils.ts`: `parseReleaseVersionEntry` passes `variables` through (optional, not displayed). Its `version` fallback `tag.replace(/^v/, "")` only runs on old CLIs.
- Tests: a `version:list` fixture with a custom tag (`v1.0.0-pi2-it4-uat-rc1`), shown on the pipeline nodes and in the history. `SAFE_RELEASE_TAG` (`/^[\w.+-]+$/`) accepts it.
- No new flag, prompt or WebSocket event. No minimum CLI version bump: the JSON change only adds fields.
- Extension `CHANGELOG.md` `## Unreleased`: extend its release versioning line.

## Training impact

None. No lab uses release versioning.

## Risks and choices to confirm

1. **Production warning only when the production branch config sets a format.** A project-level format would otherwise warn on every production deployment.
2. **Variables are the highest among all sfdx-hardis tags, any branch and any version.** PI is global to the project. A branch whose format has no `{PI}` neither reads nor writes it.
3. **The previous rc of a branch is found by deployment date, no longer by rc number.** Needed because `pi3-it1-rc1` comes after `pi2-it4-rc3`. Tags made by hand have no deployment date of their own (only a creation date) and are not tied to a branch, so this path is unchanged for them.
4. **`version` in the JSON is not unique anymore** (`1.0.0-rc.1` for the UAT rc1 and the preprod rc1). The extension keys everything on `tag`. Third-party scripts reading `version` would see duplicates.
5. **Changing a format resets the counter** (`-rc{RC}` to `-rc.{RC}` gives a new text). Intended ("per tag text"), and documented.
6. **Release notes of a custom rc** go through `findPreviousSemverTag`, which needs the release notes fix above. Missing it would silently give wrong release notes ranges.
