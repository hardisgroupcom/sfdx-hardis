/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { getCurrentGitBranch, uxLog } from '../../../common/utils/index.js';
import {
  collectTestClassesFromPrs,
  confirmDestructiveChanges,
  deployBackpromoteMetadata,
  detectOrgConflicts,
  ensureBranchUpToDate,
  executeBackpromoteActions,
  generateConflictReport,
  listMergedPrsWithCommits,
  loadBackpromoteState,
  promptConfirmContinueAfterConflictFailure,
  promptMetadataValidation,
  promptOpenVisualDiffsInVsCode,
  resolveParentBranch,
  saveBackpromoteState,
} from '../../../common/utils/backpromoteUtils.js';
import {
  BackpromotePlanCheck,
  BackpromotePrepareMergeResult,
  announceBackpromoteMerge,
  buildBackpromotePlan,
  computeBackpromoteGroupDeltas,
  findLocalMetadataFiles,
  findOldestCommit,
  getBackpromoteTargetOrgInfo,
  listBackpromoteParentBranchChoices,
  listBackpromotePlanActions,
  listFilesWithConflictMarkers,
  listUncommittedFiles,
  prepareBackpromoteMerge,
  promptBackpromoteConflictDecisions,
  promptBackpromoteGroups,
  removeKeysFromPackageXml,
  resolveBackpromoteGroupStatuses,
  resolveBackpromoteParentRef,
  writeBackpromoteMergePrompt,
  writeBackpromotePackages,
} from '../../../common/utils/backpromotePlanUtils.js';
import {
  buildBackpromoteMergePrompt,
  buildBackpromoteRunCommand,
  computeNextBackpromoteState,
  defaultGroupSelection,
  findItemsAlsoChangedByUnselected,
  getBackpromoteWindowStart,
  parseMetadataKey,
  resolveExplicitGroupSelection,
  selectDeltaUnion,
  splitListFlag,
  splitMetadataKeysFlag,
  toMetadataKey,
  unionGroupDeltas,
} from '../../../common/utils/backpromoteSelectionUtils.js';
import { getConfig } from '../../../config/index.js';
import { listMajorOrgs } from '../../../common/utils/orgConfigUtils.js';
import { isPackageXmlEmpty } from '../../../common/utils/xmlUtils.js';
import { t } from '../../../common/utils/i18n.js';
import fs from '../../../common/utils/fsUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class BackpromoteTask extends SfCommand<any> {
  public static title = 'Backpromote to dev sandbox (Beta)';

  public static description = `
## Command Behavior (Beta)

> **This command is currently in Beta.** Please report any issues or feedback on the [sfdx-hardis GitHub repository](https://github.com/hardisgroupcom/sfdx-hardis/issues).

**Brings the changes merged into a parent branch (e.g. integration) into the developer's own org: a developer sandbox or a scratch org.**

Developers stay in sync with what their teammates merged, without waiting for a new sandbox. In VS Code, the **Backpromote (Beta)** panel of the sfdx-hardis extension shows everything on one page and runs this same command with the choices made in the panel.

Key functionalities:

- **Developer orgs only:** the target org must be a developer sandbox or a scratch org. A production org, or the org of a major branch declared in \`config/branches\`, is refused: the CI/CD pipeline deploys those.
- **Pre-flight checks:** the git working directory must be clean, the current branch must not be a major branch, and it must already contain the latest commit of the parent branch.
- **Pull Request selection:** the Pull Requests merged in the parent branch since the last backpromote are listed, and each one can be selected or left out. A Pull Request left out is offered again by the next run. An item also changed by a Pull Request left out is deployed with that change too, since the deployment reads the files of the branch: the command warns about it.
- **Delta computation:** sfdx-git-delta computes what each selected Pull Request deploys and deletes.
- **Org conflict detection:** the same metadata is retrieved from the org and compared with the local files, with Excel and PDF reports and VS Code diffs.
- **Items changed in the org:** each one is deployed by default, can be kept as it is in the org, or merged. A merge writes a three-way merge with git conflict markers into the local file, opens it in VS Code, and saves a prompt to paste into a coding agent (Claude Code, GitHub Copilot...) to solve it. The solved file is then deployed as it is, and is to be committed with the User Story.
- **Deletions:** listed and confirmed. Declining really skips them.
- **Deployment:** NoTestRun, or RunSpecifiedTests when the selected Pull Requests declare test classes.
- **Deployment actions:** the actions of the selected Pull Requests run before and after the deployment. Actions requiring another user try LoginAs, then fall back to a manual checklist.
- **State tracking:** the last backpromoted commit, the Pull Requests left out and the actions already run are stored in the user config.

### Explicit selection

As soon as \`--pull-requests\`, \`--commits\` or \`--to\` is passed, the command asks nothing about what to deploy: every item of the selection is deployed and every deletion applied, unless \`--exclude-metadata\` or \`--skip-destructive\` says otherwise, and the actions not already run are executed, unless \`--actions\` or \`--skip-actions\` says otherwise. This is how the VS Code panel runs the command.

### Plan and merge (read-only modes)

- \`--plan --json\` returns the checks, the waiting Pull Requests with what each one deploys, the items changed in the org, the deletions and the deployment actions. It deploys nothing and saves nothing.
- \`--prepare-merge Type:Name\` writes the three-way merge of these items into the local files and returns the coding agent prompt. Run the command again with \`--merged-metadata Type:Name\` once the conflicts are solved.

### Agent Mode

Use \`--agent\` to disable all interactive prompts. The command will:

- Use the configured \`developmentBranch\` (or the branch the feature branch was created from) as the parent branch
- Without selection flags, select only the next Pull Request waiting (\`--from\` is required when no previous backpromote state exists)
- With \`--pull-requests\`, \`--commits\` or \`--to\`, deploy exactly that selection
- Deploy every item without interactive validation, apart from \`--exclude-metadata\`
- Auto-confirm destructive changes with a warning, unless \`--skip-destructive\`
- Log manual actions instead of prompting

Required flags: \`--agent\`, and \`--from\` or a selection flag if no previous backpromote state exists.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Target org check:** queries \`Organization.IsSandbox\` and \`TrialExpirationDate\`, and compares the username and instance URL with the major orgs of \`config/branches\`.
- **Git Integration:** Uses \`simple-git\` to verify branch status, list the first-parent commits of the parent branch and group the Pull Requests each one brought in.
- **sfdx-git-delta:** Computes the delta of each selected first-parent commit against its first parent, and unions them. The last commit touching an item decides whether it is deployed or deleted.
- **Org Metadata Retrieval:** Uses \`sf project retrieve start\` with the delta package.xml to retrieve current org state for conflict detection.
- **Diff Library:** Uses the \`diff\` npm package to compute file-level differences between org and local metadata.
- **Merge:** \`git merge-file --diff3\` between the org file, the file before the selection and the incoming file.
- **ExcelJS:** Generates Excel conflict reports via \`generateCsvFile\`.
- **md-to-pdf:** Converts markdown conflict reports to PDF using \`generatePdfFileFromMarkdown\`.
- **Deployment Actions:** Uses \`ActionsProvider\` to execute deployment actions, with \`authOrg\` for LoginAs authentication.
- **Configuration:** Stores backpromote state (\`lastCommit\`, \`skippedCommits\`) and deployment action history in user config via \`setConfig('user', ...)\`.
</details>
`;

  public static examples = [
    '$ sf hardis:work:backpromote',
    '$ sf hardis:work:backpromote --parentbranch integration',
    '$ sf hardis:work:backpromote --pull-requests 478,481,487',
    '$ sf hardis:work:backpromote --pull-requests 482 --exclude-metadata "Layout:Opportunity-Sales Layout" --skip-actions',
    '$ sf hardis:work:backpromote --plan --json',
    '$ sf hardis:work:backpromote --pull-requests 482 --prepare-merge Flow:Quote_Approval --json',
    '$ sf hardis:work:backpromote --pull-requests 482 --merged-metadata Flow:Quote_Approval',
    '$ sf hardis:work:backpromote --agent',
    '$ sf hardis:work:backpromote --agent --from abc1234',
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
      description: 'PR number or commit SHA to start the backpromote from. Required in --agent mode when no previous backpromote state exists and no selection flag is passed.',
    }),
    to: Flags.string({
      description: 'PR number or commit SHA: select every Pull Request waiting up to this one (included).',
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
      description: 'Comma-separated ids of the deployment actions to run. Default: the actions not already run on this branch.',
    }),
    'skip-actions': Flags.boolean({
      default: false,
      description: 'Run no deployment action.',
    }),
    plan: Flags.boolean({
      default: false,
      description: 'Read-only: return what a backpromote would do (use with --json). Deploys and saves nothing.',
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

    const pullRequests = splitListFlag(flags['pull-requests']).map((value) => parseInt(value, 10)).filter((value) => !isNaN(value));
    const commits = splitListFlag(flags.commits);
    const toFlag: string | null = flags.to || null;
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

    // Step 1: the target org must be a developer sandbox or a scratch org
    uxLog('log', this, c.cyan(t('backpromoteStarting', { parentBranch: '' })));
    const targetOrg = await getBackpromoteTargetOrgInfo(conn, targetUsername);
    checks.push({ id: 'targetOrg', ok: targetOrg.refusal === null, message: targetOrg.message });
    const projectConfig = await getConfig('project');
    const parentBranchChoices = await listBackpromoteParentBranchChoices(projectConfig.developmentBranch || null);
    const blockedPlan = (currentBranch: string, parentBranch: string) =>
      buildBackpromotePlan({ status: 'blocked', currentBranch, parentBranch, parentBranchChoices, targetOrg, checks, lastState: null }) as unknown as AnyJson;
    if (targetOrg.refusal !== null) {
      if (planMode) {
        return blockedPlan((await getCurrentGitBranch()) || '', flags.parentbranch || '');
      }
      throw new SfError(targetOrg.message);
    }

    // Step 2: never from a major branch
    const currentBranch = (await getCurrentGitBranch()) || '';
    if (!currentBranch) {
      throw new Error('Unable to determine current git branch');
    }
    const majorOrgs = await listMajorOrgs();
    if (majorOrgs.some((org: any) => org.branchName === currentBranch)) {
      const message = t('backpromoteNotAllowedOnMajorOrg', { currentBranch });
      checks.push({ id: 'currentBranch', ok: false, message });
      if (planMode) {
        return blockedPlan(currentBranch, flags.parentbranch || '');
      }
      throw new SfError(message);
    }

    // Step 3: parent branch
    const parentBranch = await resolveParentBranch(this, flags.parentbranch || null, nonInteractive, currentBranch);
    uxLog('log', this, c.cyan(t('backpromoteStarting', { parentBranch: c.green(parentBranch) })));
    if (currentBranch === parentBranch) {
      const message = t('backpromoteCannotBackpromoteFromSameBranch');
      checks.push({ id: 'currentBranch', ok: false, message });
      if (planMode) {
        return blockedPlan(currentBranch, parentBranch);
      }
      throw new Error(message);
    }
    checks.push({ id: 'currentBranch', ok: true, message: t('backpromoteCheckCurrentBranchOk', { branch: currentBranch }) });

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
      if (stillConflicting.length > 0) {
        throw new SfError(t('backpromoteMergedFilesHaveMarkers', { files: stillConflicting.join(', ') }));
      }
    }

    // Step 5: the branch must already contain the latest commit of the parent branch
    try {
      await ensureBranchUpToDate(parentBranch, currentBranch, this);
      checks.push({ id: 'upToDate', ok: true, message: t('backpromoteCheckUpToDateOk', { currentBranch, parentBranch }) });
    } catch (e) {
      checks.push({ id: 'upToDate', ok: false, message: (e as Error).message });
      if (!planMode) {
        throw e;
      }
    }
    const checksPassed = checks.every((check) => check.ok);

    // Step 6: list the Pull Request groups waiting in the parent branch
    const lastState = await loadBackpromoteState(currentBranch);
    const fromFlag: string | null = flags.from || null;
    if (agentMode && !lastState && !fromFlag && !explicitSelection) {
      throw new SfError(t('backpromoteAgentRequiresFromFlag'));
    }
    // What the remote parent branch holds, which is what the up-to-date check compared with
    const parentRef = await resolveBackpromoteParentRef(parentBranch);
    const oldestSkipped = lastState?.skippedCommits?.length ? await findOldestCommit(lastState.skippedCommits, parentRef) : null;
    const groupsOldestFirst = await listMergedPrsWithCommits(parentRef, currentBranch, getBackpromoteWindowStart(fromFlag, lastState, oldestSkipped), this);
    const statuses = await resolveBackpromoteGroupStatuses(groupsOldestFirst, lastState);
    const waitingIndexes = statuses.map((status, index) => (status === 'done' ? -1 : index)).filter((index) => index >= 0);
    const planBase = { currentBranch, parentBranch, parentBranchChoices, targetOrg, checks, lastState };

    if (waitingIndexes.length === 0 && !explicitSelection) {
      if (planMode) {
        return buildBackpromotePlan({ ...planBase, status: checksPassed ? 'upToDate' : 'blocked', groupsOldestFirst, statuses }) as unknown as AnyJson;
      }
      uxLog('action', this, c.cyan(t('backpromoteUpToDate', { parentBranch })));
      return { outputString: 'No changes to backpromote' };
    }

    // Step 7: which groups this run takes
    let selectedIndexes: number[];
    if (planMode) {
      selectedIndexes = waitingIndexes;
    } else if (explicitSelection) {
      const resolved = resolveExplicitGroupSelection(groupsOldestFirst, statuses, { pullRequests, commits, to: toFlag });
      if (resolved.unknownPullRequests.length > 0) {
        throw new SfError(t('backpromoteUnknownPullRequests', { parentBranch, ids: resolved.unknownPullRequests.join(', ') }));
      }
      if (resolved.unknownCommits.length > 0) {
        throw new SfError(t('backpromoteUnknownCommits', { parentBranch, commits: resolved.unknownCommits.join(', ') }));
      }
      selectedIndexes = resolved.selected;
    } else if (prepareMode) {
      selectedIndexes = defaultGroupSelection(statuses);
    } else if (agentMode) {
      // Without selection flags, agent mode takes only the next group waiting
      selectedIndexes = [waitingIndexes[0]];
      const nextGroup = groupsOldestFirst[waitingIndexes[0]];
      uxLog('action', this, c.cyan(t('backpromoteAgentAutoSelectedNextPr', {
        id: nextGroup.commit.hash.substring(0, 7) + ' ' + nextGroup.commit.message.substring(0, 60),
      })));
    } else {
      selectedIndexes = await promptBackpromoteGroups(groupsOldestFirst, statuses, lastState);
    }
    if (selectedIndexes.length === 0) {
      uxLog('action', this, c.cyan(t('backpromoteNothingSelected')));
      return { outputString: 'No Pull Request selected' };
    }
    const selectedGroups = selectedIndexes.map((index) => groupsOldestFirst[index]);
    const selectedHashes = selectedGroups.map((group) => group.commit.hash);

    // Step 8: what the selection deploys and deletes. The waiting groups left out are computed too,
    // to warn about the items they also changed.
    const computedIndexes = [...new Set([...waitingIndexes, ...selectedIndexes])].sort((a, b) => a - b);
    const computedGroups = computedIndexes.map((index) => groupsOldestFirst[index]);
    const deltas = checksPassed || !planMode ? await computeBackpromoteGroupDeltas(computedGroups, this) : [];
    const computedHashes = computedGroups.map((group) => group.commit.hash);
    const union = unionGroupDeltas(deltas);
    const selection = selectDeltaUnion(union, selectedHashes, computedHashes);

    if (planMode && !checksPassed) {
      return buildBackpromotePlan({ ...planBase, status: 'blocked', groupsOldestFirst, statuses }) as unknown as AnyJson;
    }

    if (!planMode) {
      const alsoChanged = findItemsAlsoChangedByUnselected(selection, selectedHashes, waitingIndexes.map((index) => groupsOldestFirst[index].commit.hash));
      if (alsoChanged.length > 0) {
        uxLog('warning', this, c.yellow(t('backpromoteItemsAlsoChangedByUnselected', { count: alsoChanged.length, items: alsoChanged.join(', ') })));
      }
      if (excludedKeys.length > 0) {
        uxLog('log', this, c.grey(t('backpromoteExcludedItems', { count: excludedKeys.length, items: excludedKeys.join(', ') })));
      }
    }
    const deployKeys = [...selection.items.keys()].filter((key) => !excludedKeys.includes(key));
    const deleteKeys = [...selection.deletions.keys()].filter((key) => !excludedKeys.includes(key));

    if (deployKeys.length === 0 && deleteKeys.length === 0 && !planMode) {
      uxLog('action', this, c.cyan(t('backpromoteNoDelta')));
      await saveBackpromoteState(currentBranch, computeNextBackpromoteState(groupsOldestFirst, statuses, selectedIndexes, lastState, parentBranch), this);
      return { outputString: 'No metadata changes to deploy' };
    }
    uxLog('log', this, c.cyan(t('backpromoteDeltaSummary', { addedModified: deployKeys.length, deleted: deleteKeys.length })));
    const { packageXml, destructiveXml } = await writeBackpromotePackages(deployKeys, deleteKeys);

    // Step 9: items changed in the org
    const conflictResult = deployKeys.length > 0
      ? await detectOrgConflicts(packageXml, targetUsername, this, debugMode)
      : { conflicts: [], success: true, notInOrgKeys: [] as string[] };
    const conflictsInSelection = conflictResult.conflicts.filter((item) => deployKeys.includes(toMetadataKey(item.metadataType, item.metadataName)));

    if (planMode) {
      const localFiles = await findLocalMetadataFiles(selection.items.keys());
      return buildBackpromotePlan({
        ...planBase,
        status: 'ready',
        groupsOldestFirst,
        statuses,
        deltas,
        selection,
        conflicts: conflictResult.conflicts,
        notInOrgKeys: conflictResult.notInOrgKeys,
        conflictDetection: { success: conflictResult.success, errorMessage: conflictResult.success ? null : (conflictResult as any).errorMessage || null },
        actions: await listBackpromotePlanActions(computedGroups, currentBranch, this),
        localFiles,
      }) as unknown as AnyJson;
    }

    // The merge base is the parent branch as it was just before the oldest selected group
    const baseCommit = `${selectedHashes[0]}^1`;
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
        currentBranch,
        orgLabel: targetUsername,
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
      const nextCommand = runCommandFor([...new Set([...mergedKeys, ...prepareMergeKeys])], excludedKeys);
      const prompt = mergePromptFor(files, [...new Set([...mergedKeys, ...prepareMergeKeys])], excludedKeys);
      const promptFile = await writeBackpromoteMergePrompt(prompt);
      for (const file of files) {
        announceBackpromoteMerge({ ...file, originalContent: '' }, promptFile, this);
      }
      const result: BackpromotePrepareMergeResult = { files, prompt, promptFile, nextCommand };
      return result as unknown as AnyJson;
    }

    // Step 10: interactive review of the conflicts and of the items to deploy
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
        uxLog('log', this, c.grey(t('backpromoteExcludedItems', { count: decisions.excludedKeys.length, items: decisions.excludedKeys.join(', ') })));
        await removeKeysFromPackageXml(validatedPackageXml, decisions.excludedKeys);
      }
    }

    // Step 11: deletions. Declining them, or --skip-destructive, really leaves them out.
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

    // Step 12: deployment actions, deployment
    const actionOptions = { actionIds, skipActions: flags['skip-actions'] === true, nonInteractive: explicitSelection };
    if (actionOptions.skipActions) {
      uxLog('log', this, c.grey(t('backpromoteActionsSkippedByFlag')));
    }
    await executeBackpromoteActions(selectedGroups, currentBranch, 'commandsPreDeploy', targetUsername, conn, this, agentMode, actionOptions);
    await deployBackpromoteMetadata(
      validatedPackageXml,
      validatedDestructiveXml,
      targetUsername,
      collectTestClassesFromPrs(selectedGroups),
      this,
      debugMode,
      agentMode,
    );
    await executeBackpromoteActions(selectedGroups, currentBranch, 'commandsPostDeploy', targetUsername, conn, this, agentMode, actionOptions);

    // Step 13: state
    await saveBackpromoteState(currentBranch, computeNextBackpromoteState(groupsOldestFirst, statuses, selectedIndexes, lastState, parentBranch), this);
    if (runMergedKeys.length > 0) {
      const merged = await findLocalMetadataFiles(runMergedKeys);
      uxLog('action', this, c.yellow(t('backpromoteMergedFilesToCommit', { files: [...merged.values()].filter(Boolean).join(', ') })));
    }

    uxLog('action', this, c.green(t('backpromoteCompleted')));
    return { outputString: 'Backpromote completed successfully', selectedCommits: selectedHashes, deployed: deployKeys.length, deleted: validatedDestructiveXml ? deleteKeys.length : 0 };
  }
}
