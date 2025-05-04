# Security Policy

## Introduction

Salesforce orgs contain critical data, so we are very serious regarding the security around the use of sfdx-hardis locally or from CI/CD servers.

## Supported Versions

Always use the latest sfdx-hardis version to be up to date with security updates.

## Supply Chain Security

### Continuous Scanning

All development and release workflows contain security checks using [Trivy](https://trivy.dev/latest/)

- Scan npm package files

- Scan docker images

Some exceptions has been added in [.trivyignore config file](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/.trivyignore), with comments explaining why these CVE are not risky within sfdx-hardis usage.

You can find security scan results and SBOM (Software Build Of Materials) in CycloneDX and SPDX formats in the [artifacts of release workflows](https://github.com/hardisgroupcom/sfdx-hardis/actions/workflows/deploy-RELEASE.yml) or directly at the end of the Release notes.

![Security artifacts screenshot](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/screenshot-security-artifacts-1.jpg)

### Dependencies

We are using [dependabot](https://github.com/dependabot) to keep dependencies up to date.

## Architecture

- sfdx-hardis plugin is built using the latest [sfdx-plugin framework provided by Salesforce](https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_plugins.meta/sfdx_cli_plugins/cli_plugins.htm), including the use of official CI/CD workflows used by official Salesforce CLI plugins.

- Authentication between sfdx-hardis and Salesforce orgs are performed using a Connect App created during configuration. Each connection requires 2 secured environment variables: one with the connected app Client Id, and one used to decrypt "on the fly" an encrypted self-signed certificate stored in the repository.

- There is no embedded telemetry: sfdx-hardis maintainers have 0 information about sfdx-hardis command line usage, and it is by design.

## Reporting a Vulnerability

In case of detected vulnerability, please write directly to [Nicolas Vuillamy on LinkedIn](https://www.linkedin.com/in/nicolas-vuillamy/)
