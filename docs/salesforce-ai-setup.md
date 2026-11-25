---
title: Sfdx-hardis AI assistant setup
description: Learn how to wire AI into sfdx-hardis deployments
---

<!-- markdownlint-disable MD013 -->

# Setup AI for sfdx-hardis

## Security considerations

sfdx-hardis sends **prompts via API** to collect its analyses: only **metadata XML** or **JSON deployment errors** are sent in the prompts. The monitoring AI summary input is pre-anonymized: see [Security & Privacy](salesforce-security-privacy.md#ai-and-privacy) for the complete picture of what can leave your environment.

If you follow Flow best practices and **do not hardcode credentials or tokens in variables**, sending metadata XML to an external LLM carries no serious risk (**but be aware that you are doing it**).

You can see the content of the prompts by setting the environment variable `DEBUG_PROMPTS=true`.

See the [list of prompts used by sfdx-hardis](salesforce-ai-prompts.md), and how to override them.

> If you use AI for the generated project documentation, it is highly recommended to run it locally the first time, to generate and commit the AI cache: the generation can make hundreds of API calls and take some time.

## Main configuration

> Feeling lost? Contact [Cloudity](https://cloudity.com/contact-us/), we can set it up for you.

[![Cloudity](assets/images/cloudity-banner.png)](https://cloudity.com/contact-us/){target=blank}

### Common variables

| Variable                     | Description                                                                                                                                                                                 | Default |
|------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|---------|
| AI_MAXIMUM_CALL_NUMBER       | Maximum allowed number of calls to AI Providers during a single sfdx-hardis command                                                                                                         | `10000` |
| PROMPTS_LANGUAGE             | Language of the prompt results (`en`,`fr`, or any [ISO Language code](https://en.wikipedia.org/wiki/List_of_ISO_639_language_codes))                                                        | `en`    |
| DEBUG_PROMPTS                | Set to true to log prompt requests and responses                                                                                                                                            | `false` |
| MAX_DEPLOYMENT_TIPS_AI_CALLS | Maximum number of errors that will be analyzed by AI for a single Pull Request                                                                                                              | `20`    |
| DISABLE_AI                   | Set to true to disable AI calls without removing your configuration                                                                                                                         | `false` |
| IGNORE_AI_CACHE              | Some processes like Flow description use AI cache files to save calls to the AI API; set to true to disable the cache                                                                       | `false` |
| AI_MAX_TIMEOUT_MINUTES       | When sfdx-hardis runs in a CI/CD job, AI stops being called after 30 minutes, to avoid interfering with the timeouts of other jobs. You can raise this value to as many minutes as you want | `30`    |

### With Agentforce

- Agentforce must be activated on the default org used when you call the sfdx-hardis command

> You can do that with the free [Salesforce Foundations](https://www.salesforce.com/crm/foundations/) offer, which includes 200,000 Einstein prompts

![Salesforce Foundations free tier](assets/images/foundations.png)

- A prompt template **SfdxHardisGenericPrompt** (type `Flex`) must exist in the default org, with input variable **PromptText** (type `FreeText`)
- The connected user must be assigned to permission set **Prompt Template User** (EinsteinGPTPromptTemplateUser)

> **Quick setup:** Run [`sf hardis:org:configure:generic-prompt`](hardis/org/configure/generic-prompt.md) to deploy the `SfdxHardisGenericPrompt` template and optionally assign the `EinsteinGPTPromptTemplateUser` Permission Set to your user in a single interactive step. Then **manually** add `useAgentforce: true` to your `.sfdx-hardis.yml` config file or set the `USE_AGENTFORCE` env variable to enable Agentforce integration.

| Variable                           | Description                                                                                                                                                                                                                                                                 | Default                                                                                                        |
|------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------|
| USE_AGENTFORCE                     | Set to true to activate the use of Agentforce prompts                                                                                                                                                                                                                       | false                                                                                                          |
| GENERIC_AGENTFORCE_PROMPT_TEMPLATE | Set this variable to override the default prompt template                                                                                                                                                                                                                   | `SfdxHardisGenericPrompt`                                                                                      |
| GENERIC_AGENTFORCE_PROMPT_URL      | Set this variable to override the default prompt URL                                                                                                                                                                                                                        | `/services/data/v{{API_VERSION}}/einstein/prompt-templates/{{GENERIC_AGENTFORCE_PROMPT_TEMPLATE}}/generations` |
| SFDX_AUTH_URL_TECHNICAL_ORG        | If you want to use another org to call Agentforce (like a [Developer Org](https://developer.salesforce.com/signup) just to test the feature), you can define this variable (get the auth URL with `sf org auth show-sfdx-auth-url --target-org <alias> --no-prompt --json`) | <!-- -->                                                                                                       |

![](assets/images/screenshot-agentforce-config-1.jpg)

![](assets/images/screenshot-agentforce-config-2.jpg)

#### Configure Agentforce via .sfdx-hardis.yml

```yaml
useAgentforce: true
genericAgentforcePromptTemplate: SfdxHardisGenericPrompt
genericAgentforcePromptUrl: /services/data/v{{API_VERSION}}/einstein/prompt-templates/{{PROMPT_TEMPLATE}}/generations
```

API keys or technical org auth URLs still have to be provided via secure environment variables; the config file only holds non-sensitive defaults.

### With an LLM API (OpenAI, Anthropic, Google Gemini, Ollama)

sfdx-hardis calls the API of the provider you choose directly, over HTTPS (proxies defined with `HTTPS_PROXY` / `NO_PROXY` are used):

- OpenAI, and any gateway speaking the OpenAI API (`/chat/completions`)
- Anthropic
- Google Gemini
- Ollama

| Variable               | Description                                                                                                   | Default                          |
|------------------------|---------------------------------------------------------------------------------------------------------------|----------------------------------|
| USE_AI_LLM             | Set to true to call the LLM API (enabled by default when `AI_LLM_PROVIDER` and `AI_LLM_MODEL` are set)        |                                  |
| AI_LLM_PROVIDER        | The LLM API to call: `ollama`, `openai`, `anthropic` or `google-genai`                                        |                                  |
| AI_LLM_MODEL           | The model to use with the selected provider (e.g. `gpt-4o`, `claude-sonnet-4-5`, `qwen2.5-coder:14b`)         |                                  |
| AI_LLM_API_KEY         | API key of the selected provider (required for OpenAI, Anthropic and Gemini, unless gateway headers are used) |                                  |
| AI_LLM_TEMPERATURE     | Controls randomness (0-1)                                                                                     |                                  |
| AI_LLM_MAX_TOKENS      | Maximum number of tokens to generate (Anthropic: `8192` for Claude 3.5 models, `4096` for Claude 3 models)    | Anthropic: `16384`               |
| AI_LLM_MAX_RETRIES     | Number of retries after a rate limit or a temporary error                                                     | `6`                              |
| AI_LLM_TIMEOUT         | Timeout of one call, in milliseconds                                                                          | `600000`                         |
| AI_LLM_BASE_URL        | Base URL of the API (Ollama, corporate gateways)                                                              | Ollama: `http://localhost:11434` |
| AI_LLM_DEFAULT_HEADERS | JSON object of default HTTP headers sent with every request (for gateway/proxy authentication)                |                                  |

#### Example configurations

For Ollama:

- Visit [Ollama's official website](https://ollama.ai/) and download the appropriate version for your operating system
- Follow the installation instructions for your platform
- After installation, pull your preferred model (e.g. `ollama pull qwen2.5-coder:14b`) and start the Ollama service with `ollama serve`

```sh
AI_LLM_PROVIDER=ollama
AI_LLM_MODEL=qwen2.5-coder:14b
AI_LLM_TEMPERATURE=1
AI_LLM_BASE_URL=http://localhost:11434
```

For OpenAI:

```sh
AI_LLM_PROVIDER=openai
AI_LLM_MODEL=gpt-4o-mini
AI_LLM_API_KEY=your-api-key
AI_LLM_TEMPERATURE=0.7
AI_LLM_MAX_TOKENS=2000
```

For OpenAI via a corporate gateway (no API key needed):

```sh
AI_LLM_PROVIDER=openai
AI_LLM_MODEL=gpt-4o
AI_LLM_BASE_URL=https://your-company-gateway.example.com/v1
AI_LLM_DEFAULT_HEADERS='{"X-Company-Auth": "your-token-here"}'
```

When `AI_LLM_DEFAULT_HEADERS` is set together with `AI_LLM_BASE_URL`, the OpenAI provider skips the API key requirement and authenticates via the supplied headers instead.

For Anthropic:

```sh
AI_LLM_PROVIDER=anthropic
AI_LLM_MODEL=claude-sonnet-4-5
AI_LLM_API_KEY=your-api-key
AI_LLM_TEMPERATURE=0.7
AI_LLM_MAX_TOKENS=2000
```

For Google Gemini:

```sh
AI_LLM_PROVIDER=google-genai
AI_LLM_MODEL=gemini-2.5-flash
AI_LLM_API_KEY=your-api-key
```

#### Configure via .sfdx-hardis.yml

You can store non-secret defaults inside your project configuration so every contributor shares the same provider and model, while API keys remain in CI/CD secrets:

```yaml
# .sfdx-hardis.yml
aiLlmProvider: google-genai
aiLlmModel: gemini-2.5-flash
aiLlmTemperature: 0.1
aiLlmMaxTokens: 1000
```

Only values that are safe to commit (model, provider, tuning) are loaded from the config file. Secrets such as `AI_LLM_API_KEY` must always be provided through secure environment variables or your CI secret manager.

#### Renamed settings

These settings used to be named after LangChain, the library sfdx-hardis used to call LLM APIs. The former names still work, and sfdx-hardis logs a warning naming the new one. When both are set, the new name wins, and an environment variable always wins over a `.sfdx-hardis.yml` key, whichever its name: a former `LANGCHAIN_LLM_MODEL` variable still overrides a new `aiLlmModel` key.

| Former name                                             | New name                                  |
|---------------------------------------------------------|-------------------------------------------|
| `USE_LANGCHAIN_LLM` / `useLangchainLlm`                 | `USE_AI_LLM` / `useAiLlm`                 |
| `LANGCHAIN_LLM_PROVIDER` / `langchainLlmProvider`       | `AI_LLM_PROVIDER` / `aiLlmProvider`       |
| `LANGCHAIN_LLM_MODEL` / `langchainLlmModel`             | `AI_LLM_MODEL` / `aiLlmModel`             |
| `LANGCHAIN_LLM_MODEL_API_KEY`                           | `AI_LLM_API_KEY`                          |
| `LANGCHAIN_LLM_TEMPERATURE` / `langchainLlmTemperature` | `AI_LLM_TEMPERATURE` / `aiLlmTemperature` |
| `LANGCHAIN_LLM_MAX_TOKENS` / `langchainLlmMaxTokens`    | `AI_LLM_MAX_TOKENS` / `aiLlmMaxTokens`    |
| `LANGCHAIN_LLM_MAX_RETRIES` / `langchainLlmMaxRetries`  | `AI_LLM_MAX_RETRIES` / `aiLlmMaxRetries`  |
| `LANGCHAIN_LLM_TIMEOUT` / `langchainLlmTimeout`         | `AI_LLM_TIMEOUT` / `aiLlmTimeout`         |
| `LANGCHAIN_LLM_BASE_URL` / `langchainLlmBaseUrl`        | `AI_LLM_BASE_URL` / `aiLlmBaseUrl`        |
| `LANGCHAIN_LLM_DEFAULT_HEADERS`                         | `AI_LLM_DEFAULT_HEADERS`                  |

### With an OpenAI API key only

Defining only `OPENAI_API_KEY` (or a gateway with `OPENAI_BASE_URL` and `OPENAI_DEFAULT_HEADERS`) is a shortcut for the OpenAI provider above: sfdx-hardis calls the OpenAI Responses API with the model `OPENAI_MODEL`. Make the variable available to your CI/CD workflow.

To get an OpenAI API key, register on the [OpenAI Platform](https://platform.openai.com/).

| Variable                | Description                                                                               | Default       |
|-------------------------|-------------------------------------------------------------------------------------------|---------------|
| OPENAI_API_KEY          | Your OpenAI account API key (not required when using gateway headers)                     |               |
| OPENAI_MODEL            | OpenAI model used to perform prompts (see [models list](https://openai.com/api/pricing/)) | `gpt-4o-mini` |
| OPENAI_SERVICE_TIER     | Optional OpenAI service tier for supported projects (`auto`, `default`, `flex`)           |               |
| OPENAI_REASONING_EFFORT | Optional reasoning effort for supported OpenAI reasoning models (`low`, `medium`, `high`) |               |
| OPENAI_BASE_URL         | Base URL for OpenAI API (for corporate gateways/proxies)                                  |               |
| OPENAI_DEFAULT_HEADERS  | JSON object of default HTTP headers for gateway/proxy authentication                      |               |

#### OpenAI shortcut via corporate gateway (no API key needed)

```sh
USE_OPENAI_DIRECT=true
OPENAI_MODEL=gpt-4o
OPENAI_BASE_URL=https://your-company-gateway.example.com/v1
OPENAI_DEFAULT_HEADERS='{"X-Company-Auth": "your-token-here"}'
```

When `OPENAI_DEFAULT_HEADERS` is set together with `OPENAI_BASE_URL`, the OpenAI shortcut skips the API key requirement and authenticates via the supplied headers instead.

#### Configure the OpenAI shortcut via .sfdx-hardis.yml

```yaml
useOpenaiDirect: true
openaiModel: gpt-4o-mini
openaiServiceTier: auto
openaiReasoningEffort: medium
```

Store only model and provider preferences in the config file; keep `OPENAI_API_KEY` (or gateway headers) in secure environment variables.

### With Codex Directly

To use Codex directly, set `USE_CODEX_DIRECT=true`.

sfdx-hardis runs the Codex CLI, which is not bundled with it: install it with `npm install -g @openai/codex`. The [with-agents Docker images](installation.md#run-in-cicd-with-a-docker-image) already include it. When the Codex CLI is not found, sfdx-hardis logs a warning and uses the next configured AI provider.

Authentication is resolved in this order:

1. `CODEX_API_KEY` environment variable (recommended for CI/CD).
2. Gateway authentication via `CODEX_BASE_URL` + `CODEX_DEFAULT_HEADERS` (for corporate OpenAI gateways).
3. Existing Codex local auth cache file at `$CODEX_HOME/auth.json` (or `~/.codex/auth.json` when `CODEX_HOME` is not set).

| Variable               | Description                                                                                         | Default         |
|------------------------|-----------------------------------------------------------------------------------------------------|-----------------|
| USE_CODEX_DIRECT       | Set to true to activate direct Codex integration                                                    | `false`         |
| CODEX_API_KEY          | Codex API key passed to the Codex CLI (optional if auth cache file exists)                          |                 |
| CODEX_MODEL            | Codex model used to perform prompts                                                                 | `gpt-5.1-codex` |
| CODEX_REASONING_EFFORT | Reasoning effort used for Codex calls (`low`, `medium`, `high`, `xhigh`)                            | `high`          |
| CODEX_BASE_URL         | Base URL for Codex API (for corporate gateways/proxies; falls back to `OPENAI_BASE_URL`)            |                 |
| CODEX_DEFAULT_HEADERS  | JSON object of default HTTP headers for gateway/proxy auth (falls back to `OPENAI_DEFAULT_HEADERS`) |                 |
| CODEX_CLI_PATH         | Location of the Codex CLI when it is not in the PATH                                                |                 |

If `CODEX_REASONING_EFFORT` is set to an unsupported value, sfdx-hardis falls back to `high`.

#### Codex via corporate gateway (no API key needed)

```sh
USE_CODEX_DIRECT=true
CODEX_MODEL=gpt-5.1-codex
CODEX_BASE_URL=https://your-company-gateway.example.com/v1
CODEX_DEFAULT_HEADERS='{"X-Company-Auth": "your-token-here"}'
```

When headers are configured, sfdx-hardis defines a custom Codex CLI model provider with the supplied headers and routes requests through it.

#### Configure Codex via .sfdx-hardis.yml

```yaml
useCodexDirect: true
codexModel: gpt-5.1-codex
codexReasoningEffort: high
```

Store only model preferences in the config file; keep `CODEX_API_KEY` in a secure environment variable when running in CI/CD.

## Coding Agent Auto-Fix (Beta)

If you have configured one of the AI providers above (LLM API, OpenAI, Codex), sfdx-hardis can also use the matching **coding agent CLI** to automatically fix deployment errors.

The API key configured for your AI provider (e.g. `AI_LLM_API_KEY`) is automatically reused by the coding agent CLI, so no extra key configuration is needed.

**Local mode:** When running outside CI/CD (on your local machine), sfdx-hardis automatically detects installed coding agent CLIs and uses them **without any API key environment variables**. Agents authenticate via their own login mechanisms (`claude login`, `gh auth login`, etc.).

> **Use with caution:** This feature is in beta. AI coding agents can make mistakes: all proposed changes must be reviewed by an expert before merging.

See [Coding Agent Auto-Fix](salesforce-deployment-agent-autofix.md) for full setup instructions.

## Templates

You can override the default prompts by defining the following environment variables.

| Prompt Template                           | Description                                                                                 |                          Variables                          |
|-------------------------------------------|---------------------------------------------------------------------------------------------|:-----------------------------------------------------------:|
| PROMPT_SOLVE_DEPLOYMENT_ERROR             | Ask AI about how to solve a deployment error                                                |                            ERROR                            |
| PROMPT_DESCRIBE_FLOW                      | Describe a flow from its XML                                                                |                          FLOW_XML                           |
| PROMPT_DESCRIBE_FLOW_DIFF                 | Describe the differences between two Flow versions by comparing their XML                   |               FLOW_XML_NEW, FLOW_XML_PREVIOUS               |
| PROMPT_DESCRIBE_OBJECT                    | Describe an object using sfdx-hardis generated info based on project metadata               | OBJECT_NAME, OBJECT_XML, ALL_OBJECTS_LIST, ALL_OBJECT_LINKS |
| PROMPT_COMPLETE_OBJECT_ATTRIBUTES_MD      | Complete field and validation rule descriptions in markdown tables generated by sfdx-hardis |                    OBJECT_NAME, MARKDOWN                    |
| PROMPT_DESCRIBE_APEX                      | Describe an Apex class from its code                                                        |                    CLASS_NAME, APEX_CODE                    |
| PROMPT_CODING_AGENT_FIX_DEPLOYMENT_ERRORS | Prompt used by coding agents to fix deployment errors                                       |              ERRORS, FAILED_TESTS, TARGET_ORG               |
