import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { CommonPullRequestInfo, PullRequestCommitInfo } from '../../../src/common/gitProvider/index.js';
import type { PromotionCandidate } from '../../../src/common/utils/promotionCreateUtils.js';

/**
 * A throwaway repository holding the ways a story reaches UAT from INT without a promotion branch,
 * and a fake git provider answering from it, for the detectManualCherryPicks tests:
 *
 * - A: picked with -x into release/1, squash-merged into UAT (#101)
 * - B: picked with -x into release/2, merged into UAT with a merge commit (#102)
 * - C: picked with -x straight onto UAT, then UAT is back-merged into INT (the pick is now before
 *   the merge base)
 * - D: only in INT when hotfix/h is branched from INT; the hotfix (#104) is squash-merged into UAT
 *   (only with `withHotfix`)
 * - E: never picked
 * - F: two commits, only the first one picked with -x straight onto UAT, after the back-merge
 */
export interface ManualCherryPickFixture {
  repo: string;
  mergeBase: string;
  candidates: () => PromotionCandidate[];
  gitProvider: {
    listPullRequests: (filters: any) => Promise<CommonPullRequestInfo[]>;
    listPullRequestCommits: (prNumber: number) => Promise<PullRequestCommitInfo[]>;
  };
  // How many times the provider was asked for the commits of each Pull Request
  commitCalls: Map<number, number>;
  commits: Record<string, string>;
  cleanup: () => void;
}

