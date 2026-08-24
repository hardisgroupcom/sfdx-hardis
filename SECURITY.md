# Security & Privacy

Salesforce orgs contain critical data, so we are very serious regarding the security and privacy around the use of sfdx-hardis locally or from CI/CD servers. This page is the reference: other parts of the documentation link here whenever security, privacy or sensitive data is involved.

## No sfdx-hardis servers

sfdx-hardis is a Salesforce CLI plugin that runs entirely on machines **you** control: your workstation, or the CI/CD runners of your own git platform.

- There is **no sfdx-hardis backend server**: no account to create, no data stored anywhere by the project.
- There is **no embedded telemetry**: sfdx-hardis maintainers have 0 information about sfdx-hardis command line usage, and it is by design.
- The plugin is open-source: everything described below can be verified in [the repository](https://github.com/hardisgroupcom/sfdx-hardis).

## Where your data can go

Nothing leaves your environment unless you explicitly configure a destination. When you do, this is what each one receives:

| Destination                                                                                                                                                                                                                                                                                           | What is sent                                                                    | When                                           |
|:------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|:--------------------------------------------------------------------------------|:-----------------------------------------------|
| **Salesforce orgs**                                                                                                                                                                                                                                                                                   | Deployments, queries, metadata retrieves                                        | Commands you run, on orgs you authenticated to |
| **Your git platform** (GitHub, GitLab, Azure DevOps, Bitbucket)                                                                                                                                                                                                                                       | Pull Request comments, deployment status, generated reports as CI artifacts     | CI/CD and monitoring jobs you set up           |
| **Messaging channels** ([Slack](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-setup-integration-slack/), [Teams](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-setup-integration-ms-teams/), [Google Chat](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-setup-integration-google-chat/)) | Notification texts                                                              | Only if you configure them                     |
| **[Email](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-setup-integration-email/)**                                                                                                                                                                                                               | Notification texts, generated report files as attachments                       | Only if you configure recipients               |
| **[API endpoints](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-setup-integration-api/)** (Grafana Loki, Prometheus, or any URL you set)                                                                                                                                                          | Notification logs and metrics                                                   | Only if you configure the endpoint             |
| **Ticketing** ([JIRA](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-setup-integration-jira/), [Azure Boards](https://sfdx-hardis.cloudity.com/salesforce-ci-cd-setup-integration-azure-boards/))                                                                                                  | Deployment comments on your tickets                                             | Only if you configure the integration          |
| **LLM provider** ([AI setup](https://sfdx-hardis.cloudity.com/salesforce-ai-setup/))                                                                                                                                                                                                                  | Prompts containing metadata XML, deployment errors, or monitoring notifications | Only if you configure an AI provider           |

## Data anonymization

When running in CI (which is the case for scheduled monitoring jobs), sfdx-hardis anonymizes personal data before it leaves the machine. This covers:

- Generated report files (CSV and XLSX), which become CI artifacts and email attachments
- API channel payloads (log elements, notification title and body text, extra data fields)
- Email, Slack, Microsoft Teams and Google Chat notification texts
- The monitoring notification files used by the AI executive summary and the PPTX report (they follow the API channel level)
- Tables printed in CI console logs

### Levels

Two anonymization levels are available:

- **standard** (default in CI): masks end-user identity. `Username`, `Email`, `FirstName`, `LastName` and user display names become `user_<hash>`, Salesforce user record Ids (`005...` values, `USER_ID`, `AssigneeId`) become `id_<hash>`, client IPs and their resolved hostnames become `ip_<hash>`. Technical actor fields stay readable: `CreatedBy`, `LastModifiedBy` and `DelegateUser` in audit trail entries, `DeployedBy` in deployment history, `TriggeredBy` in security key unlink reports. They identify administrators performing setup actions, which is exactly what an audit trail is for.
- **strict**: standard, plus the technical actor fields above.

What is NOT anonymized at any level: Salesforce record Ids other than user Ids (deployment Ids, org Ids, permission set Ids...), profile and license names, dates (`LastLoginDate` is needed for inactive-user reports and is not a personal identifier), and metric values.

Key points:

- Pseudonyms are stable per org (same value always gets the same hash), so distinct-user counts and per-user drill-downs keep working in dashboards, and a pseudonym in a Grafana panel matches the same pseudonym in the XLSX report of the same run. They are salted per org, so the same user is not linkable across orgs.
- Local runs (outside CI) are not anonymized by default, so locally generated report files stay directly analyzable.
- Report files are anonymized at generation time: the file on disk is the anonymized artifact, and email attachments are these same files.

### Configuration

By default, anonymization is active (at level `standard`) **only when running in CI**. Local runs are never anonymized unless you explicitly ask for it, either with the `SFDX_HARDIS_ANONYMIZE` env var or with `enforceLocally` in the config: local logs and report files keep full information so they stay analyzable.

Override the default behavior with the env var **SFDX_HARDIS_ANONYMIZE**:

```sh
SFDX_HARDIS_ANONYMIZE=off       # disable anonymization everywhere, even in CI
SFDX_HARDIS_ANONYMIZE=standard  # explicitly enable end-user identity anonymization, including in local runs
SFDX_HARDIS_ANONYMIZE=strict    # like standard, plus technical actor fields
```

Or with the `anonymization` property in `config/.sfdx-hardis.yml`:

```yaml
anonymization:
  level: standard # off | standard | strict
  channels: # optional: a channel can be stricter than the global level, never weaker
    email: strict
    messaging: strict
    api: strict
    files: strict
  enforceLocally: false # set to true to also apply this configuration to local runs
```

This configuration applies to **CI runs only**: even a committed `level: strict` leaves local runs raw, so developers keep full information in their local logs and reports. Set `enforceLocally: true` to make local runs follow the configured anonymization too (or use the env var, which always wins).

Per-channel levels can only raise the global level: report files are anonymized once at the source, so a channel cannot receive rawer data than the global level allows. Note that email attachments are the generated report files, so they follow the `files` level, not the `email` one.

The former **NOTIF_API_ANONYMIZE** env var is deprecated but still honored (`true` maps to `standard`, `false` to `off`).

Note: anonymization only applies to new entries. Entries sent before enabling it keep their original values until your log retention expires (you can use the Loki delete API to purge them earlier).

## Credentials

- Authentication between sfdx-hardis and Salesforce orgs is performed using the official Salesforce CLI mechanisms. In CI/CD, an External Client App (the type Salesforce now recommends, replacing Connected Apps) is created during configuration: each connection requires 2 secured environment variables, one with the External Client App Consumer Key, and one used to decrypt "on the fly" an encrypted self-signed certificate stored in the repository.
- Integration tokens (Slack, email, API endpoints, LLM API keys...) are provided by you as CI/CD variables and are only used to call the services they belong to.
- Values logged as sensitive are obfuscated in log files.

## AI and privacy

When you configure an [AI provider](https://sfdx-hardis.cloudity.com/salesforce-ai-setup/), prompts are sent only to that provider: metadata XML for documentation, deployment errors for the deployment assistant, and monitoring notifications for the AI executive summary. The monitoring notifications are pre-anonymized at the API channel level (see [Data anonymization](#data-anonymization) above), so no readable end-user identity reaches the LLM when anonymization is active. If you follow best practices and do not hardcode credentials in metadata, sending metadata XML to an LLM carries no serious risk, but be aware that you are doing it.

## Supported Versions

Always use the latest sfdx-hardis version to be up to date with security updates.

## Supply Chain Security

### Continuous Scanning

Every Pull Request is analyzed by [MegaLinter](https://megalinter.io/) (by [OX Security](https://www.ox.security/)), which detects code smells and security issues thanks to the many linters and scanners it embeds. Its configuration is in [.mega-linter.yml](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/.mega-linter.yml), and each run posts its full report as a Pull Request comment.

Security scanners running on every Pull Request:

| Scanner                                                                                                                                                                                                                      | What it checks                                   |
|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|--------------------------------------------------|
| [trufflehog](https://megalinter.io/latest/descriptors/repository_trufflehog/) and [betterleaks](https://megalinter.io/latest/descriptors/repository_betterleaks/)                                                            | Secrets and credentials committed by mistake     |
| [trivy](https://megalinter.io/latest/descriptors/repository_trivy/), [grype](https://megalinter.io/latest/descriptors/repository_grype/) and [osv-scanner](https://megalinter.io/latest/descriptors/repository_osv_scanner/) | Known vulnerabilities (CVE) in dependencies      |
| [checkov](https://megalinter.io/latest/descriptors/repository_checkov/)                                                                                                                                                      | Insecure infrastructure and configuration files  |
| [zizmor](https://megalinter.io/latest/descriptors/action_zizmor/) and [actionlint](https://megalinter.io/latest/descriptors/action_actionlint/)                                                                              | GitHub Actions workflow security and correctness |
| [hadolint](https://megalinter.io/latest/descriptors/dockerfile_hadolint/)                                                                                                                                                    | Dockerfile issues                                |

The same run also checks code quality with [eslint](https://megalinter.io/latest/descriptors/typescript_eslint/), copy-pasted code with [jscpd](https://megalinter.io/latest/descriptors/copypaste_jscpd/), spelling with [cspell](https://megalinter.io/latest/descriptors/spell_cspell/), JSON and YAML schema conformity with [v8r](https://megalinter.io/latest/descriptors/json_v8r/), and broken documentation links with [lychee](https://megalinter.io/latest/descriptors/spell_lychee/).

All development and release workflows contain security checks using [Trivy](https://trivy.dev/latest/)

- Scan npm package files

- Scan docker images

Some exceptions has been added in [.trivyignore config file](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/.trivyignore), with comments explaining why these CVE are not risky within sfdx-hardis usage.

You can find security scan results and SBOM (Software Build Of Materials) in CycloneDX and SPDX formats in the [artifacts of release workflows](https://github.com/hardisgroupcom/sfdx-hardis/actions/workflows/deploy.yml) or directly at the end of the Release notes.

![Security artifacts screenshot](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/screenshot-security-artifacts-1.jpg)

### Dependencies

We are using [dependabot](https://github.com/dependabot) to keep dependencies up to date. It checks for new versions **every day**, but a new version is only proposed once it has been public for **at least one week** ([cooldown](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/.github/dependabot.yml)): a package compromised by a supply chain attack is usually detected and pulled within days, so waiting keeps a malicious release from being merged before anyone noticed it.

This delay applies to regular version updates only. **Dependabot security updates are exempt from the cooldown**: when a CVE is published for a dependency we use, the fix is proposed immediately.

## Releases

- Each release is created using GitHub Release workflows, which are protected by a GitHub Environment requiring at least one manual approval from maintainers (using MFA-protected GitHub Account).

- [NPM Trusted publishers](https://docs.npmjs.com/trusted-publishers) is configured to restrict publishing rights to this specific GitHub action workflow: publishing is tokenless, authenticated with a short-lived OIDC token that GitHub issues to that workflow only, so there is no NPM token to store or leak (MFA is also enabled on the NPM account).

## Architecture

- sfdx-hardis plugin is built using the latest [sfdx-plugin framework provided by Salesforce](https://developer.salesforce.com/docs/atlas.en-us.sfdx_cli_plugins.meta/sfdx_cli_plugins/cli_plugins.htm), including the use of official CI/CD workflows used by official Salesforce CLI plugins.

## Reporting a Vulnerability

In case of detected vulnerability, please write directly to [Nicolas Vuillamy on LinkedIn](https://www.linkedin.com/in/nicolas-vuillamy/)
