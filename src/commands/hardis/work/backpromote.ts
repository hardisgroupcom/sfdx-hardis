/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import * as path from 'path';
import {
  checkGitClean,
  createTempDir,
  getCurrentGitBranch,
  uxLog,
} from '../../../common/utils/index.js';
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
  selectBackpromoteScope,
} from '../../../common/utils/backpromoteUtils.js';
import { callSfdxGitDelta } from '../../../common/utils/gitUtils.js';
import { listMajorOrgs } from '../../../common/utils/orgConfigUtils.js';
import { countPackageXmlItems, isPackageXmlEmpty } from '../../../common/utils/xmlUtils.js';
import { t } from '../../../common/utils/i18n.js';
import fs from 'fs-extra';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class BackpromoteTask extends SfCommand<any> {
  public static title = 'Backpromote to dev sandbox (Beta)';

  public static description = `
## Command Behavior (Beta)

> **This command is currently in Beta.** Please report any issues or feedback on the [sfdx-hardis GitHub repository](https://github.com/hardisgroupcom/sfdx-hardis/issues).

**Brings the latest changes merged into a parent branch (e.g. integration) into the developer's feature branch and deploys them to their dev sandbox.**

This command automates the "backpromote" workflow, similar to what Copado provides. It allows developers to stay synchronized with changes made by other team members that have been merged into a shared branch.

Key functionalities:

- **Pre-flight checks:** Verifies the git working directory is clean (no unstaged or staged files) and that the feature branch is already up to date with the parent branch.
- **Scope selection:** Lists merged pull requests on the parent branch (grouped with their commits) and lets the user choose up to which PR to backpromote. Tracks the last backpromoted commit for incremental runs.
- **Delta computation:** Uses sfdx-git-delta to compute the metadata differences between the last backpromoted state and the selected target.
- **Org conflict detection:** Retrieves the same metadata from the org, compares with local files, and generates Excel and PDF conflict reports showing git-diff-style colored output.
- **Interactive validation:** Lets the user review and deselect metadata items before deployment. Destructive changes require explicit confirmation.
- **Deployment:** Deploys validated metadata to the dev sandbox with NoTestRun (or RunSpecifiedTests if PR test classes are configured).
- **Deployment actions:** Executes deployment actions from the selected PRs. For actions requiring a different user, attempts LoginAs authentication and falls back to a manual checklist with one-by-one validation.
- **State tracking:** Stores the last backpromoted commit and executed deployment actions in user config for future runs.

### Agent Mode

Use \`--agent\` to disable all interactive prompts. The command will:

- Use the configured \`developmentBranch\` as the parent branch
- If a previous backpromote state exists, auto-select only the next PR
- If no previous state, require \`--from\` flag (PR number or commit SHA) and select only the next PR from that point
- Deploy all metadata without interactive validation
- Auto-confirm destructive changes with a warning
- Log manual actions instead of prompting

Required flags: \`--agent\`, and \`--from\` if no previous backpromote state exists.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Git Integration:** Uses \`simple-git\` to verify branch status and list commits. Requires the branch to be clean and up to date with the parent branch before proceeding.
- **sfdx-git-delta:** Computes metadata deltas between git commits to identify changed metadata items.
- **Org Metadata Retrieval:** Uses \`sf project retrieve start\` with the delta package.xml to retrieve current org state for conflict detection.
- **Diff Library:** Uses the \`diff\` npm package to compute file-level differences between org and local metadata.
- **ExcelJS:** Generates Excel conflict reports via \`generateCsvFile\`.
- **md-to-pdf:** Converts markdown conflict reports to PDF using \`generatePdfFileFromMarkdown\`.
- **Deployment Actions:** Uses \`ActionsProvider\` to execute deployment actions, with \`authOrg\` for LoginAs authentication.
- **Configuration:** Stores backpromote state and deployment action history in user config via \`setConfig('user', ...)\`.
</details>
`;

  public static examples = [
    '$ sf hardis:work:backpromote',
    '$ sf hardis:work:backpromote --parentbranch integration',
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
      description: 'PR number or commit SHA to start the backpromote from. Required in --agent mode when no previous backpromote state exists.',
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
    const targetUsername = flags['target-org'].getUsername();
    const conn = flags['target-org'].getConnection();

    // Step 1: Verify git is clean
    uxLog('log', this, c.cyan(t('backpromoteStarting', { parentBranch: '' })));
    await checkGitClean({ allowStash: false });

    const currentBranch = (await getCurrentGitBranch()) || '';
    if (!currentBranch) {
      throw new Error('Unable to determine current git branch');
    }

    // Check that the current branch is not a major org branch
    const majorOrgs = await listMajorOrgs();
    const matchingMajorOrg = majorOrgs.find((org: any) => org.branchName === currentBranch);
    if (matchingMajorOrg) {
      throw new SfError(t('backpromoteNotAllowedOnMajorOrg', { currentBranch }));
    }

    // Step 2: Resolve parent branch
    const parentBranch = await resolveParentBranch(this, flags.parentbranch || null, agentMode, currentBranch);
    uxLog('log', this, c.cyan(t('backpromoteStarting', { parentBranch: c.green(parentBranch) })));

    if (currentBranch === parentBranch) {
      throw new Error(t('backpromoteCannotBackpromoteFromSameBranch'));
    }

    // Step 3: Ensure branch is up to date with parent
    await ensureBranchUpToDate(parentBranch, currentBranch, this);

    // Step 4: Load previous backpromote state and resolve --from flag
    const lastState = await loadBackpromoteState(currentBranch);
    const fromFlag = flags.from || null;

    // In agent mode, require either a previous backpromote state or --from flag
    if (agentMode && !lastState && !fromFlag) {
      throw new SfError(t('backpromoteAgentRequiresFromFlag'));
    }

    // Step 5: List all PRs/commits on the parent branch and let the user select which ones to backpromote
    // In interactive mode this is a single prompt (no separate "starting point" + "scope" steps)
    const sinceCommit = fromFlag || null;
    const allPrGroups = await listMergedPrsWithCommits(parentBranch, currentBranch, sinceCommit, this);

    if (allPrGroups.length === 0) {
      uxLog('action', this, c.cyan(t('backpromoteNoPrsMerged', { parentBranch })));
      return { outputString: 'No changes to backpromote' };
    }

    // Select which PRs to include: single unified prompt in interactive mode, auto-select in agent mode
    const { targetCommit, selectedPrs, fromCommit } = await selectBackpromoteScope(
      allPrGroups, lastState, this, agentMode, fromFlag,
    );

    uxLog('action', this, c.cyan(t('backpromoteComputingDelta', {
      fromCommit: fromCommit.substring(0, 7),
      toCommit: targetCommit.substring(0, 7),
    })));

    const tmpDir = await createTempDir();
    const deltaResult = await callSfdxGitDelta(fromCommit, targetCommit, tmpDir);
    if (deltaResult.status !== 0) {
      uxLog('error', this, c.red(`[Backpromote] sfdx-git-delta failed: ${JSON.stringify(deltaResult)}`));
      throw new Error('Failed to compute metadata delta');
    }

    const deltaPackageXml = path.join(tmpDir, 'package', 'package.xml');
    const destructiveChangesXml = path.join(tmpDir, 'destructiveChanges', 'destructiveChanges.xml');

    // Check if delta is empty
    if (!fs.existsSync(deltaPackageXml) || await isPackageXmlEmpty(deltaPackageXml)) {
      const hasDestructive = fs.existsSync(destructiveChangesXml) && !(await isPackageXmlEmpty(destructiveChangesXml));
      if (!hasDestructive) {
        uxLog('action', this, c.cyan(t('backpromoteNoDelta')));
        await saveBackpromoteState(currentBranch, targetCommit, parentBranch, this);
        return { outputString: 'No metadata changes to deploy' };
      }
    }

    // Display delta summary
    const addedModified = fs.existsSync(deltaPackageXml) ? await countPackageXmlItems(deltaPackageXml) : 0;
    const deleted = fs.existsSync(destructiveChangesXml) ? await countPackageXmlItems(destructiveChangesXml) : 0;
    uxLog('log', this, c.cyan(t('backpromoteDeltaSummary', { addedModified, deleted })));

    // Step 8: Detect org conflicts
    const conflictResult = await detectOrgConflicts(deltaPackageXml, targetUsername, this, debugMode);
    let conflicts = conflictResult.conflicts;

    // If conflict detection failed, warn and prompt user
    if (!conflictResult.success) {
      if (agentMode) {
        uxLog('warning', this, c.yellow(t('backpromoteConflictDetectionFailedAgentContinue')));
      } else {
        const continueRes = await promptConfirmContinueAfterConflictFailure(conflictResult.errorMessage || '', this);
        if (!continueRes) {
          return { outputString: 'Backpromote cancelled due to conflict detection failure' };
        }
      }
      conflicts = [];
    }

    // Step 9: Generate conflict report if there are conflicts
    if (conflicts.length > 0) {
      await generateConflictReport(conflicts, this);
      // Offer to open a VS Code visual diff for each conflict (no-op outside VS Code / in agent/CI mode)
      await promptOpenVisualDiffsInVsCode(
        conflicts,
        conflictResult.emptyPlaceholderPath,
        this,
        agentMode,
      );
    }

    // Step 10: Prompt user to validate metadata to deploy
    const { validatedPackageXml, validatedDestructiveXml } = await promptMetadataValidation(
      deltaPackageXml,
      fs.existsSync(destructiveChangesXml) ? destructiveChangesXml : null,
      conflicts,
      this,
      agentMode,
      conn.instanceUrl || '',
    );

    // Step 11: Handle destructive changes
    if (validatedDestructiveXml && fs.existsSync(validatedDestructiveXml) && !(await isPackageXmlEmpty(validatedDestructiveXml))) {
      const confirmed = await confirmDestructiveChanges(validatedDestructiveXml, this, agentMode);
      if (!confirmed) {
        uxLog('action', this, c.cyan(t('backpromoteDestructiveChangesSkipped')));
      }
    }

    // Step 12: Execute pre-deploy actions
    await executeBackpromoteActions(selectedPrs, currentBranch, 'commandsPreDeploy', targetUsername, conn, this, agentMode);

    // Step 13: Deploy metadata
    const testClasses = collectTestClassesFromPrs(selectedPrs);
    await deployBackpromoteMetadata(
      validatedPackageXml,
      validatedDestructiveXml,
      targetUsername,
      testClasses,
      this,
      debugMode,
      agentMode,
    );

    // Step 14: Execute post-deploy actions
    await executeBackpromoteActions(selectedPrs, currentBranch, 'commandsPostDeploy', targetUsername, conn, this, agentMode);

    // Step 15: Save backpromote state
    await saveBackpromoteState(currentBranch, targetCommit, parentBranch, this);

    uxLog('action', this, c.green(t('backpromoteCompleted')));
    return { outputString: 'Backpromote completed successfully' };
  }
}
