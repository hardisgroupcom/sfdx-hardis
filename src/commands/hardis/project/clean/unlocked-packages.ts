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

type SobjectRaw = {
  Id: string;
  attributes?: { type?: string };
  Name?: string;
  FullName?: string;
  DeveloperName?: string;
  Metadata?: LightningComponentBundle;
  ApiVersion?: string;
  ManageableState?: string;
  SobjectType?: string;
};

export default class CleanUnlockedPackages extends SfCommand<any> {
  public static title = "Clean installed unlocked packages (beta)";

  public static description: string = `
  ## Command Behavior

**Finds metadata files in your local SFDX project that came from an installed unlocked package, then lets you interactively select and remove them.**

This command helps you clean up source-format files that were introduced by installed unlocked packages (e.g. from unofficialSF, NebulaLogger, Testing libraries), without uninstalling anything from the org. It queries your target org to discover which metadata items belong to the selected package, maps those items to their source-format locations in your repo, and then deletes the files you choose.

Key functionalities:

- **Package Discovery (Org → Local):** Queries InstalledSubscriberPackage in the target org and lists packages without a namespace (typical for unlocked packages).
- **Interactive Selection:** Prompts you to pick which unlocked package to process, then presents a checklist of local files found matching the package metadata items.
- **Safe Clean-up** Deletes only the **local files** you select. It **does not** uninstall packages or remove components from the org.
- **Clear Output & JSON-friendly:** Logs what was found and removed, and returns a concise summary suitable for --json consumers.

Limitations:
This command is an early iteration and does not yet cover all scenarios. Known gaps include:
-   **Edge cases & type mappings:**\
    Not every metadata edge case has been handled or tested. The code manually remaps:
    -   RemoteProxy → remotesite
    -   QuickActionDefinition → quickAction\
        because @salesforce/source-deploy-retrieve does not return a directory for these. There are likely other types that need similar handling.

-   **Unknown items (unresolvable key prefixes):**\
    Some prefixes cannot be resolved via describeGlobal in either Rest or Tooling APIs. These items are skipped with a warning such as:\
    'Could not find reference to the component prefix: 0A7. No items of this type fetched.'

-   **API limits & batching:**\
    There is **no in-code batching** beyond using:
    -   Tooling Composite: '/services/data/vXX.X/tooling/composite'
    -   SObject Collections: '/services/data/vXX.X/composite/sobjects'\
        Composite requests are limited to **25 subrequests** While it's technically possible to nest SObject Collections inside '/services/data/vXX.X/composite' to batch multiple collection calls (up to 5), this is **not implemented** yet.

-   **Large member sets (>25) get skipped if not supported by SObject Collections:**\
    For any given type with more than 25 members, the tool attempts SObject Collections if supported; if not, the type is **skipped** and a message like\
    'Too many members to fetch: TypeName(pfx)'\
    is logged. This notably affects **CustomField** (not available via SObject Collections). This will ultimately be handled with a proper batching solution.

-   **Fields on standard (or dependent) objects can be missed:**\
    Custom fields on **custom objects** from the unlocked package are effectively cleaned when the object folder is removed. However, custom fields on **standard objects** (or objects from dependent packages) may be **missed** due to the batching limitation above. Also pending proper batching solution.

There will be additional edge cases and unsupported types not listed here. Treat the output as advisory and review selections before deletion, as well as any skipped messages for final manual cleanup.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

-   **Org Queries:**
    -   InstalledSubscriberPackage to list installed packages (filtered to NamespacePrefix == null).
    -   Package2Member to enumerate the package's members and obtain their SubjectId and SubjectKeyPrefix.
    -   describeGlobal() (Rest API) and tooling.describeGlobal() to map **key prefixes** to sObject API names.

        -   **Retrieval Strategy:**
    -   Groups member IDs by SubjectKeyPrefix.
    -   Chooses API per prefix:
        -   **Tooling composite** calls to /services/data/vXX.X/tooling/sobjects/{type}/{id} (special-casing RemoteProxy and QuickActionDefinition).
        -   **Composite sObjects** calls to /services/data/vXX.X/composite/sobjects/{sObjectName} with FIELDS(STANDARD) where supported.

            -   **Type Registry:**
    -   Uses @salesforce/source-deploy-retrieve method RegistryAccess to resolve each metadata **type** into directoryName (and strictDirectoryName when applicable).
    -   For Custom Object sub-types, captures SobjectType to ensure removal alongside their **CustomObject** folders.

        -   **File Discovery:**
    -   Builds glob patterns like **/{directoryName}/{Name}* under the chosen root folder (default force-app).
    -   Applies GLOB_IGNORE_PATTERNS to avoid unintended matches (e.g. node_modules, build folders).

        -   **Deletion:**
    -   Uses fs-extra.remove to delete the selected paths.
    -   Logs each removal and prints a final summary (count and package name).

        -   **Flags:**
    -   --folder, -f (default: force-app) --- project root to scan.
    -   --target-org (required) --- org to interrogate for packages and members.
    -   --debug --- verbose diagnostics (e.g. registry misses or type lookups).
    -   --skipauth, --websocket --- standard sfdx-hardis passthrough flags.
</details>
  `;

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

