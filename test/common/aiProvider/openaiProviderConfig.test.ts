/* eslint-disable @typescript-eslint/no-unused-expressions */
// Configuration resolution tests for the OpenAI provider (now routed through
// @langchain/openai): the env var contract must survive the client migration.
import { expect } from 'chai';
import { OpenAiProvider } from '../../../src/common/aiProvider/openaiProvider.js';

const MANAGED_ENV_VARS = [
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_DEFAULT_HEADERS',
  'OPENAI_MODEL',
  'OPENAI_SERVICE_TIER',
  'OPENAI_REASONING_EFFORT',
  'USE_OPENAI_DIRECT',
];

describe('OpenAiProvider configuration', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const envVar of MANAGED_ENV_VARS) {
      savedEnv[envVar] = process.env[envVar];
      delete process.env[envVar];
    }
  });

  afterEach(() => {
    for (const envVar of MANAGED_ENV_VARS) {
      if (savedEnv[envVar] === undefined) {
        delete process.env[envVar];
      } else {
        process.env[envVar] = savedEnv[envVar];
      }
    }
  });

  it('is not configured without an API key or gateway auth', async () => {
    expect(await OpenAiProvider.isConfigured()).to.be.false;
  });

  it('is configured with OPENAI_API_KEY', async () => {
    process.env.OPENAI_API_KEY = 'sk-test-key';
    expect(await OpenAiProvider.isConfigured()).to.be.true;
  });

  it('is configured with a gateway (base URL + default headers, no API key)', async () => {
    process.env.OPENAI_BASE_URL = 'https://gateway.example.com/v1';
    process.env.OPENAI_DEFAULT_HEADERS = '{"X-Gateway-Token": "abc"}';
    expect(await OpenAiProvider.isConfigured()).to.be.true;
  });

  it('is not configured with a base URL but no auth at all', async () => {
    process.env.OPENAI_BASE_URL = 'https://gateway.example.com/v1';
    expect(await OpenAiProvider.isConfigured()).to.be.false;
  });

  it('is not configured when USE_OPENAI_DIRECT is false', async () => {
    process.env.OPENAI_API_KEY = 'sk-test-key';
    process.env.USE_OPENAI_DIRECT = 'false';
    expect(await OpenAiProvider.isConfigured()).to.be.false;
  });

  it('ignores an invalid OPENAI_DEFAULT_HEADERS JSON for gateway auth', async () => {
    process.env.OPENAI_BASE_URL = 'https://gateway.example.com/v1';
    process.env.OPENAI_DEFAULT_HEADERS = 'not-json';
    expect(await OpenAiProvider.isConfigured()).to.be.false;
  });

  it('creates a provider exposing the ChatOpenAI model with the configured model name', async () => {
    process.env.OPENAI_API_KEY = 'sk-test-key';
    process.env.OPENAI_MODEL = 'gpt-4o';
    const provider = await OpenAiProvider.create();
    expect(provider.getLabel()).to.equal('OpenAi connector');
    const model = (provider as any).model;
    expect(model?.model).to.equal('gpt-4o');
  });

  it('applies service tier and reasoning effort when valid', async () => {
    process.env.OPENAI_API_KEY = 'sk-test-key';
    process.env.OPENAI_SERVICE_TIER = 'FLEX';
    process.env.OPENAI_REASONING_EFFORT = 'high';
    const provider = await OpenAiProvider.create();
    expect((provider as any).serviceTier).to.equal('flex');
    expect((provider as any).reasoningEffort).to.equal('high');
  });

  it('drops unsupported service tier and reasoning effort values', async () => {
    process.env.OPENAI_API_KEY = 'sk-test-key';
    process.env.OPENAI_SERVICE_TIER = 'platinum';
    process.env.OPENAI_REASONING_EFFORT = 'extreme';
    const provider = await OpenAiProvider.create();
    expect((provider as any).serviceTier).to.be.undefined;
    expect((provider as any).reasoningEffort).to.be.undefined;
  });

  it('create() throws when not configured', async () => {
    try {
      await OpenAiProvider.create();
      expect.fail('should have thrown');
    } catch (e: any) {
      expect(e.message).to.include('not properly configured');
    }
  });
});
