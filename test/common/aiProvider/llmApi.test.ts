/* eslint-disable @typescript-eslint/no-unused-expressions */
// The in-house LLM API clients and their settings: the requests each API receives, the text read
// back, the retries, and the AI_LLM_* names with their former LANGCHAIN_LLM_* aliases.
import { expect } from 'chai';
import { execSync } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import fs from '../../../src/common/utils/fsUtils.js';
import { setFetchForTests } from '../../../src/common/utils/httpUtils.js';
import { getConfig } from '../../../src/config/index.js';
import { OpenAiClient } from '../../../src/common/aiProvider/llmApi/clients/openAiClient.js';
import { AnthropicClient } from '../../../src/common/aiProvider/llmApi/clients/anthropicClient.js';
import { GoogleGenAiClient } from '../../../src/common/aiProvider/llmApi/clients/googleGenAiClient.js';
import { OllamaClient } from '../../../src/common/aiProvider/llmApi/clients/ollamaClient.js';
import { LlmApiError } from '../../../src/common/aiProvider/llmApi/llmClientBase.js';
import { createLlmClient } from '../../../src/common/aiProvider/llmApi/llmClientFactory.js';
import { getCodingAgentInfo } from '../../../src/common/aiProvider/llmApi/codingAgentInfo.js';
import {
  readLlmApiKeySetting,
  readLlmProviderSetting,
  resetDeprecatedNameWarningsForTests,
  resolveExplicitLlmSettings,
  resolveOpenAiShortcutSettings,
} from '../../../src/common/aiProvider/llmApi/llmApiConfig.js';
import { LlmApiProvider } from '../../../src/common/aiProvider/llmApi/llmApiProvider.js';
import { AiProvider } from '../../../src/common/aiProvider/index.js';

const MANAGED_ENV_VARS = [
  'USE_AI_LLM', 'AI_LLM_PROVIDER', 'AI_LLM_MODEL', 'AI_LLM_API_KEY', 'AI_LLM_BASE_URL', 'AI_LLM_DEFAULT_HEADERS',
  'AI_LLM_TEMPERATURE', 'AI_LLM_MAX_TOKENS', 'AI_LLM_MAX_RETRIES', 'AI_LLM_TIMEOUT',
  'USE_LANGCHAIN_LLM', 'LANGCHAIN_LLM_PROVIDER', 'LANGCHAIN_LLM_MODEL', 'LANGCHAIN_LLM_MODEL_API_KEY', 'LANGCHAIN_LLM_BASE_URL',
  'LANGCHAIN_LLM_DEFAULT_HEADERS', 'LANGCHAIN_LLM_TEMPERATURE', 'LANGCHAIN_LLM_MAX_TOKENS', 'LANGCHAIN_LLM_MAX_RETRIES', 'LANGCHAIN_LLM_TIMEOUT',
  'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_DEFAULT_HEADERS', 'OPENAI_MODEL', 'OPENAI_SERVICE_TIER', 'OPENAI_REASONING_EFFORT', 'USE_OPENAI_DIRECT',
  'USE_CODEX_DIRECT', 'CODEX_API_KEY', 'CODEX_BASE_URL', 'CODEX_DEFAULT_HEADERS', 'USE_AGENTFORCE', 'DISABLE_AI',
];

interface RecordedCall {
  url: string;
  headers: Record<string, string>;
  body: any;
}

function jsonResponse(body: any, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}

