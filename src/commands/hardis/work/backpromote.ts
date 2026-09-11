/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import * as path from 'path';
import { createTempDir, getCurrentGitBranch, gitFetch, uxLog } from '../../../common/utils/index.js';
import { forceSourcePull } from '../../../common/utils/deployUtils.js';
import { writePackageXmlFile } from '../../../common/utils/xmlUtils.js';
import {
  collectTestClassesFromPrs,
  confirmDestructiveChanges,
  deployBackpromoteMetadata,
  executeBackpromoteActions,
  listMergedPrsWithCommits,
  resolveParentBranch,
} from '../../../common/utils/backpromoteUtils.js';
import {
  BackpromotePlanCheck,
  announceBackpromoteConflicts,
  buildBackpromotePlan,
  getBackpromoteTargetOrgInfo,
  listBackpromoteParentBranchChoices,
  listOrgPendingChanges,
  promptConflictDecision,
  promptItemsToDeploy,
  promptWaitForSolvedConflicts,
  writeBackpromoteMergePrompt,
} from '../../../common/utils/backpromotePlanUtils.js';
import {
  abortMerge,
  applyConflictDecision,
  changedFilesBetween,
  clearBackpromoteBase,
  commitAllChanges,
  commitMerge,
  computeBackpromoteDelta,
  findItemPaths,
  headCommit,
  isAncestor,
  isMergeInProgress,
  listConflictedFiles,
  listFilesWithConflictMarkers,
  listUncommittedFiles,
  mergeBaseOf,
  mergeParentBranch,
  readBackpromoteBase,
  readMergeHead,
  resolveBackpromoteParentRef,
  saveBackpromoteBase,
} from '../../../common/utils/backpromoteGitUtils.js';
import {
  BackpromoteConflictChoice,
  buildBackpromoteMergePrompt,
  buildBackpromoteRunCommand,
  classifyBackpromoteCurrentBranch,
  findBackpromoteParentBranchRefusal,
  metadataKeysToPackageContent,
  parseConflictDecisions,
  parseMetadataKey,
  predictConflictingFiles,
  splitListFlag,
  splitMetadataKeysFlag,
} from '../../../common/utils/backpromoteRules.js';
import { getConfig } from '../../../config/index.js';
import { t } from '../../../common/utils/i18n.js';
import { reportCommandProgress } from '../../../common/utils/progressFileUtils.js';
import fs from '../../../common/utils/fsUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class BackpromoteTask extends SfCommand<any> {
  public static title = 'Backpromote to dev sandbox (Beta)';

  public static description = `
## Command Behavior (Beta)

> **This command is currently in Beta.** Please report any issues or feedback on the [sfdx-hardis GitHub repository](https://github.com/hardisgroupcom/sfdx-hardis/issues).

**Brings what your teammates merged in the parent branch (e.g. integration) into your User Story branch and your own org: a developer sandbox or a scratch org.**

A backpromote is a git merge of the parent branch into your branch, followed by the deployment of what that merge brought in. Git is the only source of truth: nothing is stored anywhere else. In VS Code, the **Backpromote (Beta)** panel of the sfdx-hardis extension shows what the merge brings and runs this same command with the choices made in the panel.

What the command does, in order:

1. **Checks:** you must be on a User Story branch (never a major, promotion or retrofit branch), with no uncommitted change, and the target org must be a developer sandbox or a scratch org. A production org, or the org of a major branch declared in \`config/branches\`, is refused: the CI/CD pipeline deploys those.
2. **Saves your org work:** when the org tracks its sources, its pending changes are pulled and committed in your branch first, so the merge sees them and the deployment never overwrites them. Use \`--no-pull\` to skip it.
3. **Merges the parent branch:** \`git fetch\` then \`git merge origin/<parent branch>\`. A file changed on both sides that git cannot merge on its own gets one decision: **overwrite** (take the parent branch version), **keep** (keep yours, as your org has it) or **merge** (solve it by hand). For a manual merge, the files are opened in VS Code and a prompt to paste into a coding agent (Claude Code, GitHub Copilot...) is saved: solve the conflicts, then run the command again, it finishes the merge and continues.
4. **Deploys the delta:** sfdx-git-delta computes what the merge brought in, and it is deployed to your org with its deletions (confirmed), the Apex test classes and the deployment actions declared by the Pull Requests merged, before and after the deployment. An item left out with \`--exclude-metadata\` stays in your branch and is not deployed now: with source tracking it stays pending, ready for a later push.

### Decisions from the flags

\`--auto\` takes every decision from the flags and asks nothing: every item is deployed unless \`--exclude-metadata\` says otherwise, every deletion applied unless \`--skip-destructive\`, every deployment action run unless \`--actions\` or \`--skip-actions\` says otherwise, and a conflicting file without an \`--on-conflict\` decision is left for a manual merge. This is how the VS Code panel runs the command.

### Plan (read-only)

\`--plan --json\` returns the checks, the Pull Requests the merge brings in, the items and the deletions it deploys, the files the merge may stop on (changed in the parent branch and in your branch or your org), the deployment actions and the pending changes of your org. It reads git and previews the org: it deploys, merges and writes nothing.

### Agent Mode

Use \`--agent\` to disable all interactive prompts. The command will:

- Use the branch the User Story was created from, or the configured \`developmentBranch\`, as the parent branch
- Behave as with \`--auto\`
- Stop on a conflicting file without decision, leaving the merge in progress and the coding agent prompt in \`hardis-report/\`: solve it and run the command again

<details markdown="1">
<summary>Technical explanations</summary>

- **Target org check:** queries \`Organization.Id\`, \`IsSandbox\` and \`TrialExpirationDate\`, and compares the username (and the sandbox it belongs to) and the instance URL with the major orgs of \`config/branches\`.
- **Org pending changes:** \`sf project retrieve preview\` for the plan, \`sf project retrieve start\` then a commit for the run, when the org tracks its sources.
- **Merge:** \`git merge --no-edit origin/<parent>\`. The pre-merge commit is kept in the \`refs/sfdx-hardis/backpromote-base\` ref while the merge waits for its conflicts, so the next run finishes the merge (\`git commit\`) and deploys the same delta. \`overwrite\` is \`git checkout --theirs\`, \`keep\` is \`git checkout --ours\`.
- **Delta:** sfdx-git-delta between the pre-merge commit and the merge commit, cached in the temporary folder per commit pair.
- **Pull Requests, actions and test classes:** the first-parent commits of the parent branch since the merge base, with the Pull Request numbers read from their messages, and \`scripts/actions/.sfdx-hardis.<PR>.yml\` read from the parent branch.
- **Progress of a background plan:** when \`SFDX_HARDIS_PROGRESS_FILE\` is set (the VS Code panel sets it), each step is appended to that file as one JSON line.
</details>
`;

  public static examples = [
    '$ sf hardis:work:backpromote',
    '$ sf hardis:work:backpromote --parentbranch integration',
    '$ sf hardis:work:backpromote --auto --exclude-metadata "Layout:Opportunity-Sales Layout" --skip-actions',
    '$ sf hardis:work:backpromote --auto --on-conflict "force-app/main/default/classes/InvoiceCalculator.cls=overwrite"',
    '$ sf hardis:work:backpromote --plan --json',
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
    auto: Flags.boolean({
      default: false,
      description: 'Take every decision from the flags and ask nothing (the VS Code panel passes it).',
    }),
    'exclude-metadata': Flags.string({
      multiple: true,
      description: 'Type:Name of an item not to deploy nor delete now, for example "Layout:Account-Account Layout". Repeatable.',
    }),
    'on-conflict': Flags.string({
      multiple: true,
      description: 'What to do with a file git cannot merge: "<file path>=overwrite" (parent branch version), "=keep" (your version) or "=merge" (solve it by hand). Repeatable.',
    }),
    'skip-destructive': Flags.boolean({
      default: false,
      description: 'Do not delete anything from the org.',
    }),
    actions: Flags.string({
      description: 'Comma-separated ids of the deployment actions to run. Default: every action of the Pull Requests brought in.',
    }),
    'skip-actions': Flags.boolean({
      default: false,
      description: 'Run no deployment action.',
    }),
    'no-pull': Flags.boolean({
      default: false,
      description: 'Do not pull the pending changes of the org into your branch before the merge.',
    }),
    plan: Flags.boolean({
      default: false,
      description: 'Read-only: return what a backpromote would do (use with --json). Deploys, merges and writes nothing.',
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
    const planMode = flags.plan === true;
    const auto = flags.auto === true || agentMode;
    const debugMode = flags.debug || false;
    const noPull = flags['no-pull'] === true;
    const targetUsername = flags['target-org'].getUsername();
    const conn = flags['target-org'].getConnection();

    const excludedKeys = splitMetadataKeysFlag(flags['exclude-metadata']);
    for (const key of excludedKeys) {
      if (!parseMetadataKey(key)) {
        throw new SfError(t('backpromoteInvalidMetadataKey', { key }));
      }
    }
    const { decisions: conflictDecisions, invalid: invalidDecisions } = parseConflictDecisions(flags['on-conflict']);
    if (invalidDecisions.length > 0) {
      throw new SfError(t('backpromoteInvalidConflictDecision', { values: invalidDecisions.join(', ') }));
    }
    const actionIds = flags.actions !== undefined ? splitListFlag(flags.actions) : null;
    const nonInteractive = auto || planMode;
    const checks: BackpromotePlanCheck[] = [];

    // Step 1: the branch, the parent branch and the org
    const currentBranch = (await getCurrentGitBranch()) || '';
    if (!currentBranch) {
      throw new SfError('Unable to determine current git branch');
    }
    const projectConfig = await getConfig('project');
    const parentBranchChoices = await listBackpromoteParentBranchChoices(projectConfig.developmentBranch || null);
    const parentBranch = await resolveParentBranch(this, flags.parentbranch || null, nonInteractive, currentBranch);
    // First output after the parent branch prompt: the VS Code UI only shows "action" lines there
    uxLog('action', this, c.cyan(t('backpromoteStarting', { parentBranch: c.green(parentBranch) })));

    reportCommandProgress({ step: 'targetOrg', message: t('backpromoteProgressTargetOrg') });
    const tracksSource = await flags['target-org'].tracksSource().catch(() => false);
    const targetOrg = await getBackpromoteTargetOrgInfo(conn, targetUsername, tracksSource);
    checks.push({ id: 'targetOrg', ok: targetOrg.refusal === null, message: targetOrg.message });

    const branchKind = currentBranch === parentBranch ? 'majorBranch' : classifyBackpromoteCurrentBranch(currentBranch, parentBranchChoices);
    const branchMessages = {
      userStoryBranch: t('backpromoteCheckCurrentBranchOk', { branch: currentBranch }),
      majorBranch: t('backpromoteCurrentBranchIsMajor', { branch: currentBranch }),
      promotionBranch: t('backpromoteCurrentBranchIsPromotion', { branch: currentBranch }),
      retrofitBranch: t('backpromoteCurrentBranchIsRetrofit', { branch: currentBranch }),
    };
    checks.push({ id: 'currentBranch', ok: branchKind === 'userStoryBranch', message: branchMessages[branchKind] });

    const parentRefusal = findBackpromoteParentBranchRefusal(parentBranch, parentBranchChoices);
    checks.push({
      id: 'parentBranch',
      ok: parentRefusal === null,
      message: parentRefusal
        ? t('backpromoteParentBranchNotMajor', { parentBranch, branches: parentRefusal.majorBranches.join(', ') })
        : t('backpromoteCheckParentBranchOk', { parentBranch }),
    });

    // A merge left waiting by a previous run: its conflicted files are the expected uncommitted ones
    const resumedBase = isMergeInProgress() ? readBackpromoteBase() : null;
    if (!resumedBase) {
      const uncommittedFiles = await listUncommittedFiles();
      checks.push({
        id: 'gitClean',
        ok: uncommittedFiles.length === 0,
        message: uncommittedFiles.length === 0 ? t('backpromoteCheckGitCleanOk') : t('backpromoteCheckGitCleanFailed'),
        details: uncommittedFiles.length > 0 ? uncommittedFiles : undefined,
      });
    }

    const planBase = { currentBranch, parentBranch, parentBranchChoices, targetOrg, checks, commandThis: this };
    const failedCheck = checks.find((check) => !check.ok);
    if (failedCheck) {
      if (planMode) {
        return buildBackpromotePlan({ ...planBase, status: 'blocked' }) as unknown as AnyJson;
      }
      throw new SfError(failedCheck.message + (failedCheck.details ? '\n' + failedCheck.details.join('\n') : ''));
    }

    // Step 2: what the parent branch holds that the branch does not
    reportCommandProgress({ step: 'fetch', message: t('backpromoteProgressFetch', { parentBranch }) });
    await gitFetch({ output: true });
    const parentRef = resolveBackpromoteParentRef(parentBranch);

    // The ref merged: the remote parent branch, or the commit a waiting merge started from, which
    // may be older than the remote parent branch is now
    const mergedRef = resumedBase ? readMergeHead() || parentRef : parentRef;
    if (!resumedBase && isAncestor(parentRef, 'HEAD')) {
      if (planMode) {
        return buildBackpromotePlan({ ...planBase, status: 'upToDate' }) as unknown as AnyJson;
      }
      uxLog('action', this, c.green(t('backpromoteUpToDate', { parentBranch })));
      return { outputString: 'Nothing to backpromote' };
    }
    const mergeBase = mergeBaseOf(mergedRef, resumedBase || 'HEAD');
    if (!mergeBase) {
      throw new SfError(t('backpromoteNoMergeBase', { parentBranch, branch: currentBranch }));
    }
    reportCommandProgress({ step: 'listing', message: t('backpromoteProgressListing', { parentBranch }) });
    const groups = await listMergedPrsWithCommits(mergedRef, currentBranch, mergeBase, this);
    const pullRequestsForPrompt = groups.flatMap((group) => group.associatedPrs).filter((pr, index, all) => all.findIndex((other) => other.id === pr.id && other.title === pr.title) === index);
    const runCommand = () =>
      buildBackpromoteRunCommand({
        parentBranch,
        excludeMetadata: excludedKeys,
        conflictDecisions,
        actions: actionIds,
        skipActions: flags['skip-actions'] === true,
        skipDestructive: flags['skip-destructive'] === true,
        noPull,
        targetUsername,
      });

    // Stop until the markers are gone: VS Code opens the files, and the coding agent prompt says how
    const stopOnConflicts = async (files: Array<{ path: string; conflictBlocks: number }>): Promise<AnyJson> => {
      const prompt = buildBackpromoteMergePrompt({ parentBranch, currentBranch, orgLabel: targetOrg.orgName, files, pullRequests: pullRequestsForPrompt, nextCommand: runCommand() });
      const promptFile = await writeBackpromoteMergePrompt(prompt);
      await announceBackpromoteConflicts(files, promptFile, this);
      uxLog('action', this, c.yellow(t('backpromoteMergeWaiting', { count: files.length, command: runCommand() })));
      return { outputString: 'Solve the conflicts, then run the command again', status: 'conflicts', files, promptFile, nextCommand: runCommand() };
    };

    // Wait, in a terminal, until the user solved the markers or gave the merge up
    const waitForSolvedConflicts = async (conflicted: string[]): Promise<'solved' | 'aborted'> => {
      for (;;) {
        const answer = await promptWaitForSolvedConflicts(conflicted);
        if (answer === 'abort') {
          abortMerge();
          clearBackpromoteBase();
          uxLog('action', this, c.cyan(t('backpromoteMergeAborted')));
          return 'aborted';
        }
        const remaining = await listFilesWithConflictMarkers(conflicted);
        if (remaining.length === 0) {
          return 'solved';
        }
        uxLog('warning', this, c.yellow(t('backpromoteMergeStillHasMarkers', { files: remaining.map((file) => `${file.path} (${file.conflictBlocks})`).join(', ') })));
      }
    };

    let base: string;
    if (resumedBase) {
      // Step 3 (resumed): finish the merge a previous run left waiting
      base = resumedBase;
      const conflicted = listConflictedFiles();
      uxLog('action', this, c.cyan(t('backpromoteMergeResuming', { count: conflicted.length })));
      const remaining = await listFilesWithConflictMarkers(conflicted);
      if (remaining.length > 0) {
        if (planMode) {
          return buildBackpromotePlan({
            ...planBase,
            status: 'mergeInProgress',
            groups,
            conflicts: remaining.map((file) => ({ path: file.path, changedInBranch: true, changedInOrg: false, conflictBlocks: file.conflictBlocks })),
          }) as unknown as AnyJson;
        }
        if (auto) {
          return stopOnConflicts(remaining);
        }
        if ((await waitForSolvedConflicts(conflicted)) === 'aborted') {
          return { outputString: 'Backpromote merge aborted' };
        }
      }
      if (planMode) {
        return buildBackpromotePlan({ ...planBase, status: 'mergeInProgress', groups, conflicts: [] }) as unknown as AnyJson;
      }
      commitMerge(conflicted);
      uxLog('action', this, c.green(t('backpromoteMergeCommitted', { parentBranch })));
    } else {
      // Step 3: the plan reads what the merge would bring, the run pulls the org, then merges
      reportCommandProgress({ step: 'delta', message: t('backpromoteProgressDelta') });
      const incoming = await computeBackpromoteDelta(mergeBase, parentRef);
      const orgChanges = tracksSource && !noPull ? await listOrgPendingChangesWithProgress(targetUsername, this) : [];
      if (planMode) {
        const itemPaths = await findItemPaths([...incoming.items, ...incoming.deletions]);
        const conflicts = predictConflictingFiles({
          parentChangedFiles: changedFilesBetween(mergeBase, parentRef),
          branchChangedFiles: changedFilesBetween(mergeBase, 'HEAD'),
          orgChangedFiles: orgChanges,
        });
        return buildBackpromotePlan({
          ...planBase,
          status: 'ready',
          groups,
          items: incoming.items,
          itemPaths,
          deletions: incoming.deletions,
          conflicts,
          orgChanges: { tracked: tracksSource, files: orgChanges },
        }) as unknown as AnyJson;
      }

      if (tracksSource && !noPull) {
        uxLog('action', this, c.cyan(t('backpromotePullingOrgChanges', { orgName: targetOrg.orgName })));
        await forceSourcePull(targetUsername, debugMode);
        const saved = await commitAllChanges(`chore(sfdx-hardis): save the changes of ${targetOrg.orgName} before the backpromote of ${parentBranch}`);
        if (saved.length > 0) {
          uxLog('action', this, c.cyan(t('backpromoteOrgChangesSaved', { count: saved.length, branch: currentBranch })));
        }
      } else if (!tracksSource) {
        uxLog('warning', this, c.yellow(t('backpromoteOrgNotTracked', { orgName: targetOrg.orgName })));
      }

      base = headCommit();
      saveBackpromoteBase(base);
      uxLog('action', this, c.cyan(t('backpromoteMerging', { parentBranch, branch: currentBranch })));
      const merge = mergeParentBranch(parentRef, parentBranch);
      if (!merge.merged) {
        const manual: string[] = [];
        for (const file of merge.conflicted) {
          const choice: BackpromoteConflictChoice = conflictDecisions.get(file) || (auto ? 'merge' : await promptConflictDecision(file));
          applyConflictDecision(file, choice);
          uxLog('action', this, c.cyan(t(`backpromoteConflictDecision_${choice}`, { file })));
          if (choice === 'merge') {
            manual.push(file);
          }
        }
        if (manual.length > 0) {
          const withMarkers = await listFilesWithConflictMarkers(manual);
          if (withMarkers.length > 0) {
            if (auto) {
              return stopOnConflicts(withMarkers);
            }
            const promptFile = await writeBackpromoteMergePrompt(
              buildBackpromoteMergePrompt({ parentBranch, currentBranch, orgLabel: targetOrg.orgName, files: withMarkers, pullRequests: pullRequestsForPrompt, nextCommand: runCommand() })
            );
            await announceBackpromoteConflicts(withMarkers, promptFile, this);
            if ((await waitForSolvedConflicts(manual)) === 'aborted') {
              return { outputString: 'Backpromote merge aborted' };
            }
          }
        }
        commitMerge(merge.conflicted);
      }
      uxLog('action', this, c.green(t('backpromoteMergeCommitted', { parentBranch })));
    }

    // Step 4: deploy what the merge brought in
    const delta = await computeBackpromoteDelta(base, 'HEAD');
    let deployKeys = delta.items.filter((key) => !excludedKeys.includes(key));
    const deleteKeys = delta.deletions.filter((key) => !excludedKeys.includes(key));
    const leftOut = [...delta.items, ...delta.deletions].filter((key) => excludedKeys.includes(key));
    if (leftOut.length > 0) {
      uxLog('action', this, c.cyan(t('backpromoteExcludedItems', { count: leftOut.length, items: leftOut.join(', ') })));
    }
    if (!nonInteractive) {
      deployKeys = await promptItemsToDeploy(deployKeys, conn.instanceUrl || '');
    }
    uxLog('action', this, c.cyan(t('backpromoteDeltaSummary', { addedModified: deployKeys.length, deleted: deleteKeys.length })));
    const packageDir = await createTempDir();
    const packageXml = path.join(packageDir, 'package', 'package.xml');
    await fs.ensureDir(path.dirname(packageXml));
    await writePackageXmlFile(packageXml, metadataKeysToPackageContent(deployKeys));
    let destructiveXml: string | null = null;
    if (deleteKeys.length > 0 && flags['skip-destructive'] !== true) {
      destructiveXml = path.join(packageDir, 'destructiveChanges', 'destructiveChanges.xml');
      await fs.ensureDir(path.dirname(destructiveXml));
      await writePackageXmlFile(destructiveXml, metadataKeysToPackageContent(deleteKeys));
      if (!(await confirmDestructiveChanges(destructiveXml, this, nonInteractive))) {
        uxLog('action', this, c.cyan(t('backpromoteDestructiveChangesSkipped')));
        destructiveXml = null;
      }
    } else if (deleteKeys.length > 0) {
      uxLog('action', this, c.cyan(t('backpromoteDestructiveChangesSkipped')));
    }

    const actionOptions = { actionIds, skipActions: flags['skip-actions'] === true, nonInteractive };
    if (actionOptions.skipActions) {
      uxLog('log', this, c.grey(t('backpromoteActionsSkippedByFlag')));
    }
    await executeBackpromoteActions(groups, currentBranch, 'commandsPreDeploy', targetUsername, conn, this, agentMode, actionOptions);
    await deployBackpromoteMetadata(packageXml, destructiveXml, targetUsername, collectTestClassesFromPrs(groups), this, debugMode, nonInteractive);
    await executeBackpromoteActions(groups, currentBranch, 'commandsPostDeploy', targetUsername, conn, this, agentMode, actionOptions);
    clearBackpromoteBase();

    uxLog('action', this, c.green(t('backpromoteCompleted')));
    return {
      outputString: 'Backpromote completed successfully',
      pullRequests: pullRequestsForPrompt.map((pr) => pr.id).filter((id) => id > 0),
      deployed: deployKeys.length,
      deleted: destructiveXml ? deleteKeys.length : 0,
    };
  }
}

async function listOrgPendingChangesWithProgress(targetUsername: string, commandThis: any): Promise<string[]> {
  reportCommandProgress({ step: 'orgChanges', message: t('backpromoteProgressOrgChanges') });
  return listOrgPendingChanges(targetUsername, commandThis);
}
