/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages, SfError, StateAggregator } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import * as os from 'os';
import * as path from 'path';
import { createTempDir, getGitRepoRoot, isCI, uxLog } from '../../../common/utils/index.js';
import { parsePackageXmlFile } from '../../../common/utils/xmlUtils.js';
import {
  BackpromoteActionCandidate,
  BackpromotePrGroup,
  collectBackpromoteActions,
  executeBackpromoteActions,
  listMergedPrsWithCommits,
} from '../../../common/utils/backpromoteUtils.js';
import {
  BACKPROMOTE_DEFAULT_SCAN_LIMIT,
  BACKPROMOTE_PLAN_VERSION,
  BackpromoteMode,
  BackpromotePlan,
  BackpromotePlanAction,
  BackpromotePlanCheck,
  BackpromotePlanComparison,
  BackpromotePlanItem,
  BackpromotePlanPullRequest,
  BackpromoteRunResult,
  BackpromoteRunState,
  BackpromoteStatus,
  announceBackpromoteMerges,
  buildSandboxRow,
  newBackpromoteRunId,
  promptActionsToRun,
  promptConfirmReset,
  promptDiffDecision,
  promptDirtyTree,
  promptItemsToDeploy,
  promptManualActionDone,
  promptParentBranch,
  promptStartPullRequest,
  promptWaitForSolvedMerges,
  readBackpromoteRunState,
  writeBackpromoteMergePrompt,
  writeBackpromoteRunState,
} from '../../../common/utils/backpromotePlanUtils.js';
import {
  BackpromoteTargetOrgInfo,
  compareItemsWithOrg,
  deployBackpromoteDeletions,
  deployBackpromotePackage,
  getBackpromoteTargetOrgInfo,
  listOrgPendingChanges,
  retrieveItemsForComparison,
} from '../../../common/utils/backpromoteOrgUtils.js';
import {
  changedFilesBetween,
  checkoutBackpromoteBranch,
  collectItemFiles,
  commitAllChanges,
  commitFiles,
  computeBackpromoteDelta,
  currentBranchName,
  deleteBackpromoteBranch,
  fetchOrigin,
  fileAtRef,
  gitUserName,
  headCommit,
  inspectBackpromoteBranch,
  listFilesWithConflictMarkers,
  listUncommittedFiles,
  isAncestor,
  pushBackpromoteBranch,
  rebuildBackpromoteBranchOnParent,
  resolveBackpromoteParentRef,
  revParse,
  stashWorkingTree,
  writeMergedFile,
} from '../../../common/utils/backpromoteGitUtils.js';
import {
  BackpromoteDiffChoice,
  BackpromoteMergePromptFile,
  buildBackpromoteBranchName,
  buildBackpromoteMergePrompt,
  buildBackpromoteRunCommand,
  classifyBackpromoteCurrentBranch,
  countConflictMarkerBlocks,
  filterNoOverwriteKeys,
  findBackpromoteParentBranchRefusal,
  listAllowedBackpromoteParentBranches,
  normalizeRepoPath,
  parseDiffDecisions,
  parseMetadataKey,
  sameFileContent,
  splitListFlag,
  splitMetadataKeysFlag,
  walkBackpromoteHistory,
} from '../../../common/utils/backpromoteRules.js';
import {
  BackpromoteActionRow,
  BackpromoteCommentStore,
  BackpromoteLeftOutItem,
  BackpromoteSandboxRow,
  findActionRow,
  hasGitProviderForBackpromote,
  upsertActionRow,
  upsertSandboxRow,
} from '../../../common/utils/backpromoteCommentUtils.js';
import { getConfig } from '../../../config/index.js';
import { listMajorOrgs } from '../../../common/utils/orgConfigUtils.js';
import { t } from '../../../common/utils/i18n.js';
import { reportCommandProgress } from '../../../common/utils/progressFileUtils.js';
import { gitProviderBatchSizes, mapInAdaptiveBatches } from '../../../common/utils/adaptiveBatch.js';
import { GitProvider } from '../../../common/gitProvider/index.js';
import fs from '../../../common/utils/fsUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

/** Everything the modes share once the checks passed */
interface BackpromoteContext {
  mode: BackpromoteMode;
  agentMode: boolean;
  interactive: boolean;
  debugMode: boolean;
  runId: string;
  state: BackpromoteRunState;
  store: BackpromoteCommentStore;
  targetOrg: BackpromoteTargetOrgInfo;
  conn: any;
  parentBranch: string;
  parentRef: string;
  parentHead: string;
  allowedParentBranches: string[];
  backpromoteBranch: string;
  gitRoot: string;
  user: string;
  scanLimit: number;
  groups: BackpromotePrGroup[];
  pullRequests: BackpromotePlanPullRequest[];
  scan: BackpromotePlan['scan'];
  historyFound: boolean;
  /** The newest Pull Request already backpromoted, whose partial row may carry left-out items */
  foundGroup: BackpromotePrGroup | null;
  foundRow: BackpromoteSandboxRow | null;
  windowGroups: BackpromotePrGroup[];
  window: BackpromotePlan['window'];
  items: BackpromotePlanItem[];
  deletions: BackpromotePlan['deletions'];
  actions: BackpromotePlanAction[];
  actionCandidates: { pre: BackpromoteActionCandidate[]; post: BackpromoteActionCandidate[] };
  actionRows: Map<string, BackpromoteActionRow>;
  comparison: BackpromotePlanComparison[];
  checks: BackpromotePlanCheck[];
  excludedKeys: Set<string>;
  diffDecisions: Map<string, BackpromoteDiffChoice>;
  diffDefault: BackpromoteDiffChoice;
  skipDestructive: boolean;
  actionIds: string[] | null;
  skipActions: boolean;
  confirmActionIds: string[];
  promptFile: string | null;
  /** Uncommitted files of the developer's checkout, read once before anything switches branches */
  dirtyFiles: string[];
}

export default class BackpromoteTask extends SfCommand<any> {
  public static title = 'Backpromote to a dev sandbox (Beta)';

  public static description = `
## Command Behavior (Beta)

> **This command is currently in Beta.** Please report any issues or feedback on the [sfdx-hardis GitHub repository](https://github.com/hardisgroupcom/sfdx-hardis/issues).

**Brings into a developer sandbox (or a scratch org) what the team merged in a parent major branch (integration, uat...) since the last backpromote: the metadata, and the deployment actions declared by the merged Pull Requests.**

Several people backpromote to the same sandbox over time, from different computers: nothing that matters is stored on a computer. The history of a sandbox is read from the **"Backpromotes" comment** sfdx-hardis writes on every Pull Request it backpromotes, and from nothing else. In VS Code, the **Backpromote (Beta)** panel of the sfdx-hardis extension runs this same command with the choices made in the panel.

What the command does, in order:

1. **Checks:** a git provider token must be configured (the history lives in the Pull Request comments), the target org must be a developer sandbox or a scratch org (a production org, or the org of a major branch declared in \`config/branches\`, is refused: the CI/CD pipeline deploys those), and the parent branch must be \`developmentBranch\` or one of \`availableTargetBranches\`.
2. **Start Pull Request:** the merged Pull Requests of the parent branch are listed, newest first, and the "Backpromotes" comment of each one is read until one holds a row for this sandbox: the default start is the Pull Request merged right after it. Everything merged after the start, up to the head of the parent branch, is the **window**.
3. **Delta and actions:** sfdx-git-delta computes what the window deploys and deletes, and \`scripts/actions/.sfdx-hardis.<PR>.yml\` gives the deployment actions of its Pull Requests. An action with a success row for this sandbox in the "Backpromotes" comment never runs twice (\`runOnlyOnceByOrg\`).
4. **Comparison with the sandbox:** the ticked items are retrieved from the sandbox into a cache and compared with the parent branch version. For every file that differs, one decision: **Overwrite** (\`git\`, the parent branch version is deployed), **Keep org version** (\`org\`, the item is not deployed and listed as kept) or **Merge** (\`merge\`, the file is written with conflict markers in the backpromote branch and solved with the VS Code merge editor, by hand or with the coding agent prompt saved in \`hardis-report/\`).
5. **Deployment from the backpromote branch:** the checkout is switched to \`backpromote/<parent branch>/<sandbox name>\` (a child of the parent branch that only holds the manual merges; the working tree is committed or stashed first when it is not clean), the merged files are committed, then the pre-deployment actions run, the metadata is deployed (\`NoTestRun\`), the deletions are applied, the post-deployment actions run.
6. **History:** every Pull Request of the window gets a row for the sandbox in its "Backpromotes" comment (complete, or partial with the items left out), and the backpromote branch is pushed when it holds manual merges. The checkout **stays on the backpromote branch**: the last line of the output says how to get back to your own branch.

### Decisions from the flags

\`--auto\` takes every decision from the flags and asks nothing: \`--from-pull-request\` for the start, \`--exclude-metadata\` for the items and deletions not to deploy, \`--skip-destructive\`, \`--actions\` / \`--skip-actions\`, \`--on-diff <file>=git|org|merge\` per file and \`--on-diff-default\` for the others (default \`git\`). It refuses to start while a prepared file still holds conflict markers. This is how the VS Code panel runs the command.

### Plan (read-only)

\`--plan --json\` returns the checks, the Pull Requests with their backpromote rows, the window, the items, the deletions, the deployment actions with what already ran in this sandbox, and the comparison of every file with the sandbox (with the absolute paths of the sandbox, parent branch and base versions kept in the cache). It reads git, the Pull Request comments and the sandbox: it deploys, merges, commits and writes nothing. \`--prepare\` goes one step further: it switches the checkout to the backpromote branch and writes the files marked \`merge\` with their markers, so that they can be solved before the run.

### Agent Mode

Use \`--agent\` to disable all interactive prompts. The command will:

- Take the parent branch from \`--parent-branch\`, else \`developmentBranch\`
- Take the start from \`--from-pull-request\`, else the first Pull Request not backpromoted yet (and refuse when the history holds no row within the scan limit)
- Behave as with \`--auto\`, leaving manual actions pending (confirm them later with \`--confirm-action <id>\`)
- Stop with status \`waitingForMerges\` (exit code 0) when a file marked \`merge\` is written with markers: edit the files listed in the JSON, then run the same command again with the returned \`runId\`. A file left with markers is not deployed and is listed as "conflict pending" in the comment row.

Typical sequence: \`--plan --json\` to read the plan, decide, \`--agent --run-id <runId> --from-pull-request <n> --on-diff ... --json\`, edit the merged files, run the same command again.

<details markdown="1">
<summary>Technical explanations</summary>

- **Target org check:** queries \`Organization.Id\`, \`IsSandbox\` and \`TrialExpirationDate\`, and compares the username (and the sandbox it belongs to) and the instance URL with the major orgs of \`config/branches\`. The sandbox name comes from the instance URL (\`mycompany--dev1.sandbox...\` gives \`dev1\`), else from the username, else from the org id; \`--sandbox-name\` overrides it.
- **History:** the "Backpromotes" comment is found by the hidden marker \`<!-- sfdx-hardis backpromotes -->\` and holds a hidden JSON block plus two readable tables: the sandbox rows (name, org id, date, user, parent branch, complete or partial with the items left out) and the deployment actions run by backpromotes. A refreshed sandbox has a new org id: its old rows are history, not state. \`backpromoteScanLimit\` (default 100) bounds the number of Pull Requests read.
- **Backpromote branch:** fetched at every run, rebuilt on the parent head (the manual merge commits are cherry-picked over it), pushed with \`--force-with-lease\` when it holds merges. \`--reset\` deletes it.
- **Merges:** three-way with \`git merge-file\` (base = the version at the start of the window) when the sandbox already received a backpromote, two-way with markers around every differing block otherwise. The three versions are kept in the cache for the VS Code merge editor.
- **Cache:** under the temporary folder, \`sfdx-hardis/backpromote/\`: the sfdx-git-delta output per commit pair, the comment reads and the run state per run id, the sandbox retrieve per org id and run id. Deleting it loses nothing.
- **Progress of a background call:** when \`SFDX_HARDIS_PROGRESS_FILE\` is set (the VS Code panel sets it), each step is appended to that file as one JSON line.
</details>
`;

