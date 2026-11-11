/* eslint-disable @typescript-eslint/no-unused-expressions */
// The Codex AI provider runs a Codex CLI installed by the user (sfdx-hardis does not bundle it):
// how the CLI is found, the `codex exec` arguments, the JSON events, and the provider around them.
import { expect } from 'chai';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildCodexExecArgs,
  parseCodexEvents,
  resolveCodexCommand,
  runCodexExec,
  type CodexCommand,
} from '../../../src/common/aiProvider/codexCli.js';
import { CodexProvider } from '../../../src/common/aiProvider/codexProvider.js';

const FAKE_CODEX = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'codex', 'fake-codex.mjs');
const FAKE_COMMAND: CodexCommand = { command: process.execPath, prefixArgs: [FAKE_CODEX] };

describe('Codex CLI', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-cli-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('resolveCodexCommand', () => {
    it('uses CODEX_CLI_PATH when the file exists', () => {
      const exe = path.join(tmpDir, 'my-codex');
      fs.writeFileSync(exe, '');
      expect(resolveCodexCommand({ cliPath: exe, windows: false })).to.deep.equal({ command: exe, prefixArgs: [] });
    });

    it('returns null when CODEX_CLI_PATH does not exist', () => {
      expect(resolveCodexCommand({ cliPath: path.join(tmpDir, 'missing'), windows: false })).to.be.null;
    });

    it('starts a codex.js script with the current Node.js', () => {
      expect(resolveCodexCommand({ cliPath: FAKE_CODEX, windows: false })).to.deep.equal(FAKE_COMMAND);
    });

    it('finds codex in PATH', () => {
      const exe = path.join(tmpDir, 'codex');
      fs.writeFileSync(exe, '');
      fs.chmodSync(exe, 0o755);
      expect(resolveCodexCommand({ cliPath: '', path: tmpDir, windows: false })).to.deep.equal({ command: exe, prefixArgs: [] });
    });

    it('returns null when codex is not in PATH', () => {
      expect(resolveCodexCommand({ cliPath: '', path: tmpDir, windows: false })).to.be.null;
    });

    it('starts the codex.js behind a Windows npm shim with Node.js', () => {
      fs.writeFileSync(path.join(tmpDir, 'codex.cmd'), '');
      const codexJs = path.join(tmpDir, 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
      fs.mkdirSync(path.dirname(codexJs), { recursive: true });
      fs.writeFileSync(codexJs, '');
      expect(resolveCodexCommand({ cliPath: '', path: tmpDir, pathExt: '.CMD', windows: true })).to.deep.equal({
        command: process.execPath,
        prefixArgs: [codexJs],
      });
    });

    it('returns null for a Windows npm shim without its codex.js', () => {
      fs.writeFileSync(path.join(tmpDir, 'codex.cmd'), '');
      expect(resolveCodexCommand({ cliPath: '', path: tmpDir, pathExt: '.CMD', windows: true })).to.be.null;
    });
  });

  describe('buildCodexExecArgs', () => {
    it('builds read-only, non-interactive JSON arguments', () => {
      const args = buildCodexExecArgs({ model: 'gpt-5.1-codex', reasoningEffort: 'high' });
      expect(args).to.deep.equal([
        'exec', '--json', '--sandbox', 'read-only', '--skip-git-repo-check',
        '--model', 'gpt-5.1-codex',
        '--config', 'approval_policy="never"',
        '--config', 'model_reasoning_effort="high"',
      ]);
    });

    it('passes a base URL without headers as openai_base_url', () => {
      const args = buildCodexExecArgs({ model: 'm', reasoningEffort: 'low', baseUrl: 'https://proxy.example.com/v1' });
      expect(args).to.include('openai_base_url="https://proxy.example.com/v1"');
      expect(args.join(' ')).not.to.include('model_providers');
      expect(args[args.indexOf('--model') + 1]).to.equal('m');
    });

    it('routes a gateway with headers through a custom model provider', () => {
      const args = buildCodexExecArgs({
        model: 'gpt-5.1-codex',
        reasoningEffort: 'high',
        baseUrl: 'https://gw.example.com/v1',
        defaultHeaders: { 'X-Company-Auth': 'tok"en', 'x.dotted': 'v' },
      });
      expect(args[args.indexOf('--model') + 1]).to.equal('sfdx-hardis-gateway/gpt-5.1-codex');
      expect(args).to.include('model_providers.sfdx-hardis-gateway.base_url="https://gw.example.com/v1"');
      expect(args).to.include('model_providers.sfdx-hardis-gateway.wire_api="responses"');
      expect(args).to.include('model_providers.sfdx-hardis-gateway.http_headers={X-Company-Auth = "tok\\"en", "x.dotted" = "v"}');
    });
  });

  describe('parseCodexEvents', () => {
    it('returns the last agent message', () => {
      const lines = [
        '{"type":"thread.started","thread_id":"t"}',
        '{"type":"item.completed","item":{"type":"reasoning","text":"thinking"}}',
        '{"type":"item.completed","item":{"type":"agent_message","text":"first"}}',
        '',
        '{"type":"item.completed","item":{"type":"agent_message","text":"final"}}',
        '{"type":"some.future.event"}',
        '{"type":"turn.completed","usage":{}}',
      ];
      expect(parseCodexEvents(lines).finalResponse).to.equal('final');
    });

    it('throws on a failed turn', () => {
      expect(() => parseCodexEvents(['{"type":"turn.failed","error":{"message":"quota exceeded"}}'])).to.throw('quota exceeded');
    });

    it('ignores an error event when an answer came, throws it otherwise', () => {
      const retry = '{"type":"error","message":"Reconnecting... 1/5"}';
      const answer = '{"type":"item.completed","item":{"type":"agent_message","text":"ok"}}';
      expect(parseCodexEvents([retry, answer]).finalResponse).to.equal('ok');
      expect(() => parseCodexEvents([retry])).to.throw('Reconnecting');
    });

    it('throws on a line that is not JSON', () => {
      expect(() => parseCodexEvents(['not json'])).to.throw('Failed to parse Codex event');
    });
  });

  describe('runCodexExec', () => {
    it('sends the prompt on stdin and returns the answer', async () => {
      const result = await runCodexExec(FAKE_COMMAND, ['exec', '--json'], 'hello', { ...process.env, CODEX_API_KEY: 'sk-1' });
      const answer = JSON.parse(result.finalResponse);
      expect(answer).to.deep.equal({ prompt: 'hello', args: ['exec', '--json'], apiKey: 'sk-1' });
    });

    it('throws with stderr when the CLI exits with an error', async () => {
      let error: Error | null = null;
      try {
        await runCodexExec(FAKE_COMMAND, [], 'fail');
      } catch (e) {
        error = e as Error;
      }
      expect(error?.message).to.equal('Codex CLI exited with code 3: boom');
    });

    it("throws the failed turn message rather than the stderr logs", async () => {
      let error: Error | null = null;
      try {
        await runCodexExec(FAKE_COMMAND, [], 'turn-failed');
      } catch (e) {
        error = e as Error;
      }
      expect(error?.message).to.equal('quota exceeded');
    });
  });
});

