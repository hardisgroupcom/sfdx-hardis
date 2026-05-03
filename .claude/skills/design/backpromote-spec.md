# Technical Specification: `hardis:work:backpromote`

## Overview

New command `hardis:work:backpromote` that brings the latest changes merged into a parent branch (e.g. `integration`) into the developer's feature branch and deploys them to their dev sandbox. The command merges the parent branch, detects org conflicts by retrieving the same metadata from the org and generating Excel + PDF diff reports, deploys the delta, and executes deployment actions from merged PRs. It also tracks the last backpromoted commit in user config for incremental future runs. The existing `hardis:work:refresh` command is deprecated and replaced with a redirect message.

---

## Files to Create

### 1. `src/commands/hardis/work/backpromote.ts`

The command class. Follows the same pattern as `work:save.ts` and `work:refresh.ts`.

**Structure:**
- Extends `SfCommand<any>` with `requiresProject = true`
- `requiresSfdxPlugins = ['sfdx-git-delta']`
- Requires `target-org` flag (uses `requiredOrgFlagWithDeprecations`)

**Flags:**
| Flag | Type | Description |
|------|------|-------------|
| `agent` | boolean | Non-interactive mode |
| `parentbranch` | string | Override the parent branch (defaults to `config.developmentBranch`) |
| `debug` | boolean | Debug mode |
| `websocket` | string | WebSocket connection |
| `skipauth` | boolean | Skip authentication check |
| `target-org` | requiredOrgFlagWithDeprecations | Target org |

**`run()` method flow** (delegates to utility functions in `backpromoteUtils.ts`):

1. Parse flags, determine parent branch (from flag, user config, or prompt)
2. Fetch parent branch, list merged PRs with commits via git provider
3. Prompt user to select "up to which PR" to backpromote (show PRs grouped with commits)
   - If previous backpromote tracked in user config, suggest starting from there
4. Compute delta using `sfdx-git-delta` between the last backpromoted commit (or merge-base) and selected target commit
5. Display delta summary (added/modified/deleted metadata count)
6. Merge parent branch into feature branch, handle conflicts interactively (reuse pattern from `work:refresh.ts`)
7. Retrieve same metadata from org using delta `package.xml`, compare with local files
8. Generate conflict report (Excel + PDF) showing org vs local differences
9. Prompt user to validate the list of metadata to deploy (multiselect to exclude items)
10. If destructive changes exist, warn and get confirmation
11. Deploy metadata to dev sandbox (`sf project deploy start --manifest ... --test-level NoTestRun`)
    - Or use `RunSpecifiedTests` with PR test classes if configured
12. Execute deployment actions from PRs in scope:
    - For `customUsername` actions: attempt LoginAs auth, fallback to manual checklist with one-by-one validation
    - For other actions: execute automatically
13. Store last backpromoted commit SHA + timestamp in user config

### 2. `src/common/utils/backpromoteUtils.ts`

Utility module containing all the backpromote logic. The command file calls these functions.

**Exported functions:**

