/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import * as path from 'path';
import { getCurrentGitBranch, getGitRepoRoot, gitFetch, uxLog } from '../../../common/utils/index.js';
import {
  BackpromoteActionEntry,
  collectTestClassesFromPrs,
  confirmDestructiveChanges,
  deployBackpromoteMetadata,
  detectOrgConflicts,
  executeBackpromoteActions,
  generateConflictReport,
  listMergedPrsWithCommits,
  promptConfirmContinueAfterConflictFailure,
  promptMetadataValidation,
  promptOpenVisualDiffsInVsCode,
  resolveParentBranch,
} from '../../../common/utils/backpromoteUtils.js';
import {
  BACKPROMOTE_NEW_ORG_WINDOW,
  BackpromotePlanCheck,
  BackpromotePrepareMergeResult,
  announceBackpromoteMerge,
  buildBackpromoteBaseVersionReader,
  buildBackpromotePlan,
  computeBackpromoteGroupDeltas,
  findLocalMetadataFiles,
  getBackpromoteTargetOrgInfo,
  hasFirstParent,
  listBackpromoteParentBranchChoices,
  listBackpromotePlanActions,
  listFilesWithConflictMarkers,
  listUncommittedFiles,
  loadBackpromoteHistory,
  prepareBackpromoteMerge,
  promptBackpromoteConflictDecisions,
  promptBackpromoteGroups,
  removeKeysFromPackageXml,
  resolveBackpromoteFromRef,
  resolveBackpromoteParentRef,
  resolveOlderWindowStart,
  writeBackpromoteMergePrompt,
  writeBackpromotePackages,
} from '../../../common/utils/backpromotePlanUtils.js';
import {
  BackpromoteOrgRecord,
  checkBackpromoteGitProvider,
  findActionsDoneInOrg,
  persistBackpromoteOrgRecords,
} from '../../../common/utils/backpromoteStateUtils.js';
import {
  createBackpromoteBranch,
  exportBranchPackageDirectories,
  isBranchUpToDateWith,
  leaveBackpromoteBranch,
  readBackpromoteBranchInfo,
} from '../../../common/utils/backpromoteBranchUtils.js';
import {
  BackpromoteWorkingBranch,
  buildBackpromoteMergePrompt,
  buildBackpromoteRunCommand,
  defaultGroupSelection,
  decideBackpromoteWorkingBranch,
  findBackpromoteParentBranchRefusal,
  findItemsAlsoChangedByUnselected,
  findNewestDoneGroupIndex,
  parseMetadataKey,
  parsePullRequestNumbers,
  resolveBackpromoteMergeBase,
  resolveExplicitGroupSelection,
  selectDeltaUnion,
  splitListFlag,
  splitMetadataKeysFlag,
  toMetadataKey,
  unionGroupDeltas,
} from '../../../common/utils/backpromoteSelectionUtils.js';
import { getConfig } from '../../../config/index.js';
import { isPackageXmlEmpty } from '../../../common/utils/xmlUtils.js';
import { t } from '../../../common/utils/i18n.js';
import { reportCommandProgress } from '../../../common/utils/progressFileUtils.js';
import fs from '../../../common/utils/fsUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

/** How a group is named in progress messages: its Pull Requests, or its commit */
function backpromoteGroupLabel(group: { commit: { hash: string }; associatedPrs: Array<{ id: number }> }): string {
  const ids = group.associatedPrs.filter((pr) => pr.id > 0).map((pr) => `#${pr.id}`);
  return ids.length > 0 ? ids.join(', ') : group.commit.hash.substring(0, 7);
}

/** Where the run works, as the currentBranch check of the plan says it */
function backpromoteWorkingBranchMessage(workingBranch: BackpromoteWorkingBranch, currentBranch: string, parentBranch: string): string {
  const values = { branch: currentBranch, parentBranch, returnBranch: workingBranch.returnBranch || '' };
  if (workingBranch.refusal?.reason === 'backpromoteBranchOtherParent') {
    return t('backpromoteWorkingBranchOtherParent', { ...values, branchParentBranch: workingBranch.refusal.parentBranch });
  }
  switch (workingBranch.reason) {
    case 'userStoryBranch':
      return t('backpromoteWorkingBranchCurrent', values);
    case 'backpromoteBranch':
      return t('backpromoteWorkingBranchResume', values);
    case 'backpromoteBranchBehind':
      return t('backpromoteWorkingBranchResumeBehind', values);
    case 'solvedMerge':
      return t('backpromoteWorkingBranchSolvedMerge', values);
    case 'majorBranch':
      return t('backpromoteWorkingBranchNewMajor', values);
    case 'promotionBranch':
      return t('backpromoteWorkingBranchNewPromotion', values);
    case 'retrofitBranch':
      return t('backpromoteWorkingBranchNewRetrofit', values);
    default:
      return t('backpromoteWorkingBranchNewNotUpToDate', values);
  }
}

export default class BackpromoteTask extends SfCommand<any> {
  public static title = 'Backpromote to dev sandbox (Beta)';

