---
title: Salesforce CI/CD Setup Checklist
description: Chronological checklist to verify that your Salesforce CI/CD setup with sfdx-hardis is complete, including all integrations
---

<!-- markdownlint-disable MD013 -->

This checklist follows the [Setup Guide](salesforce-ci-cd-setup-home.md) in chronological order, with the [initialization merge request](salesforce-ci-cd-setup-merge-request.md) as the pivot: some items must be done **before** it, others only make sense **after** it.

Go through every item in order and tick the boxes. Anything left unticked is either a deliberate choice for your project, or a gap to fix before you let the team work on the pipeline.

Sections that depend on a platform are grouped by platform: find your platform, then tick only its own items.

- [Before the first merge request](#before-the-first-merge-request)
  - [Git repository](#git-repository)
  - [Salesforce orgs](#salesforce-orgs)
  - [SFDX project](#sfdx-project)
  - [CI server authentication](#ci-server-authentication)
  - [Git provider and CI server](#git-provider-and-ci-server)
  - [Pipelines](#pipelines)
  - [Project configuration](#project-configuration)
  - [Notification channels](#notification-channels)
  - [Ticketing integration](#ticketing-integration)
  - [AI integration](#ai-integration)
  - [Coding agents auto-fix](#coding-agents-auto-fix)
- [The first merge request](#the-first-merge-request)
- [After the first merge request](#after-the-first-merge-request)
  - [Integrations verification](#integrations-verification)
  - [Delta deployments](#delta-deployments)
  - [Other major orgs](#other-major-orgs)
  - [End to end validation](#end-to-end-validation)
  - [Setup clean up](#setup-clean-up)
  - [Team onboarding](#team-onboarding)
  - [Going further](#going-further)

---

## Before the first merge request

Everything in this phase must be in place before you open the initialization merge request, otherwise its control jobs cannot even run.

### Git repository

_See [Init Git repository](salesforce-ci-cd-setup-git.md)_

- [ ] The repository exists and contains the sfdx-hardis project sources.
- [ ] One major branch exists for each major Salesforce org (for example `main`, `preprod`, `uat`, `integration`).
- [ ] The lowest major branch (usually `integration`) is set as **default branch**.
- [ ] All major branches are **protected**: they can only be updated through Merge Requests / Pull Requests.
- [ ] **Allowed to merge** is restricted to Release Managers / Maintainers on all major branches except the lowest one.
- [ ] Source branches are deleted after merge, and squash is enforced for User Story branches.
- [ ] The `cicd` initialization branch has been created, under the lowest major branch (usually `integration`).

### Salesforce orgs

_See [Configure Orgs](salesforce-ci-cd-setup-activate-org.md)_

- [ ] **Dev Hub** is activated on the production org.
- [ ] **Sandbox source tracking** is activated on the Dev Hub, **before** creating or refreshing the sandboxes.
- [ ] **Enable ExperienceBundle Metadata API** is activated (Setup -> Digital Experiences).
- [ ] The sandbox of the **lowest major branch** (usually Integration) has been **created or refreshed from production**, so it matches production and has source tracking. It is the only major org you need at this stage.
- [ ] That sandbox is a **developer** sandbox, because you will clone it to create the developer sandboxes.
- [ ] Developer sandboxes are created **from the Integration org**, not from production.
- [ ] The Integration org has a **dedicated CI user** with the permissions needed to deploy (System Administrator profile or equivalent), pre-authorized on the External Client App.

> The sandboxes of the other major branches (UAT, PreProd...) are **not needed yet**. Create or refresh them after the first merge request, once the pipeline works on the first level.

### SFDX project

_See [Init SFDX Project](salesforce-ci-cd-setup-init-project.md)_

- [ ] The project was created with `sf hardis:project:create` (not the default Salesforce command).
- [ ] `manifest/package.xml` contains the metadata to deploy, with a current Salesforce API version.
- [ ] `manifest/destructiveChanges.xml` is **empty**, unless you deliberately want the initialization deployment to **delete metadata from the orgs**: if you removed useless metadata from the project during the setup and want it gone from the orgs too, list it here.
- [ ] `config/.sfdx-hardis.yml` exists, with `developmentBranch`, `availableTargetBranches` and the branch/org mapping filled in.
- [ ] `config/branches/.sfdx-hardis.<branch>.yml` exists for the lowest major branch, with the right `targetUsername` and `instanceUrl` (the other major branches come later, with their org).
- [ ] Installed packages are listed in `config/.sfdx-hardis.yml`, with `installDuringDeployments` and `installOnScratchOrgs` set according to your needs. _See [Retrieve installed packages](salesforce-ci-cd-setup-existing-org.md#retrieve-installed-packages)_
- [ ] `SFDX_DISABLE_FLOW_DIFF` is set to `true` **directly in the workflow file** of your git provider (`check-deploy.yml`, `.gitlab-ci.yml`, `azure-pipelines-checks.yml`, `bitbucket-pipelines.yml`, `Jenkinsfile`), for the duration of the setup, to avoid flooding merge requests with comments.
- [ ] `.gitignore` and `.forceignore` do not exclude metadata that must be versioned, and do exclude local artifacts.

### CI server authentication

_See [CI Server Authentication](salesforce-ci-cd-setup-auth.md)_

- [ ] `sf hardis:project:configure:auth` has been run for the **lowest major branch** (usually `integration`): it is the only one required to run the initialization merge request. The other major branches are done later, when their sandbox exists.
- [ ] An **External Client App** is present in the target org, with the certificate uploaded as Digital Signature and the CI user pre-authorized.
- [ ] `SFDX_CLIENT_ID_<ALIAS>` is defined in the CI/CD variables, `<ALIAS>` being the uppercased branch name.
- [ ] `SFDX_CLIENT_KEY_<ALIAS>` (AES passphrase) and/or `SFDX_CLIENT_CERT_<ALIAS>` is defined, matching the [certificate storage mode](salesforce-ci-cd-setup-auth.md#certificate-storage-modes) you selected.
- [ ] All credential variables are **masked / secret**, and not restricted to protected branches only if your pipelines run on other branches.
- [ ] If you use scratch orgs, Dev Hub authentication is configured too (`sf hardis:project:configure:auth --devhub` plus the `SFDX_CLIENT_*_<DEVHUB_ALIAS>` variables).
- [ ] No `SFDX_AUTH_URL_*` variable is used for a major org (it embeds a long-lived refresh token, reserve it for scratch orgs and Dev Hub).
- [ ] Login works from the CI server: a pipeline job reaches the org without falling back to an interactive prompt.

### Git provider and CI server

Find your platform below and tick only its items. Only what **you** have to do is listed: whatever the default sfdx-hardis workflow files already contain (job permissions, token passing, variable mapping for the default branch names, coding agent snippets, `auto-fix/` branch skipping) is not repeated here.

- **GitHub / GitHub Actions** _(see [variables](salesforce-ci-cd-setup-auth-github.md), [integration](salesforce-ci-cd-setup-integration-github.md))_
  - [ ] Folder `.github/workflows` is kept, the workflow files of the other providers are deleted.
  - [ ] Secrets are created in **Settings -> Secrets and variables -> Actions**.
  - [ ] Any secret **not already wired** in the `env` blocks of the templates is added there, since GitHub Actions does not expose secrets to jobs automatically. The templates wire the `SFDX_CLIENT_*` of the default branch names plus `SLACK_*`, `NOTIF_EMAIL_ADDRESS` and `JIRA_*`, so add for example your other branch aliases, `MS_TEAMS_WEBHOOK_URL`, `GOOGLE_CHAT_WEBHOOK_URL`, `NOTIF_API_*`, or the AI keys that are commented out.
  - [ ] Branch protection rules require the check deploy and MegaLinter status checks to pass before merge.
- **GitLab / GitLab CI** _(see [variables](salesforce-ci-cd-setup-auth-gitlab.md), [integration](salesforce-ci-cd-setup-integration-gitlab.md))_
  - [ ] Files `.gitlab-ci.yml` and `gitlab-ci-config.yml` are kept, the workflow files of the other providers are deleted.
  - [ ] Variables are created in **Settings -> CI/CD -> Variables**, **masked** when secret and **Protected variable** unselected.
  - [ ] In **Settings -> General -> Merge requests**, **Pipelines must succeed** is checked.
  - [ ] `USE_SCRATCH_ORGS` is set to `"false"` in `gitlab-ci-config.yml` if you use sandboxes only.
  - [ ] A project access token with role **Developer** and scope **api** is stored in variable `CI_SFDX_HARDIS_GITLAB_TOKEN`, so results are posted as Merge Request notes.
  - [ ] If you use a ticketing system: **Merge Commit Message Template** and **Squash Commit Message Template** include `%{issues}` and `%{all_commits}`, so ticket references survive the merge.
- **Azure DevOps / Azure Pipelines** _(see [variables](salesforce-ci-cd-setup-auth-azure.md), [integration](salesforce-ci-cd-setup-integration-azure.md))_
  - [ ] Files `azure-pipelines-checks.yml` and `azure-pipelines-deployment.yml` are kept, the workflow files of the other providers are deleted.
  - [ ] Pipeline **Check Pull Request** is created from `azure-pipelines-checks.yml`, with the continuous integration trigger **disabled**.
  - [ ] Pipeline **Deploy to org** is created from `azure-pipelines-deployment.yml`, with continuous integration **enabled** and branch filters including all major branches.
  - [ ] Branch policies on the major branches include **Build Validation** with the Check Pull Request pipeline.
  - [ ] Variables are defined on the pipelines (**Edit -> Variables**), and those **not already wired** in the templates are added to the YAML with `$(VARIABLE_NAME)`: the templates wire `SFDX_CLIENT_*_INTEGRATION` only, plus `SLACK_*`, `NOTIF_EMAIL_ADDRESS`, `JIRA_*` and `OPENAI_API_KEY`, so add for example your other branch aliases, `MS_TEAMS_WEBHOOK_URL`, `GOOGLE_CHAT_WEBHOOK_URL` or `NOTIF_API_*`.
  - [ ] **Contribute** and **Contribute to Pull Requests** are allowed on the Build Service, so the pipeline can post on Pull Requests.
  - [ ] A Work Item named **sfdx-hardis tech attachments** exists (or `AZURE_ATTACHMENTS_WORK_ITEM_ID` is defined), so Flow visual git diff images can be uploaded.
- **Bitbucket / Bitbucket Pipelines** _(see [variables](salesforce-ci-cd-setup-auth-bitbucket.md), [integration](salesforce-ci-cd-setup-integration-bitbucket.md))_
  - [ ] File `bitbucket-pipelines.yml` is kept, the workflow files of the other providers are deleted.
  - [ ] Variables are created in **Repository Settings -> Repository Variables**, secured when secret.
  - [ ] Merge checks require the pipeline to pass before merge.
  - [ ] A repository access token with scopes `pullrequest`, `pullrequest:write`, `repository`, `repository:write` is stored in variable `CI_SFDX_HARDIS_BITBUCKET_TOKEN`, so results are posted as Pull Request comments.
- **Jenkins** _(see [Jenkins setup](salesforce-ci-cd-setup-auth-jenkins.md))_
  - [ ] File `Jenkinsfile` is kept, the workflow files of the other providers are deleted.
  - [ ] The job is a **Multibranch Pipeline**, so `CHANGE_ID` is available and merge request comments can be posted.
  - [ ] Credentials are declared in Jenkins and exposed to the build as environment variables.
  - [ ] The token of your git provider is set: `CI_SFDX_HARDIS_GITHUB_TOKEN`, `CI_SFDX_HARDIS_GITLAB_TOKEN`, `CI_SFDX_HARDIS_AZURE_TOKEN` or `CI_SFDX_HARDIS_BITBUCKET_TOKEN`. The other variables are derived from the Jenkins built-in ones.

### Pipelines

The default workflow files already declare the three jobs (check deploy, code quality, deployment), their triggers and their artifacts. What is left to you:

- [ ] The **branch lists** of the workflow files are updated with **your** major branch names, if they differ from the defaults (`integration`, `uat`, `preprod`, `main`): each template has an `Add your major branches here` comment at the right place, and GitLab uses `DEPLOY_BRANCHES` in `gitlab-ci-config.yml`.
- [ ] The sfdx-hardis Docker image or plugin version used by the pipeline is the one you want (pin a version instead of `latest` if you need reproducible runs).
- [ ] The CI runner has enough minutes / capacity for the deployments.
- [ ] `SFDX_DEPLOY_WAIT_MINUTES` is increased if your deployments need more than the default 120 minutes.

### Project configuration

_See [Maintainer Guide](salesforce-ci-cd-config-home.md) and the [full list of configuration properties](schema/sfdx-hardis-json-schema-parameters.html)_

**Overwrite management is the most important part of this section.** Without `manifest/package-no-overwrite.xml`, every deployment overwrites the metadata that is maintained directly in the orgs: business users lose their Reports and Dashboards, and org-specific credentials and URLs are replaced by the ones of another environment. _See [Overwrite management](salesforce-ci-cd-config-overwrite.md)_

- **`manifest/package-no-overwrite.xml`**
  - [ ] The file exists at the root of the `manifest` folder, and is committed.
  - [ ] Metadata holding **org-specific values** is protected with `*`: `ConnectedApp`, `ExtlClntAppGlobalOauthSettings`, `NamedCredential`, `ExternalCredential`, `RemoteSiteSetting`, `SamlSsoConfig`.
  - [ ] Metadata **managed by business users in production** is protected with `*`: `Report`, `Dashboard`, and the `Wave*` types if you use CRM Analytics.
  - [ ] `ApprovalProcess` is protected if your approval processes reference users of a specific org.
  - [ ] `Profile` is protected if profiles are maintained manually in the orgs and access is driven by Permission Sets.
  - [ ] `FlexiPage` and `CustomApplication` items that embed hardcoded dashboard or record IDs are listed **by name**.
  - [ ] Wildcards are used where they save maintenance, for example `*__dlm` and `*__dlm.*` for Data Cloud objects and fields.
  - [ ] If production needs stricter protection than the lower orgs, `packageNoOverwritePath` points to a dedicated file in `config/branches/.sfdx-hardis.<branch>.yml`.

Then the rest of the project configuration:

- [ ] [Automated sources cleaning](salesforce-ci-cd-config-cleaning.md) is configured (`autoCleanTypes`), so User Story branches are cleaned before merge requests.
- [ ] Apex test configuration matches your policy (test level, minimum coverage).
- [ ] New User Story options are set (`availableTargetBranches`, `availableTargetBranchesLabels`, `sharedDevSandboxes`, `allowedOrgTypes`...) so contributors get the right prompts.
- [ ] Delta deployments are **NOT activated**: `useDeltaDeployment` is absent from `config/.sfdx-hardis.yml`, or set to `false`. The initialization merge request must deploy the **full package**. _See [Delta deployments](salesforce-ci-cd-config-delta-deployment.md)_

### Notification channels

_Overview: [Configure integrations](salesforce-ci-cd-setup-integrations-home.md)_

At least one channel must be configured, otherwise nobody is told when a deployment to a major org fails. Configure the ones you use.

- **Slack** _(see [Slack integration](salesforce-ci-cd-setup-integration-slack.md))_
  - [ ] Slack app created, with scopes `chat-write`, `chat-write.customize` and `chat-write.public`.
  - [ ] Auth token stored in variable `SLACK_TOKEN`.
  - [ ] Channel created, its ID stored in variable `SLACK_CHANNEL_ID`.
  - [ ] The bot user is **invited to the channel** (`/invite @sfdx-hardis-bot`).
- **Microsoft Teams** _(see [Teams integration](salesforce-ci-cd-setup-integration-ms-teams.md))_
  - [ ] Workflow "Post to a channel when a webhook request is received" created on the channel.
  - [ ] Webhook URL stored in variable `MS_TEAMS_WEBHOOK_URL`.
- **Google Chat** _(see [Google Chat integration](salesforce-ci-cd-setup-integration-google-chat.md))_
  - [ ] Incoming webhook created on the space (needs a Google Workspace account).
  - [ ] Webhook URL stored in variable `GOOGLE_CHAT_WEBHOOK_URL`.
- **Email** _(see [Email integration](salesforce-ci-cd-setup-integration-email.md))_
  - [ ] Recipients defined in variable `NOTIF_EMAIL_ADDRESS` (comma separated).
  - [ ] Email deliverability of the CI user is set to **Send through Salesforce**.
- **API, for example Grafana** _(see [API integration](salesforce-ci-cd-setup-integration-api.md))_
  - [ ] Logs endpoint defined in `NOTIF_API_URL`, with its auth variables (`NOTIF_API_BASIC_AUTH_USERNAME` / `NOTIF_API_BASIC_AUTH_PASSWORD` or `NOTIF_API_BEARER_TOKEN`).
  - [ ] Metrics endpoint defined in `NOTIF_API_METRICS_URL`, with its own auth variables, if you want Prometheus metrics.
  - [ ] sfdx-hardis dashboards imported in Grafana.

### Ticketing integration

- **Jira** _(see [Jira integration](salesforce-ci-cd-setup-integration-jira.md))_
  - [ ] `jiraHost` is defined in `.sfdx-hardis.yml`, so the VS Code extension can use it too.
  - [ ] Authentication is configured as CI/CD secrets: `JIRA_EMAIL` + `JIRA_TOKEN` (Basic Auth), `JIRA_CLIENT_ID` + `JIRA_CLIENT_SECRET` (OAuth2 service account with `read:jira-work` and `write:jira-work`), or `JIRA_PAT` (on-premise).
  - [ ] `jiraTicketRegex` is tuned to your ticket format in `.sfdx-hardis.yml`, if the default expression catches too much or too little.
- **Azure Boards** _(see [Azure Boards integration](salesforce-ci-cd-setup-integration-azure-boards.md))_
  - [ ] `SYSTEM_COLLECTIONURI`, `SYSTEM_ACCESSTOKEN`, `SYSTEM_TEAMPROJECT` and `BUILD_REPOSITORY_ID` are available from the pipelines.
  - [ ] The team knows that Work Items must be **linked to the Pull Requests** to be detected.
- **Any other ticketing tool** _(see [Generic ticketing](salesforce-ci-cd-setup-integration-generic-ticketing.md))_
  - [ ] `genericTicketingProviderRegex` is defined in `.sfdx-hardis.yml` and tested against real ticket references.
  - [ ] `genericTicketingProviderUrlBuilder` is defined in `.sfdx-hardis.yml`, with its `{REF}` segment.

### AI integration

_Optional, but it makes deployment errors much faster to solve. See [Setup AI integration](salesforce-ai-setup.md)_

- **Agentforce** _(see [With Agentforce](salesforce-ai-setup.md#with-agentforce))_
  - [ ] Agentforce is activated on the org used by the commands.
  - [ ] Prompt template **SfdxHardisGenericPrompt** exists in the org (`sf hardis:org:configure:generic-prompt` deploys it).
  - [ ] The CI user is assigned to permission set **Prompt Template User**.
  - [ ] `useAgentforce: true` in `.sfdx-hardis.yml`.
- **LangChain (OpenAI, Anthropic, Gemini, Ollama)** _(see [With LangChain](salesforce-ai-setup.md#with-langchain))_
  - [ ] `useLangchainLlm: true`, `langchainLlmProvider` and `langchainLlmModel` defined in `.sfdx-hardis.yml`, so all contributors share the same provider and model.
  - [ ] `LANGCHAIN_LLM_MODEL_API_KEY` defined as a **masked secret** (not needed for Ollama): API keys never go in `.sfdx-hardis.yml`.
- **OpenAI directly**
  - [ ] `useOpenaiDirect: true` and `openaiModel` defined in `.sfdx-hardis.yml`.
  - [ ] `OPENAI_API_KEY` defined as a masked secret, or gateway authentication configured.
- Whatever the provider:
  - [ ] API keys are stored as **masked secrets**, never committed in `.sfdx-hardis.yml`.
  - [ ] The security implications have been reviewed with the client, and the cost settings are understood (`AI_MAXIMUM_CALL_NUMBER`, `MAX_DEPLOYMENT_TIPS_AI_CALLS`).

### Coding agents auto-fix

_Optional. Only if you want the pipeline to fix deployment errors and push fix branches. See [Coding Agent Auto-Fix](salesforce-deployment-agent-autofix.md)_

The default workflow files already contain the coding agent install lines (commented out), the `git remote set-url` snippet and the `auto-fix/` branch skipping, so only the following is up to you.

- [ ] If you do not use the sfdx-hardis Docker image: the install line of the coding agent CLI you want is **uncommented** in the workflow file.
- [ ] Auto-fix is enabled: `codingAgentAutoFix: true` in `.sfdx-hardis.yml`.
- [ ] The agent is chosen: `codingAgent` in `.sfdx-hardis.yml` (`claude`, `codex-cli`, `gemini-cli`, `copilot-cli`).
- [ ] The API key of the chosen agent is set as a masked secret (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY` / `CODEX_API_KEY`, `GEMINI_API_KEY`, `COPILOT_GITHUB_TOKEN`), unless it reuses `LANGCHAIN_LLM_MODEL_API_KEY`.
- [ ] The token that lets the pipeline push branches and open merge requests is available:
  - [ ] **GitHub**: `CI_SFDX_HARDIS_GITHUB_PUSH_TOKEN`, either `secrets.GITHUB_TOKEN` with `contents: write` and `pull-requests: write`, or a fine-grained PAT with `Contents` and `Pull requests` read and write.
  - [ ] **GitLab**: `CI_SFDX_HARDIS_GITLAB_TOKEN` with scopes **api** and **write_repository**.
  - [ ] **Azure DevOps**: **Allow scripts to access OAuth token** enabled in the pipeline settings, or a PAT mapped to `CI_SFDX_HARDIS_AZURE_TOKEN`.
  - [ ] **Bitbucket**: `CI_SFDX_HARDIS_BITBUCKET_TOKEN`.
- [ ] Branch protection rules allow the bot to push `auto-fix/*` branches and open merge requests.

---

## The first merge request

_See [First merge request](salesforce-ci-cd-setup-merge-request.md)_

This is the initialization merge request: it deploys the **full package** to your lowest major org. Expect several rounds of errors and configuration fixes before it goes green.

- [ ] The merge request has `cicd` as source branch and the lowest major branch (usually `integration`) as target.
- [ ] `manifest/destructiveChanges.xml` is reviewed one last time before you merge: still empty, or containing **exactly** the metadata you decided to delete from the orgs, and nothing else.
- [ ] The **check deploy** job is triggered by the merge request, and ends green. _See [Solve deployment errors](salesforce-ci-cd-solve-deployment-errors.md)_
- [ ] The **code quality** (MegaLinter) job is green, or its remaining errors are known and accepted. _See [Handle MegaLinter errors](salesforce-ci-cd-solve-megalinter-errors.md)_
- [ ] The merge request has been merged, and the deployment job **deployed the full package** to the Integration org.
- [ ] The `cicd` branch is deleted.

---

## After the first merge request

The pipeline works on the first level. Now verify what could not be verified before, then extend to the other major orgs.

> **Every remaining configuration change goes through a new branch and a new merge request.** The `cicd` branch is gone and the major branches are protected, so from now on org authentication, delta deployments, cleaning options and any other `.sfdx-hardis.yml` update follow the same contribution process as a User Story, with the control jobs running on them.

### Integrations verification

Open a small test merge request with a real change and check what actually shows up.

- [ ] A deployment status comment is posted by the pipeline on the merge request, with the deployment errors and failing test classes when there are any.
- [ ] Quick Deploy is effective: after a successful check job, the deployment job reuses the validated deployment instead of running a full one (`SFDX_HARDIS_QUICK_DEPLOY` is not set to `false`). _See [Smart Deployments](salesforce-ci-cd-smart-deployment.md)_
- [ ] **A real notification has been received** on each configured channel, coming from an actual deployment job.
- [ ] Ticket references and links appear in merge request comments and in notifications.
- [ ] Tickets get a comment and a deployment tag once deployed in a major org (`DEPLOYED_TAG_TEMPLATE` if you customized the tag).
- [ ] A deployment error produces an AI assisted explanation in the comment, if you configured an LLM provider.
- [ ] Flow visual git diff works: once `SFDX_DISABLE_FLOW_DIFF` is back to `false`, a Flow change in a merge request produces a diagram in the comment.

### Delta deployments

_See [Delta deployments](salesforce-ci-cd-config-delta-deployment.md)_

- [ ] Delta deployments are activated **only now** that the initialization merge request is merged: `useDeltaDeployment: true` in `config/.sfdx-hardis.yml`.
- [ ] The activation is committed in a **new branch and merged with its own merge request**.
- [ ] Delta deployments are enabled for the **first level only** (User Story branches to `integration`). Between major orgs (`integration` to `uat`, `uat` to `preprod`...), full deployments are used, as delta is not recommended there.

### Other major orgs

Now that the first level works, set up the orgs of the upper major branches.

_See [Configure Orgs](salesforce-ci-cd-setup-activate-org.md) for the recommended sandbox types_

- [ ] The sandbox of each remaining major branch (UAT, PreProd...) is **created or refreshed from production**, so it starts from a state close to production.
- [ ] Each of them has a **dedicated CI user** with the permissions needed to deploy, pre-authorized on the External Client App.
- [ ] `sf hardis:project:configure:auth` has been run for each of these major branches, **from a new branch**, and its output (`config/branches/.sfdx-hardis.<branch>.yml`, encrypted key files) is merged with its own merge request.
- [ ] Their `SFDX_CLIENT_ID_<ALIAS>` and `SFDX_CLIENT_KEY_<ALIAS>` / `SFDX_CLIENT_CERT_<ALIAS>` variables are defined and masked.
- [ ] The External Client App of the **production** org is in place, created manually if Apex test errors prevented the automated deployment. _See [CI Server Authentication](salesforce-ci-cd-setup-auth.md)_

### End to end validation

The setup is only complete when a change travels all the way to production.

- [ ] A **User Story branch** can be created with `sf hardis:work:new`, and it creates or assigns the expected sandbox.
- [ ] `sf hardis:work:save` runs successfully: it updates `package.xml`, applies the cleanings and prepares the merge request.
- [ ] The check job on the merge request **passes** for a real change.
- [ ] After merge, the deployment job **deploys to the matching org**, and the change is visible in the Salesforce Setup.
- [ ] **Overwrite management really protects the orgs**: the items of `package-no-overwrite.xml` that already exist in the target org are removed from the deployed package, and their version in the org is left untouched. Check it on a Report or a Named Credential of a major org.
- [ ] The Apex tests actually pass on every major org.
- [ ] The same has been verified for **every** major branch, up to production. A pipeline that only works on `integration` is not a finished setup.
- [ ] Deploying to production has been done at least once from the pipeline, not manually.

### Setup clean up

Easy to forget, and it changes the daily experience of the team.

- [ ] `SFDX_DISABLE_FLOW_DIFF` is set back to `false` in the workflow file where you set it to `true`: it is only meant to be `true` during setup.
- [ ] Temporary setup artifacts are removed from the repository (`packagexmlfull.xml`, retrieve leftovers, unused workflow files of other git providers).
- [ ] `server.key` / `server.crt` are **not** committed in clear text, only the encrypted key file in `config/branches/.jwt/` if you chose that storage mode.
- [ ] Leftover translations of deleted Dashboards and Reports are removed from `translations/*.xml`. _See [Common issues](salesforce-ci-cd-setup-merge-request.md#common-issues)_
- [ ] No credential, token or Salesforce URL with a session is present in the git history.

### Team onboarding

- [ ] Every contributor installed the required tooling and the VS Code sfdx-hardis extension. _See [Installation guide](salesforce-ci-cd-use-install.md)_
- [ ] Every contributor cloned the repository and can create a User Story branch. _See [Clone repository](salesforce-ci-cd-clone-repository.md)_
- [ ] The team knows the [contribution process](salesforce-ci-cd-use-home.md): create a User Story, work on it, publish it, handle merge request results.
- [ ] Release Managers know how to [validate a merge request](salesforce-ci-cd-validate-merge-request.md) and how to handle [hotfixes](salesforce-ci-cd-hotfixes.md).
- [ ] The team knows that **custom Profiles deployed for the first time must be created manually** in the target org, cloned from "Minimal Access".
- [ ] Someone owns the pipeline: they get the notifications and they know where the job logs and artifacts are.

### Going further

Not part of the CI/CD pipeline itself, but usually set up right after.

- [ ] [Org Monitoring](salesforce-monitoring-home.md) is set up on a separate repository, with its own External Client App and its own notification variables.
- [ ] [Project documentation](salesforce-project-documentation.md) is generated and hosted, so the team has an up to date functional documentation of the org.
- [ ] [Deployment Agent](salesforce-deployment-agent-home.md) is set up if you want assisted resolution of deployment errors.
- [ ] [Sandbox refresh](salesforce-sandbox-refresh.md) procedure is documented for the day a major sandbox is refreshed.
