---
title: Configure CI Server authentication to Salesforce orgs
description: Learn how to configure CI Server authentication to automate deployments
---
<!-- markdownlint-disable MD013 -->

## Major orgs

To automate [deployments from major branches to their related org](salesforce-ci-cd-deploy-major-branches.md), you need to **configure secure authentication from your CI server to an External Client App**.

> Note: _You need [openssl](https://www.openssl.org/) installed on your computer (available in `Git bash`)_

- Remain in your initialization branch `cicd`, or a sub-branch of your lowest level major branch (usually `integration`).
- For each major branch to link to an org, run the sfdx-hardis command **Configuration ->** ![Configure Org CI Authentication](assets/images/btn-configure-ci-auth.jpg) (`sf hardis:project:configure:auth`)

For example, run the command for `integration`, `uat`, `preprod` and `production` major branches.

> If messages ask you to **run twice** the same command, it's **normal**, it's for technical reasons :)

> If you have **errors in your apex tests classes**, you may not be able to deploy the app to the Production org automatically.
> You will need to **create the app manually** by following the instructions in yellow in the error message, or follow the [Advanced scenarios](#advanced-scenarios) below.
> You can do it later, after having succeeded to merge the first merge request in the lower major branch (usually `integration`).

<div style="text-align:center"><iframe width="560" height="315" src="https://www.youtube.com/embed/OzREUu5utVI" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>

> ![Under the hood](assets/images/engine.png) **_Under the hood_**
>
> The command `sf hardis:project:configure:auth` will create/update:
>
> - `.sfdx-hardis.yml` branch configuration file (committed to repo)
> - A self-signed SSL certificate (`server.key` / `server.crt`)
> - An **External Client App** deployed to the target org via metadata API
> - CI environment variables (manually set in CI/CD server UIs)
>
> At runtime, sfdx-hardis uses the [OAuth 2.0 JSON Web Token (JWT) bearer flow](https://developer.salesforce.com/docs/atlas.en-us.sfdx_dev.meta/sfdx_dev/sfdx_dev_auth_jwt_flow.htm) with the Consumer Key stored as a secured CI/CD variable and the certificate key decrypted on the fly using an AES passphrase stored as a secured CI/CD variable.

See how to configure pipelines and CI/CD variables on different Git providers:

- [Gitlab tutorial](salesforce-ci-cd-setup-auth-gitlab.md)
- [Azure tutorial](salesforce-ci-cd-setup-auth-azure.md), **with Pipeline setup instructions**
- [GitHub tutorial](salesforce-ci-cd-setup-auth-github.md)
- [BitBucket tutorial](salesforce-ci-cd-setup-auth-bitbucket.md)
- [Jenkins tutorial](salesforce-ci-cd-setup-auth-jenkins.md)

## Additional information

The sections below cover background information, advanced scenarios, and reference details. You do not need them for the standard configuration described above.

### External Client App

sfdx-hardis uses an **External Client App** (metadata type `ExternalClientApplication`, managed in **Setup > External Client App Manager**) to authenticate from CI to the target Salesforce org via JWT bearer flow.

It is a good practice to use **one dedicated External Client App per use case** (one for CI/CD, another one for [Monitoring](salesforce-monitoring-home.md), etc.). This way, if you ever need to investigate or rotate credentials, you can identify exactly which application is involved.

### Certificate storage modes

When the wizard generates the SSL certificate, it asks where you want to store the **encrypted private key**:

1. **Encrypted file in repo** (default): the encrypted `<branchName>.key` file is committed to `config/branches/.jwt/`. Only `SFDX_CLIENT_ID_<ALIAS>` and `SFDX_CLIENT_KEY_<ALIAS>` need to be set as CI variables (the latter being the AES passphrase used to decrypt the file at runtime).
2. **CI variable**: nothing is committed to the repo. You set three CI variables: `SFDX_CLIENT_ID_<ALIAS>`, `SFDX_CLIENT_KEY_<ALIAS>`, and `SFDX_CLIENT_CERT_<ALIAS>` (which holds the encrypted key content directly).

When you bring your own CA-signed certificate (see [Advanced scenarios](#advanced-scenarios) below), a **third mode** is available: store the **raw PEM private key** directly in `SFDX_CLIENT_CERT_<ALIAS>`, no AES passphrase needed.

The variable-storage modes are useful when your security policy forbids committing any key material (even encrypted) to git.

### CI environment variables

sfdx-hardis resolves the JWT credentials in this priority order:

| Variable                                                  | Required                                                                                                           | Description                                                                                                                                                                                                                                  |
|-----------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `SFDX_CLIENT_ID_<ALIAS>`                                  | Yes                                                                                                                | The **Consumer Key** of the External Client App.                                                                                                                                                                                             |
| `SFDX_CLIENT_CERT_<ALIAS>`                                | Required in CI-variable storage modes; ignored when the encrypted key file is committed in `config/branches/.jwt/` | Either the **raw PEM private key** (content starts with `-----BEGIN`, no decryption needed) **or** the sfdx-hardis-encrypted key content (`<iv-hex>:<encrypted-hex>`, needs `SFDX_CLIENT_KEY_<ALIAS>`). sfdx-hardis auto-detects the format. |
| `SFDX_CLIENT_KEY_<ALIAS>`                                 | Only with encrypted storage (file or variable)                                                                     | The **AES-256 passphrase** used by sfdx-hardis to decrypt the encrypted private key (32 hex characters).                                                                                                                                     |
| `SFDX_CLIENT_ID` / `SFDX_CLIENT_CERT` / `SFDX_CLIENT_KEY` | Fallback                                                                                                           | Same as above, but without the `_<ALIAS>` suffix. Only useful if you have a single org alias.                                                                                                                                                |

`<ALIAS>` is the **uppercased branch name** (for example `INTEGRATION`, `UAT`, `PREPROD`, `PRODUCTION`). For the Dev Hub, the alias is the value of `devHubAlias` from `.sfdx-hardis.yml` (often `DEVHUB_<PROJECTNAME>`).

> sfdx-hardis also recognizes `SFDX_AUTH_URL_<ALIAS>` and `SFDX_AUTH_URL_DEV_HUB` for SFDX auth URL flow (mostly used for scratch orgs and Dev Hubs). When set, JWT is skipped and `sf org login sfdx-url` is used instead.

### Use a CA-signed certificate

The standard wizard creates everything end-to-end with a self-signed certificate. The section below covers the **CA-signed certificate** case (issue [#1900](https://github.com/hardisgroupcom/sfdx-hardis/issues/1900)), where you bring your own key pair and the External Client App is created manually in Setup. The same flow also applies when you already have a working External Client App and just want to wire it up to a new pipeline.

If your organization requires a certificate signed by an internal or public Certificate Authority instead of the self-signed certificate generated by sfdx-hardis, you cannot let the wizard auto-generate the certificate. The flow is fully supported, but you create the External Client App manually and configure sfdx-hardis with two CI/CD variables containing the raw PEM key - **no bash encryption script needed**.

#### 1. Generate the key and CSR, get the certificate signed

```bash
# Private key (keep this file secret)
openssl genrsa -out server.key 2048

# Certificate Signing Request to send to your CA
openssl req -new -key server.key -out server.csr \
  -subj "/C=FR/ST=Paris/L=Paris/O=YourCompany/OU=sfdx-hardis/CN=ci.yourcompany.com"
```

Send `server.csr` to your CA. You will receive `server.crt` back (and possibly an intermediate chain). Only `server.crt` (the leaf certificate) is uploaded to the External Client App.

#### 2. Create the External Client App manually

In the target Salesforce org:

1. **Setup > External Client App Manager > New External Client App**.
2. **Basic Information**: enter Name, API Name (for example `sfdxhardis_integration`), Contact Email, and a Description.
3. **API (Enable OAuth Settings)**:
    - Check **Enable OAuth**.
    - Callback URL: `http://localhost:1717/OauthRedirect`
    - Check **Use Digital Signature** and upload your `server.crt` file.
    - Selected OAuth Scopes: `Manage user data via APIs (api)`, `Access the Salesforce CLI (Web)` (`web`), `Perform requests at any time (refresh_token, offline_access)`.
4. Save. **Wait a few minutes** for the app to propagate.
5. Open the newly created app, then **Edit Policies**:
    - Under **OAuth Policies**, set **Permitted Users** to **Admin approved users are pre-authorized** (required for JWT).
    - IP Relaxation: **Enforce IP restrictions** (or as your security team requires).
    - Refresh Token Policy: as your security team requires.
6. **Manage Profiles** (or Permission Sets): add the **profile of the CI user** (typically `System Administrator` or a dedicated DevOps profile). Without this, JWT will fail with `user hasn't approved this consumer`.
7. Copy the **Consumer Key** from the External Client App detail page: this is your `SFDX_CLIENT_ID_<ALIAS>` value.

#### 3. Run the wizard and pick the CA-signed path

Run:

```shell
sf hardis:project:configure:auth
```

When the wizard reaches the certificate step, it will ask **"How do you want to provide the SSL certificate?"**. Pick **"Use a CA-signed certificate I already have"**. The wizard will then:

- prompt you to paste the **Consumer Key** from step 2.7,
- prompt for the path to your **`server.key`** file (PEM private key),
- print the two CI/CD variables you need to set, with the raw values to copy/paste.

The wizard does not generate any certificate, does not deploy any External Client App, and does not commit any key material to the repo.

#### 4. Set CI variables and validate

Set in your CI provider, scoped to the matching branch:

- `SFDX_CLIENT_ID_<ALIAS>` = the Consumer Key from step 2.7
- `SFDX_CLIENT_CERT_<ALIAS>` = the **full content** of `server.key`, including the `-----BEGIN ... PRIVATE KEY-----` and `-----END ... PRIVATE KEY-----` lines (newlines preserved)

`SFDX_CLIENT_KEY_<ALIAS>` is **not** needed in this mode: sfdx-hardis auto-detects that `SFDX_CLIENT_CERT_<ALIAS>` starts with `-----BEGIN` and uses the key as-is, without decryption.

To validate locally before pushing:

```bash
export SFDX_CLIENT_ID_INTEGRATION="<consumer-key>"
export SFDX_CLIENT_CERT_INTEGRATION="$(cat server.key)"
sf hardis:auth:login --target-org integration
```

#### 5. Rotate or migrate later

Because the CSR/key pair lives on your side, you can:

- **Rotate the certificate**: generate a new CSR, get it signed, upload the new `server.crt` to the existing External Client App (Digital Signature setting), and update `SFDX_CLIENT_CERT_<ALIAS>` with the new `server.key` content. The Consumer Key does not change.
- **Migrate Git provider**: just set the same two CI variables in the new provider. No transformation needed.

> Curious about how sfdx-hardis resolves credentials at runtime (alias lookup order, JWT private key format auto-detection, key file lookup paths, etc.)? See the **Technical explanations** section of [`hardis:auth:login`](hardis/auth/login.md).

### Dev Hub

If you are **using scratch orgs**, you also need to **configure authentication for the Dev Hub** (even if you already configured authentication for the production org).

To do that, run the following command:

```shell
sf hardis:project:configure:auth --devhub
```

This stores the Dev Hub alias / username / instance URL in the project-level `.sfdx-hardis.yml` and generates a dedicated key pair under `config/.jwt/`. Set `SFDX_CLIENT_ID_<DEVHUB_ALIAS>` plus either:

- `SFDX_CLIENT_KEY_<DEVHUB_ALIAS>` (and optionally `SFDX_CLIENT_CERT_<DEVHUB_ALIAS>` with the encrypted key) for the self-signed flow, or
- `SFDX_CLIENT_CERT_<DEVHUB_ALIAS>` with the raw PEM key content for the CA-signed flow.

Alternatively, for scratch-org workflows where JWT is not practical, you can set `SFDX_AUTH_URL_DEV_HUB` with the output of `sf org display --target-org <devhub-alias> --verbose --json | jq -r .result.sfdxAuthUrl`.
