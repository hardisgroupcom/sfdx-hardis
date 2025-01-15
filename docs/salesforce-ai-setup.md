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

You need to define at least env variable OPENAI_API_KEY and make it available to your CI/CD workflow.

You can contact [Cloudity](https://cloudity.com/#form) to use our fine-tuned Model for best results, or get an OpenAi API key via [OpenAi Platform](https://platform.openai.com/).

| Variable                     | Description                                                                               | Default       |
|------------------------------|-------------------------------------------------------------------------------------------|---------------|
| OPENAI_API_KEY               | Your openai account API key                                                               |               |
| OPENAI_MODEL                 | OpenAi model used to perform prompts (see [models list](https://openai.com/api/pricing/)) | `gpt-4o-mini` |
| AI_MAXIMUM_CALL_NUMBER       | Maximum allowed number of calls to OpenAi API during a single sfdx-hardis command         | `10000`       |
| PROMPTS_LANGUAGE             | Language to use for prompts results (en,fr)                                               | `en`          |
| DEBUG_PROMPTS                | Set to true if you want prompts requests and responses in logs                            | `false`       |
| MAX_DEPLOYMENT_TIPS_AI_CALLS | Maximum number of errors that will be analyzed by AI for a single Pull Request            | `20`          |
| DISABLE_AI                   | In case you want to disable API calls to API without removing your configuration, set to true | `false`   |
| IGNORE_AI_CACHE              | Some processes like Flow description use AI cache files to save calls to prompts API, disable by setting to true | `false` | 

## Templates

You can override default prompts by defining the following environment variables.

| Prompt Template               | Description                                                             |           Variables            |
|-------------------------------|-------------------------------------------------------------------------|:------------------------------:|
| PROMPT_SOLVE_DEPLOYMENT_ERROR | Ask AI about how to solve a deployment error                            |             ERROR              |
| PROMPT_DESCRIBE_FLOW          | Describe a flow from its XML                                            |            FLOW_XML            |
| PROMPT_DESCRIBE_FLOW_DIFF     | Describe the differences between 2 flow versions by comparing their XML | FLOW_XML_NEW,FLOW_XML_PREVIOUS |
