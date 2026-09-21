import { expect } from 'chai';
import NewTask from '../../../../src/commands/hardis/work/new.js';

/**
 * newTaskNameRegex is checked against the User Story name as the user typed it.
 * The normalization into a git-compatible branch name, where every space becomes
 * "-", happens only once the name is valid. Doing it the other way round made
 * every documented example unusable: "^MYPROJECT-[0-9]+ .*" can never match a
 * value whose spaces have already been replaced (issue #2223).
 *
 * The methods below are plain string work and read nothing from the command
 * instance, so the prototype is enough: building an SfCommand would need an
 * oclif Config, a git repository and an org.
 *
 * The third path, promptTaskName, is not covered here: it goes through prompts(),
 * which refuses to ask anything when CI is set, and these tests only run in CI.
 * What it does once the answer is in hand is validateAndNormalizeTaskName below.
 */
const command = Object.create(NewTask.prototype) as any;

const normalize = (taskName: string): string => command.normalizeTaskName(taskName);
const validate = (taskName: string, regex: string | null, example: string | null = null): void =>
  command.validateTaskNameOrThrow(taskName, regex, example);

// The example shipped in config/sfdx-hardis.jsonschema.json
const DOCUMENTED_REGEX = '^MYPROJECT-[0-9]+ .*';
// A project that writes its regex against the branch name shape instead
const HYPHEN_REGEX = '^US-\\d{3}-[a-z0-9-]+$';

describe('hardis:work:new User Story name', () => {
  describe('validation against newTaskNameRegex', () => {
    it('accepts the name of the issue, spaces and all', () => {
      expect(() => validate('MYPROJECT-123 test regex', DOCUMENTED_REGEX)).to.not.throw();
    });

    it('rejects a name the pattern does not describe', () => {
      // "^MYPROJECT-[0-9]+ .*" asks for a space and something after it
      expect(() => validate('MYPROJECT-123', DOCUMENTED_REGEX)).to.throw(/does not match required pattern/);
    });

    it('names the value as typed in the error, not a normalized one', () => {
      expect(() => validate('WRONG-123 my user story', DOCUMENTED_REGEX)).to.throw(
        'task-name "WRONG-123 my user story" does not match required pattern (^MYPROJECT-[0-9]+ .*). ' +
        'Example: MYPROJECT-123 Update account status validation rule'
      );
    });

    it('uses newTaskNameRegexExample in the error when the project sets one', () => {
      expect(() => validate('nope', DOCUMENTED_REGEX, 'MYPROJECT-456 Add a field')).to.throw(
        /Example: MYPROJECT-456 Add a field$/
      );
    });

    it('still accepts a regex written for the branch name shape', () => {
      expect(() => validate('US-014-panels-required', HYPHEN_REGEX)).to.not.throw();
      expect(() => validate('US-14-panels', HYPHEN_REGEX)).to.throw(/does not match required pattern/);
    });

    it('accepts anything when the project configures no regex', () => {
      expect(() => validate('whatever the user types', null)).to.not.throw();
    });
  });

  describe('normalization into a branch name', () => {
    it('turns the validated name into the branch name of the issue', () => {
      expect(normalize('MYPROJECT-123 test regex')).to.equal('MYPROJECT-123-test-regex');
    });

    it('replaces what git should not carry, and collapses the result', () => {
      expect(normalize('US-014: panels (required!)')).to.equal('US-014-panels-required');
    });

    it('leaves no dash at either end', () => {
      expect(normalize('  spaced out  ')).to.equal('spaced-out');
    });

    it('leaves a name that is already branch shaped alone', () => {
      expect(normalize('US-014-panels-required')).to.equal('US-014-panels-required');
    });
  });

  describe('--task-name, where the two meet', () => {
    const resolve = (taskName: string, regex: string | null): string =>
      command.validateAndNormalizeTaskName(taskName, regex, null);

    it('accepts the name of the issue and branches on its normalized form', () => {
      expect(resolve('MYPROJECT-123 test regex', DOCUMENTED_REGEX)).to.equal('MYPROJECT-123-test-regex');
    });

    it('checks the order, not only the two steps', () => {
      // The guard against the regression: the branch name this returns does not
      // itself match the configured pattern. Validating after normalizing, which
      // is what the command used to do, therefore rejects every valid name.
      const branchName = resolve('MYPROJECT-123 test regex', DOCUMENTED_REGEX);
      expect(new RegExp(DOCUMENTED_REGEX).test(branchName)).to.equal(false);
    });

    it('stops on a name the pattern does not describe', () => {
      expect(() => resolve('MYPROJECT-123', DOCUMENTED_REGEX)).to.throw(/does not match required pattern/);
    });

    it('normalizes anyway when the project configures no regex', () => {
      expect(resolve('US-014: panels required', null)).to.equal('US-014-panels-required');
    });
  });

  describe('--agent mode', () => {
    const agentConfig = {
      availableTargetBranches: ['integration'],
      allowedOrgTypes: ['noOrg'],
      newTaskNameRegex: DOCUMENTED_REGEX,
    };

    it('accepts a --task-name with spaces and reports the branch name', async () => {
      const inputs = await command.validateAgentInputs(
        { 'task-name': 'MYPROJECT-123 test regex', 'target-branch': 'integration' },
        agentConfig
      );
      expect(inputs.taskNameRaw).to.equal('MYPROJECT-123 test regex');
      expect(inputs.normalizedTaskName).to.equal('MYPROJECT-123-test-regex');
      expect(inputs.targetBranch).to.equal('integration');
    });

    it('refuses a --task-name the pattern does not describe, quoting it as passed', async () => {
      let error: Error | null = null;
      try {
        await command.validateAgentInputs(
          { 'task-name': 'MYPROJECT-123', 'target-branch': 'integration' },
          agentConfig
        );
      } catch (e: any) {
        error = e;
      }
      expect(error, 'an invalid task-name must stop the command').to.not.equal(null);
      expect(error?.message).to.contain('task-name "MYPROJECT-123" does not match newTaskNameRegex');
    });
  });
});