```typescript
// Determine parent branch from config or user selection
export async function resolveParentBranch(
  commandThis: any,
  flagOverride: string | null,
  agentMode: boolean,
): Promise<string>

// List merged PRs on parent branch since a given commit, grouped with their commits
export async function listMergedPrsWithCommits(
  parentBranch: string,
  sinceCommit: string | null,
  commandThis: any,
): Promise<BackpromotePrGroup[]>

// Prompt user to select the target PR (up to which to backpromote)
export async function selectBackpromoteScope(
  prGroups: BackpromotePrGroup[],
  lastBackpromoteCommit: string | null,
  commandThis: any,
  agentMode: boolean,
): Promise<{ targetCommit: string; selectedPrs: BackpromotePrGroup[] }>

// Merge parent branch into current branch with conflict handling
export async function mergeParentBranch(
  parentBranch: string,
  currentBranch: string,
  commandThis: any,
  agentMode: boolean,
): Promise<void>

// Retrieve metadata from org using package.xml and compare with local files
export async function detectOrgConflicts(
  deltaPackageXml: string,
  targetUsername: string,
  commandThis: any,
  debugMode: boolean,
): Promise<OrgConflictItem[]>

// Generate Excel + PDF conflict report
export async function generateConflictReport(
  conflicts: OrgConflictItem[],
  commandThis: any,
): Promise<{ excelPath: string; pdfPath: string | false }>

// Prompt user to validate metadata to deploy (multiselect to exclude)
export async function promptMetadataValidation(
  deltaPackageXml: string,
  conflicts: OrgConflictItem[],
  commandThis: any,
  agentMode: boolean,
): Promise<{ validatedPackageXml: string; hasDestructiveChanges: boolean }>

// Deploy metadata to the dev sandbox
export async function deployBackpromoteMetadata(
  packageXmlFile: string,
  destructiveChangesFile: string | null,
  targetUsername: string,
  testClasses: string[],
  commandThis: any,
  debugMode: boolean,
): Promise<void>

// Execute deployment actions from PRs, handling customUsername with LoginAs fallback
export async function executeBackpromoteActions(
  selectedPrs: BackpromotePrGroup[],
  targetUsername: string,
  conn: any,
  commandThis: any,
  agentMode: boolean,
): Promise<void>

// Save backpromote state to user config
export async function saveBackpromoteState(
  currentBranch: string,
  targetCommit: string,
): Promise<void>

// Load last backpromote state from user config
export async function loadBackpromoteState(
  currentBranch: string,
): Promise<BackpromoteState | null>
```

**Interfaces (in backpromoteUtils.ts):**

```typescript
export interface BackpromotePrGroup {
  pr: {
    id: number;
    title: string;
    author: string;
    mergedAt: string;
    webUrl: string;
    sourceBranch: string;
  };
  commits: Array<{
    hash: string;
    message: string;
    author: string;
    date: string;
  }>;
  // PR-scoped config (deployment actions, test classes)
  prConfig: any | null;
}

export interface OrgConflictItem {
  metadataType: string;
  metadataName: string;
  status: 'modified' | 'added' | 'deleted' | 'unchanged';
  localPath: string;
  diffPreview: string;      // Short preview of differences
  diffMarkdown: string;     // Full diff in markdown format with colors
  hasOrgChanges: boolean;   // True if org version differs from local
}

export interface BackpromoteState {
  lastCommit: string;
  lastTimestamp: string;
  parentBranch: string;
}
```

### 3. `messages/work.md` (new oclif messages file for work commands)

Not needed - the command already uses `messages/org.md` for shared flags like `debugMode`, `websocket`. The command description is inline.

---

## Files to Modify

### 1. `src/commands/hardis/work/refresh.ts`

**Change:** Replace the entire `run()` method body to display a deprecation message and exit with code 1.

```typescript
public async run(): Promise<AnyJson> {
  uxLog("error", this, c.red(t('workRefreshDeprecatedUseBackpromote')));
  process.exitCode = 1;
  return { outputString: 'This command is deprecated. Use sf hardis:work:backpromote instead.' };
}
```

Keep the rest of the class (flags, description, etc.) but update the description to add a deprecation notice at the top. Remove unused imports.

### 2. `src/common/gitProvider/gitProviderRoot.ts`

**Change:** Add a new abstract method for listing merged PRs on a branch with their commits:

```typescript
public async listMergedPullRequestsOnBranch(
  branchName: string,
  sinceCommit?: string,
): Promise<CommonPullRequestInfo[]> {
  uxLog("other", this, `Method listMergedPullRequestsOnBranch is not implemented yet on ${this.getLabel()}`);
  return [];
}
```

This leverages the existing `listPullRequests` method with `{ status: 'merged', targetBranch: branchName }` filter. Alternatively, the backpromoteUtils can use the existing `listPullRequests` directly - which is preferable since it avoids modifying the abstract base class. **Decision: use existing `listPullRequests` directly in backpromoteUtils, no change to gitProviderRoot.**

### 3. `src/common/gitProvider/index.ts`

**No change needed** if we use `listPullRequests` directly from the git provider instance. However, the `GitProvider` static facade may need a convenience method. Let me check if there's a static method pattern.

**Decision: access the git provider instance directly in backpromoteUtils via `GitProvider.getInstance()` and call `listPullRequests`.**

