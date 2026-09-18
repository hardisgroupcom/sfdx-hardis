import { expect } from 'chai';
import fs from '../../../src/common/utils/fsUtils.js';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { CustomFunctionAction, createMaskedLineStreamer, maskSecrets } from '../../../src/common/actionsProvider/customFunctionAction.js';
import { PrePostCommand } from '../../../src/common/actionsProvider/actionsProvider.js';
import { CustomFunctionDefinition } from '../../../src/common/utils/customFunctionUtils.js';
import { setupTmpDir } from '../utils/actionTestHelper.js';

/**
 * These tests run real node scripts through the provider, so they cover the whole contract:
 * env vars in, exit code and stdout out.
 */
describe('CustomFunctionAction', () => {
  setupTmpDir('sfdx-hardis-custom-function-action');

  async function declareFunction(
    definition: CustomFunctionDefinition,
    scriptBody: string
  ): Promise<void> {
    await fs.ensureDir(path.dirname(definition.script));
    await fs.writeFile(definition.script, scriptBody);
    await fs.ensureDir('config');
    await fs.writeFile(path.join('config', '.sfdx-hardis.yml'), yaml.dump({ customFunctions: [definition] }));
  }

  function buildCommand(type: string, parameters: Record<string, any> = {}): PrePostCommand {
    return {
      id: 'action-1',
      label: 'Test action',
      type,
      command: '',
      context: 'all',
      parameters,
      pipelineContext: {
        targetBranch: 'integration',
        sourceBranch: '',
        currentBranch: '',
        commitSha: '',
        repoUrl: '',
        prId: '482',
        prTitle: '',
        prUrl: '',
        prAuthor: '',
        prSourceBranch: '',
        prTargetBranch: '',
        orgUsername: '',
        orgInstanceUrl: '',
        orgId: '',
        orgAlias: '',
        isProduction: 'false',
        checkOnly: 'false',
        when: 'post-deploy',
        actionId: 'action-1',
        actionLabel: 'Test action',
        jobUrl: '',
        deploymentId: '',
      },
    };
  }

  it('runs a script, returns its outputs and keeps the rest as log', async () => {
    await declareFunction(
      {
        id: 'echoValue',
        label: 'Echo',
        runtime: 'node',
        script: path.join('scripts', 'functions', 'echo.js'),
        inputs: [{ name: 'value', type: 'string', required: true }],
        outputs: [{ name: 'echoed' }],
      },
      [
        'console.log("starting");',
        'console.log(JSON.stringify({ echoed: process.env.SFDX_HARDIS_IN_VALUE }));',
      ].join('\n')
    );

    const result = await new CustomFunctionAction().run(buildCommand('echoValue', { value: 'hello' }));
    expect(result.statusCode).to.equal('success');
    expect(result.outputs).to.deep.equal({ echoed: 'hello' });
    expect(result.output).to.equal('starting');
  });

  it('exposes the pipeline context to the script', async () => {
    await declareFunction(
      {
        id: 'readContext',
        label: 'Read context',
        runtime: 'node',
        script: path.join('scripts', 'functions', 'context.js'),
        outputs: [{ name: 'branch' }, { name: 'pr' }],
      },
      'console.log(JSON.stringify({ branch: process.env.SFDX_HARDIS_TARGET_BRANCH, pr: process.env.SFDX_HARDIS_PR_ID }));'
    );

    const result = await new CustomFunctionAction().run(buildCommand('readContext'));
    expect(result.statusCode).to.equal('success');
    expect(result.outputs).to.deep.equal({ branch: 'integration', pr: '482' });
  });

  it('applies the declared default of an input the action does not set', async () => {
    await declareFunction(
      {
        id: 'withDefault',
        label: 'With default',
        runtime: 'node',
        script: path.join('scripts', 'functions', 'default.js'),
        inputs: [{ name: 'severity', type: 'string', default: 'info' }],
        outputs: [{ name: 'severity' }],
      },
      'console.log(JSON.stringify({ severity: process.env.SFDX_HARDIS_IN_SEVERITY }));'
    );

    const result = await new CustomFunctionAction().run(buildCommand('withDefault'));
    expect(result.outputs).to.deep.equal({ severity: 'info' });
  });

  it('fails when the script exits with a non-zero code', async () => {
    await declareFunction(
      { id: 'boom', label: 'Boom', runtime: 'node', script: path.join('scripts', 'functions', 'boom.js') },
      'console.error("something broke"); process.exit(3);'
    );

    const result = await new CustomFunctionAction().run(buildCommand('boom'));
    expect(result.statusCode).to.equal('failed');
    expect(result.skippedReason).to.match(/3/);
    expect(result.output).to.match(/something broke/);
  });

  it('fails when the last stdout line is not the declared JSON object', async () => {
    await declareFunction(
      {
        id: 'badContract',
        label: 'Bad contract',
        runtime: 'node',
        script: path.join('scripts', 'functions', 'bad.js'),
        outputs: [{ name: 'messageId' }],
      },
      'console.log("all done");'
    );

    const result = await new CustomFunctionAction().run(buildCommand('badContract'));
    expect(result.statusCode).to.equal('failed');
    expect(result.skippedReason).to.match(/JSON/i);
  });

  it('fails when the function is not declared', async () => {
    await fs.ensureDir('config');
    await fs.writeFile(path.join('config', '.sfdx-hardis.yml'), yaml.dump({ customFunctions: [] }));
    const result = await new CustomFunctionAction().run(buildCommand('missingFunction'));
    expect(result.statusCode).to.equal('failed');
    expect(result.skippedReason).to.match(/missingFunction/);
  });

  it('fails when the script file is gone', async () => {
    await fs.ensureDir('config');
    await fs.writeFile(path.join('config', '.sfdx-hardis.yml'), yaml.dump({
      customFunctions: [{ id: 'gone', label: 'Gone', runtime: 'node', script: 'scripts/functions/gone.js' }],
    }));
    const result = await new CustomFunctionAction().run(buildCommand('gone'));
    expect(result.statusCode).to.equal('failed');
    expect(result.skippedReason).to.match(/gone\.js/);
  });

  it('fails when a required input has no value', async () => {
    await declareFunction(
      {
        id: 'needsInput',
        label: 'Needs input',
        runtime: 'node',
        script: path.join('scripts', 'functions', 'needs.js'),
        inputs: [{ name: 'channel', type: 'string', required: true }],
      },
      'console.log("never reached");'
    );
    const result = await new CustomFunctionAction().run(buildCommand('needsInput'));
    expect(result.statusCode).to.equal('failed');
    expect(result.skippedReason).to.match(/channel/);
  });

  it('fails when the CI/CD variable of a secret input is not defined', async () => {
    await declareFunction(
      {
        id: 'needsSecret',
        label: 'Needs secret',
        runtime: 'node',
        script: path.join('scripts', 'functions', 'secret.js'),
        inputs: [{ name: 'token', type: 'secret', required: true }],
      },
      'console.log("never reached");'
    );
    const result = await new CustomFunctionAction().run(
      buildCommand('needsSecret', { token: 'A_VARIABLE_THAT_IS_NOT_DEFINED' })
    );
    expect(result.statusCode).to.equal('failed');
    expect(result.skippedReason).to.match(/A_VARIABLE_THAT_IS_NOT_DEFINED/);
  });

  it('passes the value of the CI/CD variable a secret input names, and masks it', async () => {
    process.env.TEST_CUSTOM_FUNCTION_SECRET = 'super-secret-value';
    try {
      await declareFunction(
        {
          id: 'usesSecret',
          label: 'Uses secret',
          runtime: 'node',
          script: path.join('scripts', 'functions', 'uses-secret.js'),
          inputs: [{ name: 'token', type: 'secret', required: true }],
          outputs: [{ name: 'length' }],
        },
        [
          // Printing the secret is exactly what the mask must catch
          'console.log("token is " + process.env.SFDX_HARDIS_IN_TOKEN);',
          'console.log(JSON.stringify({ length: (process.env.SFDX_HARDIS_IN_TOKEN || "").length }));',
        ].join('\n')
      );
      const result = await new CustomFunctionAction().run(
        buildCommand('usesSecret', { token: 'TEST_CUSTOM_FUNCTION_SECRET' })
      );
      expect(result.statusCode).to.equal('success');
      expect(result.outputs).to.deep.equal({ length: 'super-secret-value'.length });
      expect(result.output).to.equal('token is ****');
      expect(result.output).to.not.match(/super-secret-value/);
    } finally {
      delete process.env.TEST_CUSTOM_FUNCTION_SECRET;
    }
  });

  it('kills a script that outlives its timeout', async () => {
    await declareFunction(
      {
        id: 'slow',
        label: 'Slow',
        runtime: 'node',
        script: path.join('scripts', 'functions', 'slow.js'),
        timeout: 1,
      },
      'setTimeout(() => console.log("done"), 30000);'
    );
    const result = await new CustomFunctionAction().run(buildCommand('slow'));
    expect(result.statusCode).to.equal('failed');
    expect(result.skippedReason).to.match(/1/);
  }).timeout(20000);

  describe('createMaskedLineStreamer', () => {
    it('emits complete lines only, holding back a partial one', () => {
      const lines: string[] = [];
      const streamer = createMaskedLineStreamer((line) => lines.push(line));
      streamer.push('first\nsec');
      expect(lines).to.deep.equal(['first']);
      streamer.push('ond\n');
      expect(lines).to.deep.equal(['first', 'second']);
    });

    // A secret split across two chunks would slip past a per-chunk mask: buffering until the
    // newline is what makes masking reliable on the live log.
    it('reassembles a value split across two chunks before emitting it', () => {
      const lines: string[] = [];
      const streamer = createMaskedLineStreamer((line) => lines.push(maskSecrets(line, ['super-secret-value'])));
      streamer.push('token is super-sec');
      streamer.push('ret-value\n');
      expect(lines).to.deep.equal(['token is ****']);
    });

    it('flushes a trailing line without a newline', () => {
      const lines: string[] = [];
      const streamer = createMaskedLineStreamer((line) => lines.push(line));
      streamer.push('no newline at the end');
      expect(lines).to.deep.equal([]);
      streamer.flush();
      expect(lines).to.deep.equal(['no newline at the end']);
    });

    it('strips the carriage return of CRLF output', () => {
      const lines: string[] = [];
      const streamer = createMaskedLineStreamer((line) => lines.push(line));
      streamer.push('windows\r\n');
      expect(lines).to.deep.equal(['windows']);
    });

    it('emits nothing on flush when everything was already emitted', () => {
      const lines: string[] = [];
      const streamer = createMaskedLineStreamer((line) => lines.push(line));
      streamer.push('done\n');
      streamer.flush();
      expect(lines).to.deep.equal(['done']);
    });
  });

  describe('maskSecrets', () => {
    it('masks every occurrence of each secret', () => {
      expect(maskSecrets('a=SECRET and b=SECRET', ['SECRET'])).to.equal('a=**** and b=****');
    });

    it('leaves very short values alone, to avoid masking unrelated text', () => {
      expect(maskSecrets('a value of a', ['a'])).to.equal('a value of a');
    });

    it('tolerates an empty text and an empty secret list', () => {
      expect(maskSecrets('', ['SECRET'])).to.equal('');
      expect(maskSecrets('text', [])).to.equal('text');
    });
  });
});