  public static description = `
## Command Behavior (Beta)

> **This command is currently in Beta.** Please report any issues or feedback on the [sfdx-hardis GitHub repository](https://github.com/hardisgroupcom/sfdx-hardis/issues).

**Brings the changes merged into a parent branch (e.g. integration) into the developer's own org: a developer sandbox or a scratch org.**

Developers stay in sync with what their teammates merged, without waiting for a new sandbox. In VS Code, the **Backpromote (Beta)** panel of the sfdx-hardis extension shows everything on one page and runs this same command with the choices made in the panel.

Key functionalities:

- **Connected to the git provider:** the history of what each developer org received is kept in Pull Request comments, shared by every developer and machine, and nothing is stored locally. The command refuses to run until sfdx-hardis is connected to GitHub, GitLab, Azure DevOps or Bitbucket.
- **Developer orgs only:** the target org must be a developer sandbox or a scratch org. A production org, or the org of a major branch declared in \`config/branches\`, is refused: the CI/CD pipeline deploys those.
- **Pre-flight checks:** the git working directory must be clean and the parent branch must be a major branch (or the development branch).
- **Never on a major branch:** the backpromote runs on the current branch when it is a User Story branch that already contains the latest commit of the parent branch. From anything else (a major, promotion or retrofit branch, or a User Story branch behind its parent branch), it creates a local branch \`backpromote/<parent branch>/<date>\` from the remote parent branch, without tracking it, runs there, then brings you back to the branch you started from. That branch is kept when it holds merged files (committed on it), and deleted when it holds nothing of its own.
- **Pull Request selection:** the Pull Requests merged in the parent branch after the last one backpromoted to this org are listed, and each one can be selected or left out. A Pull Request left out stays in the list of the next run, and \`--from\` (a commit SHA, or a Pull Request number) lists older ones. An item also changed by a Pull Request left out is deployed with that change too, since the deployment reads the files of the branch: the command warns about it.
- **An org with no history:** a new or refreshed sandbox, a scratch org, or any org that never received a backpromote is offered the newest Pull Requests only, with the newest one selected: nothing redeploys months of merges by accident.
- **History per org:** a Pull Request deployed into an org is recorded in a comment of that Pull Request with the Salesforce Organization Id, the date, the merge commit and the result of its deployment actions. A refreshed sandbox is a new org and starts with nothing backpromoted.
- **Delta computation:** sfdx-git-delta computes what each selected Pull Request deploys and deletes. The delta of a commit never changes, so it is cached between runs.
- **Org conflict detection:** the same metadata is retrieved from the org and compared with the local files, with Excel and PDF reports and VS Code diffs. An explicit selection (the VS Code panel, an agent) skips that retrieve: the decisions are already taken.
- **Items changed in the org:** an item counts as changed in the org only when it differs from the version the org received last, not from the version being backpromoted: an item nobody touched is deployed without asking. Each one is deployed by default, can be kept as it is in the org, or merged. A merge writes a three-way merge with git conflict markers into the local file, starting from that same last received version so a Pull Request left out is never silently reverted, opens it in VS Code, and saves a prompt to paste into a coding agent (Claude Code, GitHub Copilot...) to solve it. The solved file is then deployed as it is, and is to be committed with the User Story.
- **Deletions:** listed and confirmed. Declining really skips them.
- **Deployment:** NoTestRun, or RunSpecifiedTests when the selected Pull Requests declare test classes.
- **Deployment actions:** the actions of the selected Pull Requests run before and after the deployment, skipping those already run in this org. They are read from the parent branch, so a Pull Request merged after your branch keeps its actions and its test classes. Actions requiring another user try LoginAs, then fall back to a manual checklist. A selection holding only actions runs them.

### Explicit selection

As soon as \`--pull-requests\`, \`--commits\` or \`--to\` is passed, the command asks nothing about what to deploy: every item of the selection is deployed and every deletion applied, unless \`--exclude-metadata\` or \`--skip-destructive\` says otherwise, and the actions not already run in this org are executed, unless \`--actions\` or \`--skip-actions\` says otherwise. This is how the VS Code panel runs the command.

### Plan and merge (read-only modes)

- \`--plan --json\` returns the checks, the listed Pull Requests with what each one deploys and where it was already backpromoted, the items changed in the org, the deletions and the deployment actions. It deploys nothing and writes nothing.
- \`--prepare-merge Type:Name\` writes the three-way merge of these items into the local files and returns the coding agent prompt. Run the command again with \`--merged-metadata Type:Name\` once the conflicts are solved.

### Agent Mode

Use \`--agent\` to disable all interactive prompts. The command will:

- Use the configured \`developmentBranch\` (or the branch the feature branch was created from) as the parent branch
- Without selection flags, select only the oldest Pull Request not yet backpromoted to the org
- With \`--pull-requests\`, \`--commits\` or \`--to\`, deploy exactly that selection
- Deploy every item without interactive validation, apart from \`--exclude-metadata\`
- Auto-confirm destructive changes with a warning, unless \`--skip-destructive\`
- Log manual actions instead of prompting

Required: a git provider token in the environment (\`GITHUB_TOKEN\`, \`CI_SFDX_HARDIS_GITLAB_TOKEN\`, \`AZURE_DEVOPS_EXT_PAT\` or \`CI_SFDX_HARDIS_BITBUCKET_TOKEN\`).

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Git provider:** \`GitProvider.getInstance()\` then a merged Pull Request listing checks the connection. The history is one comment per Pull Request, found by the \`<!-- sfdx-hardis backpromote-state -->\` marker; each table row carries its record as encoded JSON in a hidden marker, and is merged with the comment's current content before every write.
- **Target org check:** queries \`Organization.Id\`, \`IsSandbox\` and \`TrialExpirationDate\`, and compares the username and instance URL with the major orgs of \`config/branches\`.
- **Git Integration:** Uses \`simple-git\` to verify branch status, list the first-parent commits of \`origin/<parent branch>\` and group the Pull Requests each one brought in. The listing stops at the newest group already backpromoted to the org, and after 20 groups when none of them was.
- **Merge base:** the merge of an item changed in the org, and the comparison that decides whether it was changed at all, both start from the newest group already backpromoted to this org (from just before the window when there is none). Starting from the parent of the selection would put the changes of a Pull Request the org never received in the base, and \`git merge-file\` would drop them without a conflict marker.
- **sfdx-git-delta:** Computes the delta of each selected first-parent commit against its first parent, one run at a time, and unions them. The last commit touching an item decides whether it is deployed or deleted. Each delta is cached in the temporary folder, keyed by commit.
- **Org Metadata Retrieval:** Uses \`sf project retrieve start\` with the delta package.xml to retrieve current org state for conflict detection.
- **Diff Library:** Uses the \`diff\` npm package to compute file-level differences between org and local metadata.
- **Merge:** \`git merge-file --diff3\` between the org file, the file before the selection and the incoming file.
- **ExcelJS:** Generates Excel conflict reports via \`generateCsvFile\`.
- **md-to-pdf:** Converts markdown conflict reports to PDF using \`generatePdfFileFromMarkdown\`.
- **Deployment Actions:** Uses \`ActionsProvider\` to execute deployment actions, with \`authOrg\` for LoginAs authentication.
- **Progress of a background plan:** when \`SFDX_HARDIS_PROGRESS_FILE\` is set (the VS Code panel sets it), each step of the plan is appended to that file as one JSON line (\`step\`, \`message\`, and \`current\` / \`total\` on counted steps), so the panel shows what the command is doing while it waits for the JSON result.
</details>
`;

