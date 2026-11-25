import { expect } from 'chai';
import fs from '../../../src/common/utils/fsUtils.js';
import * as path from 'path';
import * as yaml from 'js-yaml';
import {
  buildInputEnvVarName,
  findActionsUsingCustomFunction,
  getSecretInputNames,
  isBuiltInActionType,
  parseCustomFunctionOutputs,
  readCustomFunctionsFromProjectFile,
  resolveRuntimeInterpreter,
  validateCustomFunctionDefinition,
  writeCustomFunctionsToProjectFile,
} from '../../../src/common/utils/customFunctionUtils.js';
import { parseInputsFlag, parseOutputsFlag, parseFunctionInputFlags } from '../../../src/common/utils/customFunctionFlagUtils.js';
import { setupTmpDir } from './actionTestHelper.js';

describe('customFunctionUtils', () => {
  setupTmpDir('sfdx-hardis-custom-functions');

  async function writeScript(scriptPath: string): Promise<string> {
    await fs.ensureDir(path.dirname(scriptPath));
    await fs.writeFile(scriptPath, '// test script');
    return scriptPath;
  }

  describe('validateCustomFunctionDefinition', () => {
    it('accepts a complete definition', async () => {
      const script = await writeScript(path.join('scripts', 'functions', 'ok.js'));
      const errors = validateCustomFunctionDefinition({
        id: 'notifySlack',
        label: 'Notify Slack',
        runtime: 'node',
        script,
        inputs: [{ name: 'channel', type: 'string', required: true }],
        outputs: [{ name: 'messageId' }],
      });
      expect(errors).to.deep.equal([]);
    });

    it('rejects a missing id, label, runtime and script', () => {
      const errors = validateCustomFunctionDefinition({});
      expect(errors).to.have.length(4);
    });

    it('rejects an id colliding with a built-in action type', async () => {
      const script = await writeScript(path.join('scripts', 'f.js'));
      const errors = validateCustomFunctionDefinition({ id: 'apex', label: 'X', runtime: 'node', script });
      expect(errors.join(' ')).to.match(/apex/);
    });

    it('rejects a duplicate id', async () => {
      const script = await writeScript(path.join('scripts', 'f.js'));
      const existing = [{ id: 'notifySlack', runtime: 'node' as const, script }];
      const errors = validateCustomFunctionDefinition({ id: 'notifySlack', label: 'X', runtime: 'node', script }, existing);
      expect(errors.join(' ')).to.match(/notifySlack/);
    });

    it('rejects an id that is not a safe identifier', async () => {
      const script = await writeScript(path.join('scripts', 'f.js'));
      const errors = validateCustomFunctionDefinition({ id: '1bad id!', label: 'X', runtime: 'node', script });
      expect(errors).to.have.length.greaterThan(0);
    });

    it('rejects an unknown runtime', async () => {
      const script = await writeScript(path.join('scripts', 'f.js'));
      const errors = validateCustomFunctionDefinition({ id: 'a', label: 'X', runtime: 'ruby' as any, script });
      expect(errors.join(' ')).to.match(/ruby/);
    });

    it('rejects a script file that does not exist', () => {
      const errors = validateCustomFunctionDefinition({ id: 'a', label: 'X', runtime: 'node', script: 'scripts/nope.js' });
      expect(errors.join(' ')).to.match(/nope\.js/);
    });

    it('rejects an invalid timeout', async () => {
      const script = await writeScript(path.join('scripts', 'f.js'));
      const errors = validateCustomFunctionDefinition({ id: 'a', label: 'X', runtime: 'node', script, timeout: -1 });
      expect(errors.join(' ')).to.match(/-1/);
    });

    it('rejects duplicate input names, case-insensitively', async () => {
      const script = await writeScript(path.join('scripts', 'f.js'));
      const errors = validateCustomFunctionDefinition({
        id: 'a', label: 'X', runtime: 'node', script,
        inputs: [{ name: 'channel' }, { name: 'CHANNEL' }],
      });
      expect(errors.join(' ')).to.match(/CHANNEL/i);
    });

    it('rejects a select input without options', async () => {
      const script = await writeScript(path.join('scripts', 'f.js'));
      const errors = validateCustomFunctionDefinition({
        id: 'a', label: 'X', runtime: 'node', script,
        inputs: [{ name: 'severity', type: 'select' }],
      });
      expect(errors.join(' ')).to.match(/severity/);
    });

    it('rejects an unknown input type', async () => {
      const script = await writeScript(path.join('scripts', 'f.js'));
      const errors = validateCustomFunctionDefinition({
        id: 'a', label: 'X', runtime: 'node', script,
        inputs: [{ name: 'x', type: 'date' as any }],
      });
      expect(errors.join(' ')).to.match(/date/);
    });

    it('rejects duplicate output names', async () => {
      const script = await writeScript(path.join('scripts', 'f.js'));
      const errors = validateCustomFunctionDefinition({
        id: 'a', label: 'X', runtime: 'node', script,
        outputs: [{ name: 'id' }, { name: 'id' }],
      });
      expect(errors.join(' ')).to.match(/id/);
    });
  });

  describe('parseCustomFunctionOutputs', () => {
    const declared = [{ name: 'messageId' }];

    it('reads the JSON object of the last line and keeps the rest as log', () => {
      const result = parseCustomFunctionOutputs('doing things\nalmost done\n{"messageId":"42"}', declared);
      expect(result.error).to.equal(undefined);
      expect(result.outputs).to.deep.equal({ messageId: '42' });
      expect(result.logOutput).to.equal('doing things\nalmost done');
    });

    it('ignores trailing blank lines', () => {
      const result = parseCustomFunctionOutputs('log\n{"messageId":"42"}\n\n  \n', declared);
      expect(result.outputs).to.deep.equal({ messageId: '42' });
    });

    it('returns the whole stdout as log when the function declares no output', () => {
      const result = parseCustomFunctionOutputs('just logging\nmore', []);
      expect(result.error).to.equal(undefined);
      expect(result.outputs).to.deep.equal({});
      expect(result.logOutput).to.equal('just logging\nmore');
    });

    it('reports a last line that is not JSON', () => {
      const result = parseCustomFunctionOutputs('log\nall good', declared);
      expect(result.error).to.match(/JSON/i);
    });

    it('reports a last line that is a JSON array', () => {
      const result = parseCustomFunctionOutputs('["a"]', declared);
      expect(result.error).to.match(/object/i);
    });

    it('reports declared outputs the script did not return', () => {
      const result = parseCustomFunctionOutputs('{"other":"1"}', declared);
      expect(result.error).to.match(/messageId/);
    });

    it('reports an empty stdout when outputs are declared', () => {
      const result = parseCustomFunctionOutputs('   \n  ', declared);
      expect(result.error).to.match(/stdout/i);
    });
  });

  describe('resolveRuntimeInterpreter', () => {
    it('resolves node to the interpreter running the tests', () => {
      const resolved = resolveRuntimeInterpreter('node');
      expect(resolved?.interpreter).to.equal(process.execPath);
    });

    it('reports the candidates it tried for python', () => {
      const resolved = resolveRuntimeInterpreter('python');
      // python may or may not be installed on the machine running the tests
      if (resolved) {
        expect(resolved.tried).to.deep.equal(['python3', 'python']);
      } else {
        expect(resolved).to.equal(null);
      }
    });
  });

  describe('project file read and write', () => {
    it('writes then reads back the catalog', async () => {
      const script = await writeScript(path.join('scripts', 'f.js'));
      const definition = { id: 'a', label: 'A', runtime: 'node' as const, script };
      const configFile = await writeCustomFunctionsToProjectFile([definition]);
      expect(configFile).to.equal(path.join('config', '.sfdx-hardis.yml'));
      expect(await readCustomFunctionsFromProjectFile()).to.deep.equal([definition]);
    });

    it('preserves the other keys of the config file', async () => {
      const configFile = path.join('config', '.sfdx-hardis.yml');
      await fs.ensureDir('config');
      await fs.writeFile(configFile, yaml.dump({ developmentBranch: 'integration' }));
      const script = await writeScript(path.join('scripts', 'f.js'));
      await writeCustomFunctionsToProjectFile([{ id: 'a', runtime: 'node', script }]);
      const doc: any = yaml.load(fs.readFileSync(configFile, 'utf-8'));
      expect(doc.developmentBranch).to.equal('integration');
      expect(doc.customFunctions).to.have.length(1);
    });

    it('removes the property entirely when the last function is deleted', async () => {
      const script = await writeScript(path.join('scripts', 'f.js'));
      await writeCustomFunctionsToProjectFile([{ id: 'a', runtime: 'node', script }]);
      await writeCustomFunctionsToProjectFile([]);
      const doc: any = yaml.load(fs.readFileSync(path.join('config', '.sfdx-hardis.yml'), 'utf-8'));
      expect(doc.customFunctions).to.equal(undefined);
    });

    it('returns an empty list when no config file exists', async () => {
      expect(await readCustomFunctionsFromProjectFile()).to.deep.equal([]);
    });
  });

  describe('findActionsUsingCustomFunction', () => {
    it('finds usages in project, branch and pull request configs', async () => {
      await fs.ensureDir(path.join('config', 'branches'));
      await fs.ensureDir(path.join('scripts', 'actions'));
      await fs.writeFile(path.join('config', '.sfdx-hardis.yml'), yaml.dump({
        commandsPreDeploy: [{ id: 'p1', label: 'Project one', type: 'notifySlack' }],
      }));
      await fs.writeFile(path.join('config', 'branches', '.sfdx-hardis.uat.yml'), yaml.dump({
        commandsPostDeploy: [{ id: 'b1', label: 'Branch one', type: 'notifySlack' }],
      }));
      await fs.writeFile(path.join('scripts', 'actions', '.sfdx-hardis.482.yml'), yaml.dump({
        commandsPostDeploy: [{ id: 'r1', label: 'Pr one', type: 'somethingElse' }],
      }));
      const usages = await findActionsUsingCustomFunction('notifySlack');
      expect(usages.map((usage) => usage.actionId).sort()).to.deep.equal(['b1', 'p1']);
    });

    it('returns an empty list when nothing uses the function', async () => {
      expect(await findActionsUsingCustomFunction('notifySlack')).to.deep.equal([]);
    });
  });

  describe('helpers', () => {
    it('builds the input env var name', () => {
      expect(buildInputEnvVarName('webhookToken')).to.equal('SFDX_HARDIS_IN_WEBHOOKTOKEN');
    });

    it('lists the secret input names', () => {
      const names = getSecretInputNames({
        id: 'a', runtime: 'node', script: 'x',
        inputs: [{ name: 'channel', type: 'string' }, { name: 'token', type: 'secret' }],
      });
      expect(names).to.deep.equal(['token']);
    });

    it('knows the built-in action types', () => {
      expect(isBuiltInActionType('apex')).to.equal(true);
      expect(isBuiltInActionType('notifySlack')).to.equal(false);
    });
  });

  describe('flag parsers', () => {
    it('parses a full input declaration', () => {
      const inputs = parseInputsFlag('channel:string:required;severity:select|info,warning,critical=info;retries:number=3');
      expect(inputs).to.deep.equal([
        { name: 'channel', type: 'string', required: true },
        { name: 'severity', type: 'select', options: ['info', 'warning', 'critical'], default: 'info' },
        { name: 'retries', type: 'number', default: 3 },
      ]);
    });

    it('casts a boolean default', () => {
      expect(parseInputsFlag('dryRun:boolean=true')[0].default).to.equal(true);
      expect(parseInputsFlag('dryRun:boolean=no')[0].default).to.equal(false);
    });

    it('keeps a default value containing a colon', () => {
      const inputs = parseInputsFlag('url:string=https://example.com/a:b');
      expect(inputs[0].default).to.equal('https://example.com/a:b');
    });

    it('parses an output declaration', () => {
      expect(parseOutputsFlag('messageId;permalink:string')).to.deep.equal([
        { name: 'messageId' },
        { name: 'permalink', type: 'string' },
      ]);
    });

    it('returns an empty list for an empty flag', () => {
      expect(parseInputsFlag('')).to.deep.equal([]);
      expect(parseOutputsFlag('')).to.deep.equal([]);
    });

    it('parses repeatable --function-input values', () => {
      const parameters = parseFunctionInputFlags(['channel=#releases', 'severity=critical']);
      expect(parameters).to.deep.equal({ channel: '#releases', severity: 'critical' });
    });

    it('keeps an = inside a --function-input value', () => {
      const parameters = parseFunctionInputFlags(['query=SELECT Id FROM Account WHERE Name=\'A\'']);
      expect(parameters.query).to.equal("SELECT Id FROM Account WHERE Name='A'");
    });

    it('ignores a --function-input value without a name', () => {
      expect(parseFunctionInputFlags(['=novalue', 'noequals'])).to.deep.equal({});
    });
  });
});
