---
title: Create Git provider access tokens (GitHub, GitLab, Azure DevOps, Bitbucket)
description: Step by step guide to create a Personal Access Token (PAT) for GitHub, GitLab, Azure DevOps and Bitbucket, used to clone repositories and to connect the vscode-sfdx-hardis Pipeline view
---

<!-- markdownlint-disable MD013 -->

- [When do you need a token?](#when-do-you-need-a-token)
- [GitHub](#github)
- [GitLab](#gitlab)
- [Azure DevOps](#azure-devops)
- [Bitbucket](#bitbucket)
- [Storing the token securely](#storing-the-token-securely)

---

## When do you need a token?

Most Git platforms no longer accept your account password over HTTPS. You will need to create a **Personal Access Token** (PAT) or an **App / API token** in the following situations:

- **Cloning a repository from VS Code over HTTPS**: when VS Code (or `git`) prompts for a username and password, paste your account name as the username and the **token as the password**.
- **Connecting the [vscode-sfdx-hardis Pipeline view](vscode-extension.md) to your Git platform**: the extension calls the Git platform REST API (to list pull requests, jobs, etc.). When you open the Pipeline panel, it asks for a token (or uses the official VS Code authentication for GitHub).

> **Security tips**
>
> - Always give the token the **smallest possible scope**.
> - Set the **shortest expiration** that still fits your workflow.
> - **Never commit a token** to a repository or paste it in a chat.
> - If a token leaks, **revoke it immediately** from your Git provider.

---

## GitHub

GitHub is supported in two ways by vscode-sfdx-hardis:

- **Recommended**: sign in with the built-in **VS Code GitHub authentication** (the extension calls `vscode.authentication.getSession("github", ["repo"])`). No manual token is needed.
- Or create a **fine-grained Personal Access Token** scoped to the single Salesforce repository you need to work on (required for `git clone` over HTTPS, GitHub Enterprise Server, or when the VS Code GitHub sign-in is not available).

> **Do not use classic tokens.** Classic Personal Access Tokens grant access to **all** repositories you can read. Always use a **fine-grained token restricted to the one repository** you need.

### Create a fine-grained Personal Access Token

1. Sign in to GitHub and open [https://github.com/settings/personal-access-tokens/new](https://github.com/settings/personal-access-tokens/new). (Navigation: profile picture -> **Settings** -> **Developer settings** -> **Personal access tokens** -> **Fine-grained tokens**.)
2. Fill in:
   - **Token name**: `sfdx-hardis - <repository-name>` (max 40 characters).
   - **Expiration**: pick the shortest duration that fits your team policy. The maximum is capped by your organization's policy when applicable.
   - **Resource owner**: select the user or organization that owns the Salesforce repository.
   - **Repository access**: choose **Only select repositories** and pick the **single repository** you need to work on. **Never** pick "All repositories" or "Public repositories".
3. Under **Repository permissions**, grant the **minimum** required:
   - `Contents`: **Read and write** -> clone and push.
   - `Pull requests`: **Read and write** -> list and comment pull requests from the Pipeline view.
   - `Actions`: **Read-only** (optional) -> read GitHub Actions workflow runs from the Pipeline view.
   - `Metadata`: **Read-only** (added automatically and mandatory).
4. Leave all **Account permissions** at **No access**.
5. Click **Generate token** and **copy the value immediately** (you will not be able to see it again).
6. If the repository is owned by an organization that requires approval, the token will be marked as **pending** and limited to public-resource reads until an admin approves it in the org's **Personal access tokens** settings.

> GitHub limits each user to **50 active fine-grained tokens**. Revoke unused ones from [https://github.com/settings/personal-access-tokens](https://github.com/settings/personal-access-tokens) when you hit the cap.

### GitHub Enterprise Server

Replace `github.com` by your enterprise host (for example `https://github.mycompany.com/settings/personal-access-tokens/new`). The procedure is identical and the same "fine-grained, single repository" rule applies.

> When `git` asks for credentials, use your **GitHub username** + the **token as the password**.

---

## GitLab

GitLab does not allow login with a password through Git anymore. You need a **Personal Access Token**.

### Create a Personal Access Token

1. Sign in to GitLab (`gitlab.com` or your self-hosted instance) and open:
   - GitLab.com: [https://gitlab.com/-/user_settings/personal_access_tokens](https://gitlab.com/-/user_settings/personal_access_tokens)
   - Self-hosted: `https://<your-gitlab-host>/-/user_settings/personal_access_tokens`
2. Fill in:
   - **Token name**: `sfdx-hardis`
   - **Expiration date**: **mandatory since GitLab 16.0** (non-expiring tokens are no longer allowed for regular users). The maximum is **365 days** by default (admins can extend this on self-hosted instances).
   - **Scopes**:
     - `api` -> required for the vscode-sfdx-hardis Pipeline view (read/write merge requests, pipelines). Implies `read_repository` and `write_repository`.
     - `read_user` -> required to identify the connected user.
     - `read_repository` and `write_repository` -> only needed if you do **not** grant `api`; required to clone and push over HTTPS.
3. Click **Create personal access token**.
4. **Copy the token immediately** (it is only shown once).

### Use the token

- When prompted by VS Code or `git`, use your **GitLab username** + the **token as the password**.
- In the **vscode-sfdx-hardis Pipeline view**, paste the token when asked. It is stored in the VS Code Secret Storage (OS keychain) under `CI_SFDX_HARDIS_GITLAB_TOKEN`.

> Quick link (preconfigured for sfdx-hardis): [https://gitlab.com/-/user_settings/personal_access_tokens?name=sfdx-hardis&scopes=api,read_user](https://gitlab.com/-/user_settings/personal_access_tokens?name=sfdx-hardis&scopes=api,read_user)

Official docs: [https://docs.gitlab.com/user/profile/personal_access_tokens/](https://docs.gitlab.com/user/profile/personal_access_tokens/)

Video tutorial: [https://www.youtube.com/watch?v=9y5VmmYHuIg](https://www.youtube.com/watch?v=9y5VmmYHuIg)

---

## Azure DevOps

Azure DevOps uses **Personal Access Tokens** (PAT) bound to your Azure DevOps **organization**.

> **Microsoft now recommends Microsoft Entra tokens over PATs** for new integrations (PATs are flagged as a security risk because they are long-lived). If your organization supports Entra-based authentication for VS Code / `git`, prefer it. Use a PAT only when Entra is not available for your tool. See [Microsoft's PAT reduction guidance](https://devblogs.microsoft.com/devops/reducing-pat-usage-across-azure-devops/).

### Create a Personal Access Token

1. Sign in to your Azure DevOps organization: `https://dev.azure.com/<your-organization>`.
2. Open the **user settings** (gear icon, top right) -> **Personal access tokens**.
   - Direct link: `https://dev.azure.com/<your-organization>/_usersSettings/tokens`
3. Click **+ New Token** and fill in:
   - **Name**: `sfdx-hardis`
   - **Organization**: the one that hosts your Salesforce repository.
   - **Expiration**: pick the shortest duration that fits your policy. Your tenant admin may cap the maximum lifetime through PAT policies.
   - **Scopes** (use **Custom defined** - do NOT pick "Full access"):
     - `Code`: **Read & write** -> clone, push, list pull requests, **and comment on pull requests** (PR threads are part of the Code scope, there is no separate "Pull Request Threads" scope).
     - `Build`: **Read** -> read pipeline runs from the Pipeline view.
     - `Release`: **Read** (optional) -> if you use Azure Release pipelines.
4. Click **Create** and **copy the token immediately** (it is shown only once).

> Your administrator may [restrict PAT creation](https://learn.microsoft.com/en-us/azure/devops/organizations/accounts/manage-pats-with-policies-for-administrators) (full-scope tokens, long lifetimes, or PAT creation entirely). If you cannot create the PAT you need, ask to be added to the allow list.

### Use the token

- When prompted by VS Code or `git`, leave the username empty (or use anything) and paste the **token as the password**.
- In the **vscode-sfdx-hardis Pipeline view**, paste the token when asked. It is stored in the VS Code Secret Storage under `CI_SFDX_HARDIS_AZURE_TOKEN` and also exposed as `SYSTEM_ACCESSTOKEN` to sfdx-hardis CLI calls.

Official docs: [https://learn.microsoft.com/en-us/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate](https://learn.microsoft.com/en-us/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate)

---

## Bitbucket

Bitbucket Cloud offers two ways to authenticate. **Which one you can use depends on your role on the repository**:

- **If you have the Admin role on the repository** -> create a **Repository Access Token** (scoped to that single repo). This is the cleanest option.
- **If you do not have the Admin role** -> you cannot create a repository access token. You must use an **Atlassian API token** with the appropriate Bitbucket scopes (linked to your personal Atlassian account).

> **App passwords are being removed.** Atlassian stopped accepting new app passwords on **September 9, 2025**, and existing app passwords stop working on **June 9, 2026**. Do not create new integrations with app passwords - use Repository Access Tokens or Atlassian API tokens instead.

### Option 1 - Repository Access Token (Admin role required)

> This option is only available if you have the **Admin** role on the repository. If the **Access tokens** menu does not appear in your repository settings, skip to Option 2.
>
> **Project Access Tokens** and **Workspace Access Tokens** are also available but are **Premium plan only features**. Each workspace is also limited to **25 access tokens** total.

1. Sign in to Bitbucket and open your repository.
2. Go to **Repository settings** -> **Security** -> **Access tokens**.
   - Direct link: `https://bitbucket.org/<workspace>/<repo>/admin/access-tokens/`
3. Click **Create access token** and fill in:
   - **Name**: `sfdx-hardis`
   - **Expiry**: pick the shortest duration that fits your policy.
   - **Permissions** (exact UI labels):
     - **Repositories**: **Read** and **Write** (clone, push, and read commit build statuses reported by Jenkins / external CI).
     - **Pull requests**: **Read** and **Write** (list and comment pull requests).
     - **Pipelines**: **Read** (only if your project uses **Bitbucket Pipelines** - not needed for Jenkins).
4. Click **Create**. **Copy the token immediately** (it is only shown once).
5. In the **vscode-sfdx-hardis Pipeline view**, when prompted for the authentication method, choose **Access token** and paste the value.

> Tip for team leads: if several developers need access, prefer creating one Repository Access Token per developer (rather than sharing one) so you can revoke them independently.

### Option 2 - Atlassian API token with scopes (any user)

If you do not have the Admin role on the repository (you cannot create a Repository Access Token), create a personal **Atlassian API token** scoped to the minimum Bitbucket permissions you need.



1. Open [https://id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens).
2. Click **Create API token with scopes** (the scoped option, **not** the legacy "Create API token" without scopes).
3. Fill in:
   - **Name**: `sfdx-hardis - <repository-name>`
   - **Expiry**: pick the shortest duration allowed by your policy (1 year max).
   - **App**: select **Bitbucket**.
   - **Scopes** (grant the **minimum** required - note that `write:` scopes do **not** automatically imply `read:`, you must tick both):
     - `read:repository:bitbucket` -> clone, browse the repo, **and read commit build statuses reported by external CI (Jenkins, CircleCI, GitHub Actions, etc.)**. This is what the Pipeline view uses to list Jenkins builds when you are not a repository admin.
     - `write:repository:bitbucket` -> push commits.
     - `read:pullrequest:bitbucket` -> list pull requests in the Pipeline view. (Required separately - it is **not** implied by `read:repository:bitbucket`.)
     - `write:pullrequest:bitbucket` -> comment deployment results on pull requests.
     - `read:pipeline:bitbucket` (optional) -> only needed if your project uses **Bitbucket Pipelines** (Atlassian's native CI). **Not required for Jenkins builds**, which are exposed through the commit statuses API and covered by `read:repository:bitbucket`.
     - `read:user:bitbucket` -> identify the connected user.
4. Click **Create** and **copy the token immediately** (it is only shown once).
5. In the **vscode-sfdx-hardis Pipeline view**, when prompted for the authentication method, choose **Email + API token** and paste:
   - **Email**: your **Atlassian account email** (used for REST API calls).
   - **API token**: the value you just copied.

> **Do not use legacy unscoped API tokens or "App passwords".** Unscoped tokens grant much wider access than needed, and **app passwords stop working on June 9, 2026**.

### Use the token with `git` over HTTPS

- With a **Repository Access Token**: use `x-token-auth` as username and the **token as the password**.
- With an **Atlassian API token**: use **either** your **Bitbucket username** **or** the static username **`x-bitbucket-api-token-auth`**, and the **API token as the password**. Do **not** use your Atlassian email here - the email is for REST API calls only, not for `git`.

The vscode-sfdx-hardis Pipeline view stores the value under `CI_SFDX_HARDIS_BITBUCKET_TOKEN` (and the email under `CI_SFDX_HARDIS_BITBUCKET_EMAIL` when using Option 2) in the VS Code Secret Storage.

Official docs:

- Repository Access Tokens: [https://support.atlassian.com/bitbucket-cloud/docs/repository-access-tokens/](https://support.atlassian.com/bitbucket-cloud/docs/repository-access-tokens/)
- Repository Access Token permissions: [https://support.atlassian.com/bitbucket-cloud/docs/repository-access-token-permissions/](https://support.atlassian.com/bitbucket-cloud/docs/repository-access-token-permissions/)
- Atlassian API tokens with scopes for Bitbucket: [https://support.atlassian.com/bitbucket-cloud/docs/api-tokens/](https://support.atlassian.com/bitbucket-cloud/docs/api-tokens/)
- Bitbucket API token scope reference: [https://support.atlassian.com/bitbucket-cloud/docs/api-token-permissions/](https://support.atlassian.com/bitbucket-cloud/docs/api-token-permissions/)
- Using API tokens with `git`: [https://support.atlassian.com/bitbucket-cloud/docs/using-api-tokens/](https://support.atlassian.com/bitbucket-cloud/docs/using-api-tokens/)
- App password deprecation timeline: [https://www.atlassian.com/blog/bitbucket/bitbucket-cloud-transitions-to-api-tokens-enhancing-security-with-app-password-deprecation](https://www.atlassian.com/blog/bitbucket/bitbucket-cloud-transitions-to-api-tokens-enhancing-security-with-app-password-deprecation)

---

## Storing the token securely

- The vscode-sfdx-hardis extension stores tokens in the **VS Code Secret Storage** (backed by your OS keychain: Windows Credential Manager, macOS Keychain, GNOME Keyring). Tokens are **never written to disk in plain text** and **never logged**.
- For `git` itself, enable the credential helper so you only paste the token once:

```bash
git config --global credential.helper store
```

> On Windows, the default credential helper is `manager-core` and stores the token in **Windows Credential Manager**. You do not usually need to change it.

- If you ever suspect a token leak (committed by mistake, shared in a screenshot, etc.), **revoke it immediately** from the Git provider UI and create a new one.

---

You are now ready to [clone your repository](salesforce-ci-cd-clone-repository.md) and start working on the project.