  public static examples = [
    '$ sf hardis:work:backpromote',
    '$ sf hardis:work:backpromote --parentbranch integration',
    '$ sf hardis:work:backpromote --pull-requests 478,481,487',
    '$ sf hardis:work:backpromote --pull-requests 482 --exclude-metadata "Layout:Opportunity-Sales Layout" --skip-actions',
    '$ sf hardis:work:backpromote --plan --json',
    '$ sf hardis:work:backpromote --plan --from abc1234 --json',
    '$ sf hardis:work:backpromote --pull-requests 482 --prepare-merge Flow:Quote_Approval --json',
    '$ sf hardis:work:backpromote --pull-requests 482 --merged-metadata Flow:Quote_Approval',
    '$ sf hardis:work:backpromote --agent',
  ];

  public static flags: any = {
    agent: Flags.boolean({
      default: false,
      description: 'Run in non-interactive mode for agents and automation',
    }),
    parentbranch: Flags.string({
      description: 'Name of the parent branch to backpromote from. Will be guessed or prompted if not provided.',
    }),
    from: Flags.string({
      description: 'Commit SHA: list the Pull Requests merged after it. PR number: list from that Pull Request, included. Instead of listing those merged after the last one backpromoted to the org.',
    }),
    to: Flags.string({
      description: 'PR number or commit SHA: select every Pull Request not yet backpromoted up to this one (included).',
    }),
    'pull-requests': Flags.string({
      description: 'Comma-separated numbers of the Pull Requests to backpromote. Asks nothing about what to deploy.',
    }),
    commits: Flags.string({
      description: 'Comma-separated SHAs of the parent branch commits to backpromote (for merges without a Pull Request number). Asks nothing about what to deploy.',
    }),
    'exclude-metadata': Flags.string({
      multiple: true,
      description: 'Type:Name of an item not to deploy nor delete, for example "Layout:Account-Account Layout". Repeatable.',
    }),
    'merged-metadata': Flags.string({
      multiple: true,
      description: 'Type:Name of an item whose local file holds a solved merge (see --prepare-merge): deploy it as it is. Repeatable.',
    }),
    'prepare-merge': Flags.string({
      multiple: true,
      description: 'Type:Name of an item changed both in the org and in the parent branch: write the three-way merge into the local file, return the coding agent prompt, and exit. Repeatable.',
    }),
    'skip-destructive': Flags.boolean({
      default: false,
      description: 'Do not delete anything from the org.',
    }),
    actions: Flags.string({
      description: 'Comma-separated ids of the deployment actions to run. Default: the actions not already run in this org.',
    }),
    'skip-actions': Flags.boolean({
      default: false,
      description: 'Run no deployment action.',
    }),
    plan: Flags.boolean({
      default: false,
      description: 'Read-only: return what a backpromote would do (use with --json). Deploys and writes nothing.',
    }),
    debug: Flags.boolean({
      char: 'd',
      default: false,
      description: messages.getMessage('debugMode'),
    }),
    websocket: Flags.string({
      description: messages.getMessage('websocket'),
    }),
    skipauth: Flags.boolean({
      description: 'Skip authentication check when a default username is required',
    }),
    'target-org': requiredOrgFlagWithDeprecations,
  };

  public static requiresProject = true;
  protected static requiresSfdxPlugins = ['sfdx-git-delta'];
  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(BackpromoteTask);
    const agentMode = flags.agent === true;
    const debugMode = flags.debug || false;
    const planMode = flags.plan === true;
    const targetUsername = flags['target-org'].getUsername();
    const conn = flags['target-org'].getConnection();

    const { ids: pullRequests, invalid: invalidPullRequests } = parsePullRequestNumbers(splitListFlag(flags['pull-requests']));
    if (invalidPullRequests.length > 0) {
      throw new SfError(t('backpromoteInvalidPullRequestNumbers', { values: invalidPullRequests.join(', ') }));
    }
    const commits = splitListFlag(flags.commits);
    const toFlag: string | null = flags.to || null;
    const fromFlag: string | null = flags.from || null;
    const excludedKeys = splitMetadataKeysFlag(flags['exclude-metadata']);
    const mergedKeys = splitMetadataKeysFlag(flags['merged-metadata']);
    const prepareMergeKeys = splitMetadataKeysFlag(flags['prepare-merge']);
    const actionIds = flags.actions !== undefined ? splitListFlag(flags.actions) : null;
    for (const key of [...excludedKeys, ...mergedKeys, ...prepareMergeKeys]) {
      if (!parseMetadataKey(key)) {
        throw new SfError(t('backpromoteInvalidMetadataKey', { key }));
      }
    }
    const explicitSelection = pullRequests.length > 0 || commits.length > 0 || toFlag !== null;
    const prepareMode = prepareMergeKeys.length > 0;
    const nonInteractive = agentMode || planMode || prepareMode || explicitSelection;
    const checks: BackpromotePlanCheck[] = [];

