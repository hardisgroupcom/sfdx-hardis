---
name: promotion-branches
description: How the promotion branches feature works (enablePromotionBranches, sf hardis:project:promotion:create) across sfdx-hardis and vscode-sfdx-hardis, and every file to touch when changing it. Use when working on promotion branches, on the Pull Request scope of deploy:smart, on release notes filtering, or on the DevOps Pipeline windows, counters and toggles.
user-invocable: false
---

# Promotion branches (experimental)

A **promotion branch** carries a chosen subset of the User Stories waiting in a major branch to the
next major branch, ahead of the rest of the promotion window. It is a selective merge: instead of
merging `uat` into `preprod` and shipping everything, you assemble a branch holding only the
approved stories.

Feature switch: **`enablePromotionBranches`** in `config/.sfdx-hardis.yml`, default `false`.
Required with it: **`allowedPromotionSteps`**, the source and target branches a release manager
may assemble a promotion between (`- source: uat` / `target: preprod`). `promotion:create`
refuses to run while the list is missing.
Everything below is inert while it is off, with one exception noted in [Filtering](#filtering-what-moves-the-pull-requests).
The feature is **experimental** and must be labelled as such in docs and UIs.

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
7. **Conflict markers never reach an org, and the reviewer is told why.**
   `assertNoPromotionConflictMarkers` greps every tracked file, not only the package directories.
   It stops the job before anything is deployed, so no other code would ever post a Pull Request
   comment: it sets `deployErrorsMarkdownBody` / `status: 'invalid'` on the Pull Request data and
   calls `GitProvider.managePostPullRequestComment(checkOnly)` **before** throwing. A red job with
   no comment on the very Pull Request that has to be fixed is not an acceptable outcome.
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
13. **A vehicle is expanded before it is dropped.** A promotion merged into the source branch
    arrives in the next branch as one cherry-picked merge commit that names the promotion, not the
    stories under it: the `-x` trailers only survive one level. `expandPromotionsInGroups` replaces
    it with what its `promotionPullRequests` block declares, recursively, before invariant 10
    removes it. Without that, a candidate two levels down carries no number, cannot be selected,
    and its stories are stranded one branch short of production.
14. **Which commits a merge brought in is a question about the graph, never about the dates.** A
    cherry-picked commit keeps the author date it had on the branch it came from, so it is older
    than the merge before it. `attributeCommitsToFirstParents` walks
    `git rev-list --parents`, stopping at the other first-parent commits, oldest merge first.
    Attributing by date puts the stories of a promotion under the wrong merge, and a promotion
    assembled from that grouping declares stories whose metadata it does not carry.
15. **Every yaml block of a description counts, and a list adds up.** `mergePrDescriptionYamlBlocks`
    concatenates list values across blocks (without duplicates) and keeps the last value for
    anything else, so appending a block to name one more Apex test class does not drop the ones
    declared above it.
16. **Nobody promotes on a step the project never declared.** `allowedPromotionSteps` is required as
    soon as `enablePromotionBranches` is on: `promotion:create` stops with
    `promotionCreateAllowedStepsRequired` while the list is missing, and with
    `promotionCreateAllowedStepsInvalid` when it is there but unreadable. Guessing "every major
    branch to every merge target" would be a decision the command has no business making. The pure
    helpers still treat an empty list as no restriction, which is what keeps the deployment jobs and
    the pipeline diagram working on a project that is mid-configuration. The rule gates
    **creation**, never deployment: a promotion assembled outside the list is deployed with a
    warning, since refusing it would block a branch that is already merged.
17. **A vehicle is opened up, never offered whole.** A first-parent commit of the source branch that
    only moves other merges (`integration -> uat`, a promotion merged into its target) is replaced
    by the first-parent commits it brought in (`splitVehicleMerges`, called from
    `listMergedPrsWithCommits` only when `promotion:create` / `list-candidates` asks for it). On a
    pipeline where stories are merged into `integration`, every first-parent commit of `uat` is one
    of those syncs: without this, the whole promotion window is a single selectable row and carrying
    one story carries them all. Two guards keep it honest: only a merge with exactly two parents is
    opened up (an octopus merge would lose every side but the second), and only when everything it
    brought in is inside the window being listed, which keeps a back-merge from the target branch
    whole instead of turning it into a page of rows already delivered. The vehicle stays a boundary
    of `attributeCommitsToFirstParents` (`extraBoundaries`) so the merge after it does not swallow
    it.
18. **A configuration file can stop being readable mid-command.** `promotion:create` commits git
    conflict markers on purpose, and `config/.sfdx-hardis.yml` is a file like any other:
    `loadFromConfigFile` keeps the last configuration it read from each set of files and falls back
    to it with a warning (`configFileUnreadableUsingPrevious`, `configFileConflictMarkers`) rather
    than crashing halfway, with a branch assembled and no Pull Request. It only falls back to
    something it actually read: a project whose configuration is broken from the start still stops.
19. **A conflict answer can be given once for the whole promotion.** The prompt of
    `cherryPickCandidates` offers `commit-with-markers-all` next to the three
    `PromotionConflictChoice` values: it commits the markers like `commit-with-markers` and fills
    `rememberedChoice`, so the rest of the window is handled without asking again
    (`promotionCreateConflictRemembered` says so in the log). It is a **prompt answer, not a flag
    value**: `PROMOTION_CONFLICT_CHOICES` stays `skip` / `commit-with-markers` / `abort`, because
    `--on-conflict` already applies to every conflict. A promotion window usually conflicts on the
    same files story after story, so answering ten times in a row is answering once.
20. **A resolution nobody can read is not a resolution.** `buildConflictResolutionPrompt` asks the
    coding agent for a commit message whose body carries one line per conflicting file, naming the
    story, what the target side had, what the story added and what was kept, and forbids
    "solved conflicts" / "merged both versions". The reviewer of the promotion Pull Request reads
    the resolutions from `git log`, without opening the diff.
21. **A branch that was just pushed may not be visible to the provider yet.**
    `GitProvider.createPullRequest` takes `{ retries, retryDelayMs }` and
    `pushAndCreatePromotionPullRequest` passes 3 retries: GitLab answers
    `{"source_branch":["does not exist"]}` on a ref its API has not indexed, a fraction of a second
    after the push that created it. Each attempt starts with `findOpenPullRequest`, so a create that
    succeeded while reporting an error is picked up instead of being created twice, and
    `GitProvider.lastPullRequestCreationError` carries the reason into
    `promotionCreatePullRequestManual`: the fallback message names what the provider said instead
    of guessing at a missing token. When it still fails, `GitProvider.getPullRequestCreateUrl`
    hands the user the provider's own "new Pull Request" form with the source branch, the target
    branch, the title and the description already filled in. Each provider class builds its own URL
    (`GithubProvider.getPullRequestCreateUrl` and the three others, static, from the git remote, so
    a project with no token gets one too); `buildPrCreateUrl` drops the description and keeps the
    link when the URL would go past `MAX_PR_CREATE_URL_LENGTH`, and the caller then says where to
    paste it from. Retyping a promotion description is not an option: the `promotionPullRequests`
    block is what the deployment jobs read.
22. **The git remote is the authority on which project the API talks to.** Outside a GitLab CI job
    (`!process.env.GITLAB_CI`), `GitlabProvider.autoDetectSettings` checks a `CI_PROJECT_ID` coming
    from the environment or a `.env` file against the project path of `remote.origin.url`, and
    replaces it with a warning (`gitlabProjectIdMismatch`) when they disagree. A leftover
    `CI_PROJECT_ID` from another repository makes every call answer about that other project, which
    looks exactly like a branch that does not exist.
23. **A promotion branch is validated, never deployed.** It is the source branch of a Pull
    Request, like a feature branch: the only job it may run is that Pull Request's validation. A
    deployment job triggered by the push that created it would send the promotion to the target org
    before anyone reviewed or merged it. `assertPromotionBranchIsNotDeployed` stops `deploy:smart`
    at the top of `run()` and names the CI setting to fix, because the answer is to fix the
    trigger, not to let the job continue. Silent when the feature is off, on a validation job, and
    with `SFDX_HARDIS_DEPLOY_BEFORE_MERGE`, where a deployment legitimately runs from the source
    branch. It raises an error and posts **no** Pull Request comment: the job that trips it is the
    branch pipeline of the push, not the validation, and failing the Pull Request over it would say
    the promotion is broken when it is the pipeline configuration that is.
24. **A promotion branch always runs two pipelines, and only one of them is its Pull Request's.**
    It is pushed to the server, so it gets a branch pipeline of its own next to the Pull Request
    validation pipeline, on the same commit. In vscode-sfdx-hardis,
    `GitProviderGitlab.pickMergeRequestPipeline` reads the newest `merge_request_event` pipeline
    (the newest of all of them when the project runs none), which is how GitLab picks the
    `head_pipeline` its own merge request page shows; reporting every pipeline of the commit drew a
    green merge request red on the DevOps Pipeline diagram. GitLab is the only provider concerned:
    GitHub already asks for `event: "pull_request"` runs, Azure DevOps and Bitbucket read builds
    and statuses attached to the Pull Request. Deployment status is a different question, answered
    by `getJobsForBranchLatestCommit`, which leaves the merge request pipelines out.
    Related project-side trap: an unanchored `DEPLOY_BRANCHES` regex
    (`/(integration|uat|preprod|main)/` instead of `/^(...)$/`) matches
    `promotion/integration/uat/...`, so every promotion branch push starts the deployment job and
    fails it. The sfdx-hardis default template is anchored.

## sfdx-hardis (CLI)

| File                                                                                                                                                                       | Role                                                                                                                                                                                                                       |
|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `src/common/utils/promotionBranchUtils.ts`                                                                                                                                 | Pure logic: naming, parsing the declaration, classification, expansion, inherited behaviors, promotion index. No I/O.                                                                                                      |
| `src/common/utils/promotionCreateUtils.ts`                                                                                                                                 | Everything the two promotion commands need: the configuration gate, branch resolution, candidate listing, already-promoted detection, candidate table and summaries, cherry-picking, conflict handling, Pull Request body. |
| `src/commands/hardis/project/promotion/create.ts`                                                                                                                          | The command. Flags: `--source-branch`, `--target-branch`, `--pull-requests`, `--skip-pull-request`, `--include-already-promoted`, `--on-conflict`, `--agent`.                                                              |
| `src/commands/hardis/project/promotion/list-candidates.ts`                                                                                                                 | Read-only listing of the candidates, for agents. Flags: `--source-branch`, `--target-branch`, `--include-already-promoted`, `--agent`. Creates, pushes and closes nothing.                                                 |
| `src/common/utils/pullRequestUtils.ts`                                                                                                                                     | Resolves the declared Pull Requests from the git provider, walks the downstream promotions, merges the yaml blocks of a description.                                                                                       |
| `src/common/utils/backpromoteUtils.ts`                                                                                                                                     | `listMergedPrsWithCommits`, which the candidate list is built from: `attributeCommitsToFirstParents` decides which commits a merge brought in, `splitVehicleMerges` opens up the merges that only move other merges.       |
| `src/common/gitProvider/gitProviderRoot.ts` + the four providers                                                                                                           | `closePullRequest()` (close on GitHub/GitLab, abandon on Azure DevOps, decline on Bitbucket), used to supersede the promotion already open, and `getPullRequestCreateUrl()` on each provider class (`buildPrCreateUrl` / `PullRequestCreateUrlResult` live in the root).                                                                                |
| `src/commands/hardis/project/deploy/smart.ts`                                                                                                                              | Applies the inherited custom behaviors and the conflict-marker gate.                                                                                                                                                       |
| `src/common/utils/prePostCommandUtils.ts`                                                                                                                                  | Deployment actions of the carried stories, promotion scope wording.                                                                                                                                                        |
| `src/common/utils/releaseNotesUtils.ts`                                                                                                                                    | Leaves the vehicles out, `--include-promotions` brings them back.                                                                                                                                                          |
| `src/common/gitProvider/index.ts`                                                                                                                                          | `inheritedCustomBehaviors` + the `inheritedCustomBehaviorsPrId` guard, `createPullRequest` retries + `lastPullRequestCreationError`.                                                                                                                                                     |
| `config/sfdx-hardis.jsonschema.json`                                                                                                                                       | `enablePromotionBranches` and `allowedPromotionSteps` properties (required for any new config key).                                                                                                                        |
| `test/common/utils/promotionBranchUtils.test.ts`, `promotionCreateUtils.test.ts`, `releaseNotesPromotion.test.ts`, `backpromoteUtils.test.ts`, `prDescriptionYaml.test.ts` | Unit tests.                                                                                                                                                                                                                |

Reading the flag: `getConfig('branch')` (project config merged with the running branch's config),
via `getPromotionBranchConfig(config)`, which also parses `allowedPromotionSteps` into
`config.allowedSteps`. Both are **project level** settings: the extension exposes them at project
scope only, because `promotion:create` runs from any branch and would not see a branch file.

### Allowed steps

`parsePromotionSteps` reads the list (objects, or a `"uat > preprod"` string for a hand-edited
config; no target means any target of that source). `isPromotionStepAllowed`,
`allowedPromotionSourceBranches`, `allowedPromotionTargetBranches` and `formatPromotionSteps` are
what the callers use. `resolvePromotionSourceAndTarget` filters both prompts and refuses a flag
naming a step outside the list; `warnAboutPromotionPullRequestMisuse` warns in the deployment job;
the extension mirrors the same functions in `pipeline.js` (it cannot import them: an LWC module of
the webview only resolves other `s/` modules). `_isPromotionSourceAllowed` asks for a step naming
the branch **and** a target it can reach, a merge target read from `pipelineData.links`, so a step
pointing somewhere the pipeline does not go opens nothing. `showCreatePromotionButton` ends with it
and `modalHideCheckboxColumn` is its negation, so the button and the per-story checkboxes appear
and disappear together. An empty list keeps them, on purpose: the command then answers with
`promotionCreateAllowedStepsRequired`, which names the setting, where a missing button would say
nothing.

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
| `src/utils/pipeline/sfdxHardisConfigHelper.ts`       | `enablePromotionBranches` and `allowedPromotionSteps` sit in the **Danger Zone** of Pipeline Settings, scope `["global"]`.                                                                    |
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
- The feature is experimental: keep the "(experimental)" mention in the docs page, the JSON schema
  description and the settings UI.
