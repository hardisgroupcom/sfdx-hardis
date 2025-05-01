# Security Policy

## Supported Versions

Always use the latest sfdx-hardis version to be up to date with security updates.

## How we secure sfdx-hardis

All development and release workflows contain security checks using [Trivy](https://trivy.dev/latest/)

- Scan package files
- Scan docker images

Some exceptions has been added in [.trivyignore config file](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/.trivyignore), with comments explaining why these CVE are not risky within sfdx-hardis usage.

We are also using [dependabot](https://github.com/dependabot) to keep dependencies up to date.

## Reporting a Vulnerability

In case of detected vulnerability, please write directly to [Nicolas Vuillamy on LinkedIn](https://www.linkedin.com/in/nicolas-vuillamy/)