    uxLog('log', this, c.cyan(t('backpromoteStarting', { parentBranch: '' })));
    const currentBranch = (await getCurrentGitBranch()) || '';
    if (!currentBranch) {
      throw new Error('Unable to determine current git branch');
    }
    const projectConfig = await getConfig('project');
    const parentBranchChoices = await listBackpromoteParentBranchChoices(projectConfig.developmentBranch || null);
    // A plan always names its parent branch, even when it stops on a failed check
    const planParentBranch = planMode ? await resolveParentBranch(this, flags.parentbranch || null, true, currentBranch) : '';
    reportCommandProgress({ step: 'targetOrg', message: t('backpromoteProgressTargetOrg') });
    const targetOrg = await getBackpromoteTargetOrgInfo(conn, targetUsername);

    // Step 1: the history lives in Pull Request comments, so a git provider connection is required
    reportCommandProgress({ step: 'gitProvider', message: t('backpromoteProgressGitProvider') });
    const gitProviderCheck = await checkBackpromoteGitProvider(planMode ? planParentBranch : flags.parentbranch || null);
    const gitProviderName = gitProviderCheck.name;
    checks.push({ id: 'gitProvider', ok: gitProviderCheck.ok, message: gitProviderCheck.message });
    const blockedPlan = () =>
      buildBackpromotePlan({ status: 'blocked', currentBranch, parentBranch: planParentBranch, parentBranchChoices, targetOrg, gitProviderName, checks }) as unknown as AnyJson;
    if (!gitProviderCheck.ok || !gitProviderCheck.provider) {
      if (planMode) {
        return blockedPlan();
      }
      throw new SfError(gitProviderCheck.message);
    }
    const provider = gitProviderCheck.provider;

    // Step 2: the target org must be a developer sandbox or a scratch org
    checks.push({ id: 'targetOrg', ok: targetOrg.refusal === null, message: targetOrg.message });
    if (targetOrg.refusal !== null) {
      if (planMode) {
        return blockedPlan();
      }
      throw new SfError(targetOrg.message);
    }

    // Step 3: the parent branch, a major branch
    const parentBranch = planMode ? planParentBranch : await resolveParentBranch(this, flags.parentbranch || null, nonInteractive, currentBranch);
    // First output after the parent branch prompt: the VS Code UI only shows "action" lines there
    uxLog('action', this, c.cyan(t('backpromoteStarting', { parentBranch: c.green(parentBranch) })));
    const parentRefusal = findBackpromoteParentBranchRefusal(parentBranch, parentBranchChoices);
    if (parentRefusal) {
      const message = t('backpromoteParentBranchNotMajor', { parentBranch, branches: parentRefusal.majorBranches.join(', ') });
      checks.push({ id: 'parentBranch', ok: false, message });
      if (planMode) {
        return blockedPlan();
      }
      throw new SfError(message);
    }

    // Step 4: clean working tree, apart from the files holding a merge (prepared or solved)
    const mergeFiles = await findLocalMetadataFiles([...mergedKeys, ...prepareMergeKeys]);
    for (const key of mergedKeys) {
      if (!mergeFiles.get(key)) {
        throw new SfError(t('backpromoteMergedMetadataNotFound', { key }));
      }
    }
    const uncommittedFiles = await listUncommittedFiles([...mergeFiles.values()].filter((file): file is string => !!file));
    checks.push({
      id: 'gitClean',
      ok: uncommittedFiles.length === 0,
      message: uncommittedFiles.length === 0 ? t('backpromoteCheckGitCleanOk') : t('backpromoteCheckGitCleanFailed'),
      details: uncommittedFiles.length > 0 ? uncommittedFiles : undefined,
    });
    if (uncommittedFiles.length > 0 && !planMode) {
      throw new SfError(t('branchIsNotCleanCommitOrResetLocalUpdates', { branch: currentBranch, localUpdates: uncommittedFiles.join('\n') }));
    }
    if (mergedKeys.length > 0) {
      const stillConflicting = await listFilesWithConflictMarkers(mergedKeys.map((key) => mergeFiles.get(key) as string));
      // A plan says it in its checks rather than failing: the panel reloads a plan after every
      // merge, and a refusal there would leave it read-only with the merge still waiting
      checks.push({
        id: 'mergeMarkers',
        ok: stillConflicting.length === 0,
        message: stillConflicting.length === 0 ? t('backpromoteCheckMergeMarkersOk') : t('backpromoteMergedFilesHaveMarkers', { files: stillConflicting.join(', ') }),
        details: stillConflicting.length > 0 ? stillConflicting : undefined,
      });
      if (stillConflicting.length > 0 && !planMode) {
        throw new SfError(t('backpromoteMergedFilesHaveMarkers', { files: stillConflicting.join(', ') }));
      }
    }

    // Step 5: where the run works. Never on a major branch: on the current branch when it can receive the
    // backpromote, otherwise on a new local backpromote branch created from the remote parent branch
    reportCommandProgress({ step: 'fetch', message: t('backpromoteProgressFetch', { parentBranch }) });
    await gitFetch({ output: true });
    const parentRef = await resolveBackpromoteParentRef(parentBranch);
    const backpromoteBranchInfo = readBackpromoteBranchInfo(currentBranch);
    const workingBranch = decideBackpromoteWorkingBranch({
      currentBranch,
      parentBranch,
      majorBranches: parentBranchChoices,
      upToDate: isBranchUpToDateWith(parentRef, currentBranch),
      backpromoteReturnBranch: backpromoteBranchInfo.returnBranch,
      backpromoteParentBranch: backpromoteBranchInfo.parentBranch,
      hasSolvedMerge: mergedKeys.length > 0,
    });
    const workingBranchMessage = backpromoteWorkingBranchMessage(workingBranch, currentBranch, parentBranch);
    checks.push({ id: 'currentBranch', ok: !workingBranch.refusal, message: workingBranchMessage });
    if (workingBranch.refusal) {
      if (planMode) {
        return blockedPlan();
      }
      throw new SfError(workingBranchMessage);
    }
    uxLog('log', this, c.cyan(workingBranchMessage));
    // A backpromote branch behind the remote parent branch deploys the files it holds: listing the
    // newer Pull Requests of origin would deploy their metadata from a working tree without them
    const listingRef = workingBranch.listFromCurrentBranch ? currentBranch : parentRef;
    const fromRef = fromFlag ? await resolveBackpromoteFromRef(listingRef, fromFlag) : null;

