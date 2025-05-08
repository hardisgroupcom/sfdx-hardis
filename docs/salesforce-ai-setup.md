---
title: Sfdx-hardis AI assistant setup
description: Learn how to use AI to supercharge sfdx-hardis deployments
---
<!-- markdownlint-disable MD013 -->

# Setup AI for sfdx-hardis

## Security considerations

sfdx-hardis uses **prompt via API** to collect analysis: only **Metadata XML** or **JSON deployment errors** are sent in the prompts.

If you follow Flows best practices and **do not hardcode credentials / tokens in variables**, there is no serious risk to send metadata XML to an external LLM (**but be aware that you do !**)

You can see the prompts content if you set env variable `DEBUG_PROMPTS=true`.

The list of prompts used by sfdx-hardis is defined in [this source file](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/src/common/aiProvider/promptTemplates.ts).

## Main configuration

> You're lost ? Contact [Cloudity](https://cloudity.com/#form), we can do it for you :)

### Common variables

| Variable                     | Description                                                                                                                               | Default |
|------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------|---------|
| AI_MAXIMUM_CALL_NUMBER       | Maximum allowed number of calls to OpenAi API during a single sfdx-hardis command                                                         | `10000` |
| PROMPTS_LANGUAGE             | Language to use for prompts results (`en`,`fr`, or any [ISO Language code](https://en.wikipedia.org/wiki/List_of_ISO_639_language_codes)) | `en`    |
| DEBUG_PROMPTS                | Set to true if you want prompts requests and responses in logs                                                                            | `false` |
| MAX_DEPLOYMENT_TIPS_AI_CALLS | Maximum number of errors that will be analyzed by AI for a single Pull Request                                                            | `20`    |
| DISABLE_AI                   | In case you want to disable API calls to API without removing your configuration, set to true                                             | `false` |
| IGNORE_AI_CACHE              | Some processes like Flow description use AI cache files to save calls to prompts API, disable by setting to true                          | `false` |

### With Agentforce

- Agentforce must be activated on the default org used when you call the sfdx-hardis command

> You can do that with Salesforce Freemium feature [Salesforce Foundations](https://www.salesforce.com/crm/foundations/), that offers 200000 Einstein Prompts

![Salesforce Foundations free tier](assets/images/foundations.png)

- A prompt template **SfdxHardisGenericPrompt** (type `Flex`) must exist in the default org, with input variable **PromptText** (type `FreeText`)
- The connected used must be assigned to permission set **Prompt Template User**

| Variable                           | Description                                           | Default                                                                                                        |
|------------------------------------|-------------------------------------------------------|----------------------------------------------------------------------------------------------------------------|
| USE_AGENTFORCE                     | Set to true to activate the use of Agentforce prompts | false                                                                                                          |
| GENERIC_AGENTFORCE_PROMPT_TEMPLATE | Set this variable to override default prompt template | `SfdxHardisGenericPrompt`                                                                                      |
| GENERIC_AGENTFORCE_PROMPT_URL      | Set this variable to override default prompt url      | `/services/data/v{{API_VERSION}}/einstein/prompt-templates/{{GENERIC_AGENTFORCE_PROMPT_TEMPLATE}}/generations` |

![](assets/images//screenshot-agentforce-config-1.jpg)

![](assets/images//screenshot-agentforce-config-2.jpg)

### With OpenAI

You need to define env variable OPENAI_API_KEY and make it available to your CI/CD workflow.

To get an OpenAi API key , register on [OpenAi Platform](https://platform.openai.com/).

| Variable       | Description                                                                               | Default       |
|----------------|-------------------------------------------------------------------------------------------|---------------|
| OPENAI_API_KEY | Your openai account API key                                                               |               |
| OPENAI_MODEL   | OpenAi model used to perform prompts (see [models list](https://openai.com/api/pricing/)) | `gpt-4o-mini` |

### With Ollama

You can use a local Ollama instance to generate documentation. This requires Ollama to be installed and running on your machine.

#### Install Ollama
- Visit [Ollama's official website](https://ollama.ai/) and download the appropriate version for your operating system
- Follow the installation instructions for your platform
- After installation, start the Ollama service with `ollama serve`

#### Pull a Model**
```bash
# Pull your preferred model, for example:
ollama pull qwen2.5-coder:14b

# See all available models
ollama list
```

#### Configure environment variables**

| Variable       | Description                                                                               | Default       |
|----------------|-------------------------------------------------------------------------------------------|---------------|
| USE_OLLAMA     | true                                                                                      | false         |
| OLLAMA_MODEL   | Ollama model used to perform prompts (see [models list](https://ollama.com/library))      |               |


## Templates

You can override default prompts by defining the following environment variables.

| Prompt Template                      | Description                                                                                         |                          Variables                          |
|--------------------------------------|-----------------------------------------------------------------------------------------------------|:-----------------------------------------------------------:|
| PROMPT_SOLVE_DEPLOYMENT_ERROR        | Ask AI about how to solve a deployment error                                                        |                            ERROR                            |
| PROMPT_DESCRIBE_FLOW                 | Describe a flow from its XML                                                                        |                          FLOW_XML                           |
| PROMPT_DESCRIBE_FLOW_DIFF            | Describe the differences between 2 flow versions by comparing their XML                             |               FLOW_XML_NEW, FLOW_XML_PREVIOUS               |
| PROMPT_DESCRIBE_OBJECT               | Describe Object using sfdx-hardis generated info based on project metadatas                         | OBJECT_NAME, OBJECT_XML, ALL_OBJECTS_LIST, ALL_OBJECT_LINKS |
| PROMPT_COMPLETE_OBJECT_ATTRIBUTES_MD | Complete fields and validation rules descriptions in input markdown tables generated by sfdx-hardis |                    OBJECT_NAME, MARKDOWN                    |
| PROMPT_DESCRIBE_APEX                 | Describe an Apex class from its code                                                                |                    CLASS_NAME, APEX_CODE                    |