### 4. `src/i18n/*.json` (all 9 locale files)

Add new i18n keys for the backpromote command. Full list below.

### 5. `config/sfdx-hardis.jsonschema.json`

No new config properties needed in the schema. The backpromote state is stored in user config (per-developer, not committed).

---

## Detailed Implementation Design

### Step 1: Resolve Parent Branch

- Read `config.developmentBranch` from project config (same as `work:refresh`)
- If `--parentbranch` flag is provided, use that
- If interactive, show remote branches with `developmentBranch` recommended first (same UX as `work:refresh`)
- In agent mode, use `developmentBranch` directly

### Step 2: List Merged PRs with Commits

Use the git provider's `listPullRequests` method with filters:
```typescript
const gitProvider = await GitProvider.getInstance();
const mergedPrs = await gitProvider.listPullRequests(
  { status: 'merged', targetBranch: parentBranch },
  { formatted: true }
);
```

Then for each PR, get the commits using `git.log` between the merge-base of the PR's source branch. But since we don't have the exact merge commits easily, a simpler approach:

**Better approach:** Use `git log` on the parent branch to list all commits since the last backpromote (or branch creation). Then correlate commits with PRs using the git provider API. The git provider `listPullRequests` already gives us PR merge dates and source branches.

**Simplest approach:** Use `git log parentBranch` since the merge-base with the feature branch. For each commit that is a merge commit, correlate it with a PR. Non-merge commits are standalone commits. Group commits under their PR.

**Practical approach chosen:**
1. Compute `mergeBase = git merge-base featureBranch parentBranch`
2. Get `git log mergeBase..parentBranch` to get all commits on the parent since divergence
3. Call `gitProvider.listPullRequests({ status: 'merged', targetBranch: parentBranch })` to get merged PRs
4. Match PR merge commit SHAs with commits in the log
5. Group: each PR becomes a group header, with its associated commits as children
6. Any commits not associated with a PR become standalone entries

### Step 3: Prompt User to Select Scope

Show PRs in chronological order (oldest first):
```
? Select up to which PR to backpromote:
  > #42 - Add new field to Account (by user1, 2026-04-28) [3 commits]
      - abc1234 Add field definition
      - def5678 Update layout
      - ghi9012 Add validation rule
    #45 - Fix flow error handling (by user2, 2026-04-30) [1 commit]
      - jkl3456 Fix error handler in ContactFlow
    #47 - Permission set updates (by user3, 2026-05-01) [2 commits]
      - mno7890 Update Admin permission set
      - pqr1234 Add new permission set
```

If `lastBackpromoteCommit` exists in user config, show it and default to the first PR after it.

The user selects one PR; all PRs up to and including that one are in scope.

### Step 4: Compute Delta with sfdx-git-delta

```typescript
const fromCommit = lastBackpromoteState?.lastCommit || mergeBase;
const toCommit = selectedPrs[selectedPrs.length - 1].commits.at(-1).hash; // Last commit of last selected PR
// Or more precisely, the merge commit SHA of the last selected PR on the parent branch

await callSfdxGitDelta(fromCommit, toCommit, tmpDir);
```

This produces:
- `tmpDir/package/package.xml` - added/modified metadata
- `tmpDir/destructiveChanges/destructiveChanges.xml` - deleted metadata

### Step 5: Git Merge

Reuse the pattern from `work:refresh.ts`:
1. Stash local changes
2. Fetch and checkout parent branch, pull latest
3. Checkout feature branch
4. Check if merge is necessary (compare refs)
5. Merge with interactive conflict resolution
6. Pop stash

**Important:** The merge brings the feature branch up to date with the parent. We merge the **full parent branch** (not just up to the selected commit), because the git state should be clean and up to date regardless of the backpromote scope selection. The scope selection only affects which metadata to deploy and which deployment actions to run.

**Wait - the user said "offer the user a choice about until when in the parent branch he wants to apply the retrofit".** This implies only merging up to a specific point. But a partial merge of a branch is not straightforward in git. The approach should be:

**Revised approach:** Actually, the merge brings the full parent branch into the feature branch (this is the standard git merge). The "scope selection" only affects:
- Which metadata delta to deploy to the org (using sfdx-git-delta from `lastBackpromoteCommit` to `selectedCommit`)
- Which deployment actions to execute

The git merge itself is always full. This makes sense because:
- Git doesn't support partial branch merges cleanly
- The developer's local code should be up to date regardless
- Only the _deployment_ to the sandbox is scoped

### Step 6: Org Conflict Detection

After the merge, retrieve the same metadata that's in the delta from the org:
1. Use `sf project retrieve start --manifest deltaPackageXml --target-org username` to retrieve current org state into a temp directory
2. Compare each retrieved file with the local file (post-merge) using the `diff` library
3. Build `OrgConflictItem[]` with status and diff preview

**Implementation detail:** Use `sf project retrieve start -x package.xml -o targetOrg --output-dir tmpRetrieveDir` to retrieve into a separate directory, then compare file-by-file.

### Step 7: Generate Conflict Reports

**Excel report** (using ExcelJS via `generateCsvFile` pattern):
- Columns: `Metadata Type`, `Name`, `Status`, `Diff Preview`, `Local Path`
- Use `generateCsvFile` -> automatically creates Excel too
- Status: "Modified in org", "Not in org", "Same as local"

**PDF report** (using `md-to-pdf` via `generatePdfFileFromMarkdown`):
- Generate a Markdown file with git-diff-style colored output
- For each conflicting item, show:
  ```markdown
  ### ApexClass/MyClass
  ```diff
  - Old line from org
  + New line from local
  ```
  ```
- Convert to PDF using existing `generatePdfFileFromMarkdown`

### Step 8: User Validation

Show the metadata list with conflict indicators:
```
? Select metadata to deploy (use space to toggle, all selected by default):
  [x] ApexClass/MyClass (modified in org - see conflict report)
  [x] CustomField/Account.NewField__c
  [x] Layout/Account-Account Layout
  [ ] Flow/ContactFlow (modified in org - see conflict report)
```

User can deselect items they don't want deployed. For deselected items, remove them from the package.xml before deployment.

### Step 9: Handle Destructive Changes

If `destructiveChanges.xml` has content:
- Show the list of items to be deleted
- Warn with yellow text
- Prompt for confirmation (in interactive mode)
- In agent mode, proceed with warning

### Step 10: Deploy

```typescript
const testLevel = testClasses.length > 0 ? 'RunSpecifiedTests' : 'NoTestRun';
const deployCmd = `sf project deploy start --manifest "${validatedPackageXml}" --test-level ${testLevel}` +
  (testClasses.length > 0 ? ` --tests ${testClasses.join(',')}` : '') +
  (destructiveChangesFile ? ` --post-destructive-changes "${destructiveChangesFile}"` : '') +
  ` -o ${targetUsername} --wait 120 --json`;
```

**Test classes:** Collect from all selected PRs' scoped configs:
```typescript
for (const prGroup of selectedPrs) {
  if (prGroup.prConfig?.deploymentApexTestClasses) {
    testClasses.push(...prGroup.prConfig.deploymentApexTestClasses);
  }
}
```

### Step 11: Execute Deployment Actions

Collect `commandsPreDeploy` and `commandsPostDeploy` from selected PR configs:
```typescript
for (const prGroup of selectedPrs) {
  if (prGroup.prConfig?.commandsPostDeploy) {
    for (const cmd of prGroup.prConfig.commandsPostDeploy) {
      // Attach PR info for tracking
      cmd.pullRequest = prGroup.pr;
      actions.push(cmd);
    }
  }
}
```

For each action:
1. If no `customUsername`: execute via `ActionsProvider.buildActionInstance(cmd).run(cmd)`
2. If `customUsername`:
   a. Attempt `authOrg(targetBranch, { forceUsername, instanceUrl, setDefault: false })`
   b. If auth succeeds: execute the action with the authenticated username
   c. If auth fails: add to manual checklist