function recordCalls(responses: Array<() => Response>): RecordedCall[] {
  const calls: RecordedCall[] = [];
  let index = 0;
  setFetchForTests(async (url: string, init: any) => {
    calls.push({ url, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
    const next = responses[Math.min(index, responses.length - 1)];
    index++;
    return next();
  });
  return calls;
}

describe('LLM API clients', () => {
  afterEach(() => {
    setFetchForTests(null);
  });

  it('OpenAI chat mode calls /chat/completions with a user message', async () => {
    const calls = recordCalls([() => jsonResponse({ model: 'gpt-4o-2024', choices: [{ message: { content: 'Hello' } }] })]);
    const client = new OpenAiClient({ modelName: 'gpt-4o', apiKey: 'sk-1', temperature: 0.2, maxTokens: 100, openAiApi: 'chat' });
    const result = await client.complete('Say hello');
    expect(result).to.deep.equal({ text: 'Hello', model: 'gpt-4o-2024', emptyReason: undefined });
    expect(calls[0].url).to.equal('https://api.openai.com/v1/chat/completions');
    expect(calls[0].headers.Authorization).to.equal('Bearer sk-1');
    expect(calls[0].body).to.deep.equal({ model: 'gpt-4o', messages: [{ role: 'user', content: 'Say hello' }], temperature: 0.2, max_tokens: 100 });
  });

  it('OpenAI chat mode sends max_completion_tokens to reasoning models, and a gateway base URL and headers', async () => {
    const calls = recordCalls([() => jsonResponse({ choices: [{ message: { content: 'ok' } }] })]);
    const client = new OpenAiClient({ modelName: 'o3-mini', baseUrl: 'https://gw.example.com/v1/', defaultHeaders: { 'X-Gw': 'abc' }, maxTokens: 50 });
    const result = await client.complete('p');
    expect(result.model).to.equal('o3-mini');
    expect(calls[0].url).to.equal('https://gw.example.com/v1/chat/completions');
    expect(calls[0].headers['X-Gw']).to.equal('abc');
    expect(calls[0].headers.Authorization).to.be.undefined;
    expect(calls[0].body.max_completion_tokens).to.equal(50);
    expect(calls[0].body.max_tokens).to.be.undefined;
  });

  it('OpenAI responses mode sends the prompt as system message with service tier and reasoning effort', async () => {
    const calls = recordCalls([() => jsonResponse({
      model: 'gpt-4o-mini',
      output: [{ type: 'reasoning' }, { type: 'message', content: [{ type: 'output_text', text: 'Part 1' }, { type: 'output_text', text: ' and 2' }] }],
    })]);
    const client = new OpenAiClient({ modelName: 'gpt-4o-mini', apiKey: 'sk-1', openAiApi: 'responses', serviceTier: 'flex', reasoningEffort: 'high' });
    const result = await client.complete('Prompt');
    expect(result.text).to.equal('Part 1 and 2');
    expect(calls[0].url).to.equal('https://api.openai.com/v1/responses');
    expect(calls[0].body).to.deep.equal({
      model: 'gpt-4o-mini',
      input: [{ role: 'system', content: 'Prompt' }],
      service_tier: 'flex',
      reasoning: { effort: 'high' },
    });
  });

  it('Anthropic calls /v1/messages with its headers and a default max_tokens', async () => {
    const calls = recordCalls([() => jsonResponse({ model: 'claude-x', content: [{ type: 'thinking', thinking: '...' }, { type: 'text', text: 'Answer' }] })]);
    const client = new AnthropicClient({ modelName: 'claude-x', apiKey: 'ak' });
    const result = await client.complete('Q');
    expect(result.text).to.equal('Answer');
    expect(calls[0].url).to.equal('https://api.anthropic.com/v1/messages');
    expect(calls[0].headers['x-api-key']).to.equal('ak');
    expect(calls[0].headers['anthropic-version']).to.equal('2023-06-01');
    expect(calls[0].body).to.deep.equal({ model: 'claude-x', max_tokens: 16384, messages: [{ role: 'user', content: 'Q' }] });
  });

  it('Google GenAI calls generateContent and reports a safety block', async () => {
    const calls = recordCalls([
      () => jsonResponse({ modelVersion: 'gemini-2.5-flash', candidates: [{ content: { parts: [{ text: 'thinking', thought: true }, { text: 'Gemini says' }] } }] }),
      () => jsonResponse({ promptFeedback: { blockReason: 'SAFETY' } }),
    ]);
    const client = new GoogleGenAiClient({ modelName: 'gemini-2.5-flash', apiKey: 'gk', temperature: 0, maxTokens: 10 });
    const result = await client.complete('Q');
    expect(result.text).to.equal('Gemini says');
    expect(calls[0].url).to.equal('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
    expect(calls[0].headers['x-goog-api-key']).to.equal('gk');
    expect(calls[0].body).to.deep.equal({ contents: [{ role: 'user', parts: [{ text: 'Q' }] }], generationConfig: { temperature: 0, maxOutputTokens: 10 } });
    const blocked = await client.complete('Q');
    expect(blocked.text).to.equal('');
    expect(blocked.emptyReason).to.equal('SAFETY');
  });

  it('Ollama calls /api/chat without streaming', async () => {
    const calls = recordCalls([() => jsonResponse({ model: 'qwen', message: { role: 'assistant', content: 'Local answer' } })]);
    const client = new OllamaClient({ modelName: 'qwen', temperature: 1 });
    const result = await client.complete('Q');
    expect(result.text).to.equal('Local answer');
    expect(calls[0].url).to.equal('http://localhost:11434/api/chat');
    expect(calls[0].body).to.deep.equal({ model: 'qwen', messages: [{ role: 'user', content: 'Q' }], stream: false, options: { temperature: 1 } });
  });

  it('retries after a rate limit, with the delay the API asked for', async () => {
    const calls = recordCalls([
      () => jsonResponse({ error: { message: 'Rate limit reached' } }, 429, { 'retry-after': '0' }),
      () => jsonResponse({ error: { type: 'overloaded_error', message: 'Overloaded' } }, 529, { 'retry-after': '0' }),
      () => jsonResponse({ content: [{ type: 'text', text: 'Finally' }] }),
    ]);
    const client = new AnthropicClient({ modelName: 'claude-x', apiKey: 'ak' });
    const result = await client.complete('Q');
    expect(result.text).to.equal('Finally');
    expect(calls).to.have.length(3);
  });

  it('throws the message of the API, without retrying an authentication error', async () => {
    const calls = recordCalls([() => jsonResponse({ error: { message: 'Incorrect API key provided' } }, 401)]);
    const client = new OpenAiClient({ modelName: 'gpt-4o', apiKey: 'bad' });
    try {
      await client.complete('Q');
      expect.fail('should have thrown');
    } catch (e: any) {
      expect(e).to.be.instanceOf(LlmApiError);
      expect(e.message).to.equal('OpenAI API error 401: Incorrect API key provided');
      expect(e.status).to.equal(401);
    }
    expect(calls).to.have.length(1);
  });

  it('stops retrying after AI_LLM_MAX_RETRIES', async () => {
    const calls = recordCalls([() => jsonResponse({ error: 'busy' }, 503, { 'retry-after': '0' })]);
    const client = new OllamaClient({ modelName: 'qwen', maxRetries: 1 });
    try {
      await client.complete('Q');
      expect.fail('should have thrown');
    } catch (e: any) {
      expect(e.message).to.equal('Ollama API error 503: busy');
    }
    expect(calls).to.have.length(2);
  });

  it('checks the credentials each provider needs', () => {
    expect(() => createLlmClient('anthropic', { modelName: 'm' })).to.throw('AI_LLM_API_KEY');
    expect(() => createLlmClient('google-genai', { modelName: 'm' })).to.throw('AI_LLM_API_KEY');
    expect(() => createLlmClient('openai', { modelName: 'm' })).to.throw('gateway authentication');
    expect(() => createLlmClient('mistral', { modelName: 'm' })).to.throw('Unsupported LLM provider: mistral');
    expect(createLlmClient('openai', { modelName: 'm', baseUrl: 'https://gw', defaultHeaders: { A: 'b' } }).getLabel()).to.equal('OpenAI');
    expect(createLlmClient('ollama', { modelName: 'm' }).getLabel()).to.equal('Ollama');
  });

  it('keeps the coding agent CLI of each provider', () => {
    expect(getCodingAgentInfo('anthropic')?.command).to.equal('claude');
    expect(getCodingAgentInfo('google-genai')?.command).to.equal('gemini');
    expect(getCodingAgentInfo('openai')?.command).to.equal('codex');
    expect(getCodingAgentInfo('ollama')).to.be.null;
  });
});

describe('LLM API settings', () => {
  const savedEnv: Record<string, string | undefined> = {};
  const previousCwd = process.cwd();
  let tmpDir: string;

  beforeEach(async () => {
    for (const envVar of MANAGED_ENV_VARS) {
      savedEnv[envVar] = process.env[envVar];
      delete process.env[envVar];
    }
    resetDeprecatedNameWarningsForTests();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sfdx-hardis-llm-'));
    execSync('git init -q', { cwd: tmpDir });
    process.chdir(tmpDir);
    await writeConfig('');
  });

  afterEach(async () => {
    process.chdir(previousCwd);
    await fs.remove(tmpDir);
    for (const envVar of MANAGED_ENV_VARS) {
      if (savedEnv[envVar] === undefined) {
        delete process.env[envVar];
      } else {
        process.env[envVar] = savedEnv[envVar];
      }
    }
    await getConfig('user');
  });

  // Write config/.sfdx-hardis.yml and refresh the cached configuration
  async function writeConfig(content: string): Promise<void> {
    await fs.ensureDir(path.join(tmpDir, 'config'));
    await fs.writeFile(path.join(tmpDir, 'config', '.sfdx-hardis.yml'), content);
    await getConfig('user');
  }

  it('is not configured without provider and model', async () => {
    expect(await resolveExplicitLlmSettings()).to.be.null;
    process.env.AI_LLM_PROVIDER = 'anthropic';
    expect(await resolveExplicitLlmSettings()).to.be.null;
  });

  it('reads the AI_LLM_* environment variables', async () => {
    process.env.AI_LLM_PROVIDER = 'Anthropic';
    process.env.AI_LLM_MODEL = 'claude-x';
    process.env.AI_LLM_API_KEY = 'ak';
    process.env.AI_LLM_TEMPERATURE = '0.3';
    process.env.AI_LLM_MAX_TOKENS = '500';
    process.env.AI_LLM_MAX_RETRIES = '2';
    process.env.AI_LLM_TIMEOUT = '1000';
    process.env.AI_LLM_DEFAULT_HEADERS = '{"X-A": "b"}';
    const settings = await resolveExplicitLlmSettings();
    expect(settings).to.deep.include({
      provider: 'anthropic', modelName: 'claude-x', apiKey: 'ak', temperature: 0.3, maxTokens: 500, maxRetries: 2, timeout: 1000, openAiApi: 'chat',
    });
    expect(settings?.defaultHeaders).to.deep.equal({ 'X-A': 'b' });
  });

  it('still reads the former LANGCHAIN_LLM_* names, the new names winning', async () => {
    process.env.LANGCHAIN_LLM_PROVIDER = 'openai';
    process.env.LANGCHAIN_LLM_MODEL = 'gpt-old';
    process.env.LANGCHAIN_LLM_MODEL_API_KEY = 'old-key';
    process.env.AI_LLM_MODEL = 'gpt-new';
    const settings = await resolveExplicitLlmSettings();
    expect(settings).to.deep.include({ provider: 'openai', modelName: 'gpt-new', apiKey: 'old-key' });
    expect(readLlmApiKeySetting()).to.deep.equal({ value: 'old-key', name: 'LANGCHAIN_LLM_MODEL_API_KEY' });
    process.env.AI_LLM_API_KEY = 'new-key';
    expect(readLlmApiKeySetting()).to.deep.equal({ value: 'new-key', name: 'AI_LLM_API_KEY' });
  });

  it('reads aiLlm* config keys, then the former langchainLlm* ones, environment variables winning', async () => {
    await writeConfig('aiLlmProvider: google-genai\nlangchainLlmModel: gemini-old\nlangchainLlmTemperature: 0.5\n');
    let settings = await resolveExplicitLlmSettings();
    expect(settings).to.deep.include({ provider: 'google-genai', modelName: 'gemini-old', temperature: 0.5 });
    await writeConfig('aiLlmProvider: google-genai\naiLlmModel: gemini-new\nlangchainLlmModel: gemini-old\n');
    settings = await resolveExplicitLlmSettings();
    expect(settings?.modelName).to.equal('gemini-new');
    process.env.LANGCHAIN_LLM_MODEL = 'gemini-env';
    settings = await resolveExplicitLlmSettings();
    expect(settings?.modelName).to.equal('gemini-env');
    expect(readLlmProviderSetting(await getConfig('user'))).to.equal('google-genai');
  });

  it('can be disabled with USE_AI_LLM or the former useLangchainLlm key', async () => {
    process.env.AI_LLM_PROVIDER = 'ollama';
    process.env.AI_LLM_MODEL = 'qwen';
    expect(await resolveExplicitLlmSettings()).to.not.be.null;
    await writeConfig('useLangchainLlm: false\n');
    expect(await resolveExplicitLlmSettings()).to.be.null;
    process.env.USE_AI_LLM = 'true';
    expect(await resolveExplicitLlmSettings()).to.not.be.null;
  });

  it('turns OPENAI_API_KEY into the OpenAI Responses API shortcut', async () => {
    expect(await resolveOpenAiShortcutSettings()).to.be.null;
    process.env.OPENAI_API_KEY = 'sk-test-key';
    process.env.OPENAI_SERVICE_TIER = 'FLEX';
    process.env.OPENAI_REASONING_EFFORT = 'extreme';
    const settings = await resolveOpenAiShortcutSettings();
    expect(settings).to.deep.include({
      provider: 'openai', modelName: 'gpt-4o-mini', apiKey: 'sk-test-key', openAiApi: 'responses', serviceTier: 'flex', reasoningEffort: undefined,
    });
    process.env.OPENAI_MODEL = 'gpt-4o';
    expect((await resolveOpenAiShortcutSettings())?.modelName).to.equal('gpt-4o');
    process.env.USE_OPENAI_DIRECT = 'false';
    expect(await resolveOpenAiShortcutSettings()).to.be.null;
  });

  it('accepts an OpenAI gateway without API key, but not a base URL alone or invalid headers', async () => {
    process.env.OPENAI_BASE_URL = 'https://gateway.example.com/v1';
    expect(await resolveOpenAiShortcutSettings()).to.be.null;
    process.env.OPENAI_DEFAULT_HEADERS = 'not-json';
    expect(await resolveOpenAiShortcutSettings()).to.be.null;
    process.env.OPENAI_DEFAULT_HEADERS = '{"X-Gateway-Token": "abc"}';
    expect(await resolveOpenAiShortcutSettings()).to.deep.include({ baseUrl: 'https://gateway.example.com/v1', apiKey: undefined });
  });

  it('picks the explicit LLM API before the OpenAI shortcut', async () => {
    process.env.OPENAI_API_KEY = 'sk-test-key';
    let instance = await AiProvider.getInstance();
    expect(instance?.getLabel()).to.equal('OpenAI connector');
    expect((instance as LlmApiProvider).getSettings().openAiApi).to.equal('responses');
    process.env.AI_LLM_PROVIDER = 'ollama';
    process.env.AI_LLM_MODEL = 'qwen';
    instance = await AiProvider.getInstance();
    expect(instance?.getLabel()).to.equal('Ollama connector');
  });

  it('returns the text of the LLM API through AiProvider.promptAi', async () => {
    process.env.AI_LLM_PROVIDER = 'ollama';
    process.env.AI_LLM_MODEL = 'qwen';
    recordCalls([() => jsonResponse({ model: 'qwen', message: { content: 'The answer' } })]);
    try {
      const response = await AiProvider.promptAi('Question', 'PROMPT_SOLVE_DEPLOYMENT_ERROR' as any);
      expect(response).to.deep.include({ success: true, model: 'qwen', promptResponse: 'The answer' });
    } finally {
      setFetchForTests(null);
    }
  });
});