export function buildManualCherryPickFixture(options: { withHotfix: boolean }): ManualCherryPickFixture {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'manual-cherry-picks-'));
  const git = (args: string[]): string => {
    const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
    if (result.status !== 0) {
      throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
    }
    return result.stdout.trim();
  };
  const head = () => git(['rev-parse', 'HEAD']);
  const commitFile = (file: string, content: string, message: string) => {
    fs.writeFileSync(path.join(repo, file), content);
    git(['add', file]);
    git(['commit', '-m', message]);
    return head();
  };
  const commits: Record<string, string> = {};

  git(['init', '-b', 'UAT']);
  git(['config', 'user.email', 'test@example.invalid']);
  git(['config', 'user.name', 'Test']);
  git(['config', 'commit.gpgsign', 'false']);
  commitFile('base.txt', 'base\n', 'base');
  git(['branch', 'INT']);

  const story = (name: string, number: number, files: string[]) => {
    git(['checkout', '-q', '-b', `feature/${name}`, 'INT']);
    files.forEach((file, index) => {
      commits[`${name}${index + 1}`] = commitFile(file, `${file}\n`, `story ${name} part ${index + 1}`);
    });
    git(['checkout', '-q', 'INT']);
    git(['merge', '--no-ff', `feature/${name}`, '-m', `Merge feature/${name} (#${number})`]);
    commits[`m${name.toUpperCase()}`] = head();
  };
  story('a', 1, ['a.txt']);
  story('b', 2, ['b.txt']);
  story('c', 3, ['c.txt']);
  story('d', 4, ['d.txt']);

  // A: release/1, squashed
  git(['checkout', '-q', '-b', 'release/1', 'UAT']);
  git(['cherry-pick', '-x', commits.a1]);
  git(['checkout', '-q', 'UAT']);
  git(['merge', '--squash', 'release/1']);
  git(['commit', '-m', 'Release 1 (#101)']);
  commits.s101 = head();
  // B: release/2, merge commit
  git(['checkout', '-q', '-b', 'release/2', 'UAT']);
  git(['cherry-pick', '-x', commits.b1]);
  git(['checkout', '-q', 'UAT']);
  git(['merge', '--no-ff', 'release/2', '-m', 'Merge release/2 (#102)']);
  commits.m102 = head();
  // C: straight onto UAT
  git(['cherry-pick', '-x', commits.c1]);
  commits.t3 = head();
  // Back-merge: the merge base moves past every pick above
  git(['checkout', '-q', 'INT']);
  git(['merge', '--no-ff', 'UAT', '-m', 'Merge UAT into INT']);
  commits.backMerge = head();

  story('e', 5, ['e.txt']);
  story('f', 6, ['f1.txt', 'f2.txt']);
  git(['checkout', '-q', 'UAT']);
  git(['cherry-pick', '-x', commits.f1]);
  commits.t6 = head();

  if (options.withHotfix) {
    // D: dragged by a hotfix branched from INT, squashed into UAT, with a fix of its own
    git(['checkout', '-q', '-b', 'hotfix/h', commits.backMerge]);
    commits.h1 = commitFile('h.txt', 'h\n', 'hotfix of its own');
    git(['checkout', '-q', 'UAT']);
    git(['merge', '--squash', 'hotfix/h']);
    git(['commit', '-m', 'Hotfix (#104)']);
    commits.s104 = head();
  }

  git(['update-ref', 'refs/remotes/origin/UAT', 'UAT']);
  git(['update-ref', 'refs/remotes/origin/INT', 'INT']);
  const mergeBase = git(['merge-base', 'origin/UAT', 'origin/INT']);

  const pullRequests: CommonPullRequestInfo[] = [
    ...(options.withHotfix ? [pullRequestInfo(104, 'hotfix/h', commits.s104)] : []),
    pullRequestInfo(102, 'release/2', commits.m102),
    pullRequestInfo(101, 'release/1', commits.s101),
  ];
  // What a provider answers: the commits the Pull Request held, its head branch minus the target
  // branch as it was before the merge
  const heldCommits: Record<number, [string, string]> = {
    101: ['release/1', `${commits.s101}^1`],
    102: [`${commits.m102}^2`, `${commits.m102}^1`],
    104: ['hotfix/h', `${commits.s104 || 'HEAD'}^1`],
  };
  const commitCalls = new Map<number, number>();
  const gitProvider = {
    listPullRequests: async () => pullRequests,
    listPullRequestCommits: async (prNumber: number): Promise<PullRequestCommitInfo[]> => {
      commitCalls.set(prNumber, (commitCalls.get(prNumber) || 0) + 1);
      const [tip, base] = heldCommits[prNumber];
      return git(['log', '--format=%H%x1f%P%x1f%B%x1e', tip, '--not', base])
        .split('\x1e')
        .map((record) => record.trim())
        .filter((record) => record)
        .map((record) => {
          const [sha, parents, message] = record.split('\x1f');
          return { sha, message, parentShas: parents.split(' ').filter((parent) => parent) };
        });
    },
  };

  const candidates = (): PromotionCandidate[] => {
    const stories: Array<[string, number]> = [['mA', 1], ['mB', 2], ['mC', 3], ['mD', 4], ['mE', 5], ['mF', 6]];
    return stories.map(([key, number]) => ({
      group: {
        commit: { hash: commits[key], message: `Merge ${number}`, author: 'Test', date: git(['show', '-s', '--format=%cI', commits[key]]) },
        associatedPrs: [{ id: number, title: `Story ${number}`, author: 'Test', webUrl: '', sourceBranch: `feature/${number}` }],
        prConfigs: [],
      },
      pullRequestNumbers: [number],
      label: `#${number}`,
    }));
  };

  return {
    repo,
    mergeBase,
    candidates,
    gitProvider,
    commitCalls,
    commits,
    cleanup: () => fs.rmSync(repo, { recursive: true, force: true }),
  };
}

function pullRequestInfo(idNumber: number, sourceBranch: string, mergeCommitSha: string): CommonPullRequestInfo {
  return {
    idNumber,
    idStr: `#${idNumber}`,
    targetBranch: 'UAT',
    sourceBranch,
    title: sourceBranch,
    description: '',
    authorName: 'Test',
    webUrl: `https://github.example.com/pull/${idNumber}`,
    mergeCommitSha,
    customBehaviors: {},
    providerInfo: {},
  };
}