  public static examples = [
    '$ sf hardis:work:backpromote',
    '$ sf hardis:work:backpromote --parent-branch integration --target-org dev1',
    '$ sf hardis:work:backpromote --plan --json --target-org dev1 --parent-branch integration',
    '$ sf hardis:work:backpromote --auto --run-id 7f3a --from-pull-request 412 --on-diff "force-app/main/default/classes/InvoiceCalculator.cls=merge" --target-org dev1',
    '$ sf hardis:work:backpromote --agent --target-org dev1 --parent-branch integration --json',
    '$ sf hardis:work:backpromote --reset --target-org dev1 --parent-branch integration',
  ];

  public static flags: any = {
    agent: Flags.boolean({
      default: false,
      description: 'Run in non-interactive mode for agents and automation',
    }),
    auto: Flags.boolean({
      default: false,
      description: 'Take every decision from the flags and ask nothing (the VS Code panel passes it).',
    }),
    plan: Flags.boolean({
      default: false,
      description: 'Read-only: return what a backpromote would do (use with --json). Deploys, merges, commits and writes nothing.',
    }),
    prepare: Flags.boolean({
      default: false,
      description: 'Switch the checkout to the backpromote branch and write the files marked merge with their conflict markers, without deploying.',
    }),
    reset: Flags.boolean({
      default: false,
      description: 'Delete the backpromote branch of the sandbox on origin and locally (abandons the pending manual merges).',
    }),
    'parent-branch': Flags.string({
      description: 'Parent branch to backpromote from: developmentBranch or one of availableTargetBranches. Default: developmentBranch.',
    }),
    'from-pull-request': Flags.integer({
      description: 'Number of the start Pull Request: it and everything merged after it are backpromoted. Default: the first one not backpromoted yet.',
    }),
    'run-id': Flags.string({
      description: 'Id of a previous --plan or --prepare call, to reuse its cache and its prepared files.',
    }),
    'sandbox-name': Flags.string({
      description: 'Short name of the sandbox (branch name and comment rows), when the one read from the instance URL is not right.',
    }),
    'exclude-metadata': Flags.string({
      multiple: true,
      description: 'Type:Name of an item not to deploy nor delete now, for example "Layout:Account-Account Layout". Repeatable.',
    }),
    'on-diff': Flags.string({
      multiple: true,
      description: 'Decision for a file whose sandbox version differs: "<file path>=git" (overwrite with the parent branch version), "=org" (keep the org version) or "=merge" (merge by hand). Repeatable.',
    }),
    'on-diff-default': Flags.string({
      options: ['git', 'org', 'merge'],
      default: 'git',
      description: 'Decision for the files that differ and have no --on-diff decision.',
    }),
    'skip-destructive': Flags.boolean({
      default: false,
      description: 'Do not delete anything from the org.',
    }),
    actions: Flags.string({
      description: 'Comma-separated ids of the deployment actions to run. Default: every action of the window not run in this sandbox yet.',
    }),
    'skip-actions': Flags.boolean({
      default: false,
      description: 'Run no deployment action.',
    }),
    'confirm-action': Flags.string({
      multiple: true,
      description: 'Id of a manual deployment action done in the sandbox by hand: its row is written as done. Repeatable.',
    }),
    'dirty-tree': Flags.string({
      options: ['stash', 'commit'],
      description: 'What to do with uncommitted changes before the checkout switches to the backpromote branch. Default: stash with --auto and --agent, asked otherwise.',
    }),
    'commit-message': Flags.string({
      description: 'Commit message when --dirty-tree commit is used.',
    }),
    'scan-limit': Flags.integer({
      description: 'Number of merged Pull Requests read to find the last backpromote of the sandbox. Default: backpromoteScanLimit (100).',
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

  private flags: any;

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(BackpromoteTask);
    this.flags = flags;
    const agentMode = flags.agent === true;
    const mode: BackpromoteMode = flags.reset ? 'reset' : flags.plan ? 'plan' : flags.prepare ? 'prepare' : (flags['confirm-action'] || []).length > 0 && !flags.auto && !agentMode ? 'confirm' : flags.auto || agentMode ? 'run' : 'interactive';
    const interactive = mode === 'interactive' && !isCI;
    const debugMode = flags.debug || false;
    const targetUsername = flags['target-org'].getUsername();
    const conn = flags['target-org'].getConnection();

    const excludedKeys = new Set(splitMetadataKeysFlag(flags['exclude-metadata']));
    for (const key of excludedKeys) {
      if (!parseMetadataKey(key)) {
        throw new SfError(t('backpromoteInvalidMetadataKey', { key }));
      }
    }
    const { decisions: diffDecisions, invalid: invalidDecisions } = parseDiffDecisions(flags['on-diff']);
    if (invalidDecisions.length > 0) {
      throw new SfError(t('backpromoteInvalidDiffDecision', { values: invalidDecisions.join(', ') }));
    }
    const actionIds = flags.actions !== undefined ? splitListFlag(flags.actions) : null;
    const checks: BackpromotePlanCheck[] = [];

    // Step 1: the git provider token, the target org, the parent branch
    reportCommandProgress({ step: 'gitProvider', message: t('backpromoteProgressGitProvider') });
    const hasProvider = await hasGitProviderForBackpromote();
    checks.push({ id: 'gitProvider', ok: hasProvider, message: hasProvider ? t('backpromoteCheckGitProviderOk') : t('backpromoteGitProviderRequired') });

    reportCommandProgress({ step: 'targetOrg', message: t('backpromoteProgressTargetOrg') });
    const tracksSource = await flags['target-org'].tracksSource().catch(() => false);
    const aliases = (await StateAggregator.getInstance()).aliases;
    const alias = aliases.get(targetUsername) || null;
    const targetOrg = await getBackpromoteTargetOrgInfo({ conn, username: targetUsername, alias, tracksSource, sandboxNameOverride: flags['sandbox-name'] || null });
    checks.push({ id: 'targetOrg', ok: targetOrg.refusal === null, message: targetOrg.message });

    const projectConfig = await getConfig('project');
    const allowedParentBranches = listAllowedBackpromoteParentBranches(projectConfig);
    let parentBranch: string = flags['parent-branch'] || '';
    if (!parentBranch && interactive && allowedParentBranches.length > 0) {
      parentBranch = await promptParentBranch(allowedParentBranches);
    } else if (!parentBranch) {
      parentBranch = allowedParentBranches[0] || '';
    }
    const parentRefusal = allowedParentBranches.length === 0 ? { allowedBranches: [] } : findBackpromoteParentBranchRefusal(parentBranch, allowedParentBranches);
    checks.push({
      id: 'parentBranch',
      ok: parentRefusal === null,
      message: parentRefusal
        ? allowedParentBranches.length === 0
          ? t('backpromoteNoAllowedParentBranch')
          : t('backpromoteParentBranchNotAllowed', { parentBranch, branches: parentRefusal.allowedBranches.join(', ') })
        : t('backpromoteCheckParentBranchOk', { parentBranch }),
    });
    uxLog('action', this, c.cyan(t('backpromoteStarting', { parentBranch: c.green(parentBranch || '?'), sandboxName: c.green(targetOrg.sandboxName) })));

    const scanLimit = flags['scan-limit'] && flags['scan-limit'] > 0 ? flags['scan-limit'] : Number(projectConfig.backpromoteScanLimit) > 0 ? Number(projectConfig.backpromoteScanLimit) : BACKPROMOTE_DEFAULT_SCAN_LIMIT;
    const backpromoteBranch = parentBranch ? buildBackpromoteBranchName(parentBranch, targetOrg.sandboxName) : '';
    const gitRoot = path.resolve((await getGitRepoRoot()).trim());
    const user = gitUserName() || os.userInfo().username;

    const failedCheck = checks.find((check) => !check.ok);
    if (failedCheck) {
      const blocked = this.emptyPlan({ mode, runId: flags['run-id'] || newBackpromoteRunId(), status: 'blocked', message: failedCheck.message, targetOrg, parentBranch, allowedParentBranches, backpromoteBranch, checks, gitRoot });
      if (mode === 'plan') {
        return blocked as unknown as AnyJson;
      }
      throw this.refusal(failedCheck.message + (failedCheck.details ? '\n' + failedCheck.details.join('\n') : ''), blocked);
    }

    // Step 2: the refs and the run state
    reportCommandProgress({ step: 'fetch', message: t('backpromoteProgressFetch', { parentBranch }) });
    fetchOrigin();
    const parentRef = resolveBackpromoteParentRef(parentBranch);
    const parentHead = revParse(parentRef);
    if (!parentHead) {
      throw new SfError(t('backpromoteParentBranchNotFound', { parentBranch }));
    }
    const previousState = await readBackpromoteRunState(flags['run-id'] || null);
    const reusable = previousState && previousState.orgId === targetOrg.orgId && previousState.parentBranch === parentBranch && previousState.parentHead === parentHead;
    const runId = previousState?.runId || (flags['run-id'] && /^[A-Za-z0-9_-]{4,64}$/.test(flags['run-id']) ? flags['run-id'] : newBackpromoteRunId());
    const state: BackpromoteRunState = reusable
      ? (previousState as BackpromoteRunState)
      : {
        runId,
        createdAt: new Date().toISOString(),
        orgId: targetOrg.orgId,
        sandboxName: targetOrg.sandboxName,
        username: targetUsername,
        parentBranch,
        parentHead,
        backpromoteBranch,
        fromCommit: null,
        startPullRequest: null,
        historyFound: false,
        checkout: previousState?.checkout || null,
        prepared: previousState?.prepared || [],
        retrieveDir: null,
        comparison: [],
      };
    const store = new BackpromoteCommentStore(runId, this);

    if (mode === 'reset') {
      return this.resetBranch({ backpromoteBranch, parentRef, interactive, targetOrg, parentBranch, allowedParentBranches, checks, runId, mode, gitRoot }) as unknown as AnyJson;
    }

    const ctx: BackpromoteContext = {
      mode,
      agentMode,
      interactive,
      debugMode,
      runId,
      state,
      store,
      targetOrg,
      conn,
      parentBranch,
      parentRef,
      parentHead,
      allowedParentBranches,
      backpromoteBranch,
      gitRoot,
      user,
      scanLimit,
      groups: [],
      pullRequests: [],
      scan: { read: 0, limit: scanLimit, found: false, hasMore: false },
      historyFound: false,
      foundGroup: null,
      foundRow: null,
      windowGroups: [],
      window: null,
      items: [],
      deletions: [],
      actions: [],
      actionCandidates: { pre: [], post: [] },
      actionRows: new Map(),
      comparison: [],
      checks,
      excludedKeys,
      diffDecisions,
      diffDefault: (flags['on-diff-default'] || 'git') as BackpromoteDiffChoice,
      skipDestructive: flags['skip-destructive'] === true,
      actionIds,
      skipActions: flags['skip-actions'] === true,
      confirmActionIds: flags['confirm-action'] || [],
      promptFile: null,
      dirtyFiles: currentBranchName() === backpromoteBranch ? [] : await listUncommittedFiles(),
    };

    // Step 3: the Pull Requests, the history and the window
    await this.listPullRequestsAndHistory(ctx);
    if (mode === 'confirm') {
      // A manual action is confirmed whatever the window is: the action is looked up in every
      // Pull Request read, the newest Pull Request declaring it wins
      await this.collectActions(ctx, [...ctx.groups]);
      return (await this.confirmActions(ctx)) as unknown as AnyJson;
    }
    const startNumber = await this.chooseStart(ctx);
    if (startNumber === null) {
      const unknownStart = flags['from-pull-request'] !== undefined && flags['from-pull-request'] !== null;
      const status: BackpromoteStatus = unknownStart ? 'refused' : ctx.scan.found ? 'nothingToDo' : mode === 'plan' ? 'ok' : 'refused';
      const message = unknownStart
        ? t('backpromoteStartPullRequestUnknown', { number: flags['from-pull-request'], parentBranch })
        : ctx.scan.found ? t('backpromoteUpToDate', { parentBranch, sandboxName: targetOrg.sandboxName }) : t('backpromoteNoHistoryFound', { count: ctx.scan.read });
      const plan = this.buildPlan(ctx, status, message);
      if (mode === 'plan' || status === 'nothingToDo') {
        uxLog('action', this, c.green(message));
        return plan as unknown as AnyJson;
      }
      throw this.refusal(message, plan);
    }
    await this.computeWindow(ctx, startNumber);
    await this.compare(ctx);
    if (interactive) {
      await this.askDecisions(ctx);
    }
    this.applyDecisions(ctx);
    await this.persistState(ctx);

    if (mode === 'plan') {
      const nothing = ctx.items.length === 0 && ctx.deletions.length === 0 && ctx.actions.length === 0;
      return this.buildPlan(ctx, nothing ? 'nothingToDo' : 'ok', nothing ? t('backpromoteWindowEmpty') : null) as unknown as AnyJson;
    }

    // Step 4: the checkout and the merges
    await this.switchCheckout(ctx);
    const merges = await this.prepareMerges(ctx);
    if (mode === 'prepare') {
      uxLog('action', this, c.cyan(t('backpromotePrepared', { count: merges.prepared.length, branch: backpromoteBranch })));
      return this.buildPlan(ctx, 'ok', null) as unknown as AnyJson;
    }
    // Agent mode stops once for the files it just wrote; on the next call the files still holding
    // markers are not deployed and recorded as conflict pending (R37), the run goes on
    const agentMustStop = agentMode && merges.newlyWritten.length > 0;
    if (merges.withMarkers.length > 0 && (!agentMode || agentMustStop)) {
      if (agentMode) {
        const plan = this.buildPlan(ctx, 'waitingForMerges', t('backpromoteWaitingForMerges', { count: merges.withMarkers.length }));
        uxLog('action', this, c.yellow(t('backpromoteWaitingForMerges', { count: merges.withMarkers.length })));
        uxLog('action', this, c.yellow(t('backpromoteRunAgain', { command: plan.runCommand || '' })));
        return plan as unknown as AnyJson;
      }
      if (interactive) {
        const answer = await this.waitForMerges(ctx, merges.withMarkers.map((file) => file.path));
        if (answer === 'aborted') {
          return this.buildPlan(ctx, 'refused', t('backpromoteMergeAborted')) as unknown as AnyJson;
        }
      } else {
        const plan = this.buildPlan(ctx, 'conflictsRemaining', t('backpromoteConflictsRemaining', { files: merges.withMarkers.map((file) => file.path).join(', ') }));
        throw this.refusal(plan.message || '', plan);
      }
    }
    return (await this.deployAndRecord(ctx)) as unknown as AnyJson;
  }

  // ---- Pull Requests, history, window ----

  private async listPullRequestsAndHistory(ctx: BackpromoteContext): Promise<void> {
    reportCommandProgress({ step: 'listing', message: t('backpromoteProgressListing', { parentBranch: ctx.parentBranch }) });
    ctx.groups = await listMergedPrsWithCommits(ctx.parentRef, '', null, this, { maxCount: ctx.scanLimit });
    const newestFirst = [...ctx.groups].reverse();
    const rowsByGroup = new Map<string, BackpromoteSandboxRow[]>();
    let read = 0;
    let found = false;
    reportCommandProgress({ step: 'history', message: t('backpromoteProgressHistory'), current: 0, total: newestFirst.length });
    // The comments are read in the adaptive batches of the git provider's ladder (one API call
    // each, shrunk only when the provider throttles), newest first, and the walk stops at the batch
    // holding the first Pull Request with a row for this sandbox and org id
    const isMine = (row: BackpromoteSandboxRow) => row.sandboxName === ctx.targetOrg.sandboxName && row.orgId === ctx.targetOrg.orgId;
    const groupRows = await mapInAdaptiveBatches(
      newestFirst,
      async (group) => {
        const rows: BackpromoteSandboxRow[] = [];
        for (const pr of group.associatedPrs.filter((entry) => entry.id > 0)) {
          rows.push(...(await ctx.store.read(pr.id)).sandboxRows);
        }
        return rows;
      },
      {
        sizes: gitProviderBatchSizes(await GitProvider.getInstance()),
        stopWhen: (rows) => rows.some(isMine),
        onBackoff: (size, error, waitMs) => uxLog('log', this, c.grey(`[Backpromote] ${t('providerThrottledBackoff', { count: size, waitSeconds: Math.round(waitMs / 1000), message: (error as Error)?.message || '' })}`)),
        onProgress: (done) => reportCommandProgress({ step: 'history', message: t('backpromoteProgressHistory'), current: done, total: newestFirst.length }),
      },
    );
    for (let index = 0; index < newestFirst.length; index++) {
      const rows = groupRows[index];
      if (rows === undefined) {
        break;
      }
      rowsByGroup.set(newestFirst[index].commit.hash, rows);
      read++;
      if (rows.some(isMine)) {
        found = true;
        break;
      }
    }
    const walk = walkBackpromoteHistory(
      newestFirst.map((group) => ({ pullRequestNumbers: group.associatedPrs.map((pr) => pr.id), rows: rowsByGroup.get(group.commit.hash) || [] })),
      ctx.targetOrg.sandboxName,
      ctx.targetOrg.orgId,
    );
    ctx.historyFound = found;
    ctx.scan = { read, limit: ctx.scanLimit, found, hasMore: !found && ctx.groups.length >= ctx.scanLimit };
    if (found) {
      ctx.foundGroup = newestFirst[walk.foundIndex];
      ctx.foundRow = walk.verdicts[walk.foundIndex].row;
    }
    ctx.pullRequests = newestFirst.flatMap((group, index) => {
      const verdict = walk.verdicts[index];
      const items = changedFilesBetween(`${group.commit.hash}^1`, group.commit.hash).length;
      const actionCount = group.prConfigs.reduce((total, config) => total + (config.config?.commandsPreDeploy?.length || 0) + (config.config?.commandsPostDeploy?.length || 0), 0);
      // A first-parent commit with no Pull Request (a direct commit on the parent branch) is
      // listed under its commit subject, so that it can be the start and is never skipped
      const entries = group.associatedPrs.length > 0 ? group.associatedPrs : [{ id: 0, title: group.commit.message.split('\n')[0], author: group.commit.author, webUrl: '', sourceBranch: '' }];
      return entries.map((pr) => ({
        number: pr.id,
        title: pr.title,
        author: pr.author,
        mergeDate: group.commit.date,
        sourceBranch: pr.sourceBranch,
        commit: group.commit.hash,
        webUrl: pr.webUrl,
        itemCount: items,
        actionCount,
        backpromote: verdict.row ? { date: verdict.row.date, user: verdict.row.user, status: verdict.row.status, leftOut: verdict.row.leftOut } : null,
        beforeRefresh: verdict.beforeRefresh,
        beforeLastBackpromote: walk.foundIndex !== -1 && index > walk.foundIndex,
        selected: false,
        inWindow: false,
        scanned: rowsByGroup.has(group.commit.hash),
      }));
    });
    // The default start: the group merged right after the found one. When the newest Pull Request
    // is already backpromoted but partially, it is the start again, so that its left-out items are
    // offered (what it already deployed is deployed again, which changes nothing in the sandbox).
    const defaultStartIndex = walk.defaultStartIndex !== null ? walk.defaultStartIndex : walk.foundIndex === 0 && ctx.foundRow?.status === 'partial' ? 0 : null;
    if (defaultStartIndex !== null) {
      const startGroup = newestFirst[defaultStartIndex];
      const startPr = startGroup.associatedPrs.find((pr) => pr.id > 0) || startGroup.associatedPrs[0];
      const entry = ctx.pullRequests.find((pr) => pr.commit === startGroup.commit.hash && (!startPr || pr.number === startPr.id));
      if (entry) {
        entry.selected = true;
      }
    }
  }

  /** The number of the start Pull Request (0 for a merge without number), or null when there is no window */
  private async chooseStart(ctx: BackpromoteContext): Promise<number | null> {
    const fromFlag: number | undefined = this.flags['from-pull-request'];
    if (fromFlag !== undefined && fromFlag !== null) {
      const entry = ctx.pullRequests.find((pr) => pr.number === fromFlag);
      if (!entry) {
        const plan = this.buildPlan(ctx, 'refused', t('backpromoteStartPullRequestUnknown', { number: fromFlag, parentBranch: ctx.parentBranch }));
        if (ctx.mode === 'plan') {
          return null;
        }
        throw this.refusal(plan.message || '', plan);
      }
      for (const pr of ctx.pullRequests) {
        pr.selected = pr.commit === entry.commit;
      }
      return fromFlag;
    }
    const preselected = ctx.pullRequests.find((pr) => pr.selected);
    if (ctx.interactive) {
      const chosenCommit = await promptStartPullRequest(ctx.pullRequests, ctx.targetOrg.sandboxName);
      const entry = chosenCommit ? ctx.pullRequests.find((pr) => pr.commit === chosenCommit) : null;
      if (!entry) {
        return null;
      }
      for (const pr of ctx.pullRequests) {
        pr.selected = pr.commit === entry.commit;
      }
      return entry.number;
    }
    // Everything is backpromoted, or nothing is known within the scan limit: nothing is pre-selected
    return preselected ? preselected.number : null;
  }

  private async computeWindow(ctx: BackpromoteContext, startNumber: number): Promise<void> {
    const startEntry = ctx.pullRequests.find((pr) => pr.number === startNumber && pr.selected) || ctx.pullRequests.find((pr) => pr.number === startNumber);
    if (!startEntry) {
      throw new SfError(t('backpromoteStartPullRequestUnknown', { number: startNumber, parentBranch: ctx.parentBranch }));
    }
    const startIndex = ctx.groups.findIndex((group) => group.commit.hash === startEntry.commit);
    ctx.windowGroups = ctx.groups.slice(startIndex);
    const fromCommit = revParse(`${startEntry.commit}^1`) || EMPTY_TREE;
    ctx.window = { fromCommit, toCommit: ctx.parentHead, startPullRequest: startNumber > 0 ? startNumber : null };
    const windowCommits = new Set(ctx.windowGroups.map((group) => group.commit.hash));
    for (const pr of ctx.pullRequests) {
      pr.inWindow = windowCommits.has(pr.commit);
    }
    ctx.state.fromCommit = fromCommit;
    ctx.state.startPullRequest = ctx.window.startPullRequest;
    ctx.state.historyFound = ctx.historyFound;
    // First output after the start prompt: the VS Code UI only shows "action" lines there
    uxLog('action', this, c.cyan(t('backpromoteWindowChosen', { number: startNumber > 0 ? `#${startNumber}` : startEntry.commit.substring(0, 7), parentBranch: ctx.parentBranch })));

    // The delta of the window, plus the items a previous partial backpromote left out
    reportCommandProgress({ step: 'delta', message: t('backpromoteProgressDelta') });
    const delta = await computeBackpromoteDelta(fromCommit, ctx.parentHead);
    const leftOutBefore = new Map<string, BackpromoteLeftOutItem>();
    for (const item of ctx.foundRow?.leftOut || []) {
      leftOutBefore.set(item.key, item);
    }
    const noOverwrite = await this.readNoOverwrite(ctx.parentRef);
    const allKeys = [...new Set([...delta.items, ...[...leftOutBefore.keys()].filter((key) => !delta.deletions.includes(key))])];
    const noOverwriteKeys = new Set(filterNoOverwriteKeys(allKeys, noOverwrite));

    // Which Pull Request touched which file, first-parent by first-parent
    const prsOfFile = new Map<string, Set<number>>();
    const groupsForFiles = ctx.foundGroup && leftOutBefore.size > 0 ? [ctx.foundGroup, ...ctx.windowGroups] : ctx.windowGroups;
    for (const group of groupsForFiles) {
      const numbers = group.associatedPrs.map((pr) => pr.id).filter((id) => id > 0);
      for (const file of changedFilesBetween(`${group.commit.hash}^1`, group.commit.hash)) {
        const set = prsOfFile.get(file) || new Set<number>();
        for (const number of numbers) {
          set.add(number);
        }
        prsOfFile.set(file, set);
      }
    }
    const filesFrom = ctx.foundGroup && leftOutBefore.size > 0 ? revParse(`${ctx.foundGroup.commit.hash}^1`) || fromCommit : fromCommit;
    const itemFiles = collectItemFiles(allKeys, changedFilesBetween(filesFrom, ctx.parentHead), ctx.parentRef);
    // A left-out item touched before the found Pull Request: look for its files in the recent history of the parent branch
    const orphans = [...leftOutBefore.keys()].filter((key) => (itemFiles.get(key) || []).length === 0 && !delta.deletions.includes(key));
    if (orphans.length > 0) {
      const oldest = ctx.groups[0] ? revParse(`${ctx.groups[0].commit.hash}^1`) : null;
      const recentFiles = oldest ? changedFilesBetween(oldest, ctx.parentHead) : [];
      for (const [key, files] of collectItemFiles(orphans, recentFiles, ctx.parentRef)) {
        if (files.length > 0) {
          itemFiles.set(key, files);
        }
      }
    }
    ctx.items = allKeys
      .map((key) => {
        const parsed = parseMetadataKey(key) || { type: '', name: key };
        const files = itemFiles.get(key) || [];
        const pullRequests = [...new Set(files.flatMap((file) => [...(prsOfFile.get(file) || [])]))].sort((a, b) => a - b);
        return { key, type: parsed.type, name: parsed.name, files, pullRequests, excludedLastTime: leftOutBefore.has(key), noOverwrite: noOverwriteKeys.has(key) };
      })
      .sort((a, b) => a.key.localeCompare(b.key));
    ctx.deletions = delta.deletions
      .map((key) => {
        const parsed = parseMetadataKey(key) || { type: '', name: key };
        return { key, type: parsed.type, name: parsed.name };
      })
      .sort((a, b) => a.key.localeCompare(b.key));

    await this.collectActions(ctx, ctx.windowGroups);
  }

  /** The deployment actions of the given groups, with what already ran in this sandbox */
  private async collectActions(ctx: BackpromoteContext, groups: BackpromotePrGroup[]): Promise<void> {
    reportCommandProgress({ step: 'actions', message: t('backpromoteProgressActions') });
    ctx.actionCandidates = {
      pre: collectBackpromoteActions(groups, ctx.parentBranch, 'commandsPreDeploy', this),
      post: collectBackpromoteActions(groups, ctx.parentBranch, 'commandsPostDeploy', this),
    };
    ctx.actions = [];
    for (const [phase, candidates] of [['pre', ctx.actionCandidates.pre], ['post', ctx.actionCandidates.post]] as const) {
      for (const action of candidates) {
        const row = action.prId > 0 ? findActionRow(await ctx.store.read(action.prId), action.id, ctx.targetOrg.sandboxName, ctx.targetOrg.orgId) : null;
        if (row) {
          ctx.actionRows.set(action.id, row);
        }
        ctx.actions.push({
          id: action.id,
          label: action.label,
          type: action.type || 'command',
          phase,
          context: action.context || 'all',
          pullRequest: action.prId,
          alreadyRunOn: row && row.status === 'success' ? row.date : null,
          manual: action.type === 'manual',
          customUsername: action.customUsername || null,
          runnable: true,
          runOnlyOnceByOrg: action.runOnlyOnceByOrg !== false,
        });
      }
    }
  }

  private async readNoOverwrite(parentRef: string): Promise<Record<string, string[]> | null> {
    for (const file of ['manifest/package-no-overwrite.xml', 'manifest/packageDeployOnce.xml']) {
      const content = fileAtRef(parentRef, file);
      if (content === null) {
        continue;
      }
      const tempFile = path.join(await createTempDir(), 'package-no-overwrite.xml');
      await fs.writeFile(tempFile, content, 'utf8');
      try {
        return ((await parsePackageXmlFile(tempFile)) || {}) as Record<string, string[]>;
      } catch {
        return null;
      }
    }
    return null;
  }

  // ---- Comparison and decisions ----

  private async compare(ctx: BackpromoteContext): Promise<void> {
    const keys = ctx.items.filter((item) => !ctx.excludedKeys.has(item.key) && !item.noOverwrite).map((item) => item.key);
    reportCommandProgress({ step: 'retrieve', message: t('backpromoteProgressRetrieve', { count: keys.length, sandboxName: ctx.targetOrg.sandboxName }) });
    const retrieve = await retrieveItemsForComparison({ username: ctx.targetOrg.username, keys, orgId: ctx.targetOrg.orgId, runId: ctx.runId, commandThis: this });
    ctx.state.retrieveDir = retrieve.orgDir;
    reportCommandProgress({ step: 'compare', message: t('backpromoteProgressCompare') });
    const pendingInOrg = new Set(ctx.targetOrg.tracksSource ? await listOrgPendingChanges(ctx.targetOrg.username, this).catch(() => []) : []);
    const prsOfItem = new Map(ctx.items.map((item) => [item.key, item.pullRequests]));
    const itemFiles = new Map(ctx.items.filter((item) => keys.includes(item.key)).map((item) => [item.key, item.files]));
    ctx.comparison = await compareItemsWithOrg({
      itemFiles,
      pullRequestsOfFile: (file) => [...new Set([...itemFiles].filter(([, files]) => files.includes(file)).flatMap(([key]) => prsOfItem.get(key) || []))],
      retrieve,
      parentRef: ctx.parentRef,
      baseRef: ctx.historyFound && ctx.window ? ctx.window.fromCommit : null,
      pendingInOrg,
      orgId: ctx.targetOrg.orgId,
      runId: ctx.runId,
      excludedItems: ctx.excludedKeys,
    });
    // What a previous --prepare wrote, when the checkout is still on the backpromote branch
    const onBranch = currentBranchName() === ctx.backpromoteBranch;
    for (const entry of ctx.comparison) {
      const prepared = ctx.state.prepared.find((file) => file.file === entry.file);
      if (!prepared) {
        continue;
      }
      entry.threeWay = prepared.threeWay;
      entry.decision = 'merge';
      if (onBranch) {
        const absolute = path.join(ctx.gitRoot, entry.file);
        entry.prepared = fs.existsSync(absolute);
        entry.markersRemaining = entry.prepared ? countConflictMarkerBlocks(await fs.readFile(absolute, 'utf8')) : 0;
      } else {
        entry.prepared = true;
      }
    }
  }

  /** Terminal mode: the items, the deletions and the decision for every file that differs */
  private async askDecisions(ctx: BackpromoteContext): Promise<void> {
    const candidates = ctx.items.filter((item) => !item.noOverwrite).map((item) => item.key);
    const chosen = await promptItemsToDeploy(candidates, ctx.deletions.map((deletion) => deletion.key), ctx.targetOrg.sandboxName);
    for (const key of candidates) {
      if (!chosen.items.includes(key)) {
        ctx.excludedKeys.add(key);
      }
    }
    for (const deletion of ctx.deletions) {
      if (!chosen.deletions.includes(deletion.key)) {
        ctx.excludedKeys.add(deletion.key);
      }
    }
    let forAll: BackpromoteDiffChoice | null = null;
    for (const entry of ctx.comparison) {
      if (!['different', 'pendingInOrg'].includes(entry.status) || ctx.excludedKeys.has(entry.item) || ctx.diffDecisions.has(entry.file)) {
        continue;
      }
      if (entry.prepared) {
        ctx.diffDecisions.set(entry.file, 'merge');
        continue;
      }
      if (forAll) {
        ctx.diffDecisions.set(entry.file, forAll);
        continue;
      }
      const answer = await promptDiffDecision(entry.file, ctx.parentBranch, ctx.targetOrg.sandboxName);
      ctx.diffDecisions.set(entry.file, answer.choice);
      if (answer.forAll) {
        forAll = answer.choice;
      }
    }
    if (ctx.actions.length > 0 && ctx.actionIds === null && !ctx.skipActions) {
      ctx.actionIds = await promptActionsToRun(ctx.actions);
    }
  }

  private applyDecisions(ctx: BackpromoteContext): void {
    for (const entry of ctx.comparison) {
      if (!['different', 'pendingInOrg'].includes(entry.status)) {
        entry.decision = null;
        continue;
      }
      entry.decision = ctx.diffDecisions.get(entry.file) || (entry.prepared ? 'merge' : ctx.diffDefault);
    }
  }

  private async persistState(ctx: BackpromoteContext): Promise<void> {
    ctx.state.comparison = ctx.comparison;
    await writeBackpromoteRunState(ctx.state);
  }

  // ---- Checkout, merges ----

  private async switchCheckout(ctx: BackpromoteContext): Promise<void> {
    reportCommandProgress({ step: 'checkout', message: t('backpromoteProgressCheckout', { branch: ctx.backpromoteBranch }) });
    const current = currentBranchName();
    if (current !== ctx.backpromoteBranch) {
      const dirty = await listUncommittedFiles();
      let stashed = false;
      let stashMessage: string | null = null;
      if (dirty.length > 0) {
        // A commit is only allowed on the developer's own branch: on a major, promotion, retrofit or
        // backpromote branch the changes are stashed whatever was asked
        const majorBranches = [...ctx.allowedParentBranches, ...(await listMajorOrgs()).map((org: any) => org.branchName).filter(Boolean)];
        const ownBranch = classifyBackpromoteCurrentBranch(current, majorBranches) === 'userStoryBranch';
        let action: 'stash' | 'commit' = this.flags['dirty-tree'] || 'stash';
        let message: string | null = this.flags['commit-message'] || null;
        if (!this.flags['dirty-tree'] && ctx.interactive && ownBranch) {
          const answer = await promptDirtyTree(dirty, current);
          action = answer.action;
          message = answer.message;
        }
        if (!ownBranch) {
          action = 'stash';
        }
        if (action === 'commit') {
          const committed = await commitAllChanges(message || 'WIP');
          uxLog('action', this, c.cyan(t('backpromoteDirtyTreeCommitted', { count: committed.length, branch: current })));
        } else {
          stashMessage = `sfdx-hardis backpromote ${ctx.runId} from ${current}`;
          stashed = stashWorkingTree(stashMessage);
          uxLog('action', this, c.cyan(t('backpromoteDirtyTreeStashed', { count: dirty.length, branch: current })));
        }
      }
      ctx.state.checkout = { originalBranch: current, stashed, stashMessage };
      const carried = checkoutBackpromoteBranch(ctx.backpromoteBranch, ctx.parentRef);
      uxLog('action', this, c.cyan(t('backpromoteCheckedOut', { branch: ctx.backpromoteBranch, parentBranch: ctx.parentBranch })));
      if (carried.droppedMerges.length > 0) {
        uxLog('warning', this, c.yellow(t('backpromoteMergesDropped', { files: carried.droppedMerges.join(', ') })));
      }
    } else {
      if (!ctx.state.checkout) {
        ctx.state.checkout = { originalBranch: current, stashed: false, stashMessage: null };
      }
      // Already on the branch (the command leaves the checkout there): the parent branch may have
      // moved since. The prepared files are committed first so that they are carried over, then the
      // branch is rebuilt on the current parent head.
      if (!isAncestor(ctx.parentHead, 'HEAD')) {
        const uncommitted = await listUncommittedFiles();
        if (uncommitted.length > 0) {
          commitFiles(uncommitted, `chore(sfdx-hardis): backpromote merges in progress for ${ctx.targetOrg.sandboxName}`);
        }
        const carried = rebuildBackpromoteBranchOnParent(ctx.parentRef);
        uxLog('action', this, c.cyan(t('backpromoteBranchRebuilt', { branch: ctx.backpromoteBranch, parentBranch: ctx.parentBranch })));
        if (carried.droppedMerges.length > 0) {
          uxLog('warning', this, c.yellow(t('backpromoteMergesDropped', { files: carried.droppedMerges.join(', ') })));
        }
      }
    }
    await this.persistState(ctx);
  }

  /** Write the files marked merge that are not prepared yet, and the coding agent prompt */
  private async prepareMerges(ctx: BackpromoteContext): Promise<{ prepared: BackpromotePlanComparison[]; withMarkers: Array<{ path: string; conflictBlocks: number }>; newlyWritten: string[] }> {
    const toMerge = ctx.comparison.filter((entry) => entry.decision === 'merge' && !ctx.excludedKeys.has(entry.item));
    const newlyWritten: string[] = [];
    if (toMerge.length === 0) {
      return { prepared: [], withMarkers: [], newlyWritten };
    }
    reportCommandProgress({ step: 'merges', message: t('backpromoteProgressMerges', { count: toMerge.length }) });
    const labels = { sandbox: `sandbox ${ctx.targetOrg.sandboxName}`, parent: ctx.parentBranch, base: 'base' };
    for (const entry of toMerge) {
      const absolute = path.join(ctx.gitRoot, entry.file);
      const parentContent = entry.versions.parentHead ? await fs.readFile(entry.versions.parentHead, 'utf8') : fileAtRef(ctx.parentRef, entry.file);
      // Already touched: a previous prepare, or a merge carried over by the branch (its markers or its result)
      const current = fs.existsSync(absolute) ? await fs.readFile(absolute, 'utf8') : null;
      if (current !== null && parentContent !== null && !sameFileContent(current, parentContent)) {
        entry.prepared = true;
        entry.markersRemaining = countConflictMarkerBlocks(current);
        if (!ctx.state.prepared.some((file) => file.file === entry.file)) {
          ctx.state.prepared.push({ file: entry.file, item: entry.item, threeWay: entry.threeWay });
        }
        continue;
      }
      const sandboxContent = entry.versions.sandbox ? await fs.readFile(entry.versions.sandbox, 'utf8') : null;
      if (sandboxContent === null || parentContent === null) {
        entry.decision = 'git';
        continue;
      }
      const baseContent = entry.versions.base ? await fs.readFile(entry.versions.base, 'utf8') : null;
      const written = await writeMergedFile({ absolutePath: absolute, sandboxContent, parentContent, baseContent, labels });
      entry.prepared = true;
      entry.threeWay = written.threeWay;
      entry.markersRemaining = written.conflictBlocks;
      newlyWritten.push(entry.file);
      if (!ctx.state.prepared.some((file) => file.file === entry.file)) {
        ctx.state.prepared.push({ file: entry.file, item: entry.item, threeWay: written.threeWay });
      }
      uxLog('action', this, c.cyan(t('backpromoteMergeWritten', { file: entry.file, count: written.conflictBlocks })));
    }
    const prepared = toMerge.filter((entry) => entry.prepared);
    const withMarkers = prepared.filter((entry) => entry.markersRemaining > 0).map((entry) => ({ path: entry.file, conflictBlocks: entry.markersRemaining }));
    if (prepared.length > 0) {
      const promptFiles: BackpromoteMergePromptFile[] = prepared.map((entry) => ({
        path: entry.file,
        absolutePath: path.join(ctx.gitRoot, entry.file),
        conflictBlocks: entry.markersRemaining,
        versions: entry.versions,
        pullRequests: entry.pullRequests,
      }));
      const prompt = buildBackpromoteMergePrompt({
        parentBranch: ctx.parentBranch,
        backpromoteBranch: ctx.backpromoteBranch,
        sandboxName: ctx.targetOrg.sandboxName,
        files: promptFiles,
        pullRequests: ctx.windowGroups.flatMap((group) => group.associatedPrs).filter((pr, index, all) => all.findIndex((other) => other.id === pr.id && other.title === pr.title) === index),
        nextCommand: this.runCommand(ctx, ctx.agentMode ? 'agent' : 'auto'),
        agentMode: ctx.agentMode,
      });
      ctx.promptFile = await writeBackpromoteMergePrompt(prompt, ctx.runId);
      if (withMarkers.length > 0) {
        announceBackpromoteMerges(promptFiles.filter((file) => file.conflictBlocks > 0), ctx.promptFile, this);
      }
    }
    await this.persistState(ctx);
    return { prepared, withMarkers, newlyWritten };
  }

  private async waitForMerges(ctx: BackpromoteContext, files: string[]): Promise<'solved' | 'aborted'> {
    for (;;) {
      const answer = await promptWaitForSolvedMerges(files);
      if (answer === 'abort') {
        uxLog('action', this, c.cyan(t('backpromoteMergeAborted')));
        return 'aborted';
      }
      const remaining = await listFilesWithConflictMarkers(files);
      for (const entry of ctx.comparison) {
        const left = remaining.find((file) => file.path === entry.file);
        entry.markersRemaining = left ? left.conflictBlocks : 0;
      }
      if (remaining.length === 0) {
        return 'solved';
      }
      uxLog('action', this, c.yellow(t('backpromoteMergeStillHasMarkers', { files: remaining.map((file) => `${file.path} (${file.conflictBlocks})`).join(', ') })));
    }
  }

  // ---- Deployment, comments, push ----

  private async deployAndRecord(ctx: BackpromoteContext): Promise<BackpromotePlan> {
    const result: BackpromoteRunResult = {
      deployed: 0,
      deleted: 0,
      excluded: [],
      actions: { run: [], skipped: [], failed: [], pending: [] },
      conflictPending: [],
      commentedPullRequests: [],
      pushed: false,
      pushRejected: false,
      deployReport: null,
      orgUrl: ctx.targetOrg.instanceUrl || null,
    };
    const leftOut = new Map<string, BackpromoteLeftOutItem>();
    const mergedFiles: string[] = [];
    // package-no-overwrite.xml items are never deployed and never listed as left out: they are not
    // pending, they are held back by the project rule (R22)
    const noOverwriteKeys = new Set(ctx.items.filter((item) => item.noOverwrite).map((item) => item.key));
    for (const item of ctx.items) {
      if (!item.noOverwrite && ctx.excludedKeys.has(item.key)) {
        leftOut.set(item.key, { key: item.key, reason: 'excluded' });
      }
    }
    // An Overwrite decision deploys the parent head version: a merge carried by the branch or
    // prepared earlier for that file is put back to the parent version, on the branch
    const restored: string[] = [];
    for (const entry of ctx.comparison) {
      if (entry.decision === 'merge' || leftOut.has(entry.item) || noOverwriteKeys.has(entry.item)) {
        continue;
      }
      const absolute = path.join(ctx.gitRoot, entry.file);
      const parentContent = fileAtRef(ctx.parentRef, entry.file);
      if (parentContent === null || !fs.existsSync(absolute)) {
        continue;
      }
      if (!sameFileContent(await fs.readFile(absolute, 'utf8'), parentContent)) {
        await fs.writeFile(absolute, parentContent, 'utf8');
        restored.push(entry.file);
        entry.prepared = false;
        entry.markersRemaining = 0;
        ctx.state.prepared = ctx.state.prepared.filter((file) => file.file !== entry.file);
      }
    }
    for (const entry of ctx.comparison) {
      if (leftOut.has(entry.item) || noOverwriteKeys.has(entry.item)) {
        continue;
      }
      if (entry.decision === 'org') {
        leftOut.set(entry.item, { key: entry.item, reason: 'keptOrg' });
      } else if (entry.decision === 'merge' && entry.prepared) {
        const absolute = path.join(ctx.gitRoot, entry.file);
        entry.markersRemaining = fs.existsSync(absolute) ? countConflictMarkerBlocks(await fs.readFile(absolute, 'utf8')) : 0;
        if (entry.markersRemaining > 0) {
          entry.conflictPending = true;
          leftOut.set(entry.item, { key: entry.item, reason: 'conflictPending' });
        } else {
          mergedFiles.push(entry.file);
        }
      }
    }
    // The merged files are committed in the backpromote branch: they are what gets deployed. The
    // files put back to the parent version are committed with them when a carried commit changed them.
    const filesToCommit = [...new Set([...mergedFiles, ...ctx.comparison.filter((entry) => entry.conflictPending).map((entry) => entry.file), ...restored])];
    let mergeCommit: string | null = null;
    const uncommittedNow = (await listUncommittedFiles()).map(normalizeRepoPath);
    const commitNow = filesToCommit.filter((file) => uncommittedNow.includes(file));
    if (commitNow.length > 0) {
      const message = `chore(sfdx-hardis): backpromote merges for ${ctx.targetOrg.sandboxName} from ${ctx.parentBranch}\n\n${commitNow.map((file) => `- ${file}`).join('\n')}`;
      mergeCommit = commitFiles(commitNow, message);
      uxLog('action', this, c.cyan(t('backpromoteMergesCommitted', { count: commitNow.length, branch: ctx.backpromoteBranch })));
    }
    for (const item of leftOut.values()) {
      if (item.reason === 'conflictPending' && mergeCommit) {
        item.commit = mergeCommit;
      }
    }

    const deployKeys = ctx.items.filter((item) => !leftOut.has(item.key) && !noOverwriteKeys.has(item.key)).map((item) => item.key);
    const deleteKeys = ctx.skipDestructive ? [] : ctx.deletions.filter((deletion) => !ctx.excludedKeys.has(deletion.key)).map((deletion) => deletion.key);
    for (const deletion of ctx.deletions) {
      if (ctx.skipDestructive || ctx.excludedKeys.has(deletion.key)) {
        leftOut.set(deletion.key, { key: deletion.key, reason: 'excluded' });
      }
    }
    // A conflict marker never reaches the org: the files of the window, and every file the branch
    // changed since the parent head (a merge carried from a previous run, a prepared file)
    const deployFiles = ctx.items.filter((item) => deployKeys.includes(item.key)).flatMap((item) => item.files);
    const suspects = new Set([...deployFiles, ...changedFilesBetween(ctx.parentHead, 'HEAD'), ...(await listUncommittedFiles()).map(normalizeRepoPath)]);
    const markers = await listFilesWithConflictMarkers(suspects);
    if (markers.length > 0) {
      const plan = this.buildPlan(ctx, 'conflictsRemaining', t('backpromoteConflictsRemaining', { files: markers.map((file) => file.path).join(', ') }));
      throw this.refusal(plan.message || '', plan);
    }
    if (leftOut.size > 0) {
      uxLog('action', this, c.cyan(t('backpromoteExcludedItems', { count: leftOut.size, items: [...leftOut.keys()].join(', ') })));
    }
    uxLog('action', this, c.cyan(t('backpromoteDeltaSummary', { addedModified: deployKeys.length, deleted: deleteKeys.length })));

    // Actions, deployment, deletions, actions
    const selectedActionIds = new Set(ctx.skipActions ? [] : ctx.actionIds !== null ? ctx.actionIds : ctx.actions.map((action) => action.id));
    if (ctx.skipActions) {
      uxLog('log', this, c.grey(t('backpromoteActionsSkippedByFlag')));
    }
    // The rows are read again from the provider, not from the run cache: a colleague may have run the
    // same actions in this sandbox between the plan and this run
    const refreshActionRows = async (candidates: BackpromoteActionCandidate[]) => {
      for (const action of candidates.filter((entry) => selectedActionIds.has(entry.id) && entry.prId > 0)) {
        const row = findActionRow(await ctx.store.read(action.prId, { fresh: true }), action.id, ctx.targetOrg.sandboxName, ctx.targetOrg.orgId);
        if (row) {
          ctx.actionRows.set(action.id, row);
        } else {
          ctx.actionRows.delete(action.id);
        }
      }
    };
    const actionOptions = { selectedActionIds, alreadyRun: ctx.actionRows, sandboxName: ctx.targetOrg.sandboxName, orgId: ctx.targetOrg.orgId, user: ctx.user, conn: ctx.conn, store: ctx.store, commandThis: this };
    const merge = (outcome: { run: string[]; skipped: string[]; failed: string[]; pending: string[] }) => {
      result.actions.run.push(...outcome.run);
      result.actions.skipped.push(...outcome.skipped);
      result.actions.failed.push(...outcome.failed);
      result.actions.pending.push(...outcome.pending);
    };
    reportCommandProgress({ step: 'preActions', message: t('backpromoteProgressPreActions') });
    await refreshActionRows(ctx.actionCandidates.pre);
    merge(await executeBackpromoteActions({ ...actionOptions, actions: ctx.actionCandidates.pre, phase: 'commandsPreDeploy' }));

    reportCommandProgress({ step: 'deploy', message: t('backpromoteProgressDeploy', { count: deployKeys.length, sandboxName: ctx.targetOrg.sandboxName }) });
    const workDir = await createTempDir();
    const deployment = await deployBackpromotePackage({ keys: deployKeys, username: ctx.targetOrg.username, workDir, commandThis: this, debugMode: ctx.debugMode });
    result.deployReport = deployment.reportPath;
    if (!deployment.success) {
      const plan = this.buildPlan(ctx, 'deployFailed', t('backpromoteDeployFailed'), result);
      throw this.refusal(t('backpromoteDeployFailed'), plan);
    }
    result.deployed = deployKeys.length;
    if (deleteKeys.length > 0) {
      reportCommandProgress({ step: 'destructive', message: t('backpromoteProgressDestructive', { count: deleteKeys.length }) });
      let confirmed = true;
      if (ctx.interactive) {
        const { prompts } = await import('../../../common/utils/prompts.js');
        const res = await prompts({ type: 'confirm', name: 'value', message: c.cyanBright(t('backpromoteConfirmDestructiveChanges', { count: deleteKeys.length, items: deleteKeys.join(', ') })), description: t('backpromoteConfirmDestructiveChanges', { count: deleteKeys.length, items: deleteKeys.join(', ') }), initial: true });
        confirmed = res.value === true;
      }
      if (confirmed) {
        const deletion = await deployBackpromoteDeletions({ keys: deleteKeys, username: ctx.targetOrg.username, workDir, commandThis: this, debugMode: ctx.debugMode });
        if (!deletion.success) {
          const plan = this.buildPlan(ctx, 'deployFailed', t('backpromoteDeployFailed'), result);
          throw this.refusal(t('backpromoteDeployFailed'), plan);
        }
        result.deleted = deleteKeys.length;
      } else {
        for (const key of deleteKeys) {
          leftOut.set(key, { key, reason: 'excluded' });
        }
        uxLog('action', this, c.cyan(t('backpromoteDestructiveChangesSkipped')));
      }
    }
    reportCommandProgress({ step: 'postActions', message: t('backpromoteProgressPostActions') });
    await refreshActionRows(ctx.actionCandidates.post);
    merge(await executeBackpromoteActions({ ...actionOptions, actions: ctx.actionCandidates.post, phase: 'commandsPostDeploy' }));
    result.excluded = [...leftOut.values()];
    result.conflictPending = result.excluded.filter((item) => item.reason === 'conflictPending').map((item) => item.key);

    // The sandbox rows: one per Pull Request of the window, plus the found one when its left-out items were offered again
    reportCommandProgress({ step: 'comments', message: t('backpromoteProgressComments') });
    const leftOutByPr = new Map<number, BackpromoteLeftOutItem[]>();
    const prNumbers = new Set<number>();
    for (const group of ctx.windowGroups) {
      for (const pr of group.associatedPrs) {
        if (pr.id > 0) {
          prNumbers.add(pr.id);
        }
      }
    }
    const foundNumbers = (ctx.foundGroup?.associatedPrs || []).map((pr) => pr.id).filter((id) => id > 0);
    if (ctx.foundRow && ctx.foundRow.leftOut.length > 0) {
      foundNumbers.forEach((number) => prNumbers.add(number));
    }
    // A left-out item is recorded on the Pull Requests that touched it and on the newest Pull
    // Request of the window: the history walk stops at the newest row, which must carry everything
    // still pending
    const newestNumbers = [...(ctx.windowGroups[ctx.windowGroups.length - 1]?.associatedPrs || [])].map((pr) => pr.id).filter((id) => id > 0);
    for (const item of leftOut.values()) {
      const planItem = ctx.items.find((entry) => entry.key === item.key);
      const touching = planItem && planItem.pullRequests.length > 0 ? planItem.pullRequests : planItem?.excludedLastTime ? foundNumbers : [...prNumbers];
      for (const number of new Set([...touching, ...newestNumbers])) {
        leftOutByPr.set(number, [...(leftOutByPr.get(number) || []), item]);
      }
    }
    for (const number of prNumbers) {
      try {
        const row = buildSandboxRow({ sandboxName: ctx.targetOrg.sandboxName, orgId: ctx.targetOrg.orgId, user: ctx.user, parentBranch: ctx.parentBranch, leftOut: leftOutByPr.get(number) || [], version: this.config.version });
        await ctx.store.update(number, (state) => upsertSandboxRow(state, row));
        result.commentedPullRequests.push(number);
      } catch (e) {
        uxLog('warning', this, c.yellow(t('backpromoteCommentWriteFailed', { pr: number, message: (e as Error).message })));
      }
    }
    for (const pr of ctx.pullRequests) {
      if (result.commentedPullRequests.includes(pr.number)) {
        pr.backpromote = { date: new Date().toISOString(), user: ctx.user, status: (leftOutByPr.get(pr.number) || []).length > 0 ? 'partial' : 'complete', leftOut: leftOutByPr.get(pr.number) || [] };
      }
    }

    // Manual actions confirmed now
    const confirmIds = new Set(ctx.confirmActionIds);
    if (ctx.interactive) {
      for (const action of ctx.actions.filter((entry) => result.actions.pending.includes(entry.id))) {
        if (await promptManualActionDone(action, ctx.targetOrg.sandboxName)) {
          confirmIds.add(action.id);
        }
      }
    }
    if (confirmIds.size > 0) {
      const confirmed = await this.writeConfirmedActions(ctx, [...confirmIds]);
      result.actions.pending = result.actions.pending.filter((id) => !confirmed.includes(id));
      result.actions.run.push(...confirmed);
    }

    // The backpromote branch is pushed when it holds manual merges
    let status: BackpromoteStatus = 'ok';
    let message: string | null = t('backpromoteCompleted', { sandboxName: ctx.targetOrg.sandboxName });
    if (headCommit() !== ctx.parentHead) {
      reportCommandProgress({ step: 'push', message: t('backpromoteProgressPush', { branch: ctx.backpromoteBranch }) });
      const push = pushBackpromoteBranch(ctx.backpromoteBranch);
      result.pushed = push.pushed;
      result.pushRejected = push.rejected;
      if (push.pushed) {
        uxLog('action', this, c.cyan(t('backpromoteBranchPushed', { branch: ctx.backpromoteBranch })));
      } else {
        status = 'pushRejected';
        message = push.rejected ? t('backpromotePushRejected', { branch: ctx.backpromoteBranch }) : t('backpromotePushFailed', { branch: ctx.backpromoteBranch, message: push.error || '' });
        uxLog('warning', this, c.yellow(message));
      }
    }
    await this.persistState(ctx);
    uxLog('action', this, c.green(t('backpromoteCompleted', { sandboxName: ctx.targetOrg.sandboxName })));
    const original = ctx.state.checkout?.originalBranch || '';
    if (original && original !== ctx.backpromoteBranch) {
      uxLog('action', this, c.cyan(t('backpromoteBackToBranchHint', { branch: ctx.backpromoteBranch, original, parentBranch: ctx.parentBranch, stash: ctx.state.checkout?.stashed ? ' && git stash pop' : '' })));
    }
    const plan = this.buildPlan(ctx, status, message, result);
    if (status === 'pushRejected') {
      throw this.refusal(message || '', plan);
    }
    return plan;
  }

  // ---- Confirm and reset ----

  private async writeConfirmedActions(ctx: BackpromoteContext, ids: string[]): Promise<string[]> {
    const confirmed: string[] = [];
    for (const id of ids) {
      const action = ctx.actions.find((entry) => entry.id === id);
      if (!action || action.pullRequest <= 0) {
        uxLog('warning', this, c.yellow(t('backpromoteUnknownAction', { id })));
        continue;
      }
      const row: BackpromoteActionRow = { actionId: action.id, label: action.label, phase: action.phase, sandboxName: ctx.targetOrg.sandboxName, orgId: ctx.targetOrg.orgId, date: new Date().toISOString(), status: 'success', user: ctx.user };
      try {
        await ctx.store.update(action.pullRequest, (state) => upsertActionRow(state, row));
        action.alreadyRunOn = row.date;
        ctx.actionRows.set(action.id, row);
        confirmed.push(id);
        uxLog('action', this, c.cyan(t('backpromoteManualActionCompleted', { label: action.label })));
      } catch (e) {
        uxLog('warning', this, c.yellow(t('backpromoteCommentWriteFailed', { pr: action.pullRequest, message: (e as Error).message })));
      }
    }
    return confirmed;
  }

  private async confirmActions(ctx: BackpromoteContext): Promise<BackpromotePlan> {
    const confirmed = await this.writeConfirmedActions(ctx, ctx.confirmActionIds);
    return this.buildPlan(ctx, 'ok', t('backpromoteActionsConfirmed', { count: confirmed.length }));
  }

  private async resetBranch(options: {
    backpromoteBranch: string;
    parentRef: string;
    interactive: boolean;
    targetOrg: BackpromoteTargetOrgInfo;
    parentBranch: string;
    allowedParentBranches: string[];
    checks: BackpromotePlanCheck[];
    runId: string;
    mode: BackpromoteMode;
    gitRoot: string;
  }): Promise<BackpromotePlan> {
    if (options.interactive && !(await promptConfirmReset(options.backpromoteBranch))) {
      return this.emptyPlan({ ...options, status: 'refused', message: t('backpromoteResetCancelled') });
    }
    const previous = await readBackpromoteRunState(this.flags['run-id'] || null);
    const deleted = deleteBackpromoteBranch(options.backpromoteBranch, options.parentRef, previous?.checkout?.originalBranch || null);
    const message = t('backpromoteResetDone', { branch: options.backpromoteBranch });
    uxLog('action', this, c.cyan(message));
    const plan = this.emptyPlan({ ...options, status: 'ok', message });
    plan.backpromoteBranch = { name: options.backpromoteBranch, existsOnOrigin: false, head: null, pendingMerges: [] };
    uxLog('log', this, c.grey(`[Backpromote] origin: ${deleted.deletedOnOrigin}, local: ${deleted.deletedLocally}`));
    return plan;
  }

  // ---- Plan JSON ----

  private runCommand(ctx: BackpromoteContext, mode: 'auto' | 'agent'): string {
    const decisions = new Map<string, BackpromoteDiffChoice>();
    for (const entry of ctx.comparison) {
      if (entry.decision && entry.decision !== ctx.diffDefault) {
        decisions.set(entry.file, entry.decision);
      }
    }
    return buildBackpromoteRunCommand({
      mode,
      parentBranch: ctx.parentBranch,
      targetOrg: ctx.targetOrg.alias || ctx.targetOrg.username,
      fromPullRequest: ctx.window?.startPullRequest || null,
      runId: ctx.runId,
      excludeMetadata: [...ctx.excludedKeys],
      diffDecisions: decisions,
      diffDefault: ctx.diffDefault,
      actions: ctx.skipActions ? null : ctx.actionIds,
      skipActions: ctx.skipActions,
      skipDestructive: ctx.skipDestructive,
      json: true,
    });
  }

  private buildPlan(ctx: BackpromoteContext, status: BackpromoteStatus, message: string | null, result: BackpromoteRunResult | null = null): BackpromotePlan {
    const current = currentBranchName();
    return {
      version: BACKPROMOTE_PLAN_VERSION,
      runId: ctx.runId,
      mode: ctx.mode,
      status,
      message,
      targetOrg: {
        alias: ctx.targetOrg.alias,
        username: ctx.targetOrg.username,
        instanceUrl: ctx.targetOrg.instanceUrl,
        orgId: ctx.targetOrg.orgId,
        sandboxName: ctx.targetOrg.sandboxName,
        orgType: ctx.targetOrg.orgType,
        tracksSource: ctx.targetOrg.tracksSource,
        refusal: ctx.targetOrg.refusal?.reason || null,
      },
      parentBranch: ctx.parentBranch,
      allowedParentBranches: ctx.allowedParentBranches,
      gitRoot: ctx.gitRoot,
      backpromoteBranch: inspectBackpromoteBranch(ctx.backpromoteBranch, ctx.parentRef),
      checkout: {
        originalBranch: ctx.state.checkout?.originalBranch || current,
        currentBranch: current,
        clean: ctx.dirtyFiles.length === 0,
        dirtyFiles: ctx.dirtyFiles,
        stashed: ctx.state.checkout?.stashed || false,
        stashMessage: ctx.state.checkout?.stashMessage || null,
        onBackpromoteBranch: current === ctx.backpromoteBranch,
      },
      pullRequests: ctx.pullRequests,
      scan: ctx.scan,
      window: ctx.window,
      items: ctx.items,
      deletions: ctx.deletions,
      actions: ctx.actions,
      comparison: ctx.comparison,
      checks: ctx.checks,
      promptFile: ctx.promptFile,
      runCommand: ctx.window ? this.runCommand(ctx, ctx.agentMode ? 'agent' : 'auto') : null,
      result,
    };
  }

  private emptyPlan(options: {
    mode: BackpromoteMode;
    runId: string;
    status: BackpromoteStatus;
    message: string | null;
    targetOrg: BackpromoteTargetOrgInfo;
    parentBranch: string;
    allowedParentBranches: string[];
    backpromoteBranch: string;
    checks: BackpromotePlanCheck[];
    gitRoot: string;
  }): BackpromotePlan {
    let current = '';
    try {
      current = currentBranchName();
    } catch {
      current = '';
    }
    return {
      version: BACKPROMOTE_PLAN_VERSION,
      runId: options.runId,
      mode: options.mode,
      status: options.status,
      message: options.message,
      targetOrg: {
        alias: options.targetOrg.alias,
        username: options.targetOrg.username,
        instanceUrl: options.targetOrg.instanceUrl,
        orgId: options.targetOrg.orgId,
        sandboxName: options.targetOrg.sandboxName,
        orgType: options.targetOrg.orgType,
        tracksSource: options.targetOrg.tracksSource,
        refusal: options.targetOrg.refusal?.reason || null,
      },
      parentBranch: options.parentBranch,
      allowedParentBranches: options.allowedParentBranches,
      gitRoot: options.gitRoot,
      backpromoteBranch: { name: options.backpromoteBranch, existsOnOrigin: false, head: null, pendingMerges: [] },
      checkout: { originalBranch: current, currentBranch: current, clean: true, dirtyFiles: [], stashed: false, stashMessage: null, onBackpromoteBranch: current === options.backpromoteBranch },
      pullRequests: [],
      scan: { read: 0, limit: 0, found: false, hasMore: false },
      window: null,
      items: [],
      deletions: [],
      actions: [],
      comparison: [],
      checks: options.checks,
      promptFile: null,
      runCommand: null,
      result: null,
    };
  }

  /** A refusal: exit code 1, the plan in the JSON data so that the panel and an agent read the status */
  private refusal(message: string, plan: BackpromotePlan): SfError {
    const error = new SfError(message, 'BackpromoteRefused', [], 1);
    (error as any).data = plan;
    return error;
  }
}
