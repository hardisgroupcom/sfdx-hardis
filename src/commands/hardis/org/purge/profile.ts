import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import { promptProfiles } from '../../../../common/utils/orgUtils.js';
import { getReportDirectory } from '../../../../config/index.js';
import { buildOrgManifest } from '../../../../common/utils/deployUtils.js';
import * as path from 'path';
import { execCommand, filterPackageXml, isCI, uxLog } from '../../../../common/utils/index.js';
import c from 'chalk';
import fs from 'fs';
import { parsePackageXmlFile, parseXmlFile, writePackageXmlFile, writeXmlFile } from '../../../../common/utils/xmlUtils.js';
import { prompts } from '../../../../common/utils/prompts.js';
import { MetadataUtils } from '../../../../common/metadata-utils/index.js';
import { WebSocketClient } from '../../../../common/websocketClient.js';
import { generateCsvFile, generateReportPath } from '../../../../common/utils/filesUtils.js';
import { t } from '../../../../common/utils/i18n.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class OrgPurgeProfile extends SfCommand<any> {
  public static title = 'Remove PS attributes from Profile';

  public static description = `
## Command Behavior

**Removes or "mutes" Permission Sets attributes from selected Salesforce Profile metadata files and redeploys the cleaned profiles to the target org.**

This command is intended to safely remove PS attributes from Profiles after a migration from Profile-based to PS-based permission management. It:

- Builds or reuses a full org manifest to determine metadata present in the org.
- Filters the manifest to remove selected managed package namespaces and keep only relevant metadata types required for profile processing.
- Retrieves the necessary metadata (profiles, objects, fields, classes) into the local project.
- Iterates over selected profile files and mutes configured attributes (for example: classAccesses.enabled, fieldPermissions.readable/editable, objectPermissions.* and userPermissions.enabled).
- Resets record type visibilities on purged objects: assigns the Master record type as default and visible, and unchecks all other record types.
- Resets application visibilities: keeps only the default app visible, and sets all others to not visible.
- Writes the modified profile XML files back to the repository
- Deploys the updated profiles to the target org.

The command checks for uncommitted changes and will not run if the working tree has modifications, and it allows reusing a previously generated full org manifest to speed up repeated runs.

<details markdown="1">
<summary>Technical explanations</summary>

- **Manifest generation:** Uses 'buildOrgManifest' to create a full org 'package.xml'. If an existing manifest file is available the user can choose to reuse it.
- **Namespace filtering:** Queries installed packages using 'MetadataUtils.listInstalledPackages' to propose namespaces to remove from the manifest.
- **Metadata filtering:** Keeps only metadata types required to safely mute profiles (Profile plus the package types configured in the command).
- **Profile processing:** Parses profile XML files, iterates nodes ('classAccesses', 'fieldPermissions', 'objectPermissions', 'userPermissions') and sets attributes to configured mute values, skipping configured excluded names/files.
- **Retrieval & Deployment:** Uses the Salesforce CLI ('sf project retrieve' / 'sf project deploy') via 'execCommand' to retrieve metadata and deploy the updated profiles.
- **Exit behavior:** Returns an object with 'orgId' and an 'outputString'. Errors are logged to the console and do not throw uncaught exceptions within the command.
</details>

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:org:purge:profile --agent --target-org myorg@example.com
\`\`\`

In agent mode:

- All interactive prompts and confirmations are skipped.
- Uncommitted changes warning is skipped (proceeds anyway).
- If a cached full org manifest exists, it is reused without prompting.
- No namespace filtering is applied (all namespaces are kept).
- Deployment of muted profiles proceeds without confirmation.
`;

  public static examples = [
    `sf hardis:org:purge:profile`,
    `sf hardis:org:purge:profile --target-org my-org@example.com`,
    '$ sf hardis:org:purge:profile --agent',
  ];

  /* jscpd:ignore-start */
  public static flags: any = {
    profiles: Flags.string({
      char: 'p',
      description: 'Comma-separated list of profile API names to purge. Required in agent mode.',
    }),
    outputfile: Flags.string({
      char: 'f',
      description: 'Force the path and name of output report file. Must end with .csv',
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
  /* jscpd:ignore-end */
  protected attributesToMuteDefinition = [
    {
      "packageType": "ApexClass",
      "nodeNameOnProfile": "classAccesses",
      "attributesToMute": ["enabled"],
      "muteValue": false
    }, {
      "packageType": "CustomField",
      "nodeNameOnProfile": "fieldPermissions",
      "attributesToMute": ["readable", "editable"],
      "muteValue": false
    }, {
      "packageType": "CustomObject",
      "nodeNameOnProfile": "objectPermissions",
      "attributesToMute": ["allowCreate", "allowDelete", "allowEdit", "allowRead", "modifyAllRecords", "viewAllFields", "viewAllRecords"],
      "muteValue": false
    },
    {
      "nodeNameOnProfile": "tabVisibilities",
      "attributesToMute": [],
      "includedNames": ["standard-DelegatedAccount"],
      "action": "remove"
    },
    {
      "nodeNameOnProfile": "userPermissions",
      "attributesToMute": ["enabled"],
      "muteValue": false,
      "excludedNames": [
        "ActivitiesAccess",
        "ChatterInternalUser",
        "LightningConsoleAllowedForUser",
        "ViewHelpLink",
      ],
      "excludedFiles": ["Admin.profile-meta.xml"]
    }
  ];

  protected outputFile;
  protected outputFilesRes: any = {};
  protected allChanges: { profile: string; node: string; name: string; attribute: string; oldValue: any; newValue: any }[] = [];
  protected agentMode = false;

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(OrgPurgeProfile);
    this.agentMode = flags.agent === true;
    this.outputFile = flags.outputfile || null;
    const orgUsername = flags['target-org'].getUsername();
    const conn = flags['target-org'].getConnection();
    const instanceUrlKey = conn.instanceUrl.replace(/https?:\/\//, '').replace(/\./g, '_').toUpperCase();

    uxLog("action", this, c.cyan(t('startingProfileAttributesPurgeProcessOnOrg', { conn: conn.instanceUrl })));

    const reportDir = await getReportDirectory();
    const packageFullOrgPath = path.join(reportDir, `org-package-xml-full_${instanceUrlKey}.xml`);
    const packageFilteredPackagesPath = path.join(reportDir, `org-package-xml-filtered-packages_${instanceUrlKey}.xml`);
    const packageFilteredProfilePath = path.join(reportDir, `org-package-xml-filtered-profile-purge_${instanceUrlKey}.xml`);

    // Check if user has uncommitted changes
    if (!await this.checkUncommittedChanges()) {
      if (!isCI && !this.agentMode) {
        const confirmPromptRes = await prompts({
          type: "confirm",
          message: t('youHaveUncommittedChangesInYourGit'),
          description: "It's recommended to commit, stash or discard your changes before proceeding.",
        });
        if (!confirmPromptRes.value === true) {
          uxLog("error", this, c.blue(t('operationCancelledExitingWithoutChanges')));
          return {};
        }
      }
    }

    uxLog("action", this, c.cyan(t('loadingFullOrgManifest')));
    await this.loadFullOrgManifest(conn, orgUsername, packageFullOrgPath);

    await this.filterFullOrgPackageByNamespaces(packageFullOrgPath, packageFilteredPackagesPath);

    let selectedProfiles: string[];
    if (isCI || this.agentMode) {
      const profilesFlag = flags.profiles;
      if (!profilesFlag) {
        throw new SfError(c.red('In agent/CI mode, --profiles flag is required (comma-separated profile API names).'));
      }
      selectedProfiles = profilesFlag.split(',').map((p: string) => p.trim());
    } else {
      selectedProfiles = await promptProfiles(flags['target-org'].getConnection(), { multiselect: true, returnApiName: true });
    }

    uxLog("action", this, c.cyan(t('filteringFullOrgManifest')));
    await this.filterFullOrgPackageByRelevantMetadataTypes(packageFilteredPackagesPath, packageFilteredProfilePath, selectedProfiles);

    uxLog("action", this, c.cyan(t('retrievingMetadatasForProfilePurge')));
    await execCommand(
      `sf project retrieve start --manifest "${packageFilteredProfilePath}" --target-org ${orgUsername} --ignore-conflicts --json`,
      this,
      { output: false, fail: true }
    );


    uxLog("action", this, c.cyan(t('mutingUnwantedProfileAttributes')));
    const profilesDir = path.join('force-app', 'main', 'default', 'profiles');
    for (const selectedProfile of selectedProfiles) {
      const profileFilePath = path.join(profilesDir, `${selectedProfile}.profile-meta.xml`);
      if (!fs.existsSync(profileFilePath)) {
        uxLog("warning", this, c.yellow(t('profileFileDoesNotExistSkipping', { profileFilePath })));
        continue;
      }

      const profileWithMutedAttributes = await this.muteProfileAttributes(profileFilePath);
      await writeXmlFile(profileFilePath, profileWithMutedAttributes);
      uxLog("success", this, c.green(t('profileProcessedAndUnwantedAttributesMuted', { selectedProfile })));
      WebSocketClient.sendReportFileMessage(profileFilePath, `See updated ${path.basename(profileFilePath, ".profile-meta.xml")} profile `, 'report');
    }

    // Generate output CSV file
    this.outputFile = await generateReportPath('profile-muted-attributes', this.outputFile);
    this.outputFilesRes = await generateCsvFile(this.allChanges, this.outputFile, { fileTitle: 'Profile muted attributes report' });

    if (!isCI && !this.agentMode) {
      const promptDeployRes = await prompts({
        type: "confirm",
        message: t('doYouWantToDeployProfilesBack', { selectedProfiles }),
        description: t('confirmDeployProfilesDescription'),
        initial: true,
      });
      if (!promptDeployRes.value === true) {
        uxLog("error", this, c.blue(t('deploymentCancelledByUser')));
        return { orgId: flags['target-org'].getOrgId(), outputString: "Profile purge completed without deployment." };
      }
    }

    uxLog("action", this, c.cyan(`Deploying muted profiles back to the org...`));
    await this.deployToOrg(orgUsername, selectedProfiles);

    return {
      orgId: flags['target-org'].getOrgId(),
      outputString: "Successfully purged profiles.",
      outputFile: this.outputFile,
      outputFilesRes: this.outputFilesRes
    };
  }

  private async checkUncommittedChanges(): Promise<boolean> {
    const gitResult = await execCommand('git status --porcelain', this, { output: true, fail: false });
    const output = typeof gitResult === 'string' ? gitResult : (gitResult && (gitResult as any).stdout) || '';
    return output.trim() === '';
  }

  private async loadFullOrgManifest(conn: any, orgUsername: string, packageFullOrgPath: string): Promise<void> {
    // Check if full org manifest already exists
    let useExistingManifest = false;
    if (fs.existsSync(packageFullOrgPath)) {
      if (!isCI && !this.agentMode) {
        const promptResults = await prompts({
          type: "select",
          name: "useExistingManifest",
          message: t('doYouWantToUseTheExisting'),
          description: t('existingManifestFoundDescription'),
          choices: [
            {
              title: t('useExistingManifestTitle'),
              description: t('existingManifestCacheLocation', { path: path.relative(process.cwd(), packageFullOrgPath) }),
              value: true
            },
            { title: t('generateNewManifestTitle'), value: false },
          ],
        });
        useExistingManifest = promptResults.useExistingManifest;
      } else {
        useExistingManifest = true;
      }
    }
    if (!useExistingManifest) {
      uxLog("action", this, c.cyan(`Generating full org manifest for profile retrieval...`));
      await buildOrgManifest(orgUsername, packageFullOrgPath, conn);
    }
  }

  private async muteProfileAttributes(profileFilePath: string): Promise<any> {
    const profileName = path.basename(profileFilePath, '.profile-meta.xml');
    uxLog("action", this, c.cyan(t('processingProfile', { profileName })));
    const profileParsedXml: any = await parseXmlFile(profileFilePath);
    const filename = path.basename(profileFilePath);
    const changes: { node: string; name: string; attribute: string; oldValue: any; newValue: any }[] = [];

    for (const attributeConfig of this.attributesToMuteDefinition) {
      const excludedFiles = attributeConfig.excludedFiles || [];
      if (excludedFiles.includes(filename)) {
        continue;
      }
      const nodeName = attributeConfig.nodeNameOnProfile;

      if (!profileParsedXml?.Profile?.[nodeName]) {
        continue;
      }
      // Ensure we work with an array to simplify processing
      if (!Array.isArray(profileParsedXml.Profile[nodeName])) {
        profileParsedXml.Profile[nodeName] = [profileParsedXml.Profile[nodeName]];
      }

      const muteValue = attributeConfig.muteValue || false;
      const attributesToMute = attributeConfig.attributesToMute;
      const includedNames = attributeConfig.includedNames || [];
      const excludedNames = attributeConfig.excludedNames || [];
      const action = attributeConfig.action || 'mute';
      if (action === 'remove') {
        // Remove nodes with names in includedNames
        profileParsedXml.Profile[nodeName] = profileParsedXml.Profile[nodeName].filter((nodeObj: any) => {
          let memberName = nodeObj.apexClass || nodeObj.field || nodeObj.object || nodeObj.apexPage || nodeObj.tab || nodeObj.recordType || nodeObj.application || nodeObj.name || 'unknown';
          if (Array.isArray(memberName)) {
            memberName = memberName[0];
          }
          if (includedNames.includes(memberName)) {
            changes.push({
              node: nodeName,
              name: memberName,
              attribute: 'entire node',
              oldValue: JSON.stringify(nodeObj),
              newValue: 'removed',
            });
            return false; // Exclude this node
          }
        });
        continue; // Move to next attributeConfig
      }

      for (let i = 0; i < profileParsedXml.Profile[nodeName].length; i++) {
        /* jscpd:ignore-start */
        const nodeObj = profileParsedXml.Profile[nodeName][i];
        let memberName = nodeObj.apexClass || nodeObj.field || nodeObj.object || nodeObj.apexPage || nodeObj.tab || nodeObj.recordType || nodeObj.application || nodeObj.name || 'unknown';
        if (Array.isArray(memberName)) {
          memberName = memberName[0];
        }
        /* jscpd:ignore-end */
        for (const attr of attributesToMute) {
          if (memberName && excludedNames.includes(memberName)) {
            continue;
          }
          if (nodeObj && Object.prototype.hasOwnProperty.call(nodeObj, attr)) {
            let oldVal = nodeObj[attr];
            if (Array.isArray(oldVal)) {
              oldVal = oldVal[0];
            }
            // Only record a change if the value actually differs
            if (oldVal !== muteValue) {
              changes.push({
                node: nodeName,
                name: memberName,
                attribute: attr,
                oldValue: oldVal,
                newValue: muteValue,
              });
              nodeObj[attr] = muteValue;
            }
          }
        }
      }
    }

    // Reset record type visibilities: set Master as default and visible, uncheck others
    this.resetRecordTypeVisibilities(profileParsedXml, changes);

    // Reset application visibilities: keep only the default app visible, uncheck others
    this.resetApplicationVisibilities(profileParsedXml, changes);

    // Build a single summary string and emit it with one uxLog("log") call
    const summaryLines: string[] = [];
    summaryLines.push(`Profile: ${profileName}`);
    if (changes.length === 0) {
      summaryLines.push('No attributes muted.');
    } else {
      summaryLines.push(`Muted ${changes.length} attribute(s):`);
      for (const ch of changes) {
        summaryLines.push(
          `- [${ch.node}] ${ch.name} -> ${ch.attribute}: ${JSON.stringify(ch.oldValue)} => ${JSON.stringify(
            ch.newValue
          )}`
        );
      }
    }
    uxLog('log', this, c.cyan(summaryLines.join('\n')));
    this.allChanges.push(...changes.map(change => ({ profile: profileName, ...change })));
    return profileParsedXml;
  }

  private resetRecordTypeVisibilities(
    profileParsedXml: any,
    changes: { node: string; name: string; attribute: string; oldValue: any; newValue: any }[]
  ): void {
    const nodeName = 'recordTypeVisibilities';
    const profileNodes = this.getProfileNodeArray(profileParsedXml, nodeName);
    if (!profileNodes) {
      return;
    }

    // Collect purged object names from objectPermissions
    const purgedObjects = new Set<string>();
    if (profileParsedXml?.Profile?.objectPermissions) {
      const objPerms = Array.isArray(profileParsedXml.Profile.objectPermissions)
        ? profileParsedXml.Profile.objectPermissions
        : [profileParsedXml.Profile.objectPermissions];
      for (const objPerm of objPerms) {
        const objName = this.unwrapProfileValue(objPerm.object);
        if (objName) {
          purgedObjects.add(objName);
        }
      }
    }

    if (purgedObjects.size === 0) {
      return;
    }

    for (const rtNode of profileNodes) {
      const recordTypeName = this.unwrapProfileValue(rtNode.recordType);
      if (!recordTypeName) {
        continue;
      }

      // recordType format is "ObjectName.RecordTypeName"
      const dotIndex = recordTypeName.lastIndexOf('.');
      if (dotIndex === -1) {
        continue;
      }
      const objectName = recordTypeName.substring(0, dotIndex);
      const rtName = recordTypeName.substring(dotIndex + 1);

      // Only process record types for purged objects
      if (!purgedObjects.has(objectName)) {
        continue;
      }

      const isMaster = rtName === 'Master';
      const targetVisible = isMaster;
      const targetDefault = isMaster;

      this.updateBooleanProfileAttribute(rtNode, 'visible', targetVisible, nodeName, recordTypeName, changes);
      this.updateBooleanProfileAttribute(rtNode, 'default', targetDefault, nodeName, recordTypeName, changes);
      this.updateBooleanProfileAttribute(rtNode, 'personAccountDefault', targetDefault, nodeName, recordTypeName, changes);
    }
  }

  private resetApplicationVisibilities(
    profileParsedXml: any,
    changes: { node: string; name: string; attribute: string; oldValue: any; newValue: any }[]
  ): void {
    const nodeName = 'applicationVisibilities';
    const profileNodes = this.getProfileNodeArray(profileParsedXml, nodeName);
    if (!profileNodes) {
      return;
    }

    // Find the default app name
    let defaultAppName: string | null = null;
    for (const appNode of profileNodes) {
      const isDefault = this.parseProfileBoolean(appNode.default);
      if (isDefault) {
        const appName = this.unwrapProfileValue(appNode.application);
        defaultAppName = appName;
        break;
      }
    }

    for (const appNode of profileNodes) {
      const appName = this.unwrapProfileValue(appNode.application);
      if (!appName) {
        continue;
      }

      const isDefault = appName === defaultAppName;
      const targetVisible = isDefault;
      this.updateBooleanProfileAttribute(appNode, 'visible', targetVisible, nodeName, appName, changes);
    }
  }

  private unwrapProfileValue(value: any): any {
    return Array.isArray(value) ? value[0] : value;
  }

  private getProfileNodeArray(profileParsedXml: any, nodeName: string): any[] | null {
    const profileNode = profileParsedXml?.Profile?.[nodeName];
    if (!profileNode) {
      return null;
    }
    if (!Array.isArray(profileNode)) {
      profileParsedXml.Profile[nodeName] = [profileNode];
    }
    return profileParsedXml.Profile[nodeName];
  }

  private parseProfileBoolean(value: any): boolean {
    const unwrapped = this.unwrapProfileValue(value);
    return unwrapped === true || unwrapped === 'true';
  }

  private updateBooleanProfileAttribute(
    nodeObj: any,
    attribute: string,
    targetValue: boolean,
    nodeName: string,
    memberName: string,
    changes: { node: string; name: string; attribute: string; oldValue: any; newValue: any }[]
  ): void {
    if (nodeObj?.[attribute] === undefined) {
      return;
    }
    const oldValue = this.unwrapProfileValue(nodeObj[attribute]);
    const oldValueBool = this.parseProfileBoolean(oldValue);
    if (oldValueBool !== targetValue) {
      changes.push({
        node: nodeName,
        name: memberName,
        attribute,
        oldValue,
        newValue: targetValue,
      });
      nodeObj[attribute] = targetValue;
    }
  }

  async filterFullOrgPackageByNamespaces(packageFullOrgPath: string, packageFilteredPackagesPath: string): Promise<void> {
    const namespaceOptions: { title: string; value: string }[] = [];
    try {
      uxLog("action", this, c.cyan(`Retrieving installed packages to list namespaces...`));
      const installedPackages = await MetadataUtils.listInstalledPackages(null, this);
      for (const installedPackage of installedPackages) {
        if (installedPackage?.SubscriberPackageNamespace !== '' && installedPackage?.SubscriberPackageNamespace != null) {
          namespaceOptions.push({
            title: installedPackage.SubscriberPackageNamespace, // Display title
            value: installedPackage.SubscriberPackageNamespace
          });
        }
      }
    } catch (error: any) {
      uxLog("warning", this, c.yellow(`Could not retrieve installed packages. Listing namespaces by parsing the XML file.`));
      uxLog("other", this, error?.message);
    }
    if (namespaceOptions.length === 0) {
      uxLog("action", this, c.cyan(`No installed packages found via API. Parsing package XML to list namespaces...`));
      // Fallback: parse the package XML to find namespaces
      const parsedPackageXml = await parsePackageXmlFile(packageFullOrgPath);
      const allTypes = Object.keys(parsedPackageXml);
      const namespaceSet: Set<string> = new Set();
      for (const typeEntry of allTypes) {
        for (const member of parsedPackageXml[typeEntry]) {
          const parts = member.split('__');
          if (parts.length > 2 && !member.includes(".")) {
            const namespace = parts[0];
            namespaceSet.add(namespace);
          } else if (parts.length > 1 && !member.includes(".") && !member.includes("__c") && parts[1].length > 1) {
            const namespace = parts[0];
            namespaceSet.add(namespace);
          }
        }
      }
      for (const namespace of namespaceSet) {
        namespaceOptions.push({
          title: namespace,
          value: namespace
        });
      }
    }

    let selectedNamespaces: string[] = [];
    if (!isCI && !this.agentMode) {
      const selectedNamespacesPrompt = await prompts({
        type: 'multiselect',
        name: "namespaces",
        message: t('selectTheNamespacesYouWantToIgnore'),
        description: t('youWillNotDisableAccessToElementsRelatedToNamespaces'),
        choices: namespaceOptions
      });
      selectedNamespaces = selectedNamespacesPrompt.namespaces || [];
    }

    uxLog("action", this, c.cyan(`Filtering full org manifest to remove unwanted namespaces...`));
    await filterPackageXml(packageFullOrgPath, packageFilteredPackagesPath, {
      removeNamespaces: selectedNamespaces,
      removeStandard: false
    });
  }

  async filterFullOrgPackageByRelevantMetadataTypes(packageFilteredPackagesPath: string, packageFilteredProfilePath: string, selectedProfiles: string[]): Promise<void> {
    const parsedPackage = await parsePackageXmlFile(packageFilteredPackagesPath);
    const keysToKeep = Array.from(new Set([
      ...this.attributesToMuteDefinition
        .map((a: any) => a.packageType)
        .filter((pkgType: any) => pkgType != null),
      'Profile',
      'CustomApplication', // needed to retrieve applicationVisibilities in profiles
    ]));

    for (const key of Object.keys(parsedPackage)) {
      if (!keysToKeep.includes(key)) {
        delete parsedPackage[key];
      }
    }

    parsedPackage['Profile'] = selectedProfiles;
    await writePackageXmlFile(packageFilteredProfilePath, parsedPackage);
  }

  async deployToOrg(orgUsername: string, selectedProfiles: string[]): Promise<void> {
    try {
      const metadataArgs = selectedProfiles
        .map((p) => `--metadata "Profile:${p}"`)
        .join(' ');
      await execCommand(
        `sf project deploy start ${metadataArgs} --target-org ${orgUsername} --ignore-conflicts --json`,
        this,
        { output: true, fail: true }
      );
      uxLog("action", this, c.cyan(t('successfullyDeployed2', { selectedProfiles: selectedProfiles.length })));
      uxLog("success", this, c.green(t('profilesDeployedSuccessfully', { selectedProfiles: selectedProfiles.join(', ') })));
    } catch (error) {
      uxLog("action", this, c.red(`Failed to deploy profiles.`));
      uxLog("error", this, c.red(JSON.stringify(error, null, 2)));
    }
  }
}