  private preparePackageMetadata(
    response: Array<{ body?: SobjectRaw } | SobjectRaw>
  ): Array<PackageMetadata> {
    return response.map((entry) => {
      const regOverrides = new Map([
        ["RemoteProxy", "remotesite"],
        ["QuickActionDefinition", "quickaction"],
        ["mdt", "md"],
      ]);
      const b = (entry as any).body ?? entry;
      const retrievedType = b.attributes?.type;
      const isMdt = retrievedType.split("__")?.[1] === "mdt";
      const typeName = isMdt ? "mdt" : retrievedType
      const isListView = typeName === "ListView";
      let regType;
      try {
        regType = this.registry.getTypeByName(
          regOverrides.get(typeName) ?? typeName
        );
      } catch (error) {
        console.log("Errored item:", [typeName, b.Id]);
      }

      if (isMdt) {
        // We need to add the MDT to the possible lists, and look in the customMetadata folder for it
        // We also then need to look for the custom metadata definition itself (in objects folder)
        console.log("MDT: ", [b.Id, typeName]);
        const Name = 
      }

      // Custom metadata name looks like:
      // typeName (minus __mdt) + "." + DeveloperName

      return {
        Id: b.Id,
        retrievedType: retrievedType,
        type: regType,
        SobjectType: isListView ? b.SobjectType : null,
        directoryName: regType?.directoryName,
        strictDirectoryName: regType?.strictDirectoryName,
        Name: b.FullName ?? b.Name ?? b.DeveloperName,
        Metadata: b.Metadata,
        ApiVersion: b.ApiVersion,
        ManageableState: b.ManageableState,
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

    const toolingPrefixMap = new Map<string, string>(
      globalObjectsResult.sobjects
        .filter((s) => s.keyPrefix)
        .map((s) => [s.keyPrefix as string, s.name])
    );

    const unlockedPackageMetadata: PackageMetadata[] = [];

    for (const [pfx, members] of memberByTypeMap) {
      let useCompositeFallback = false;
      const supportsComposite = platformPrefixMap.has(pfx);
      const objName = toolingPrefixMap.get(pfx);
      if (objName === undefined) {
        useCompositeFallback = supportsComposite;
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
        const compName = platformPrefixMap.get(pfx);
        if (!compName) {
          const msg = `Could not find reference to the component prefix: ${c.yellow(
            pfx
          )}. No items of this type fetched.`;
          uxLog("error", this, c.cyan(msg));
          uxLog("other", this, c.cyan(`Members: ${JSON.stringify(members)}`));
          continue;
        }
        const url = `/composite/sobjects/${compName}`;
        const response: Array<any> = await connection.requestPost(url, {
          ids: members,
          fields: ["FIELDS(STANDARD)"],
        });
        unlockedPackageMetadata.push(...this.preparePackageMetadata(response));
      }
    }

    return unlockedPackageMetadata;
  }

  private async matchFilesExistInProject(unlockedPackageMetadata, rootFolder) {
    const filesForMultiselect: Array<{
      title: string;
      value: string;
      elements: string[];
    }> = [];
    for (const el of unlockedPackageMetadata) {
      // console.log([el.directoryName, el.Name]);
      if (!el.directoryName || el.SobjectType) continue;
      if (!el.Name) continue;
      const dir = el.strictDirectoryName
        ? el.strictDirectoryName
        : el.directoryName;
      const locationPattern = rootFolder + `/**/${dir}/${el.Name}*`;
      const matches = await glob(locationPattern, {
        cwd: process.cwd(),
        ignore: GLOB_IGNORE_PATTERNS,
      });
      if (matches.length) {
        filesForMultiselect.push({
          title: `${el.Name} (${el.retrievedType})`,
          value: el.Id,
          elements: matches,
        });
      }
    }
    return filesForMultiselect;
  }
}
