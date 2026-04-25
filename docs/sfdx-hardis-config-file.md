---
title: sfdx-hardis Configuration
description: Overview of sfdx-hardis configuration - VS Code UI, config file, environment variables, and links to topic-specific configuration guides
---
<!-- markdownlint-disable MD013 -->

# sfdx-hardis Configuration

## Configure with the VS Code UI (recommended)

The easiest way to configure sfdx-hardis is through the **[VS Code SFDX Hardis extension](https://marketplace.visualstudio.com/items?itemName=NicolasVuillamy.vscode-sfdx-hardis){target=blank}**.

The extension provides a guided UI that covers most configuration tasks without ever editing a YAML file manually:

- Setting up a new CI/CD project or connecting an existing org
- Configuring cleaning rules, delta deployments, and overwrite policies
- Managing packages, permission sets, and scratch org pools
- Running monitoring and backup operations

Install the extension, open your Salesforce DX project in VS Code, and use the **SFDX Hardis** panel in the sidebar to get started.

---

## The `.sfdx-hardis.yml` config file

Behind the scenes, all configuration is stored in **`config/.sfdx-hardis.yml`** at the root of your project. Most properties are set automatically by the setup and release wizards, but you can also edit the file directly.

Three configuration layers are merged at runtime:

| Layer       | File                                        | Scope                       |
|-------------|---------------------------------------------|-----------------------------|
| **Project** | `config/.sfdx-hardis.yml`                   | Shared - committed to git   |
| **Branch**  | `config/branches/.sfdx-hardis.<branch>.yml` | Per-environment overrides   |
| **User**    | `config/user/.sfdx-hardis.<username>.yml`   | Per-developer - git-ignored |

See the [**full list of configuration properties**](schema/sfdx-hardis-json-schema-parameters.html) for every supported key, its type, default value, and description.

---

## Environment Variables

Many runtime behaviours can be controlled through environment variables - useful for CI/CD pipelines where you cannot ship secrets or machine-specific settings in a committed file.

See the [**complete list of environment variables**](all-env-variables.md).

---

## Topic-specific Configuration Guides

| Topic                                             | Guide                                                                      |
|---------------------------------------------------|----------------------------------------------------------------------------|
| CI/CD pipeline setup (new or existing project)    | [Setup a Salesforce CI/CD Project](salesforce-ci-cd-setup-home.md)         |
| CI/CD configuration overview                      | [Configure a CI/CD Project](salesforce-ci-cd-config-home.md)               |
| Automated metadata cleaning before merge          | [Configure Cleaning](salesforce-ci-cd-config-cleaning.md)                  |
| Delta deployments with sfdx-git-delta             | [Configure Delta Deployments](salesforce-ci-cd-config-delta-deployment.md) |
| Overwrite management (`package-no-overwrite.xml`) | [Configure Overwrite Management](salesforce-ci-cd-config-overwrite.md)     |
| Org monitoring & backup                           | [Monitor your Salesforce Org](salesforce-monitoring-home.md)               |
| AI providers (Claude, OpenAI, Gemini, Ollama)     | [AI Assistant Setup](salesforce-ai-setup.md)                               |

