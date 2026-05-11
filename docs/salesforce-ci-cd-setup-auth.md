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
> You will need to **create the app manually** by following the instructions in yellow in the error message, or follow the [Additional information](#additional-information) below.
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

When you bring your own CA-signed certificate (see [Use a CA-signed certificate](#use-a-ca-signed-certificate) below), a **third mode** is available: store the **raw PEM private key** directly in `SFDX_CLIENT_CERT_<ALIAS>`, no AES passphrase needed.

The variable-storage modes are useful when your security policy forbids committing any key material (even encrypted) to git.

### CI environment variables

sfdx-hardis resolves the JWT credentials in this priority order:

| Variable                                                  | Required                                                                                                           | Description                                                                                                                                                                                                                                           |
|-----------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `SFDX_CLIENT_ID_<ALIAS>`                                  | Yes                                                                                                                | The **Consumer Key** of the External Client App.                                                                                                                                                                                                      |
| `SFDX_CLIENT_CERT_<ALIAS>`                                | Required in CI-variable storage modes; ignored when the encrypted key file is committed in `config/branches/.jwt/` | Either the **raw PEM private key** (a PEM block whose header matches `-----BEGIN ... PRIVATE KEY-----`, no decryption needed) **or** the sfdx-hardis-encrypted key content (`<iv-hex>:<encrypted-hex>`, needs `SFDX_CLIENT_KEY_<ALIAS>`). sfdx-hardis auto-detects the format. |
| `SFDX_CLIENT_KEY_<ALIAS>`                                 | Only with encrypted storage (file or variable)                                                                     | The **AES-256 passphrase** used by sfdx-hardis to decrypt the encrypted private key (32 hex characters).                                                                                                                                              |
| `SFDX_CLIENT_ID` / `SFDX_CLIENT_CERT` / `SFDX_CLIENT_KEY` | Fallback                                                                                                           | Same as above, but without the `_<ALIAS>` suffix. Only useful if you have a single org alias.                                                                                                                                                         |

`<ALIAS>` is the **uppercased branch name** (for example `INTEGRATION`, `UAT`, `PREPROD`, `PRODUCTION`). For the Dev Hub, the alias is the value of `devHubAlias` from `.sfdx-hardis.yml` (often `DEVHUB_<PROJECTNAME>`).

> ⚠️ **Less secure alternative:** sfdx-hardis also recognizes `SFDX_AUTH_URL_<ALIAS>` and `SFDX_AUTH_URL_DEV_HUB` for the SFDX auth URL flow. When set, JWT is skipped and `sf org login sfdx-url` is used instead. **Do not use this for major orgs (integration / UAT / preprod / production).** An SFDX auth URL embeds a long-lived **OAuth refresh token** that grants full org access if leaked; unlike JWT, it cannot be tied to a specific signing certificate and cannot be rotated without re-authenticating manually. Reserve it for **scratch orgs** and **Dev Hub** scenarios where JWT cannot be set up.

### Use a CA-signed certificate

If your organization requires a certificate signed by an internal or public Certificate Authority instead of the self-signed certificate generated by sfdx-hardis, the setup is straightforward:

1. Generate your key pair, get `server.crt` signed by your CA, and create the **External Client App manually in Setup** with `server.crt` uploaded as **Digital Signature**, Permitted Users = **Admin approved users are pre-authorized**, and the CI user's profile assigned.
2. Set two CI/CD variables for the matching branch:
    - `SFDX_CLIENT_ID_<ALIAS>` = the **Consumer Key** of the External Client App.
    - `SFDX_CLIENT_CERT_<ALIAS>` = the **full PEM content of your private key file** (`server.key`), including the `-----BEGIN ... PRIVATE KEY-----` and `-----END ... PRIVATE KEY-----` lines.

That's it. **Do not set** `SFDX_CLIENT_KEY_<ALIAS>` in this mode: sfdx-hardis auto-detects that `SFDX_CLIENT_CERT_<ALIAS>` starts with `-----BEGIN` and uses the key as-is, with no decryption step.

> 💡 **Fetching the key from a vault at runtime:** because sfdx-hardis only reads `SFDX_CLIENT_CERT_<ALIAS>` from the environment when `hardis:auth:login` runs, you do not have to store the key as a static CI/CD variable. You can add your own pipeline step **before** `sf hardis:auth:login` that retrieves the PEM key from your secrets backend (HashiCorp Vault, AWS Secrets Manager, Azure Key Vault, GCP Secret Manager, CyberArk Conjur, etc.) and exports it as `SFDX_CLIENT_CERT_<ALIAS>`. Example:
>
> ```bash
> # Fetch the private key from Vault, then run sfdx-hardis as usual
> export SFDX_CLIENT_ID_INTEGRATION="$(vault kv get -field=consumer_key secret/sf/integration)"
> export SFDX_CLIENT_CERT_INTEGRATION="$(vault kv get -field=private_key secret/sf/integration)"
> sf hardis:auth:login --target-org integration
> ```

> 💡 **Bring your own authentication script:** if neither flow above fits your security policy, you can skip sfdx-hardis's authentication helper entirely. Authenticate however you want (custom `sf org login` invocation, short-lived OAuth token from your IdP, JWT minted by a privileged service, etc.) and just make sure the `sf` CLI ends up with a **default `target-org`** (or `target-dev-hub`) pointing at the right org **before** any `hardis:*` command runs. The prerun auth hook detects that an org is already connected (via `sf org display`) and skips its own login flow, so the rest of the pipeline runs unchanged. Example:
>
> ```bash
> # Custom step: authenticate however you want, then set the default org
> ./my-company-auth.sh --output sfdx-auth-url.txt
> sf org login sfdx-url --sfdx-url-file sfdx-auth-url.txt --alias integration --set-default
>
> # sfdx-hardis picks up the already-connected org and runs normally
> sf hardis:project:deploy:smart --check
> ```

To rotate the certificate later, generate a new key/CSR pair, upload the new `server.crt` to the same External Client App, and update `SFDX_CLIENT_CERT_<ALIAS>` (or the vault entry it is fetched from) with the new key content. The Consumer Key does not change.

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

As a **less secure last resort** for scratch-org workflows where JWT cannot be set up, you can set `SFDX_AUTH_URL_DEV_HUB` with the output of `sf org display --target-org <devhub-alias> --verbose --json | jq -r .result.sfdxAuthUrl`. Be aware that this value contains a long-lived OAuth refresh token granting full Dev Hub access if leaked; prefer JWT whenever possible.
