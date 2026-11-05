import { expect } from 'chai';
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  cherryPickCandidates,
  setConflictQuestionAnswererForTests,
  type PromotionCandidate,
} from '../../../src/common/utils/promotionCreateUtils.js';

/**
 * Every answer to a cherry-pick conflict of hardis:project:promotion:create, run for real in a
 * repository built for each test: the promotion branch starts from preprod, whose hotfix changed
 * the same lines as the stories of uat. Assembling a promotion rewrites a branch that will be
 * deployed to an org, so each answer is checked on what git really did, not on what the code
 * meant to do.
 */

const PROMOTION_BRANCH = 'promotion/uat/preprod/test';
const PREVIOUS_BRANCH = 'preprod';

interface ConflictRepository {
  dir: string;
  hooksDir: string;
  git: (args: string[]) => { status: number | null; stdout: string; stderr: string };
  read: (file: string) => string;
  write: (file: string, content: string) => void;
  story: (index: number) => PromotionCandidate;
}

/**
 * - A.xml and B.xml: story 1 changes A, story 2 changes B, the preprod hotfix changes both
 * - C.cls (`deletedOnTarget`): story 3 changes it, preprod deleted it
 * - D.xml (`deletedBySource`): story 4 deletes it, preprod changed it
 * - `failingHooks`: a pre-commit hook refusing every commit, installed the way Husky does it
 */
function buildRepository(options: { deletedOnTarget?: boolean; deletedBySource?: boolean; failingHooks?: boolean } = {}): ConflictRepository {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'promo-answers-'));
  // Outside the working tree, so no git add can commit the hooks themselves
  const hooksDir = `${dir}-hooks`;
  const run = (args: string[]) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  const write = (file: string, content: string) => fs.writeFileSync(path.join(dir, file), content);
  const read = (file: string) => fs.readFileSync(path.join(dir, file), 'utf8').replace(/\r\n/g, '\n');
  run(['init', '-q', '-b', 'preprod']);
  run(['config', 'user.email', 'test@example.invalid']);
  run(['config', 'user.name', 'Test']);
  run(['config', 'core.autocrlf', 'false']);
  write('A.xml', '<a>\n<label>base</label>\n</a>\n');
  write('B.xml', '<b>\n<v>base</v>\n</b>\n');
  if (options.deletedOnTarget) {
    write('C.cls', 'base\n');
  }
  if (options.deletedBySource) {
    write('D.xml', '<d>base</d>\n');
  }
  run(['add', '-A']);
  run(['commit', '-qm', 'base']);
  const hashes: string[] = [];
  run(['checkout', '-q', '-b', 'uat']);
  write('A.xml', '<a>\n<label>story 1</label>\n</a>\n');
  run(['commit', '-qam', 'story 1']);
  hashes.push(run(['rev-parse', 'HEAD']).stdout.trim());
  write('B.xml', '<b>\n<v>story 2</v>\n</b>\n');
  run(['commit', '-qam', 'story 2']);
  hashes.push(run(['rev-parse', 'HEAD']).stdout.trim());
  // Story 3 and story 4 keep their numbers whichever of them the repository holds
  if (options.deletedOnTarget) {
    write('C.cls', 'story 3\n');
    run(['commit', '-qam', 'story 3']);
  }
  hashes.push(options.deletedOnTarget ? run(['rev-parse', 'HEAD']).stdout.trim() : '');
  if (options.deletedBySource) {
    run(['rm', '-q', 'D.xml']);
    run(['commit', '-qm', 'story 4']);
  }
  hashes.push(options.deletedBySource ? run(['rev-parse', 'HEAD']).stdout.trim() : '');
  run(['checkout', '-q', 'preprod']);
  write('A.xml', '<a>\n<label>hotfix</label>\n</a>\n');
  write('B.xml', '<b>\n<v>hotfix</v>\n</b>\n');
  if (options.deletedOnTarget) {
    run(['rm', '-q', 'C.cls']);
  }
  if (options.deletedBySource) {
    write('D.xml', '<d>hotfix</d>\n');
  }
  run(['commit', '-qam', 'hotfix']);
  if (options.failingHooks) {
    fs.mkdirSync(hooksDir);
    fs.writeFileSync(path.join(hooksDir, 'pre-commit'), '#!/bin/sh\necho "lint failed" >&2\nexit 1\n', { mode: 0o755 });
    run(['config', 'core.hooksPath', hooksDir.replace(/\\/g, '/')]);
  }
  run(['checkout', '-q', '-b', PROMOTION_BRANCH]);
  process.chdir(dir);
  return {
    dir,
    hooksDir,
    git: run,
    read,
    write,
    story: (index: number) =>
      ({ label: `#48${index} story ${index}`, group: { commit: { hash: hashes[index - 1] } } }) as unknown as PromotionCandidate,
  };
}

