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

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = true;

  private registry = new RegistryAccess();

  protected folder: string;
  protected debugMode = false;

  public async queryUnlockedPkgs(connection: Connection) {
    let pkgsQuery = `
      SELECT SubscriberPackageId, SubscriberPackage.NamespacePrefix, SubscriberPackage.Name, SubscriberPackageVersionId
      FROM InstalledSubscriberPackage
      ORDER BY SubscriberPackage.NamespacePrefix
      `;

    const pkgsResult = await soqlQueryTooling(pkgsQuery, connection);
    uxLog("other", this, `Found ${pkgsResult.records.length} packages.`);
    return pkgsResult;
  }

  public async getPlatformSobjects(connection: Connection) {
    return connection.describeGlobal();
  }
  public async getToolingSobjects(connection: Connection) {
    return connection.tooling.describeGlobal();
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

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(CleanUnlockedPackages);
    const connection = flags["target-org"].getConnection();
    this.folder = flags.path || "./force-app";
    this.debugMode = flags.debug || false;
    const rootFolder = path.resolve(this.folder);

    /* jscpd:ignore-end */

    // List available unlocked packages in org
    const pkgsResult = await this.queryUnlockedPkgs(connection);
    // Generate choices for prompt, filtering for packages with no NamespacePrefix
    const choices = pkgsResult.records
      .filter((pkg) => pkg.SubscriberPackage.NamespacePrefix == null)
      .map((pkg) => ({
        title: pkg.SubscriberPackage.Name,
        value: pkg.SubscriberPackageId,
        version: pkg.SubscriberPackageVersionId,
      }));

    const globalPlatformResult = await this.getPlatformSobjects(connection);
    const platformPrefixMap = new Map<string, string>(
      globalPlatformResult.sobjects
        .filter((s) => s.keyPrefix)
        .map((s) => [s.keyPrefix as string, s.name])
    );

    // Get All Org SObject with prefix key
    const globalObjectsResult = await this.getToolingSobjects(connection);

    const orgObjPrefixKeyMap = new Map<string, string>(
      globalObjectsResult.sobjects
        .filter((s) => s.keyPrefix)
        .map((s) => [s.keyPrefix as string, s.name])
    );

    //Prompt which package to clean up
    const promptUlpkgToClean = await prompts([
      {
        type: "select",
        name: "packageId",
        message: "Please select the package to clean out",
        description: "Choose which unlocked package you would like work with",
        choices: choices,
      },
    ]);
    const chosenPackage = choices.filter(
      (id) => id.value == promptUlpkgToClean.packageId
    )[0];

    // Tooling query specific package
    const unlockedPackageQuery = `
      SELECT SubjectID, SubjectKeyPrefix
      FROM Package2Member
      WHERE SubscriberPackageId='${promptUlpkgToClean.packageId}'
    `;
    const unlockedPackageMembers = await soqlQueryTooling(
      unlockedPackageQuery,
      connection
    );

    const memberMap = unlockedPackageMembers.records.reduce(
      (mmap, { SubjectKeyPrefix, SubjectId }) => {
        if (!mmap.has(SubjectKeyPrefix)) {
          mmap.set(SubjectKeyPrefix, []);
        }
        mmap.get(SubjectKeyPrefix).push(SubjectId);
        return mmap;
      },
      new Map()
    );

    const unlockedPackageMetadata: PackageMetadata[] = [];

    for (const [pfx, members] of memberMap) {
      const supportsComposite = platformPrefixMap.has(pfx);
      let useComposite = false;
      const objByPrefix = orgObjPrefixKeyMap.get(pfx);
      let objName;
      switch (objByPrefix) {
        case "RemoteProxy":
          objName = "remotesite";
          break;
        case "QuickActionDefinition":
          objName = "quickAction";
          break;
        case undefined:
          if (supportsComposite) {
            useComposite = true;
          }
          break;
        default:
          objName = objByPrefix;
      }

      if (members.length > 25) {
        if (supportsComposite) {
          useComposite = true;
        } else {
          uxLog(
            "error",
            this,
            c.cyan(`Too many members to fetch: ${c.yellow(objName)}(${pfx})`)
          );
          continue;
        }
      }

      if (objName && !useComposite) {
        const request = {
          allOrNone: false,
          compositeRequest: members.map((id) => ({
            method: "GET",
            referenceId: id,
            url: `/services/data/v${connection.version}/tooling/sobjects/${objName}/${id}`,
          })),
        };

        const response: { compositeResponse: Array<any> } =
          await connection.requestPost("/tooling/composite", request);

        unlockedPackageMetadata.push(
          ...this.preparePackageMetadata(response.compositeResponse)
        );
      } else {
        objName = platformPrefixMap.get(pfx);
        if (!objName) {
          uxLog(
            "error",
            this,
            c.cyan(
              `Could not find reference to the component prefix: ${c.yellow(
                pfx
              )}. No items of this type fetched.`
            )
          );
          continue;
        }
        const url = `/composite/sobjects/${objName}`;
        const ids = members;
        const response = await connection.requestPost(url, {
          ids: ids,
          fields: ["FIELDS(STANDARD)"],
        });
        console.log(response);
        unlockedPackageMetadata.push(...this.preparePackageMetadata(response));
      }
    }

    // ListView needs to get SobjectType, so it can find the folder of the custom object, and get removed along with it.
    // Shouldn't be handled separately.

    const presentForSelection: Array<any> = [];
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
        presentForSelection.push({
          title: `${el.Name} (${el.retrievedType})`,
          value: el.Id,
          elements: matchingCustomFiles,
        });
      }
    }

    const promptElementsToRemove = await prompts([
      {
        type: "multiselect",
        name: "choices",
        message: `Found ${presentForSelection.length} Metadata items from ${chosenPackage.title}`,
        description: "Choose which elements you would like to remove",
        choices: presentForSelection,
      },
    ]);

    const shouldDeleteFiles: Array<string> =
      promptElementsToRemove.choices.flatMap((id: string) => {
        return presentForSelection.find((sel) => sel.value === id).elements;
      });

    if (!shouldDeleteFiles.length) {
      const msg = `No ${c.green(
        c.bold(chosenPackage.title)
      )} items chosen. Ended without deletion.`;
      uxLog("warning", this, msg);
      return { outputString: msg };
    }

    for (const filePath of shouldDeleteFiles) {
      if (!fs.existsSync(filePath)) {
        continue;
      }

      await fs.remove(filePath);
      uxLog(
        "action",
        this,
        c.cyan(`Removed managed item ${c.yellow(filePath)}`)
      );
    }

    // Summary
    const msg = `Cleaned ${c.green(c.bold(chosenPackage.title))} removing ${
      promptElementsToRemove.choices.length
    } Metadata items.`;
    uxLog("success", this, msg);
    // Return an object to be displayed with --json
    return { outputString: msg };
  }
}
