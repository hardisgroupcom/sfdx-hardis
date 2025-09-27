// unlockedPackages
/* jscpd:ignore-start */
import { Flags, SfCommand } from "@salesforce/sf-plugins-core";
import { Connection, Messages } from "@salesforce/core";
import { AnyJson } from "@salesforce/ts-types";
import c from "chalk";
import fs from "fs-extra";
import { glob } from "glob";
import * as path from "path";
import { uxLog } from "../../../../common/utils/index.js";
import { soqlQueryTooling } from "../../../../common/utils/apiUtils.js";
import { prompts } from "../../../../common/utils/prompts.js";
import { LightningComponentBundle } from "@salesforce/types/tooling";
import {
  MetadataType,
  RegistryAccess,
} from "@salesforce/source-deploy-retrieve";
import { GLOB_IGNORE_PATTERNS } from "../../../../common/utils/projectUtils.js";

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages("sfdx-hardis", "org");

declare type PackageMetadata = {
  Id: string;
  Name: string;
  retrievedType?: string;
  type?: MetadataType;
  directoryName?: string;
  strictDirectoryName?: boolean;
  Metadata?: LightningComponentBundle;
  ApiVersion?: string;
  ManageableState?: string;
  SobjectType?: string;
};

export default class CleanUnlockedPackages extends SfCommand<any> {
  public static title = "Clean installed unlocked packages";

  public static description: string = `Clean installed unlocked packages, such as those installed from unofficialSF`;

  public static examples = ["$ sfdx hardis:project:clean:unlockedpackages"];

  public static flags: any = {
    folder: Flags.string({
      char: "f",
      default: "force-app",
      description: "Root folder",
    }),
    debug: Flags.boolean({
      char: "d",
      default: false,
      description: messages.getMessage("debugMode"),
    }),
    websocket: Flags.string({
      description: messages.getMessage("websocket"),
    }),
    skipauth: Flags.boolean({
      description:
        "Skip authentication check when a default username is required",
    }),
    "target-org": Flags.requiredOrg(),
  };

  private registry = new RegistryAccess();

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = true;

  protected folder: string;
  protected debugMode = false;

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(CleanUnlockedPackages);
    const connection = flags["target-org"].getConnection();
    this.folder = flags.path || "./force-app";
    this.debugMode = flags.debug || false;
    const rootFolder = path.resolve(this.folder);

    /* jscpd:ignore-end */

    // List available unlocked packages in org
    const packagesInProject = await this.queryUnlockedPkgs(connection);
    // Generate choices for prompt, filtering for packages with no NamespacePrefix
    const choices = packagesInProject.records
      .filter((pkg) => pkg.SubscriberPackage.NamespacePrefix == null)
      .map((pkg) => ({
        title: pkg.SubscriberPackage.Name,
        value: pkg.SubscriberPackageId,
        version: pkg.SubscriberPackageVersionId,
      }));

    //Prompt which package to clean up
    const promptValue = await prompts([
      {
        type: "select",
        name: "Id",
        message: "Please select the package to clean out",
        description: "Choose which unlocked package you would like work with",
        choices: choices,
      },
    ]);
    const chosenPackage = choices.filter((id) => id.value == promptValue.Id)[0];

    // Tooling query specific package
    const unlockedPackageQuery = `
      SELECT SubjectID, SubjectKeyPrefix
      FROM Package2Member
      WHERE SubscriberPackageId='${promptValue.Id}'
    `;
    type Row = { SubjectKeyPrefix: string; SubjectId: string };
    const pkgMembers: { records: Row[] } = await soqlQueryTooling(
      unlockedPackageQuery,
      connection
    );

    // Collect IDs into map per type
    const memberByTypeMap = new Map<string, string[]>();
    for (const { SubjectKeyPrefix, SubjectId } of pkgMembers.records) {
      this.getOrInitKey(memberByTypeMap, SubjectKeyPrefix).push(SubjectId);
    }

    // Use APIs to gather relevant metadata fields for all IDs
    const unlockedPackageMetadata: PackageMetadata[] =
      await this.gatherAllMetadata(memberByTypeMap, connection);

    // Find which files from package metadata exist in project
    const filesForMultiselect: Array<any> = await this.matchFilesExistInProject(
      unlockedPackageMetadata,
      rootFolder
    );

    const promptElementsToRemove = await prompts([
      {
        type: "multiselect",
        name: "choices",
        message: `Found ${filesForMultiselect.length} Metadata items from ${chosenPackage.title}`,
        description: "Choose which elements you would like to remove",
        choices: filesForMultiselect,
      },
    ]);

    const shouldDeleteFiles: Array<string> =
      promptElementsToRemove.choices.flatMap((id: string) => {
        return filesForMultiselect.find((sel) => sel.value === id).elements;
      });

    if (!shouldDeleteFiles.length) {
      const msg = `No ${c.green(
        c.bold(chosenPackage.title)
      )} items chosen. Ended without deletion.`;
      uxLog("warning", this, msg);
      return { outputString: msg };
    }

    // Delete selected files
    for (const filePath of shouldDeleteFiles) {
      if (!fs.existsSync(filePath)) continue;

      await fs.remove(filePath);
      const msg = c.cyan(`Removed managed item ${c.yellow(filePath)}`);
      uxLog("action", this, msg);
    }

