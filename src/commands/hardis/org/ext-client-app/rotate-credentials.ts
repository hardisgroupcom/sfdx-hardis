/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Connection, Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { isCI, uxLog } from '../../../../common/utils/index.js';
import { prompts } from '../../../../common/utils/prompts.js';
import { t } from '../../../../common/utils/i18n.js';
import { WebSocketClient } from '../../../../common/websocketClient.js';
import { CONSTANTS } from '../../../../config/index.js';
import {
  deleteStagedEcaCredential,
  getEcaConsumers,
  getEcaConsumerKeyAndSecret,
  getEcaSettingsSetupUrl,
  getStagedEcaCredential,
  listEcaOAuthApps,
  rotateStagedEcaCredential,
  stageEcaCredential,
  EcaConsumer,
  EcaOAuthApp,
} from '../../../../common/utils/refresh/externalClientAppUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class RotateExternalClientAppCredentials extends SfCommand<any> {
  public static title = 'Rotate External Client App Credentials';

  public static description = `
## Command Behavior

**Rotates the OAuth consumer key and secret of an External Client App directly in a Salesforce org, without relying on local metadata.**

This command drives the Connect REST OAuth Credentials API to generate a brand new consumer key and secret for an External Client App, then promotes them so they become the active credentials. The new values are printed once, copy-pastable, and are hidden from log files so they can be safely stored in CI/CD variables.

Key functionalities:

- **Live Org Source:** Reads the list of External Client Apps and their consumers straight from the org through the OAuth Usage and OAuth Credentials REST APIs. Nothing is read from or written to local metadata files.
- **App and Consumer Selection:** Lists External Client Apps from the org and lets you pick one interactively. When an app has more than one consumer, you choose which credential to rotate.
- **Staged Credential Safety Check:** Salesforce allows only one staged credential per consumer. If one already exists, the command warns and offers to delete it before staging the new credentials.
- **Rotation:** Stages new credentials, then issues the \`rotate\` command so they become the active set. By default the previous credentials stay valid for 30 days before Salesforce removes them automatically, so running integrations keep working while you update them.
- **Immediate Revocation (Optional):** Pass \`--revoke-previous\` (or answer the prompt) to delete the previous credentials right after rotation, with no 30-day overlap. Use this for security incidents (e.g. a leaked secret): any integration still using the old credentials will break immediately.
- **Secure Output:** Both the new consumer key and secret are displayed with copy buttons in the VS Code UI and shown as obfuscated lines in log files, exactly like the CI/CD secrets produced by [hardis:project:configure:auth](${CONSTANTS.DOC_URL_ROOT}/hardis/project/configure/auth/).

> **Prerequisite:** "Allow access to External Client App consumer secrets via REST API" must be enabled in External Client App Settings, and the running user needs the **External Client App Developer** and **View Client Secret** permissions.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical flow involves:

- **App Discovery:** Calls \`GET /services/data/vXX.0/apps/oauth/usage\` to list External Client Apps and resolve the app identifier from its developer name.
- **Consumer Discovery:** Calls \`GET /apps/oauth/credentials/{appId}\` to list the consumers of the selected app.
- **Staged Check:** Calls \`GET /apps/oauth/credentials/{appId}/{consumerId}/staged\` to detect an existing staged credential, and \`DELETE\` on the same resource to clear it when requested.
- **Staging:** Calls \`POST /apps/oauth/credentials/{appId}/{consumerId}/staged\`, which returns the brand new \`key\` and \`secret\`.
- **Rotation:** Calls \`PATCH /apps/oauth/credentials/{appId}/{consumerId}/staged/{stagedId}\` with body \`{ "command": "rotate" }\` to promote the staged credentials to the active set.
- **Immediate Revocation:** With \`--revoke-previous\`, after rotation the former credentials occupy the staged slot in \`rotated\` state; the command reads them with a \`GET .../staged\` and issues a \`DELETE\` to revoke them immediately.
- **Output Handling:** Uses \`uxLog(..., true)\` so secrets are replaced by an obfuscated line in log files, and wraps values with \`<copy>\` tags when the VS Code UI is available.
- **JSON Output:** \`--json\` returns the app name, the new consumer key, and \`rotated: true\`. The secret is never included in the JSON output.

</details>

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:org:ext-client-app:rotate-credentials --agent --name MyExternalClientApp --target-org myorg@example.com
\`\`\`

In agent mode:

- \`--name\` (External Client App developer name) is required, since the app cannot be selected interactively.
- When the app has multiple consumers, \`--consumer-key\` is required to pick one.
- An existing staged credential is deleted automatically instead of prompting.
- The previous credentials are revoked immediately only when \`--revoke-previous\` is passed; otherwise the 30-day overlap is kept and the revocation prompt is skipped.
- The new secret is not returned in the \`--json\` output; capture it from an interactive run instead.
`;

  public static examples = [
    '$ sf hardis:org:ext-client-app:rotate-credentials',
    '$ sf hardis:org:ext-client-app:rotate-credentials --name MyExternalClientApp',
    '$ sf hardis:org:ext-client-app:rotate-credentials --revoke-previous --name MyExternalClientApp',
    '$ sf hardis:org:ext-client-app:rotate-credentials --agent --name MyExternalClientApp --target-org myorg@example.com',
  ];

  public static flags: any = {
    name: Flags.string({
      char: 'n',
      description: 'Developer name of the External Client App to rotate. Required in CI or agent mode.',
    }),
    'consumer-key': Flags.string({
      description: 'Consumer key of the credential to rotate, used when the app has more than one consumer (required in CI or agent mode in that case).',
    }),
    'revoke-previous': Flags.boolean({
      default: false,
      description: 'Immediately revoke the previous credentials after rotation instead of keeping the 30-day overlap. Use for security (e.g. a leaked secret): integrations still using the old credentials will break.',
    }),
    debug: Flags.boolean({
      char: 'd',
      default: false,
      description: messages.getMessage('debugMode'),
    }),
    websocket: Flags.string({
      description: messages.getMessage('websocket'),
    }),
    skipauth: Flags.boolean({
      description: 'Skip authentication check when a default username is required',
    }),
    agent: Flags.boolean({
      default: false,
      description: 'Run in non-interactive mode for agents and automation',
    }),
    'target-org': requiredOrgFlagWithDeprecations,
  };

  public static requiresProject = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(RotateExternalClientAppCredentials);
    const agentMode = flags.agent === true;
    const nonInteractive = isCI || agentMode;
    const conn: Connection = flags['target-org'].getConnection();

    // List External Client Apps from the org
    uxLog("action", this, c.cyan(t('listingExternalClientAppsInOrg')));
    const apps = await listEcaOAuthApps(conn, this);
    if (apps.length === 0) {
      throw new SfError(t('noExternalClientAppsFoundInTheOrg'));
    }

    // Resolve which app to rotate
    const app = await this.resolveApp(apps, flags.name, nonInteractive);
    const appName = app.developerName;
    const appId = app.identifier;

    uxLog("action", this, c.cyan(t('rotateEcaCredentialsStart', { appName })));

    // Resolve which consumer to rotate
    const consumers = await getEcaConsumers(conn, appId, this);
    if (consumers.length === 0) {
      throw new SfError(t('ecaNoConsumersFound', { appName }));
    }
    const consumer = await this.resolveConsumer(consumers, appName, flags['consumer-key'], nonInteractive);

    // Salesforce allows a single staged credential at a time: clear any existing one first
    const staged = await getStagedEcaCredential(conn, appId, consumer.id, this);
    if (staged) {
      uxLog("warning", this, c.yellow(t('ecaStagedCredentialExists', { appName, state: staged.state })));
      let doDelete = nonInteractive;
      if (!nonInteractive) {
        const deletePrompt = await prompts({
          type: 'confirm',
          name: 'value',
          message: t('doYouWantToDeleteStagedEcaCredential', { appName }),
          description: t('descDeleteStagedEcaCredential'),
          initial: true,
        });
        doDelete = deletePrompt.value === true;
      }
      if (!doDelete) {
        throw new SfError(t('ecaRotateStagedAbort'));
      }
      uxLog("action", this, c.cyan(t('deletingStagedEcaCredential', { appName })));
      await deleteStagedEcaCredential(conn, appId, consumer.id, staged.id, this);
      uxLog("success", this, c.green(t('stagedEcaCredentialDeleted', { appName })));
    }

    // Stage new credentials then promote them to the active set
    uxLog("action", this, c.cyan(t('stagingNewEcaCredential', { appName })));
    const newCredential = await stageEcaCredential(conn, appId, consumer.id, this);
    if (!newCredential.id) {
      throw new SfError(t('ecaStagingFailedNoId', { appName }));
    }
    uxLog("action", this, c.cyan(t('rotatingEcaCredential', { appName })));
    await rotateStagedEcaCredential(conn, appId, consumer.id, newCredential.id, this);
    uxLog("success", this, c.green(t('ecaCredentialsRotatedSuccessfully', { appName })));

    // After rotation the staged credentials become the active set: read them back to be sure we display the live values
    let key = newCredential.key;
    let secret = newCredential.secret;
    if (!key || !secret) {
      const fetched = await getEcaConsumerKeyAndSecret(conn, appId, consumer.id, this);
      key = key || fetched.key;
      secret = secret || fetched.secret;
    }

    // Display the new credentials, copy-pastable and hidden from log files
    this.displayNewCredentials(appName, key, secret);

    // Optionally revoke the previous credentials immediately (no 30-day overlap) for security
    const revokedPrevious = await this.maybeRevokePrevious(conn, appId, consumer.id, appName, flags['revoke-previous'] === true, nonInteractive);
    if (!revokedPrevious) {
      uxLog("warning", this, c.yellow(t('ecaPreviousCredentialsValid30Days')));
    }

    // Strongly advise turning the REST API access to consumer secrets back off now that rotation is done
    const setupUrl = getEcaSettingsSetupUrl(conn);
    uxLog("warning", this, c.yellow(t('ecaDisableRestApiAdvice')));
    uxLog("warning", this, c.cyan(`${t('openExternalClientAppSettings')}: ${setupUrl}`));
    WebSocketClient.sendReportFileMessage(setupUrl, t('openExternalClientAppSettings'), "actionUrl");

    return {
      appName,
      consumerKey: key,
      rotated: true,
      previousRevoked: revokedPrevious,
    };
  }

  private async maybeRevokePrevious(
    conn: Connection,
    appId: string,
    consumerId: string,
    appName: string,
    revokeFlag: boolean,
    nonInteractive: boolean
  ): Promise<boolean> {
    let doRevoke = revokeFlag;
    if (!doRevoke && !nonInteractive) {
      const revokePrompt = await prompts({
        type: 'confirm',
        name: 'value',
        message: t('doYouWantToRevokePreviousEcaCredential', { appName }),
        description: t('descRevokePreviousEcaCredential'),
        initial: false,
      });
      doRevoke = revokePrompt.value === true;
    }
    if (!doRevoke) {
      return false;
    }
    // After rotation, the previous credentials sit in the staged slot in "rotated" state: deleting them revokes them immediately
    const previous = await getStagedEcaCredential(conn, appId, consumerId, this);
    if (!previous) {
      uxLog("warning", this, c.yellow(t('noPreviousEcaCredentialToRevoke', { appName })));
      return false;
    }
    uxLog("action", this, c.cyan(t('revokingPreviousEcaCredential', { appName })));
    await deleteStagedEcaCredential(conn, appId, consumerId, previous.id, this);
    uxLog("success", this, c.green(t('previousEcaCredentialRevoked', { appName })));
    return true;
  }

  private async resolveApp(apps: EcaOAuthApp[], name: string | undefined, nonInteractive: boolean): Promise<EcaOAuthApp> {
    if (name) {
      const match = apps.find(a => a.developerName === name);
      if (!match) {
        const available = apps.map(a => a.developerName).join(', ');
        throw new SfError(t('ecaNameNotFoundInOrg', { name, available }));
      }
      return match;
    }
    if (nonInteractive) {
      throw new SfError(t('ecaNameRequiredInAgentMode'));
    }
    const appResponse = await prompts({
      type: 'select',
      name: 'value',
      message: t('selectExternalClientAppToRotate'),
      description: t('selectExternalClientAppToRotate'),
      choices: apps.map(a => ({ title: a.label || a.developerName, value: a.developerName })),
    });
    return apps.find(a => a.developerName === appResponse.value) as EcaOAuthApp;
  }

  private async resolveConsumer(
    consumers: EcaConsumer[],
    appName: string,
    consumerKey: string | undefined,
    nonInteractive: boolean
  ): Promise<EcaConsumer> {
    if (consumers.length === 1) {
      return consumers[0];
    }
    if (consumerKey) {
      const match = consumers.find(co => co.key === consumerKey);
      if (!match) {
        throw new SfError(t('ecaConsumerKeyRequiredInAgentMode', { appName }));
      }
      return match;
    }
    if (nonInteractive) {
      throw new SfError(t('ecaConsumerKeyRequiredInAgentMode', { appName }));
    }
    const consumerResponse = await prompts({
      type: 'select',
      name: 'value',
      message: t('selectEcaConsumerToRotate'),
      description: t('selectEcaConsumerToRotate'),
      choices: consumers.map(co => ({ title: `${co.name} (${co.key})`, value: co.id })),
    });
    return consumers.find(co => co.id === consumerResponse.value) as EcaConsumer;
  }

  private displayNewCredentials(appName: string, key: string, secret: string): void {
    let keyDisplay = key;
    let secretDisplay = secret;
    if (WebSocketClient.isAliveWithLwcUI()) {
      keyDisplay = `<copy>${key}</copy>`;
      secretDisplay = `<copy>${secret}</copy>`;
    }
    uxLog("action", this, c.cyan(t('ecaNewCredentialsCopyNow', { appName })));
    uxLog(
      "log",
      this,
      c.grey(c.cyanBright(`- Consumer Key: ${c.bold(c.green(keyDisplay))}`)),
      true
    );
    uxLog(
      "log",
      this,
      c.grey(c.cyanBright(`- Consumer Secret: ${c.bold(c.green(secretDisplay))}`)),
      true
    );
    uxLog("warning", this, c.yellow(t('ecaRotateUpdateCiReminder')));
  }
}