    // Step 7: the Pull Requests merged in the parent branch, and what the Pull Request comments say
    // this org already received. The window starts at the newest one already backpromoted here.
    reportCommandProgress({ step: 'listing', message: t('backpromoteProgressListing', { parentBranch }) });
    const listedGroups = (await listMergedPrsWithCommits(listingRef, currentBranch, fromRef, this)).filter((group) => hasFirstParent(group.commit.hash));
    reportCommandProgress({ step: 'history', message: t('backpromoteProgressHistory', { count: listedGroups.length }) });
    const history = await loadBackpromoteHistory(provider, listedGroups, targetOrg.orgId, fromFlag !== null || explicitSelection);
    if (history.readErrors.length > 0) {
      // Not one comment could be read: the token cannot read them, and every Pull Request would be
      // offered again and redeployed. Saying so beats silently redoing everything.
      if (history.readOk === 0) {
        const message = t('backpromoteStateReadFailedAll', { prs: history.readErrors.join(', ') });
        checks.push({ id: 'gitProvider', ok: false, message });
        if (planMode) {
          return blockedPlan();
        }
        throw new SfError(message);
      }
      uxLog('warning', this, c.yellow(t('backpromoteStateReadFailed', { prs: history.readErrors.join(', ') })));
    }
    let groupsOldestFirst = listedGroups.slice(history.windowStartIndex);
    let histories = history.histories;
    // An org with no backpromote history at all (new or refreshed sandbox, scratch org) gets the
    // newest Pull Requests only: offering months of merges preselected would redeploy the whole
    // history and rerun every data action of the window on the first run
    const noHistory = history.noHistory && fromFlag === null && !explicitSelection;
    if (noHistory && groupsOldestFirst.length > BACKPROMOTE_NEW_ORG_WINDOW) {
      const firstListed = groupsOldestFirst.length - BACKPROMOTE_NEW_ORG_WINDOW;
      groupsOldestFirst = groupsOldestFirst.slice(firstListed);
      histories = histories.slice(firstListed);
    }
    const statuses = histories.map((item) => item.status);
    const windowAnchored = fromFlag === null && !explicitSelection && statuses[0] === 'done';
    if (windowAnchored) {
      const anchorPrs = groupsOldestFirst[0].associatedPrs.filter((pr) => pr.id > 0).map((pr) => `#${pr.id}`).join(', ');
      uxLog('log', this, c.grey(t('backpromoteWindowSinceLastBackpromoted', { parentBranch, pr: anchorPrs, orgName: targetOrg.orgName })));
    } else if (noHistory) {
      uxLog('log', this, c.grey(t('backpromoteWindowNewOrg', { orgName: targetOrg.orgName, count: groupsOldestFirst.length })));
    }
    // Always given, so a Pull Request left out of a run can be listed again afterwards
    const olderFrom = fromFlag === null && !explicitSelection && groupsOldestFirst.length > 0
      ? resolveOlderWindowStart(groupsOldestFirst[0].commit.hash)
      : null;
    const waitingIndexes = statuses.map((status, index) => (status === 'pending' ? index : -1)).filter((index) => index >= 0);
    const preselectedIndexes = defaultGroupSelection(histories, { noHistory });
    const actionsDoneInOrg = findActionsDoneInOrg(history.recordsByPr, targetOrg.orgId);
    const checksPassed = checks.every((check) => check.ok);
    const planBase = {
      currentBranch,
      parentBranch,
      parentBranchChoices,
      targetOrg,
      gitProviderName,
      checks,
      workingBranch,
      olderFrom,
      noHistory,
      preselectedHashes: preselectedIndexes.map((index) => groupsOldestFirst[index].commit.hash),
      stateReadErrors: history.readErrors,
      groupsOldestFirst,
      histories,
    };

    if (waitingIndexes.length === 0 && !explicitSelection) {
      if (planMode) {
        return buildBackpromotePlan({ ...planBase, status: checksPassed ? 'upToDate' : 'blocked' }) as unknown as AnyJson;
      }
      uxLog('action', this, c.cyan(t('backpromoteUpToDate', { parentBranch })));
      return { outputString: 'No changes to backpromote' };
    }

    // Step 8: which groups this run takes
    let selectedIndexes: number[];
    if (planMode) {
      selectedIndexes = waitingIndexes;
    } else if (explicitSelection) {
      const resolved = resolveExplicitGroupSelection(groupsOldestFirst, statuses, { pullRequests, commits, to: toFlag });
      if (resolved.unknownPullRequests.length > 0) {
        throw new SfError(t('backpromoteUnknownPullRequests', { parentBranch, ids: resolved.unknownPullRequests.join(', ') }) + (fromFlag ? '' : ' ' + t('backpromoteUnknownUseFrom')));
      }
      if (resolved.unknownCommits.length > 0) {
        throw new SfError(t('backpromoteUnknownCommits', { parentBranch, commits: resolved.unknownCommits.join(', ') }) + (fromFlag ? '' : ' ' + t('backpromoteUnknownUseFrom')));
      }
      selectedIndexes = resolved.selected;
    } else if (prepareMode) {
      selectedIndexes = preselectedIndexes;
    } else if (agentMode) {
      // Without selection flags, agent mode takes only the oldest group not yet backpromoted
      const nextIndex = waitingIndexes.find((index) => histories[index].trackable) ?? waitingIndexes[0];
      selectedIndexes = [nextIndex];
      const nextGroup = groupsOldestFirst[nextIndex];
      uxLog('action', this, c.cyan(t('backpromoteAgentAutoSelectedNextPr', {
        id: nextGroup.commit.hash.substring(0, 7) + ' ' + nextGroup.commit.message.substring(0, 60),
      })));
    } else {
      selectedIndexes = await promptBackpromoteGroups(groupsOldestFirst, histories, { noHistory });
    }
    if (selectedIndexes.length === 0) {
      uxLog('action', this, c.cyan(t('backpromoteNothingSelected')));
      return { outputString: 'No Pull Request selected' };
    }
    const selectedGroups = selectedIndexes.map((index) => groupsOldestFirst[index]);
    const selectedHashes = selectedGroups.map((group) => group.commit.hash);
    // What the org received last: the three-way merge starts there, and an item whose org version
    // is identical to it was not changed in the org, whatever the incoming version holds
    const mergeBaseCommit = resolveBackpromoteMergeBase({
      groupHashesOldestFirst: groupsOldestFirst.map((group) => group.commit.hash),
      statuses,
      selectedIndexes,
    });
    // The branch filters of the deployment actions must never match a major branch name: the run
    // works on a User Story branch, or on a temporary branch that carries no meaning of its own
    const userStoryBranchForActions =
      workingBranch.mode === 'currentBranch' && ['userStoryBranch', 'solvedMerge'].includes(workingBranch.reason) ? currentBranch : null;