**Manual checklist UX (for failed LoginAs):**
```
The following actions require manual execution with LoginAs:

  1. [ ] Import data for Account (PR #42) - Login as admin@company.com
     Press Enter when done, or 's' to skip...

  2. [ ] Run Apex script cleanup.apex (PR #45) - Login as devops@company.com
     Press Enter when done, or 's' to skip...
```

Each item prompts individually, user confirms completion or skips.

### Step 12: Save State

```typescript
await setConfig('user', {
  backpromoteState: {
    [currentBranch]: {
      lastCommit: targetCommit,
      lastTimestamp: new Date().toISOString(),
      parentBranch: parentBranch,
    }
  }
});
```

---

## i18n Keys

New keys to add to all 9 locale files (`en`, `de`, `es`, `fr`, `it`, `ja`, `nl`, `pl`, `pt-BR`):

| Key | English text |
|-----|-------------|
| `backpromoteTitle` | `Backpromote to dev sandbox` |
| `backpromoteStarting` | `Starting backpromote from {{parentBranch}} to your dev sandbox...` |
| `backpromoteSelectParentBranch` | `Select the parent branch to backpromote from` |
| `backpromoteParentBranchAutoSelected` | `Parent branch automatically selected: {{parentBranch}}` |
| `backpromoteListingMergedPrs` | `Listing merged pull requests on {{parentBranch}}...` |
| `backpromoteNoPrsMerged` | `No pull requests have been merged on {{parentBranch}} since the last backpromote.` |
| `backpromoteSelectScope` | `Select up to which pull request to backpromote` |
| `backpromoteLastRunInfo` | `Last backpromote was performed on {{date}} (commit {{commit}})` |
| `backpromotePrEntry` | `#{{id}} - {{title}} (by {{author}}, {{date}}) [{{commitCount}} commits]` |
| `backpromoteComputingDelta` | `Computing metadata delta between {{fromCommit}} and {{toCommit}}...` |
| `backpromoteDeltaSummary` | `Delta summary: {{addedModified}} items to deploy, {{deleted}} items to delete` |
| `backpromoteNoDelta` | `No metadata changes found in the selected scope.` |
| `backpromoteMergingParentBranch` | `Merging {{parentBranch}} into {{currentBranch}}...` |
| `backpromoteBranchUpToDate` | `Branch {{currentBranch}} is already up to date with {{parentBranch}}` |
| `backpromoteDetectingOrgConflicts` | `Retrieving metadata from org to detect conflicts...` |
| `backpromoteOrgConflictsFound` | `Found {{count}} metadata items with differences between org and local files` |
| `backpromoteNoOrgConflicts` | `No conflicts detected between org metadata and local files` |
| `backpromoteConflictReportGenerated` | `Conflict report generated: {{excelPath}}` |
| `backpromoteConflictReportPdfGenerated` | `Conflict report PDF generated: {{pdfPath}}` |
| `backpromoteSelectMetadataToDeploy` | `Select metadata items to deploy (deselect to skip)` |
| `backpromoteModifiedInOrg` | `modified in org - see conflict report` |
| `backpromoteDestructiveChangesWarning` | `The following {{count}} metadata items will be DELETED from your org:` |
| `backpromoteConfirmDestructiveChanges` | `Do you want to proceed with destructive changes?` |
| `backpromoteDeploying` | `Deploying {{count}} metadata items to your dev sandbox...` |
| `backpromoteDeploySuccess` | `Successfully deployed {{count}} metadata items to your dev sandbox` |
| `backpromoteDeployFailed` | `Deployment failed. Check error messages above.` |
| `backpromoteExecutingActions` | `Executing deployment actions from {{count}} pull requests...` |
| `backpromoteActionRequiresLoginAs` | `Action "{{label}}" requires LoginAs {{username}}` |
| `backpromoteActionLoginAsSuccess` | `Successfully authenticated as {{username}} for action "{{label}}"` |
| `backpromoteActionLoginAsFailed` | `Could not authenticate as {{username}}. Manual action required.` |
| `backpromoteManualActionPrompt` | `Manual action: {{label}} (LoginAs {{username}}) - Press Enter when done, or 's' to skip` |
| `backpromoteManualActionSkipped` | `Action "{{label}}" was skipped by user` |
| `backpromoteManualActionCompleted` | `Action "{{label}}" marked as completed` |
| `backpromoteStateSaved` | `Backpromote state saved. Last commit: {{commit}}` |
| `backpromoteCompleted` | `Backpromote completed successfully` |
| `workRefreshDeprecatedUseBackpromote` | `This command is deprecated. Use "sf hardis:work:backpromote" instead.` |
| `backpromoteRetrievingForConflictCheck` | `Retrieving metadata from org for conflict check...` |
| `backpromoteTestClassesFromPrs` | `Using test classes from PR configurations: {{classes}}` |

