/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { isCI, uxLog } from '../../../../common/utils/index.js';
import { CONSTANTS } from '../../../../config/index.js';
import { t } from '../../../../common/utils/i18n.js';
import {
  assertPromotionBranchesEnabled,
  excludeAlreadyPromotedCandidates,
  formatPullRequestNumbers,
  listOpenPromotionPullRequests,
  listPromotionCandidates,
  logPartiallyPromotedCandidates,
  logPromotionCandidatesTable,
  resolvePromotionSourceAndTarget,
  toCandidateSummary,
} from '../../../../common/utils/promotionCreateUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class PromotionListCandidates extends SfCommand<any> {
  public static title = 'List the User Stories waiting for promotion (experimental)';

  public static description = `
## Command Behavior

**Experimental feature.** Promotion branches are new and switched off by default; their behavior may still change from feedback.

**Lists the Pull Requests merged into a major branch (ex: uat) and not yet promoted to the next one (ex: preprod), so you can choose the ones a [promotion branch (experimental)](${CONSTANTS.DOC_URL_ROOT}/salesforce-ci-cd-promotion-branches/) will carry.**

This is the read-only half of \`sf hardis:project:promotion:create\`: same configuration checks, same candidates, same rules about what is already on its way, but nothing is created, pushed or closed. Run it to know what can be promoted, then pass the numbers you picked to \`hardis:project:promotion:create --pull-requests\`.

The command:

- checks that \`enablePromotionBranches: true\` and \`allowedPromotionSteps\` are set, and keeps to the allowed steps: only those source and target branches are offered, and naming another one fails;
- lists the Pull Requests merged into the source branch since its merge base with the target branch, leaving out the merges between major branches and the promotion branches themselves (they carry other people's work, they are not User Stories);
- marks the ones another promotion branch already carries to the same target branch. They are left out of the candidates unless \`--include-already-promoted\` is passed, and always reported in the \`alreadyPromoted\` result;
- names the promotion Pull Request already open between the two branches, if any. It is left untouched: \`hardis:project:promotion:create\` is what closes it, once its replacement exists.

With \`--json\`, the result holds \`candidates\` (Pull Request numbers, title, author, source branch, commit, date), \`alreadyPromoted\`, and \`openPromotions\`.

<details markdown="1">
<summary>Technical explanations</summary>

- Candidates are the first-parent commits of \`origin/<source>\` since its merge base with \`origin/<target>\`, grouped with their Pull Requests like \`hardis:work:backpromote\` does (Pull Request numbers read from the merge commit messages and completed by the git provider API when a token is available).
- A promotion merged into the source branch is expanded into the User Stories its \`promotionPullRequests\` block declares, recursively, so a story promoted twice in a row keeps its number.
- A candidate can be a merge commit carrying several Pull Requests: they are listed together, because cherry-picking it carries all of them.
- Already-promoted detection reads the promotion Pull Requests of the target branch, bounded by the date of the oldest candidate. Without a git provider token, the check is skipped and said out loud.
</details>

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:project:promotion:list-candidates --agent --source-branch uat --json
\`\`\`

In agent mode:

- \`--source-branch\` is required; \`--target-branch\` defaults to the first merge target of the source branch allowed by \`allowedPromotionSteps\`.
- Nothing is prompted and nothing is written to git: the command only reads.
`;

  public static examples = [
    '$ sf hardis:project:promotion:list-candidates',
    '$ sf hardis:project:promotion:list-candidates --source-branch uat',
    '$ sf hardis:project:promotion:list-candidates --source-branch uat --target-branch preprod',
    '$ sf hardis:project:promotion:list-candidates --agent --source-branch uat --json',
    '$ sf hardis:project:promotion:list-candidates --agent --source-branch uat --include-already-promoted',
  ];

  public static flags: any = {
    'source-branch': Flags.string({
      char: 's',
      description: 'Major branch the approved User Stories are merged into (ex: uat). Prompted if not provided, required in agent mode.',
    }),
    'target-branch': Flags.string({
      char: 't',
      description: 'Major branch the promotion goes to (ex: preprod). Defaults to the first merge target of the source branch.',
    }),
    'include-already-promoted': Flags.boolean({
      default: false,
      description: 'Also list as candidates the Pull Requests another promotion branch already carries to the same target branch (reported apart by default).',
    }),
    agent: Flags.boolean({
      default: false,
      description: 'Run in non-interactive mode for agents and automation',
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
  };

  public static requiresProject = true;
  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(PromotionListCandidates);
    const agentMode = flags.agent === true || isCI;

    const promotionConfig = await assertPromotionBranchesEnabled(this);
    const { sourceBranch, targetBranch } = await resolvePromotionSourceAndTarget(
      this,
      flags['source-branch'] || null,
      flags['target-branch'] || null,
      agentMode,
      promotionConfig.allowedSteps,
    );

    uxLog('action', this, c.cyan(t('promotionCreateListingCandidates', { source: c.green(sourceBranch), target: c.green(targetBranch) })));
    // Nothing is superseded here, so the promotion already open counts as evidence like any other:
    // the stories it carries are reported as already promoted, and the promotion itself is named,
    // because hardis:project:promotion:create would close it and offer them again.
    const openPromotions = await listOpenPromotionPullRequests(sourceBranch, targetBranch, this);
    const candidates = await listPromotionCandidates(sourceBranch, targetBranch, this);
    const openPromotionsResult = openPromotions.map((pullRequest) => ({
      number: pullRequest.idNumber,
      title: pullRequest.title,
      sourceBranch: pullRequest.sourceBranch,
      webUrl: pullRequest.webUrl,
    }));
    if (candidates.length === 0) {
      uxLog('warning', this, c.yellow(t('promotionCreateNoCandidate', { source: sourceBranch, target: targetBranch })));
      return {
        sourceBranch,
        targetBranch,
        candidates: [],
        alreadyPromoted: [],
        openPromotions: openPromotionsResult,
        outputString: 'Nothing to promote',
      };
    }

    await logPromotionCandidatesTable(this, candidates, sourceBranch, targetBranch);
    const { promotable, alreadyPromoted } = excludeAlreadyPromotedCandidates(
      candidates,
      flags['include-already-promoted'] === true,
      this,
    );
    logPartiallyPromotedCandidates(promotable, this);
    if (openPromotions.length > 0) {
      uxLog('warning', this, c.yellow(t('promotionListCandidatesOpenPromotion', {
        source: sourceBranch,
        target: targetBranch,
        pullRequests: openPromotions.map((pullRequest) => `#${pullRequest.idNumber} ${pullRequest.webUrl}`).join(', '),
      })));
    }

    const prList = formatPullRequestNumbers(promotable.flatMap((candidate) => candidate.pullRequestNumbers));
    uxLog('success', this, c.green(t('promotionListCandidatesFound', {
      count: promotable.length,
      source: sourceBranch,
      target: targetBranch,
      prList,
    })));

    return {
      sourceBranch,
      targetBranch,
      candidates: promotable.map((candidate) => toCandidateSummary(candidate)),
      alreadyPromoted: alreadyPromoted.map((candidate) => toCandidateSummary(candidate)),
      openPromotions: openPromotionsResult,
      outputString: `${promotable.length} Pull Request(s) can be promoted from ${sourceBranch} to ${targetBranch}: ${prList}`,
    };
  }
}