    // Step 9: what the selection deploys and deletes. The pending groups left out are computed too,
    // to warn about the items they also changed.
    // In explicit mode the whole listing is read, but only the pending groups after the newest one
    // already backpromoted are recomputed: each older one would cost a delta for a warning only
    const deltaAnchorIndex = explicitSelection && fromFlag === null ? findNewestDoneGroupIndex(statuses) : -1;
    const deltaWaitingIndexes = waitingIndexes.filter((index) => index > deltaAnchorIndex);
    const computedIndexes = [...new Set([...deltaWaitingIndexes, ...selectedIndexes])].sort((a, b) => a - b);
    const computedGroups = computedIndexes.map((index) => groupsOldestFirst[index]);
    const deltas = checksPassed || !planMode ? await computeBackpromoteGroupDeltas(computedGroups, this, (index, total, group) =>
          reportCommandProgress({
            step: 'delta',
            message: t('backpromoteProgressDelta', { pr: backpromoteGroupLabel(group), current: index + 1, total }),
            current: index + 1,
            total,
          })
        ) : [];
    const computedHashes = computedGroups.map((group) => group.commit.hash);
    const union = unionGroupDeltas(deltas);
    const selection = selectDeltaUnion(union, selectedHashes, computedHashes);

    if (planMode && !checksPassed) {
      return buildBackpromotePlan({ ...planBase, status: 'blocked' }) as unknown as AnyJson;
    }

    if (!planMode) {
      const alsoChanged = findItemsAlsoChangedByUnselected(selection, selectedHashes, deltaWaitingIndexes.map((index) => groupsOldestFirst[index].commit.hash));
      if (alsoChanged.length > 0) {
        uxLog('warning', this, c.yellow(t('backpromoteItemsAlsoChangedByUnselected', { count: alsoChanged.length, items: alsoChanged.join(', ') })));
      }
      if (excludedKeys.length > 0) {
        uxLog('log', this, c.grey(t('backpromoteExcludedItems', { count: excludedKeys.length, items: excludedKeys.join(', ') })));
      }
    }

    // What this run records in the Pull Request comments, for this org
    const orgRecordUpdates = new Map<number, BackpromoteOrgRecord>();
    const commitOfPr = new Map<number, string>();
    for (const group of selectedGroups) {
      for (const pr of group.associatedPrs) {
        if (pr.id > 0) {
          commitOfPr.set(pr.id, group.commit.hash);
        }
      }
    }
    const recordFor = (prId: number): BackpromoteOrgRecord => {
      let record = orgRecordUpdates.get(prId);
      if (!record) {
        record = { orgId: targetOrg.orgId, orgName: targetOrg.orgName, date: null, commit: commitOfPr.get(prId) || '', actions: [] };
        orgRecordUpdates.set(prId, record);
      }
      return record;
    };
    const recordActionResult = (entry: BackpromoteActionEntry) => {
      if (entry.prId <= 0) {
        return;
      }
      const record = recordFor(entry.prId);
      const action = { id: entry.actionId, label: entry.actionLabel, status: entry.status, date: entry.date };
      const index = record.actions.findIndex((item) => item.id === entry.actionId);
      if (index >= 0) {
        record.actions[index] = action;
      } else {
        record.actions.push(action);
      }
    };
    const markSelectionBackpromoted = () => {
      const now = new Date().toISOString();
      for (const [prId, commit] of commitOfPr) {
        const record = recordFor(prId);
        record.date = now;
        record.commit = commit;
      }
      const untracked = selectedGroups.filter((group) => !group.associatedPrs.some((pr) => pr.id > 0));
      if (untracked.length > 0) {
        uxLog('warning', this, c.yellow(t('backpromoteStateCannotRemember', { count: untracked.length, commits: untracked.map((group) => group.commit.hash.substring(0, 7)).join(', ') })));
      }
    };

    const deployKeys = [...selection.items.keys()].filter((key) => !excludedKeys.includes(key));
    const deleteKeys = [...selection.deletions.keys()].filter((key) => !excludedKeys.includes(key));