---

## Dependencies

No new packages needed. All dependencies already exist in the project:
- `exceljs` (4.4.0) - Excel report generation
- `md-to-pdf` (5.2.5) - PDF generation from markdown
- `diff` (8.0.3) - Text comparison for conflict detection
- `sfdx-git-delta` (sf plugin) - Delta package.xml generation
- `simple-git` - Git operations (merge, log, stash, etc.)
- `papaparse` - CSV generation
- `js-yaml` - Reading PR-scoped config files

---

## Testing Approach

### Unit Testing
- Test `resolveParentBranch` with different config scenarios
- Test `listMergedPrsWithCommits` with mocked git log and PR data
- Test `selectBackpromoteScope` with different selection scenarios
- Test `detectOrgConflicts` comparison logic
- Test `generateConflictReport` markdown/CSV output format
- Test `saveBackpromoteState` / `loadBackpromoteState` config read/write
- Test deprecated `work:refresh` exits with code 1

### Integration Testing
- Full backpromote flow against a real scratch org (in `test:nuts`)
- Verify sfdx-git-delta produces correct delta
- Verify deployment succeeds with NoTestRun
- Verify deployment with RunSpecifiedTests when test classes are configured

### Manual Testing
- Run `./bin/dev.js hardis:work:backpromote` from a feature branch
- Verify PR listing shows correct PRs with commits
- Verify conflict report Excel opens correctly with data
- Verify conflict report PDF renders with colored diffs
- Verify deployment actions with customUsername prompt for manual actions
- Verify `hardis:work:refresh` shows deprecation message

---

## Risks and Trade-offs

| Risk | Mitigation |
|------|------------|
| Git merge always brings full parent branch, but delta/actions are scoped to user selection | This is by design - git state is always current, only deployment is scoped. Document this clearly. |
| Org conflict detection requires a full retrieve of the delta package.xml from the org | Could be slow for large deltas. Show progress. Allow skipping with a flag or prompt. |
| PDF generation requires Puppeteer/Chromium (via md-to-pdf) | Already a dependency. May fail in some CI/headless environments. Handle gracefully with try/catch (pattern already exists in `generatePdfFileFromMarkdown`). |
| LoginAs authentication may fail if JWT auth is not configured for the target user | Fall back to manual checklist with clear instructions. This matches the existing pattern. |
| Git provider API may not be available (no token configured) | Fall back to git log only (no PR grouping). Use commits directly. |
| Destructive changes in a dev sandbox could delete user's manual customizations | Warn prominently. Show the full list. Require explicit confirmation. |
| Large delta (many metadata items) could make the multiselect prompt unwieldy | Consider grouping by metadata type in the prompt. Show count per type. |

---

## Architecture Summary

```
backpromote.ts (command class)
  |
  +-- backpromoteUtils.ts (all business logic)
        |
        +-- gitUtils.ts (callSfdxGitDelta, getGitDeltaScope)
        +-- index.ts (git, execCommand, uxLog, etc.)
        +-- gitProvider/index.ts (GitProvider for PR listing)
        +-- pullRequestUtils.ts (getPullRequestScopedSfdxHardisConfig)
        +-- actionUtils.ts (readTestClasses, readActions)
        +-- actionsProvider.ts (ActionsProvider for action execution)
        +-- authUtils.ts (authOrg for LoginAs)
        +-- filesUtils.ts (generateCsvFile, generateReportPath)
        +-- markdownUtils.ts (generatePdfFileFromMarkdown)
        +-- deployUtils.ts (smartDeploy or direct sf command)
        +-- config/index.ts (getConfig, setConfig)
```
