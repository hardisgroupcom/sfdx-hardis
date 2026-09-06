---
name: promotion-branches
description: How the promotion branches feature works (enablePromotionBranches, sf hardis:project:promotion:create) across sfdx-hardis and vscode-sfdx-hardis, and every file to touch when changing it. Use when working on promotion branches, on the Pull Request scope of deploy:smart, on release notes filtering, or on the DevOps Pipeline windows, counters and toggles.
user-invocable: false
---

# Promotion branches (beta)

A **promotion branch** carries a chosen subset of the User Stories waiting in a major branch to the
next major branch, ahead of the rest of the promotion window. It is a selective merge: instead of
merging `uat` into `preprod` and shipping everything, you assemble a branch holding only the
approved stories.

Feature switch: **`enablePromotionBranches`** in `config/.sfdx-hardis.yml`, default `false`.
Everything below is inert while it is off, with one exception noted in [Filtering](#filtering-what-moves-the-pull-requests).
The feature is **beta** and must be labelled as such in docs and UIs.

User documentation: `docs/salesforce-ci-cd-promotion-branches.md`
(<https://sfdx-hardis.cloudity.com/salesforce-ci-cd-promotion-branches/>).
End to end test runbook: the `promotion-branches-e2e` skill.

## Mental model

- **Promotion branch** = `promotion/<source>/<target>/<YYYY-MM-DD>-<counter>`, for example
  `promotion/uat/preprod/2026-09-06-1`. The shape is **fixed, not configurable**. Only
  `sf hardis:project:promotion:create` builds one, with `git cherry-pick -x` (`-m 1` on merge
  commits).
- **Declaration** = the promotion Pull Request lists what it carries in a ```yaml block of its
  description:

  ```yaml
  promotionPullRequests: [482, 487]
  ```

  This is the only link back to the stories: a cherry-pick rewrites the commit SHAs, so SHA
  matching cannot find them. A branch named `promotion/...` **without** the block, or a branch with
  the block but not named `promotion/...`, is an ordinary branch and gets a warning.
- **Carried story** = a Pull Request named in that block. sfdx-hardis pulls it into the scope of the
  job so its deployment actions run, its Apex test classes are selected and its custom behaviors
  are inherited, exactly as if it had been merged directly.
- **Vehicle** = a Pull Request that *moves* other Pull Requests rather than carrying work of its
  own: a merge between two major branches (always), and a promotion Pull Request (only when the
  feature is on). Everything else, whatever it is named (`feature/`, `fix/`, `retrofit/`,
  `hotfix/`...), carries its own change and is a User Story.
- **Single place** = a Pull Request number appears in exactly one branch of the DevOps Pipeline, the
  branch it actually reached. A story a promotion carried away is listed in the target branch, not
  in the one it was merged into.
- **One promotion in flight per step** = at most one open promotion Pull Request between two given
  major branches. `promotion:create` closes the ones it supersedes (after asking a human, silently
  in agent mode), and the DevOps Pipeline draws the open one on the arrow between the two branch
  nodes instead of giving it a branch node of its own.

## Invariants

Break one of these and the feature is wrong, whatever the tests say.

1. **With `enablePromotionBranches: false`, deployment behaviour is byte for byte what it was.** A
   `promotion/...` branch is an ordinary feature branch. The only allowed difference is one
   informational log line. This is proven by the A/B regression check in the
   `promotion-branches-e2e` skill.
2. **A promotion never runs actions against the wrong org.** A `promotion/uat/preprod/...` branch
   whose Pull Request targets `main` is retargeted by hand: its declaration is ignored
   (`isPromotionPullRequestForItsTarget`), scope is the Pull Request alone, with a warning.
3. **A Pull Request number appears in a single place** in the pipeline diagram, unless the
   **Show already promoted Pull Requests** toggle is on.
4. **User facing lists show User Stories only.** Vehicles are hidden unless the **Show merge and
   promotion Pull Requests** toggle is on (diagram and modal), or `--include-promotions` is passed
   (release notes).
5. **Nothing is silently dropped.** A declared Pull Request that cannot be read is reported, not
   skipped in silence; a promotion whose stories could not be resolved stays in the release notes.
6. **Expansion is multi level.** A `preprod -> main` promotion can carry a `uat -> preprod`
   promotion, which carries stories. Both levels must resolve.
7. **Conflict markers never reach an org.** `assertNoPromotionConflictMarkers` greps every tracked
   file, not only the package directories.
8. **A promotion is never closed before its replacement exists.** `promotion:create` closes the
   superseded Pull Requests only after the new one has been created, so a failure while
   cherry-picking cannot leave a pipeline step with no promotion open.
9. **Not knowing is not a reason to act.** When the git provider cannot list the open Pull
   Requests, nothing is closed and the command says so.
10. **A vehicle is never carried.** The candidate list of `promotion:create` associates a commit
    with the Pull Requests of the commits it brought in, and a sync merge from a major branch
    matches that major branch's own Pull Request. `dropVehiclePullRequests` removes them (and their
    deployment actions) before anything is offered, declared or cherry-picked.
11. **A branch merged twice is listed once.** `shouldAddVirtualPullRequest` refuses the number-less
    entry when a real Pull Request of the same branch is already in the group.
12. **Superseding gives the stories back.** A promotion this run is about to close is not evidence
    that its stories are already promoted (`countsAsAlreadyPromoted`): otherwise agreeing to
    supersede it would leave nothing to assemble.

## sfdx-hardis (CLI)

| File                                                                                                              | Role                                                                                                                                                          |
|-------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `src/common/utils/promotionBranchUtils.ts`                                                                        | Pure logic: naming, parsing the declaration, classification, expansion, inherited behaviors, promotion index. No I/O.                                         |
| `src/common/utils/promotionCreateUtils.ts`                                                                        | Everything `promotion:create` needs: candidate listing, already-promoted detection, cherry-picking, conflict handling, Pull Request body.                     |
| `src/commands/hardis/project/promotion/create.ts`                                                                 | The command. Flags: `--source-branch`, `--target-branch`, `--pull-requests`, `--skip-pull-request`, `--include-already-promoted`, `--on-conflict`, `--agent`. |
| `src/common/utils/pullRequestUtils.ts`                                                                            | Resolves the declared Pull Requests from the git provider, walks the downstream promotions.                                                                   |
| `src/common/gitProvider/gitProviderRoot.ts` + the four providers                                                  | `closePullRequest()` (close on GitHub/GitLab, abandon on Azure DevOps, decline on Bitbucket), used to supersede the promotion already open.                   |
| `src/commands/hardis/project/deploy/smart.ts`                                                                     | Applies the inherited custom behaviors and the conflict-marker gate.                                                                                          |
| `src/common/utils/prePostCommandUtils.ts`                                                                         | Deployment actions of the carried stories, promotion scope wording.                                                                                           |
| `src/common/utils/releaseNotesUtils.ts`                                                                           | Leaves the vehicles out, `--include-promotions` brings them back.                                                                                             |
| `src/common/gitProvider/index.ts`                                                                                 | `inheritedCustomBehaviors` + the `inheritedCustomBehaviorsPrId` guard.                                                                                        |
| `config/sfdx-hardis.jsonschema.json`                                                                              | `enablePromotionBranches` property (required for any new config key).                                                                                         |
| `test/common/utils/promotionBranchUtils.test.ts`, `promotionCreateUtils.test.ts`, `releaseNotesPromotion.test.ts` | Unit tests.                                                                                                                                                   |

Reading the flag: `getConfig('branch')` (project config merged with the running branch's config),
via `getPromotionBranchConfig(config)`. It is a **project level** setting: the extension exposes it
at project scope only.

### Pull Request scope kinds

`single-pr`, `batch`, `go-live`, `check`, `promotion`, `promotion-check`. A promotion job resolves
to `promotion` / `promotion-check` and its scope is *the declared stories plus the promotion Pull
Request itself*.

### Custom behavior keywords

`NO_DELTA`, `PURGE_FLOW_VERSIONS` and `DESTRUCTIVE_CHANGES_AFTER_DEPLOYMENT` are recognized
anywhere in a description. **`FLOW_DELETE_INTERVIEWS` is not**: interview deletion is irreversible,
so it only counts on a line of its own, as a bullet, or as a ticked checkbox. A promotion inherits
the keywords of the stories it carries, and **only** those: a keyword of a story left behind must
not leak in.

## vscode-sfdx-hardis (extension)

| File                                                 | Role                                                                                                                                                                                          |
|------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `src/utils/pipeline/promotionBranchUtils.ts`         | Mirror of the CLI pure logic, plus the pipeline rules: `isVehiclePullRequest`, `userStoryPullRequests`, `visiblePullRequests`, `annotateAlreadyPromoted`, `enforceSinglePlacePerPullRequest`. |
| `src/commands/showPipeline.ts`                       | Fetches the declared Pull Requests (in parallel), builds the windows.                                                                                                                         |
| `src/pipeline-data-provider.ts`                      | Feeds the mermaid builder.                                                                                                                                                                    |
| `src/utils/pipeline/branchStrategyMermaidBuilder.ts` | Node counters (`data-count`, `data-count-all`), and the open promotion drawn on the major-to-major edge (`isPromotionOfStep`).                                                                |
| `src/webviews/lwc-ui/modules/s/pipeline/pipeline.js` | Branch window modal: filtering, the two toggles, the per-Pull-Request checkboxes and the **Create promotion** button.                                                                         |
| `src/utils/pipeline/sfdxHardisConfigHelper.ts`       | `enablePromotionBranches` sits in the **Danger Zone** of Pipeline Settings, scope `["global"]`.                                                                                               |
| `src/hardis-commands-provider.ts`                    | Command palette entry for `hardis:project:promotion:create`.                                                                                                                                  |
| `package.json`                                       | `pipelineShowAlreadyPromotedPullRequests` setting.                                                                                                                                            |

## Filtering: what moves the Pull Requests

The rule the lists and counters follow, in the diagram, the modal and the release notes:

| Pull Request                                              | promotions OFF | promotions ON |
|-----------------------------------------------------------|----------------|---------------|
| `feature/`, `fix/`, `retrofit/`, `hotfix/`, anything else | listed         | listed        |
| `uat -> preprod` (major to major)                         | **hidden**     | **hidden**    |
| `promotion/uat/preprod/...`                               | listed         | **hidden**    |

Major-to-major merges are filtered for **every** project: such a merge is plumbing in any pipeline.
A `promotion/` branch is only a vehicle when the feature is enabled, because otherwise it really is
an ordinary branch, which is exactly how the deployment jobs treat it.

What brings the vehicles back: the **Show merge and promotion Pull Requests** toggle (top right of
the branch window modal), and `--include-promotions` on `hardis:doc:release-notes`.

## Performance

A big project has hundreds of Pull Requests, so:

- `buildPromotionIndex` parses each promotion description once and indexes by story number;
  never re-parse per story.
- Provider queries for already-promoted detection are bounded by `oldestCandidateDate`.
- The extension fetches the declared Pull Requests in parallel and caches the merged ones.

## When you change something

- New config property: add it to `config/sfdx-hardis.jsonschema.json`, and to
  `resources/sfdx-hardis.jsonschema.json` in the extension if the settings UI must know it before
  sfdx-hardis publishes the schema.
- New user-visible string: `t()` plus the key in **all 9 locales** (`node scripts/i18n-upsert.mjs`
  in the CLI, the 9 `src/i18n/*.json` in the extension).
- Any behaviour change: re-run the A/B regression check with the feature **off** before saying it
  is safe. A green unit suite has already missed a flag-off regression once.
- The feature is beta: keep the "(beta)" mention in the docs page, the JSON schema description and
  the settings UI.
