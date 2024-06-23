---
title: Sfdx-hardis AI assistant setup
description: Learn how to use AI to supercharge sfdx-hardis deployments
---
<!-- markdownlint-disable MD013 -->

# Setup AI for sfdx-hardis

You need to define at least env variable OPENAI_API_KEY and make it available to your CI/CD workflow.

To get an OpenAi API key, [create an OpenAi Platform account](https://platform.openai.com/).

| Variable       | Description                 | Default |
| -------------- | --------------------------- | ------- |
| OPENAI_API_KEY | Your openai account API key |         |
| OPENAI_MODEL  | OpenAi model used to perform prompts (see [models list](https://openai.com/api/pricing/)) | `gpt-4o` |
| AI_MAXIMUM_CALL_NUMBER | Maximum allowed number of calls to OpenAi API during a single sfdx-hardis command | `10` |