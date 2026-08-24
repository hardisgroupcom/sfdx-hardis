---
title: Security & Privacy of sfdx-hardis
description: Where your data goes when using sfdx-hardis (nowhere by default), how personal data is anonymized, and how credentials are handled
---
<!-- markdownlint-disable MD013 -->

## Security & Privacy

sfdx-hardis handles data from your Salesforce orgs, so knowing exactly where that data can go matters. This page is the reference: other parts of the documentation link here whenever security, privacy or sensitive data is involved.

## No sfdx-hardis servers

sfdx-hardis is a Salesforce CLI plugin that runs entirely on machines **you** control: your workstation, or the CI/CD runners of your own git platform.

- There is **no sfdx-hardis backend server**: no account to create, no data stored anywhere by the project.
- There is **no embedded telemetry**: maintainers have zero information about your command line usage, by design (see the [Security Policy](#security-policy) below).
- The plugin is open-source: everything described below can be verified in [the repository](https://github.com/hardisgroupcom/sfdx-hardis).

## Where your data can go

Nothing leaves your environment unless you explicitly configure a destination. When you do, this is what each one receives:

| Destination                                                                                       | What is sent                                                                                        | When                                                    |
| :------------------------------------------------------------------------------------------------ | :--------------------------------------------------------------------------------------------------- | :------------------------------------------------------ |
| **Salesforce orgs**                                                                               | Deployments, queries, metadata retrieves                                                            | Commands you run, on orgs you authenticated to          |
| **Your git platform** (GitHub, GitLab, Azure DevOps, Bitbucket)                                   | Pull Request comments, deployment status, generated reports as CI artifacts                         | CI/CD and monitoring jobs you set up                    |
| **Messaging channels** ([Slack](salesforce-ci-cd-setup-integration-slack.md), [Teams](salesforce-ci-cd-setup-integration-ms-teams.md), [Google Chat](salesforce-ci-cd-setup-integration-google-chat.md)) | Notification texts                                                                                   | Only if you configure them                              |
| **[Email](salesforce-ci-cd-setup-integration-email.md)**                                          | Notification texts, generated report files as attachments                                           | Only if you configure recipients                        |
| **[API endpoints](salesforce-ci-cd-setup-integration-api.md)** (Grafana Loki, Prometheus, or any URL you set) | Notification logs and metrics                                                                        | Only if you configure the endpoint                      |
| **Ticketing** ([JIRA](salesforce-ci-cd-setup-integration-jira.md), [Azure Boards](salesforce-ci-cd-setup-integration-azure-boards.md)) | Deployment comments on your tickets                                                                  | Only if you configure the integration                   |
| **LLM provider** ([AI setup](salesforce-ai-setup.md))                                             | Prompts containing metadata XML, deployment errors, or monitoring notifications                     | Only if you configure an AI provider                    |

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

Override the default behavior with the env var **SFDX_HARDIS_ANONYMIZE**:

```sh
SFDX_HARDIS_ANONYMIZE=off       # send and write raw values even in CI
SFDX_HARDIS_ANONYMIZE=standard  # anonymize end-user identity, even in local runs
SFDX_HARDIS_ANONYMIZE=strict    # also anonymize technical actor fields
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
```

Per-channel levels can only raise the global level: report files are anonymized once at the source, so a channel cannot receive rawer data than the global level allows. Note that email attachments are the generated report files, so they follow the `files` level, not the `email` one.

The former **NOTIF_API_ANONYMIZE** env var is deprecated but still honored (`true` maps to `standard`, `false` to `off`).

Note: anonymization only applies to new entries. Entries sent before enabling it keep their original values until your log retention expires (you can use the Loki delete API to purge them earlier).

## Credentials

- Authentication to Salesforce orgs relies on the official Salesforce CLI mechanisms. In CI/CD, sfdx-hardis uses a Connected App with an encrypted self-signed certificate stored in the repository, decrypted on the fly with a secured environment variable (details in the [Security Policy](#security-policy) below).
- Integration tokens (Slack, email, API endpoints, LLM API keys...) are provided by you as CI/CD variables and are only used to call the services they belong to.
- Values logged as sensitive are obfuscated in log files.

## AI and privacy

When you configure an [AI provider](salesforce-ai-setup.md), prompts are sent only to that provider: metadata XML for documentation, deployment errors for the deployment assistant, and monitoring notifications for the AI executive summary. The monitoring notifications are pre-anonymized at the API channel level (see [Data anonymization](#data-anonymization) above), so no readable end-user identity reaches the LLM when anonymization is active. If you follow best practices and do not hardcode credentials in metadata, sending metadata XML to an LLM carries no serious risk, but be aware that you are doing it.

--8<-- "../SECURITY.md"
