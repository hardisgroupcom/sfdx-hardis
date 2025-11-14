import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import { promptProfiles } from '../../../../common/utils/orgUtils.js';
import { getReportDirectory } from '../../../../config/index.js';
import { buildOrgManifest } from '../../../../common/utils/deployUtils.js';
import * as path from 'path';
import { execCommand, filterPackageXml, uxLog } from '../../../../common/utils/index.js';
import c from 'chalk';
import fs from 'fs';
import { parsePackageXmlFile, parseXmlFile, writePackageXmlFile, writeXmlFile } from '../../../../common/utils/xmlUtils.js';
import { prompts } from '../../../../common/utils/prompts.js';
import { MetadataUtils } from '../../../../common/metadata-utils/index.js';
import { WebSocketClient } from '../../../../common/websocketClient.js';
import { generateCsvFile, generateReportPath } from '../../../../common/utils/filesUtils.js';

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
`;

  public static examples = [
    `sf hardis:org:purge:profile`,
    `sf hardis:org:purge:profile --target-org my-org@example.com`,
  ];

  public static flags: any = {
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
    'target-org': requiredOrgFlagWithDeprecations,
  };

  protected attributesToMute = [
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
    }, {
      "packageType": null,
      "nodeNameOnProfile": "userPermissions",
      "attributesToMute": ["enabled"],
      "muteValue": false,
      "excludedNames": ["ChatterInternalUser", "ViewHelpLink", "LightningConsoleAllowedForUser", "ActivitiesAccess",],
      "excludedFiles": ["Admin.profile-meta.xml"]
    }
  ];

  protected outputFile;
  protected outputFilesRes: any = {};
  protected allChanges: { profile: string; node: string; name: string; attribute: string; oldValue: any; newValue: any }[] = [];

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(OrgPurgeProfile);
    this.outputFile = flags.outputfile || null;
    const orgUsername = flags['target-org'].getUsername();
    const conn = flags['target-org'].getConnection();
    const instanceUrlKey = conn.instanceUrl.replace(/https?:\/\//, '').replace(/\./g, '_').toUpperCase();

    uxLog("action", this, c.cyan(`Starting profile attributes purge process on org: ${conn.instanceUrl}`));

    const reportDir = await getReportDirectory();
    const packageFullOrgPath = path.join(reportDir, `org-package-xml-full_${instanceUrlKey}.xml`);
    const packageFilteredPackagesPath = path.join(reportDir, `org-package-xml-filtered-packages_${instanceUrlKey}.xml`);
    const packageFilteredProfilePath = path.join(reportDir, `org-package-xml-filtered-profile-purge_${instanceUrlKey}.xml`);

    // Check if user has uncommitted changes
    if (!await this.checkUncommittedChanges()) {
      const confirmPromptRes = await prompts({
        type: "confirm",
        message: `You have uncommitted changes in your git repository, do you want to continue anyway? This may lead to overwrite your uncommitted changes.`,
        description: "It's recommended to commit, stash or discard your changes before proceeding.",
      });
      if (!confirmPromptRes.value === true) {
        uxLog("error", this, c.blue(`Operation cancelled by user. Exiting without making changes.`));
        return {};
      }
    }

    uxLog("action", this, c.cyan(`Loading full org manifest for profile retrieval...`));
    await this.loadFullOrgManifest(conn, orgUsername, packageFullOrgPath);

    await this.filterFullOrgPackageByNamespaces(packageFullOrgPath, packageFilteredPackagesPath);

    const selectedProfiles = await promptProfiles(flags['target-org'].getConnection(), { multiselect: true, returnApiName: true });

    uxLog("action", this, c.cyan(`Filtering full org manifest to only keep relevant metadata types...`));
    await this.filterFullOrgPackageByRelevantMetadataTypes(packageFilteredPackagesPath, packageFilteredProfilePath, selectedProfiles);

    uxLog("action", this, c.cyan(`Retrieving metadatas required for profile purge (this will take some time)...`));
    await execCommand(
      `sf project retrieve start --manifest ${packageFilteredProfilePath} --target-org ${orgUsername} --ignore-conflicts --json`,
      this,
      { output: false, fail: true }
    );


    uxLog("action", this, c.cyan(`Muting unwanted profile attributes...`));
    const profilesDir = path.join('force-app', 'main', 'default', 'profiles');
    for (const selectedProfile of selectedProfiles) {
      const profileFilePath = path.join(profilesDir, `${selectedProfile}.profile-meta.xml`);
      if (!fs.existsSync(profileFilePath)) {
        uxLog("warning", this, c.yellow(`Profile file ${profileFilePath} does not exist. Skipping.`));
        continue;
      }

      const profileWithMutedAttributes = await this.muteProfileAttributes(profileFilePath);
      await writeXmlFile(profileFilePath, profileWithMutedAttributes);
      uxLog("success", this, c.green(`Profile ${selectedProfile} processed and unwanted attributes muted.`));
      WebSocketClient.sendReportFileMessage(profileFilePath, `See updated ${path.basename(profileFilePath, ".profile-meta.xml")} profile `, 'report');
    }

    // Generate output CSV file
    this.outputFile = await generateReportPath('profile-muted-attributes', this.outputFile);
    this.outputFilesRes = await generateCsvFile(this.allChanges, this.outputFile, { fileTitle: 'Profile muted attributes report' });

    const promptDeployRes = await prompts({
      type: "confirm",
      message: `Do you want to deploy ${selectedProfiles} profiles back to the org now?`,
      description: "Deploying the profiles will overwrite the existing profiles in the target org with the muted versions. Profiles: " + selectedProfiles.join(", "),
      initial: true,
    });
    if (!promptDeployRes.value === true) {
      uxLog("error", this, c.blue(`Deployment cancelled by user. Exiting without deploying profiles.`));
      return { orgId: flags['target-org'].getOrgId(), outputString: "Profile purge completed without deployment." };
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
      const promptResults = await prompts({
        type: "select",
        name: "useExistingManifest",
        message: "Do you want to use the existing full org manifest or generate a new one?",
        description: "A full org manifest file was found from a previous run. You can either use it or generate a new one to ensure it's up to date. It may take some time to generate a new one.",
        choices: [
          {
            title: `Use the existing full org manifest`,
            description: `Cache file is located at ${path.relative(process.cwd(), packageFullOrgPath)}`,
            value: true
          },
          { title: "Generate a new full org manifest", value: false },
        ],
      });
      useExistingManifest = promptResults.useExistingManifest;
    }
    if (!useExistingManifest) {
      uxLog("action", this, c.cyan(`Generating full org manifest for profile retrieval...`));
      await buildOrgManifest(orgUsername, packageFullOrgPath, conn);
    }
  }

  private async muteProfileAttributes(profileFilePath: string): Promise<any> {
    const profileName = path.basename(profileFilePath, '.profile-meta.xml');
    uxLog("action", this, c.cyan(`Processing profile: ${profileName}`));
    const profileParsedXml: any = await parseXmlFile(profileFilePath);
    const filename = path.basename(profileFilePath);
    const changes: { node: string; name: string; attribute: string; oldValue: any; newValue: any }[] = [];

    for (const attributeConfig of this.attributesToMute) {
      const excludedFiles = attributeConfig.excludedFiles || [];
      if (excludedFiles.includes(filename)) {
        continue;
      }
      const excludedNames = attributeConfig.excludedNames || [];
      const muteValue = attributeConfig.muteValue || false;
      const nodeName = attributeConfig.nodeNameOnProfile;
      const attributesToMute = attributeConfig.attributesToMute;

      if (!profileParsedXml?.Profile?.[nodeName]) {
        continue;
      }

      // Ensure we work with an array to simplify processing
      if (!Array.isArray(profileParsedXml.Profile[nodeName])) {
        profileParsedXml.Profile[nodeName] = [profileParsedXml.Profile[nodeName]];
      }

      for (let i = 0; i < profileParsedXml.Profile[nodeName].length; i++) {
        const nodeObj = profileParsedXml.Profile[nodeName][i];
        const memberName = nodeObj?.name;

        for (const attr of attributesToMute) {
          if (memberName && excludedNames.includes(memberName)) {
            continue;
          }
          if (nodeObj && Object.prototype.hasOwnProperty.call(nodeObj, attr)) {
            const oldVal = nodeObj[attr];
            // Only record a change if the value actually differs
            const memberName = nodeObj.name || nodeObj.apexClass || nodeObj.field || nodeObj.object || nodeObj.apexPage || nodeObj.recordType || 'unknown';
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
    } catch (error) {
      uxLog("warning", this, c.yellow(`Could not retrieve installed packages. Listing namespaces by parsing the XML file.`));
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

    const selectedNamespacesPrompt = await prompts({
      type: 'multiselect',
      name: "namespaces",
      message: "Which namespaces do you want to remove from the full org manifest?",
      description: "Select all namespaces you want to remove",
      choices: namespaceOptions
    });

    uxLog("action", this, c.cyan(`Filtering full org manifest to remove unwanted namespaces...`));
    await filterPackageXml(packageFullOrgPath, packageFilteredPackagesPath, {
      removeNamespaces: selectedNamespacesPrompt.namespaces,
      removeStandard: false
    });
  }

  async filterFullOrgPackageByRelevantMetadataTypes(packageFilteredPackagesPath: string, packageFilteredProfilePath: string, selectedProfiles: string[]): Promise<void> {
    const parsedPackage = await parsePackageXmlFile(packageFilteredPackagesPath);
    const keysToKeep = Array.from(new Set([
      ...this.attributesToMute
        .map((a: any) => a.packageType)
        .filter((pkgType: any) => pkgType != null),
      'Profile',
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
      uxLog("action", this, c.cyan(`Successfully deployed ${selectedProfiles.length}`));
      uxLog("success", this, c.green(`Profiles deployed successfully:\n${selectedProfiles.join(', ')}`));
    } catch (error) {
      uxLog("action", this, c.red(`Failed to deploy profiles.`));
      uxLog("error", this, c.red(JSON.stringify(error, null, 2)));
    }
  }
}