    // A plan reads the files of the parent branch without checking it out. A run works on a new local
    // backpromote branch when the current branch cannot receive the backpromote.
    if (planMode && workingBranch.mode === 'newBackpromoteBranch') {
      reportCommandProgress({ step: 'parentFiles', message: t('backpromoteProgressParentFiles', { parentBranch }) });
    }
    const localPackageDirectories = planMode && workingBranch.mode === 'newBackpromoteBranch' ? await exportBranchPackageDirectories(listingRef, this) : [];
    const backpromoteBranch =
      !planMode && workingBranch.mode === 'newBackpromoteBranch' ? await createBackpromoteBranch(parentBranch, parentRef, currentBranch, this) : null;
    const workBranch = backpromoteBranch || currentBranch;
    // The branch to leave at the end of the run: the new one, or the backpromote branch this run
    // resumed on. A plan changes no branch at all: it is read-only, and the panel runs it in the
    // background while the user works in their editor.
    const branchToLeave = planMode
      ? null
      : backpromoteBranch || (['backpromoteBranch', 'backpromoteBranchBehind'].includes(workingBranch.reason) ? currentBranch : null);
    let runOutcome: 'mergePrepared' | 'deployed' | 'notDeployed' = 'notDeployed';
    let deployedMergedKeys: string[] = [];
    try {
      uxLog('log', this, c.cyan(t('backpromoteDeltaSummary', { addedModified: deployKeys.length, deleted: deleteKeys.length })));
      const { packageXml, destructiveXml } = await writeBackpromotePackages(deployKeys, deleteKeys);

      // Step 10: items changed in the org. An explicit selection (the VS Code panel Run, an agent)
      // already decided what to do with each item: retrieving the whole delta from the org again
      // would cost minutes and change nothing.
      const comparedKeys = prepareMode ? prepareMergeKeys.filter((key) => deployKeys.includes(key)) : deployKeys;
      const compareWithOrg = comparedKeys.length > 0 && (planMode || prepareMode || !explicitSelection);
      if (compareWithOrg) {
        reportCommandProgress({ step: 'orgCompare', message: t('backpromoteProgressOrgCompare', { count: comparedKeys.length }) });
      }
      const comparedPackageXml = prepareMode ? (await writeBackpromotePackages(comparedKeys, [])).packageXml : packageXml;
      const readBaseVersion = buildBackpromoteBaseVersionReader({
        baseCommit: mergeBaseCommit,
        gitRoot: path.resolve((await getGitRepoRoot()).trim()),
        packageDirectories: localPackageDirectories,
      });
      const conflictResult = compareWithOrg
        ? await detectOrgConflicts(comparedPackageXml, targetUsername, this, debugMode, localPackageDirectories, readBaseVersion)
        : { conflicts: [], success: true, notInOrgKeys: [] as string[] };
      const conflictsInSelection = conflictResult.conflicts.filter((item) => deployKeys.includes(toMetadataKey(item.metadataType, item.metadataName)));

      if (planMode) {
        reportCommandProgress({ step: 'actions', message: t('backpromoteProgressActions') });
        const localFiles = await findLocalMetadataFiles(selection.items.keys(), localPackageDirectories);
        return buildBackpromotePlan({
          ...planBase,
          status: 'ready',
          deltas,
          selection,
          conflicts: conflictResult.conflicts,
          notInOrgKeys: conflictResult.notInOrgKeys,
          conflictDetection: { success: conflictResult.success, errorMessage: conflictResult.success ? null : (conflictResult as any).errorMessage || null },
          actions: listBackpromotePlanActions(computedGroups, userStoryBranchForActions, actionsDoneInOrg, this),
          localFiles,
        }) as unknown as AnyJson;
      }

      const baseCommit = mergeBaseCommit;
      const selectionPullRequests = selectedGroups.flatMap((group) => group.associatedPrs).filter((pr, index, all) => all.findIndex((other) => other.id === pr.id && other.title === pr.title) === index);
      const runCommandFor = (merged: string[], excluded: string[]) => buildBackpromoteRunCommand({
        parentBranch,
        pullRequests: [...new Set(selectedGroups.flatMap((group) => group.associatedPrs.map((pr) => pr.id)).filter((id) => id > 0))],
        commits: selectedGroups.filter((group) => !group.associatedPrs.some((pr) => pr.id > 0)).map((group) => group.commit.hash),
        excludeMetadata: excluded,
        mergedMetadata: merged,
        actions: actionIds,
        skipActions: flags['skip-actions'] === true,
        skipDestructive: flags['skip-destructive'] === true,
        targetUsername,
      });
      const mergePromptFor = (files: Array<{ key: string; localPath: string; conflictBlocks: number }>, merged: string[], excluded: string[]) =>
        buildBackpromoteMergePrompt({
          parentBranch,
          currentBranch: workBranch,
          orgLabel: targetOrg.orgName,
          files,
          pullRequests: selectionPullRequests,
          nextCommand: runCommandFor(merged, excluded),
        });

      // --prepare-merge: write the merges, give the prompt, and stop
      if (prepareMode) {
        const files: BackpromotePrepareMergeResult['files'] = [];
        for (const key of prepareMergeKeys) {
          const conflict = conflictResult.conflicts.find((item) => toMetadataKey(item.metadataType, item.metadataName) === key && item.status === 'modified');
          if (!conflict || !conflict.localPath || !conflict.orgPath) {
            throw new SfError(t('backpromoteMergeCannotMerge', { key, parentBranch }));
          }
          const prepared = await prepareBackpromoteMerge({ key, localPath: conflict.localPath, orgPath: conflict.orgPath, baseCommit, parentBranch });
          files.push({ key: prepared.key, localPath: prepared.localPath, basePath: prepared.basePath, orgPath: prepared.orgPath, conflictBlocks: prepared.conflictBlocks });
        }
        const allMergedKeys = [...new Set([...mergedKeys, ...prepareMergeKeys])];
        const nextCommand = runCommandFor(allMergedKeys, excludedKeys);
        const prompt = mergePromptFor(files, allMergedKeys, excludedKeys);
        const promptFile = await writeBackpromoteMergePrompt(prompt);
        for (const file of files) {
          announceBackpromoteMerge({ ...file, originalContent: '' }, promptFile, this);
        }
        const result: BackpromotePrepareMergeResult = {
          files,
          prompt,
          promptFile,
          nextCommand,
          backpromoteBranch: branchToLeave,
          returnBranch: branchToLeave ? workingBranch.returnBranch : null,
        };
        runOutcome = 'mergePrepared';
        return result as unknown as AnyJson;
      }

      // Step 11: interactive review of the conflicts and of the items to deploy
      let conflictsToReview = conflictsInSelection.filter((item) => !mergedKeys.includes(toMetadataKey(item.metadataType, item.metadataName)));
      if (!conflictResult.success) {
        if (nonInteractive) {
          uxLog('warning', this, c.yellow(t('backpromoteConflictDetectionFailedAgentContinue')));
        } else {
          const continueRes = await promptConfirmContinueAfterConflictFailure((conflictResult as any).errorMessage || '', this);
          if (!continueRes) {
            return { outputString: 'Backpromote cancelled due to conflict detection failure' };
          }
        }
        conflictsToReview = [];
      }
      let diffsShownInVsCode = false;
      if (conflictsToReview.length > 0 && !explicitSelection) {
        await generateConflictReport(conflictsToReview, this);
        diffsShownInVsCode = await promptOpenVisualDiffsInVsCode(conflictsToReview, (conflictResult as any).emptyPlaceholderPath, this, nonInteractive);
      }
      const { validatedPackageXml } = await promptMetadataValidation(
        packageXml,
        destructiveXml,
        conflictsToReview,
        this,
        nonInteractive,
        conn.instanceUrl || '',
        diffsShownInVsCode,
      );
      const runMergedKeys = [...mergedKeys];
      if (!nonInteractive && conflictsToReview.length > 0) {
        const decisions = await promptBackpromoteConflictDecisions({
          conflicts: conflictsToReview,
          baseCommit,
          parentBranch,
          buildMergePrompt: (files, merged, excluded) => mergePromptFor(files, merged, [...excludedKeys, ...excluded]),
          commandThis: this,
        });
        runMergedKeys.push(...decisions.mergedKeys);
        if (decisions.excludedKeys.length > 0) {
          // First output after the decision prompts: the VS Code UI hides everything but "action"
          uxLog('action', this, c.cyan(t('backpromoteExcludedItems', { count: decisions.excludedKeys.length, items: decisions.excludedKeys.join(', ') })));
          await removeKeysFromPackageXml(validatedPackageXml, decisions.excludedKeys);
        }
      }

      // Step 12: deletions. Declining them, or --skip-destructive, really leaves them out.
      let validatedDestructiveXml: string | null = destructiveXml;
      if (flags['skip-destructive'] === true) {
        if (validatedDestructiveXml) {
          uxLog('action', this, c.cyan(t('backpromoteDestructiveChangesSkipped')));
        }
        validatedDestructiveXml = null;
      } else if (validatedDestructiveXml && fs.existsSync(validatedDestructiveXml) && !(await isPackageXmlEmpty(validatedDestructiveXml))) {
        const confirmed = await confirmDestructiveChanges(validatedDestructiveXml, this, nonInteractive);
        if (!confirmed) {
          uxLog('action', this, c.cyan(t('backpromoteDestructiveChangesSkipped')));
          validatedDestructiveXml = null;
        }
      }

      // Step 13: deployment actions and deployment. The results are written to the Pull Request
      // comments even when the deployment fails, so actions that already ran are not run twice.
      const actionOptions = {
        actionIds,
        skipActions: flags['skip-actions'] === true,
        nonInteractive: explicitSelection,
        actionsDoneInOrg,
        recordActionResult,
      };
      if (actionOptions.skipActions) {
        uxLog('log', this, c.grey(t('backpromoteActionsSkippedByFlag')));
      }
      try {
        await executeBackpromoteActions(selectedGroups, userStoryBranchForActions, 'commandsPreDeploy', targetUsername, conn, this, agentMode, actionOptions);
        await deployBackpromoteMetadata(
          validatedPackageXml,
          validatedDestructiveXml,
          targetUsername,
          collectTestClassesFromPrs(selectedGroups),
          this,
          debugMode,
          agentMode,
        );
        markSelectionBackpromoted();
        runOutcome = 'deployed';
        deployedMergedKeys = runMergedKeys;
        await executeBackpromoteActions(selectedGroups, userStoryBranchForActions, 'commandsPostDeploy', targetUsername, conn, this, agentMode, actionOptions);
      } finally {
        await persistBackpromoteOrgRecords(provider, orgRecordUpdates, this);
      }

      // On a backpromote branch, the merged files are committed when leaving it
      if (runMergedKeys.length > 0 && !branchToLeave) {
        const merged = await findLocalMetadataFiles(runMergedKeys);
        uxLog('action', this, c.yellow(t('backpromoteMergedFilesToCommit', { files: [...merged.values()].filter(Boolean).join(', ') })));
      }

      uxLog('action', this, c.green(t('backpromoteCompleted')));
      return {
        outputString: 'Backpromote completed successfully',
        selectedCommits: selectedHashes,
        deployed: deployKeys.length,
        deleted: validatedDestructiveXml ? deleteKeys.length : 0,
      };
    } finally {
      if (branchToLeave && workingBranch.returnBranch) {
        try {
          const mergedFiles =
            deployedMergedKeys.length > 0 ? [...(await findLocalMetadataFiles(deployedMergedKeys)).values()].filter((file): file is string => !!file) : [];
          await leaveBackpromoteBranch({
            branch: branchToLeave,
            returnBranch: workingBranch.returnBranch,
            parentRef,
            outcome: runOutcome,
            mergedFiles,
            commitMessage: `chore(sfdx-hardis): backpromote merge of ${deployedMergedKeys.join(', ')} from ${parentBranch}`,
            listUncommittedFiles: () => listUncommittedFiles(),
            commandThis: this,
          });
        } catch (e) {
          uxLog('warning', this, c.yellow(t('backpromoteLeaveBranchFailed', { branch: branchToLeave, message: (e as Error).message })));
        }
      }
    }
  }
}