// Answers the conflict questions in order: a value, or a function that acts on the repository
// (solves a file, commits from outside...) and returns the value
type Answer = string | ((question: any) => string);
function answerWith(answers: Answer[]) {
  const asked: any[] = [];
  setConflictQuestionAnswererForTests(async (question) => {
    asked.push(question);
    const answer = answers.shift();
    if (answer === undefined) {
      throw new Error(`Unexpected question: ${question.message}`);
    }
    return typeof answer === 'function' ? answer(question) : answer;
  });
  return asked;
}

const isSolveQuestion = (question: any) => (question.choices || []).some((choice: any) => choice.value === 'solved');

describe('Promotion conflict answers, in a real repository', () => {
  const commandThis = {} as any;
  let repo: ConflictRepository;
  let previousCwd = '';

  beforeEach(() => {
    previousCwd = process.cwd();
  });

  afterEach(() => {
    setConflictQuestionAnswererForTests(null);
    process.chdir(previousCwd);
    for (const dir of [repo?.dir, repo?.hooksDir]) {
      if (dir) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  const branchHead = (ref: string) => repo.git(['rev-parse', ref]).stdout.trim();
  const commitsAddedToPromotion = () => Number(repo.git(['rev-list', '--count', `${PREVIOUS_BRANCH}..HEAD`]).stdout.trim());
  const cherryPickInProgress = () => repo.git(['rev-parse', '-q', '--verify', 'CHERRY_PICK_HEAD']).status === 0;

  describe('given by --on-conflict', () => {
    it('skip: leaves every conflicting story out, and the branch exactly as the target branch', async () => {
      repo = buildRepository();
      const outcome = await cherryPickCandidates([repo.story(1), repo.story(2)], PROMOTION_BRANCH, PREVIOUS_BRANCH, 'skip', false, commandThis);
      expect(outcome.skipped.map((candidate) => candidate.label)).to.deep.equal(['#481 story 1', '#482 story 2']);
      expect(outcome.picked).to.deep.equal([]);
      expect(branchHead('HEAD')).to.equal(branchHead(PREVIOUS_BRANCH));
      expect(cherryPickInProgress()).to.equal(false);
      expect(repo.git(['status', '--porcelain']).stdout.trim()).to.equal('');
    });

    it('abort: undoes the whole promotion, back on the previous branch, the promotion branch deleted', async () => {
      repo = buildRepository();
      let error: Error | null = null;
      try {
        await cherryPickCandidates([repo.story(1)], PROMOTION_BRANCH, PREVIOUS_BRANCH, 'abort', false, commandThis);
      } catch (e) {
        error = e as Error;
      }
      expect(error).to.not.equal(null);
      expect(repo.git(['branch', '--show-current']).stdout.trim()).to.equal(PREVIOUS_BRANCH);
      expect(repo.git(['branch', '--list', PROMOTION_BRANCH]).stdout.trim()).to.equal('');
      expect(cherryPickInProgress()).to.equal(false);
    });

    it('agent mode without --on-conflict: aborts, naming the story and the file', async () => {
      repo = buildRepository();
      let error: Error | null = null;
      try {
        await cherryPickCandidates([repo.story(1)], PROMOTION_BRANCH, PREVIOUS_BRANCH, null, true, commandThis);
      } catch (e) {
        error = e as Error;
      }
      expect(error?.message).to.contain('#481 story 1');
      expect(error?.message).to.contain('A.xml');
      expect(repo.git(['branch', '--list', PROMOTION_BRANCH]).stdout.trim()).to.equal('');
    });

    it('commit-with-markers: flags a file deleted on the target branch, which carries no marker', async () => {
      repo = buildRepository({ deletedOnTarget: true });
      const outcome = await cherryPickCandidates([repo.story(3)], PROMOTION_BRANCH, PREVIOUS_BRANCH, 'commit-with-markers', false, commandThis);
      expect(outcome.conflicted).to.have.length(1);
      expect(outcome.conflicted[0].files).to.deep.equal(['C.cls']);
      expect(outcome.conflicted[0].noMarkerFiles).to.deep.equal(['C.cls']);
      // Committed as the story has it: nothing in the file tells the conflict
      expect(repo.read('C.cls')).to.equal('story 3\n');
      expect(commitsAddedToPromotion()).to.equal(1);
    });
  });

  describe('answered in the prompt', () => {
    it('commit-with-markers-all: asks once, then commits every following conflict with its markers', async () => {
      repo = buildRepository();
      const asked = answerWith(['commit-with-markers-all']);
      const outcome = await cherryPickCandidates([repo.story(1), repo.story(2)], PROMOTION_BRANCH, PREVIOUS_BRANCH, null, false, commandThis);
      expect(asked).to.have.length(1);
      // The answers in the order to consider them: the recommended one first, undoing everything last
      expect(asked[0].choices.map((choice: any) => choice.value).filter((value: string) => value !== 'exitNow')).to.deep.equal([
        'commit-with-markers-all',
        'commit-with-markers',
        'solve-now',
        'skip',
        'take-source',
        'take-source-all',
        'abort',
      ]);
      expect(outcome.conflicted.map((entry) => entry.files)).to.deep.equal([['A.xml'], ['B.xml']]);
      expect(repo.read('A.xml')).to.match(/^<<<<<<< /m);
      expect(repo.read('B.xml')).to.match(/^<<<<<<< /m);
      expect(commitsAddedToPromotion()).to.equal(2);
      expect(repo.git(['status', '--porcelain']).stdout.trim()).to.equal('');
    });

    it('take-source-all: asks once, keeps the story side of every conflict, and reports each file', async () => {
      repo = buildRepository();
      const asked = answerWith(['take-source-all']);
      const outcome = await cherryPickCandidates([repo.story(1), repo.story(2)], PROMOTION_BRANCH, PREVIOUS_BRANCH, null, false, commandThis);
      expect(asked).to.have.length(1);
      expect(outcome.resolvedWithSource.map((entry) => entry.files)).to.deep.equal([['A.xml'], ['B.xml']]);
      expect(repo.read('A.xml')).to.equal('<a>\n<label>story 1</label>\n</a>\n');
      expect(repo.read('B.xml')).to.equal('<b>\n<v>story 2</v>\n</b>\n');
      expect(repo.git(['log', '-1', '--format=%B']).stdout).to.contain('take-source');
    });

    it('take-source-all: never asks again, a file deleted on one side included', async () => {
      repo = buildRepository({ deletedOnTarget: true, deletedBySource: true });
      const asked = answerWith(['take-source-all']);
      const outcome = await cherryPickCandidates(
        [repo.story(1), repo.story(3), repo.story(4)],
        PROMOTION_BRANCH,
        PREVIOUS_BRANCH,
        null,
        false,
        commandThis,
      );
      // One question for the three conflicts: the answer said "without asking again"
      expect(asked).to.have.length(1);
      expect(outcome.picked).to.have.length(3);
      expect(outcome.resolvedWithSource.map((entry) => entry.files)).to.deep.equal([['A.xml'], ['C.cls'], ['D.xml']]);
      // The source side, whatever it was: changed lines, a file the target deleted, a file the story deleted
      expect(repo.read('A.xml')).to.equal('<a>\n<label>story 1</label>\n</a>\n');
      expect(repo.git(['show', 'HEAD:C.cls']).stdout.replace(/\r\n/g, '\n')).to.equal('story 3\n');
      expect(fs.existsSync(path.join(repo.dir, 'D.xml'))).to.equal(false);
      expect(repo.git(['ls-files', 'D.xml']).stdout.trim()).to.equal('');
      expect(cherryPickInProgress()).to.equal(false);
      expect(repo.git(['status', '--porcelain']).stdout.trim()).to.equal('');
    });

    it('take-source: keeps the story version past a pre-commit hook refusing every commit', async () => {
      repo = buildRepository({ deletedOnTarget: true, failingHooks: true });
      const outcome = await cherryPickCandidates([repo.story(3)], PROMOTION_BRANCH, PREVIOUS_BRANCH, 'take-source', true, commandThis);
      expect(outcome.picked).to.have.length(1);
      expect(repo.git(['show', 'HEAD:C.cls']).stdout.replace(/\r\n/g, '\n')).to.equal('story 3\n');
    });

    it('solve-now: commits the resolution of the user, and nothing else', async () => {
      repo = buildRepository();
      const resolved = '<a>\n<label>hotfix and story 1</label>\n</a>\n';
      const asked = answerWith([
        'solve-now',
        () => {
          repo.write('A.xml', resolved);
          // A backup a merge tool leaves behind must not ride along
          repo.write('A.xml.orig', 'backup');
          return 'solved';
        },
      ]);
      const outcome = await cherryPickCandidates([repo.story(1)], PROMOTION_BRANCH, PREVIOUS_BRANCH, null, false, commandThis);
      expect(asked.filter(isSolveQuestion)).to.have.length(1);
      expect(outcome.picked.map((candidate) => candidate.label)).to.deep.equal(['#481 story 1']);
      expect(outcome.conflicted).to.deep.equal([]);
      expect(repo.git(['show', 'HEAD:A.xml']).stdout.replace(/\r\n/g, '\n')).to.equal(resolved);
      expect(repo.git(['show', '--name-only', '--format=', 'HEAD']).stdout.trim()).to.equal('A.xml');
      expect(repo.git(['log', '-1', '--format=%B']).stdout).to.contain(`(cherry picked from commit ${repo.story(1).group.commit.hash})`);
    });

    it('solve-now: asks again while markers are left in the files', async () => {
      repo = buildRepository();
      const asked = answerWith([
        'solve-now',
        'solved',
        () => {
          repo.write('A.xml', '<a>\n<label>story 1</label>\n</a>\n');
          return 'solved';
        },
      ]);
      const outcome = await cherryPickCandidates([repo.story(1)], PROMOTION_BRANCH, PREVIOUS_BRANCH, null, false, commandThis);
      expect(asked.filter(isSolveQuestion)).to.have.length(2);
      expect(outcome.picked).to.have.length(1);
      expect(repo.read('A.xml')).to.not.match(/^<<<<<<< /m);
    });

    it('solve-now: waits until a file deleted on the target branch is kept or deleted', async () => {
      repo = buildRepository({ deletedOnTarget: true });
      const asked = answerWith([
        'solve-now',
        // No marker in the file, but nothing decided either
        'solved',
        () => {
          // Kept: staged, as Source Control does
          repo.git(['add', 'C.cls']);
          return 'solved';
        },
      ]);
      const outcome = await cherryPickCandidates([repo.story(3)], PROMOTION_BRANCH, PREVIOUS_BRANCH, null, false, commandThis);
      expect(asked.filter(isSolveQuestion)).to.have.length(2);
      expect(outcome.picked).to.have.length(1);
      expect(repo.git(['show', 'HEAD:C.cls']).stdout.replace(/\r\n/g, '\n')).to.equal('story 3\n');
    });

    it('solve-now: accepts a cherry-pick the user committed themselves (from VS Code)', async () => {
      repo = buildRepository();
      answerWith([
        'solve-now',
        () => {
          repo.write('A.xml', '<a>\n<label>story 1</label>\n</a>\n');
          repo.git(['add', 'A.xml']);
          repo.git(['-c', 'core.editor=true', 'cherry-pick', '--continue']);
          return 'solved';
        },
      ]);
      const outcome = await cherryPickCandidates([repo.story(1)], PROMOTION_BRANCH, PREVIOUS_BRANCH, null, false, commandThis);
      expect(outcome.picked).to.have.length(1);
      // One commit: the one the user made, not a second one on top
      expect(commitsAddedToPromotion()).to.equal(1);
    });

    it('solve-now: leaves the story out when the user undid the cherry-pick themselves', async () => {
      repo = buildRepository();
      answerWith([
        'solve-now',
        () => {
          repo.git(['cherry-pick', '--abort']);
          return 'solved';
        },
      ]);
      const outcome = await cherryPickCandidates([repo.story(1)], PROMOTION_BRANCH, PREVIOUS_BRANCH, null, false, commandThis);
      expect(outcome.picked).to.deep.equal([]);
      expect(outcome.skipped).to.have.length(1);
      expect(commitsAddedToPromotion()).to.equal(0);
    });

    it('solve-now: runs the hooks of the project, and asks again when one refuses the commit', async () => {
      repo = buildRepository({ failingHooks: true });
      const asked = answerWith([
        'solve-now',
        () => {
          repo.write('A.xml', '<a>\n<label>story 1</label>\n</a>\n');
          return 'solved';
        },
        () => {
          // The user fixed what the linter refused
          fs.rmSync(path.join(repo.hooksDir, 'pre-commit'));
          return 'solved';
        },
      ]);
      const outcome = await cherryPickCandidates([repo.story(1)], PROMOTION_BRANCH, PREVIOUS_BRANCH, null, false, commandThis);
      expect(asked.filter(isSolveQuestion)).to.have.length(2);
      expect(outcome.picked).to.have.length(1);
      expect(commitsAddedToPromotion()).to.equal(1);
    });

    it('solve-now: a resolution identical to the target branch means the change is already there', async () => {
      repo = buildRepository();
      answerWith([
        'solve-now',
        () => {
          repo.write('A.xml', '<a>\n<label>hotfix</label>\n</a>\n');
          return 'solved';
        },
      ]);
      const outcome = await cherryPickCandidates([repo.story(1)], PROMOTION_BRANCH, PREVIOUS_BRANCH, null, false, commandThis);
      expect(outcome.alreadyThere).to.have.length(1);
      expect(outcome.picked).to.deep.equal([]);
      expect(commitsAddedToPromotion()).to.equal(0);
      expect(cherryPickInProgress()).to.equal(false);
    });

    it('solve-now, then commit-with-markers: the user can still change their mind', async () => {
      repo = buildRepository();
      answerWith(['solve-now', 'commit-with-markers']);
      const outcome = await cherryPickCandidates([repo.story(1)], PROMOTION_BRANCH, PREVIOUS_BRANCH, null, false, commandThis);
      expect(outcome.conflicted.map((entry) => entry.files)).to.deep.equal([['A.xml']]);
      expect(repo.read('A.xml')).to.match(/^<<<<<<< /m);
    });
  });
});