describe('CodexProvider with the Codex CLI', () => {
  const MANAGED_ENV_VARS = ['USE_CODEX_DIRECT', 'CODEX_API_KEY', 'CODEX_CLI_PATH', 'CODEX_MODEL', 'CODEX_BASE_URL', 'CODEX_DEFAULT_HEADERS', 'PATH', 'Path'];
  const savedEnv: Record<string, string | undefined> = {};
  let emptyDir: string;

  beforeEach(() => {
    for (const envVar of MANAGED_ENV_VARS) {
      savedEnv[envVar] = process.env[envVar];
      delete process.env[envVar];
    }
    emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-empty-path-'));
    process.env.PATH = emptyDir;
    process.env.USE_CODEX_DIRECT = 'true';
    process.env.CODEX_API_KEY = 'sk-test';
  });

  afterEach(() => {
    for (const envVar of MANAGED_ENV_VARS) {
      if (savedEnv[envVar] === undefined) {
        delete process.env[envVar];
      } else {
        process.env[envVar] = savedEnv[envVar];
      }
    }
    fs.rmSync(emptyDir, { recursive: true, force: true });
  });

  it('cannot be created without a Codex CLI, and says how to install it', async () => {
    let error: Error | null = null;
    try {
      await CodexProvider.create();
    } catch (e) {
      error = e as Error;
    }
    expect(error?.message).to.include('npm install -g @openai/codex');
    expect(error?.message).to.include('CODEX_CLI_PATH');
  });

  it('does not ask for a Codex key without a Codex CLI', async () => {
    delete process.env.CODEX_API_KEY;
    expect(await CodexProvider.shouldPromptForApiKey()).to.be.false;
  });

  it('prompts through the Codex CLI found with CODEX_CLI_PATH', async () => {
    process.env.CODEX_CLI_PATH = FAKE_CODEX;
    process.env.CODEX_MODEL = 'gpt-test';
    const provider = await CodexProvider.create();
    const response = await provider.promptAi('Describe this flow');
    expect(response?.success).to.be.true;
    expect(response?.model).to.equal('gpt-test');
    const answer = JSON.parse(response?.promptResponse as string);
    expect(answer.prompt).to.equal('Describe this flow');
    expect(answer.apiKey).to.equal('sk-test');
    expect(answer.args).to.include('gpt-test');
  });
});