    // Summary
    const msg = `Cleaned ${c.green(c.bold(chosenPackage.title))} removing ${
      promptElementsToRemove.choices.length
    } Metadata items.`;
    uxLog("success", this, msg);
    // Return an object to be displayed with --json
    return { outputString: msg };
  }

  private getOrInitKey<Key, Value>(map: Map<Key, Value[]>, key: Key): Value[] {
    const existing = map.get(key);
    if (existing) return existing;
    const created: Value[] = [];
    map.set(key, created);
    return created;
  }

  private async queryUnlockedPkgs(connection: Connection) {
    let pkgsQuery = `
      SELECT SubscriberPackageId, SubscriberPackage.NamespacePrefix, SubscriberPackage.Name, SubscriberPackageVersionId
      FROM InstalledSubscriberPackage
      ORDER BY SubscriberPackage.NamespacePrefix
      `;

    const packagesInProject = await soqlQueryTooling(pkgsQuery, connection);
    uxLog("other", this, `Found ${packagesInProject.records.length} packages.`);
    return packagesInProject;
  }

  private preparePackageMetadata(response): Array<PackageMetadata> {
    return response.map((entry) => {
      const {
        Id,
        attributes,
        Name,
        FullName,
        DeveloperName,
        Metadata,
        ApiVersion,
        ManageableState,
        SobjectType,
      } = entry.body ?? entry;
      const type = attributes?.type;
      const isListView = type == "ListView";
      let mdType = type;

      try {
        const registryType = this.registry.getTypeByName(type);
        mdType = registryType;
      } catch (error) {
        console.log(error);
      }

      return {
        Id,
        retrievedType: type,
        type: mdType,
        SobjectType: isListView ? SobjectType : null,
        directoryName: mdType?.directoryName,
        strictDirectoryName: mdType?.strictDirectoryName,
        Name: FullName ?? Name ?? DeveloperName,
        Metadata,
        ApiVersion,
        ManageableState,
      };
    });
  }

  private async gatherAllMetadata(
    memberByTypeMap: Map<string, string[]>,
    connection: Connection
  ): Promise<PackageMetadata[]> {
    const globalPlatformResult = await connection.describeGlobal();
    const platformPrefixMap = new Map<string, string>(
      globalPlatformResult.sobjects
        .filter((s) => s.keyPrefix)
        .map((s) => [s.keyPrefix as string, s.name])
    );

    // Get All Org SObject with prefix key
    const globalObjectsResult = await connection.tooling.describeGlobal();

    const orgObjPrefixKeyMap = new Map<string, string>(
      globalObjectsResult.sobjects
        .filter((s) => s.keyPrefix)
        .map((s) => [s.keyPrefix as string, s.name])
    );

    const unlockedPackageMetadata: PackageMetadata[] = [];

    for (const [pfx, members] of memberByTypeMap) {
      let objName;
      let useCompositeFallback = false;
      const supportsComposite = platformPrefixMap.has(pfx);
      const objByPrefix = orgObjPrefixKeyMap.get(pfx);
      switch (objByPrefix) {
        case "RemoteProxy":
          objName = "remotesite";
          break;
        case "QuickActionDefinition":
          objName = "quickAction";
          break;
        case undefined:
          useCompositeFallback = supportsComposite;
          break;
        default:
          objName = objByPrefix;
      }

      if (members.length > 25) {
        if (supportsComposite) {
          useCompositeFallback = true;
        } else {
          uxLog(
            "error",
            this,
            c.cyan(`Too many members to fetch: ${c.yellow(objName)}(${pfx})`)
          );
          continue;
        }
      }

      if (objName && !useCompositeFallback) {
        const request = {
          allOrNone: false,
          compositeRequest: members.map((id) => ({
            method: "GET",
            referenceId: id,
            url: `/services/data/v${connection.version}/tooling/sobjects/${objName}/${id}`,
          })),
        };
        // ListView needs to get SobjectType, so it can find the folder of the custom object, and get removed along with it.
        // Shouldn't be handled separately.

        const response: { compositeResponse: Array<any> } =
          await connection.requestPost("/tooling/composite", request);

        unlockedPackageMetadata.push(
          ...this.preparePackageMetadata(response.compositeResponse)
        );
      } else {
        objName = platformPrefixMap.get(pfx);
        if (!objName) {
          const msg = `Could not find reference to the component prefix: ${c.yellow(
            pfx
          )}. No items of this type fetched.`;
          uxLog("error", this, c.cyan(msg));
          continue;
        }
        const url = `/composite/sobjects/${objName}`;
        const response = await connection.requestPost(url, {
          ids: members,
          fields: ["FIELDS(STANDARD)"],
        });
        unlockedPackageMetadata.push(...this.preparePackageMetadata(response));
      }
    }

    return unlockedPackageMetadata;
  }

  private async matchFilesExistInProject(unlockedPackageMetadata, rootFolder) {
    const filesForMultiselect: Array<any> = [];
    for (const el of unlockedPackageMetadata) {
      // console.log([el.directoryName, el.Name]);
      if (!el.directoryName) continue;
      if (el.SobjectType) continue; // Handled by Custom Object
      const findManagedPattern =
        rootFolder + `/**/${el.directoryName}/${el.Name}*`;
      const matchingCustomFiles = await glob(findManagedPattern, {
        cwd: process.cwd(),
        ignore: GLOB_IGNORE_PATTERNS,
      });
      if (matchingCustomFiles.length) {
        filesForMultiselect.push({
          title: `${el.Name} (${el.retrievedType})`,
          value: el.Id,
          elements: matchingCustomFiles,
        });
      }
    }
    return filesForMultiselect;
  }
}
