import { SfdxError } from "@salesforce/core";
import * as c from "chalk";
import * as extractZip from "extract-zip";
import * as fs from "fs-extra";
import * as path from "path";
import * as sortArray from "sort-array";
import { elapseEnd, elapseStart, execCommand, execSfdxJson, filterPackageXml, git, isGitRepo, uxLog } from "../../common/utils";
import { CONSTANTS } from "../../config";
import { PACKAGE_ROOT_DIR } from "../../settings";
import { getCache, setCache } from "../cache";
import { buildOrgManifest } from "../utils/deployUtils";
import { listMajorOrgs } from "../utils/orgConfigUtils";
import { isSfdxProject } from "../utils/projectUtils";
import { prompts } from "../utils/prompts";
import { parsePackageXmlFile } from "../utils/xmlUtils";
import { listMetadataTypes } from "./metadataList";
import { FileStatusResult } from "simple-git";

class MetadataUtils {
  // Describe packageXml <=> metadata folder correspondance
  public static describeMetadataTypes() {
    // folder is the corresponding folder in metadatas folder
    // nameSuffixList are the files and/or folder names , built from the name of the package.xml item ( in <members> )

    const metadataTypesDescription = {
      // Metadatas to use for copy
      ApexClass: {
        folder: "classes",
        nameSuffixList: [".cls", ".cls-meta.xml"],
        sfdxNameSuffixList: [".cls", "-meta.xml"],
        permissionSetTypeName: "classAccesses",
        permissionSetMemberName: "apexClass",
      },
      ApexComponent: {
        folder: "components",
        nameSuffixList: [".component", ".component-meta.xml"],
        sfdxNameSuffixList: [".component", ".component-meta.xml"],
      },
      ApexPage: {
        folder: "pages",
        nameSuffixList: [".page", ".page-meta.xml"],
        sfdxNameSuffixList: [".page", "-meta.xml"],
        permissionSetTypeName: "pageAccesses",
        permissionSetMemberName: "apexPage",
      },
      ApexTrigger: {
        folder: "triggers",
        nameSuffixList: [".trigger", ".trigger-meta.xml"],
        sfdxNameSuffixList: [".trigger", "-meta.xml"],
      },
      ApprovalProcess: {
        folder: "approvalProcesses",
        nameSuffixList: [".approvalProcess"],
        sfdxNameSuffixList: [".approvalProcess-meta.xml"],
      },
      AuraDefinitionBundle: {
        folder: "aura",
        nameSuffixList: [""],
        sfdxNameSuffixList: [""],
      },
      AuthProvider: {
        folder: "authproviders",
        nameSuffixList: [".authprovider"],
        sfdxNameSuffixList: [".authprovider-meta.xml"],
      },
      LightningComponentBundle: {
        folder: "lwc",
        nameSuffixList: [""],
        sfdxNameSuffixList: [""],
      },
      ContentAsset: {
        folder: "contentassets",
        nameSuffixList: [".asset", ".asset-meta.xml"],
        sfdxNameSuffixList: [".asset", ".asset-meta.xml"],
      },
      CustomApplication: {
        folder: "applications",
        nameSuffixList: [".app"],
        sfdxNameSuffixList: [".app-meta.xml"],
        permissionSetTypeName: "applicationVisibilities",
        permissionSetMemberName: "application",
      },
      CustomLabel: {
        folder: "labels",
        nameSuffixList: [".labels"],
        sfdxNameSuffixList: [".labels-meta.xml"],
      },
      CustomMetadata: {
        folder: "customMetadata",
        nameSuffixList: [".md"],
        sfdxNameSuffixList: [".md-meta.xml"],
      },
      CustomMetadataType: {
        virtual: true,
        permissionSetTypeName: "customMetadataTypeAccesses",
        permissionSetMemberName: "name",
      },
      CustomSettings: {
        virtual: true,
        permissionSetTypeName: "customSettingAccesses",
        permissionSetMemberName: "name",
      },
      CustomSite: {
        folder: "sites",
        nameSuffixList: [".site"],
        sfdxNameSuffixList: [".site-meta.xml"],
      },
      CustomObjectTranslation: {
        folder: "objectTranslations",
        nameSuffixList: [".objectTranslation"],
      }, // We use Translations to define the list of objectTranslations to filter & copy
      CustomPermission: {
        folder: "customPermissions",
        nameSuffixList: [".customPermission"],
        sfdxNameSuffixList: [".customPermission-meta.xml"],
      },
      CustomPlatformEvent: {
        virtual: true,
        permissionSetTypeName: "objectPermissions",
        permissionSetMemberName: "object",
      },
      CustomTab: {
        folder: "tabs",
        nameSuffixList: [".tab"],
        sfdxNameSuffixList: [".tab-meta.xml"],
        permissionSetTypeName: "tabSettings",
        permissionSetMemberName: "tab",
      },
      Document: {
        folder: "documents",
        nameSuffixList: ["", "-meta.xml"],
        sfdxNameSuffixList: [".documentFolder-meta.xml", ".document-meta.xml", ".png"],
        metasInSubFolders: true,
      },
      EmailTemplate: {
        folder: "email",
        nameSuffixList: ["", ".email", ".email-meta.xml"],
        sfdxNameSuffixList: [".email", ".email-meta.xml"],
        metasInSubFolders: true,
      },
      EscalationRules: {
        folder: "escalationRules",
        nameSuffixList: [".escalationRules"],
        sfdxNameSuffixList: [".escalationRules-meta.xml"],
      },
      FlexiPage: {
        folder: "flexipages",
        nameSuffixList: [".flexipage"],
        sfdxNameSuffixList: [".flexipage-meta.xml"],
      },
      Flow: {
        folder: "flows",
        nameSuffixList: [".flow"],
        sfdxNameSuffixList: [".flow-meta.xml"],
      },
      GlobalValueSet: {
        folder: "globalValueSets",
        nameSuffixList: [".globalValueSet"],
        sfdxNameSuffixList: [".globalValueSet-meta.xml"],
      },
      GlobalValueSetTranslation: {
        folder: "globalValueSetTranslations",
        nameSuffixList: [".globalValueSetTranslation"],
        sfdxNameSuffixList: [".globalValueSetTranslation-meta.xml"],
      },
      HomePageLayout: {
        folder: "homePageLayouts",
        nameSuffixList: [".homePageLayout"],
        sfdxNameSuffixList: [".homePageLayout-meta.xml"],
      },
      Layout: {
        folder: "layouts",
        nameSuffixList: [".layout"],
        sfdxNameSuffixList: [".layout-meta.xml"],
      },
      NamedCredential: {
        folder: "namedCredentials",
        nameSuffixList: [".namedCredential"],
        sfdxNameSuffixList: [".namedCredential-meta.xml"],
      },
      Network: {
        folder: "networks",
        nameSuffixList: [".network"],
        sfdxNameSuffixList: [".network-meta.xml"],
      },
      NetworkBranding: {
        folder: "networkBranding",
        nameSuffixList: ["", ".networkBranding", ".networkBranding-meta.xml"],
        sfdxNameSuffixList: [".networkBranding-meta.xml", ".networkBranding"],
      },
      NotificationTypeConfig: {
        folder: "notificationtypes",
        nameSuffixList: [".notiftype"],
        sfdxNameSuffixList: [".notiftype-meta.xml"],
      },
      PermissionSet: {
        folder: "permissionsets",
        nameSuffixList: [".permissionset"],
        sfdxNameSuffixList: [".permissionset-meta.xml"],
      },
      PlatformCachePartition: {
        folder: "cachePartitions",
        nameSuffixList: [".cachePartition"],
        sfdxNameSuffixList: [".cachePartition-meta.xml"],
      },
      Profile: {
        folder: "profiles",
        nameSuffixList: [".profile"],
        sfdxNameSuffixList: [".profile-meta.xml"],
      },
      Queue: {
        folder: "queues",
        nameSuffixList: [".queue"],
        sfdxNameSuffixList: [".queue-meta.xml"],
      },
      QuickAction: {
        folder: "quickActions",
        nameSuffixList: [".quickAction"],
        sfdxNameSuffixList: [".quickAction-meta.xml"],
      },
      RemoteSiteSetting: {
        folder: "remoteSiteSettings",
        nameSuffixList: [".remoteSite"],
        sfdxNameSuffixList: [".remoteSite-meta.xml"],
      },
      Report: {
        folder: "reports",
        nameSuffixList: ["", "-meta.xml"],
        sfdxNameSuffixList: [".reportFolder-meta.xml"],
      },
      Role: {
        folder: "roles",
        nameSuffixList: [".role"],
        sfdxNameSuffixList: [".role-meta.xml"],
      },
      Settings: {
        folder: "settings",
        nameSuffixList: [".settings"],
        sfdxNameSuffixList: [".settings-meta.xml"],
      },
      SiteDotCom: {
        folder: "siteDotComSites",
        nameSuffixList: [".site", ".site-meta.xml"],
        sfdxNameSuffixList: [".site", ".site-meta.xml"],
      },
      StandardValueSet: {
        folder: "standardValueSets",
        nameSuffixList: [".standardValueSet"],
        sfdxNameSuffixList: [".standardValueSet-meta.xml"],
      },
      StandardValueSetTranslation: {
        folder: "standardValueSetTranslations",
        nameSuffixList: [".standardValueSetTranslation"],
        sfdxNameSuffixList: [".standardValueSetTranslation-meta.xml"],
      },
      StaticResource: {
        folder: "staticresources",
        nameSuffixList: [".resource", ".resource-meta.xml"],
        sfdxNameSuffixList: [".resource-meta.xml", ".json", ".txt", ".bin", ".js", ".mp3", ".gif"],
      },
      //      'Translations': { folder: 'translations', nameSuffixList: ['.translation'] }, processed apart, as they need to be filtered
      Workflow: {
        folder: "workflows",
        nameSuffixList: [".workflow"],
        sfdxNameSuffixList: [".workflow-meta.xml"],
      },

      // Metadatas to use for building objects folder ( SObjects )
      BusinessProcess: { sobjectRelated: true },
      CompactLayout: { sobjectRelated: true },
      CustomField: {
        sobjectRelated: true,
        permissionSetTypeName: "fieldPermissions",
        permissionSetMemberName: "field",
      },
      CustomObject: {
        sobjectRelated: true,
        permissionSetTypeName: "objectPermissions",
        permissionSetMemberName: "object",
      },
      FieldSet: { sobjectRelated: true },
      ListView: { sobjectRelated: true },
      RecordType: {
        sobjectRelated: true,
        permissionSetTypeName: "recordTypeVisibilities",
        permissionSetMemberName: "recordType",
      },
      UserPermission: {
        sobjectRelated: false,
        permissionSetTypeName: "userPermissions",
        permissionSetMemberName: "name",
      },
      ValidationRule: { sobjectRelated: true },
      WebLink: { sobjectRelated: true },

      // Special case: Translations, used for object copy and for filtering
      Translations: {
        translationRelated: true,
        folder: "translations",
        nameSuffixList: [".translation"],
        sfdxNameSuffixList: [".translation-meta.xml"],
      },
    };

    return metadataTypesDescription;
  }

  // Describe .object file <=> package.xml formats
  public static describeObjectProperties() {
    const objectFilteringProperties = [
      {
        objectXmlPropName: "businessProcesses",
        packageXmlPropName: "BusinessProcess",
        nameProperty: "fullName",
        translationNameProperty: "name",
        sfdxNameSuffixList: [".businessProcess-meta.xml"],
      },
      {
        objectXmlPropName: "compactLayouts",
        packageXmlPropName: "CompactLayout",
        nameProperty: "fullName",
        translationNameProperty: "layout",
        sfdxNameSuffixList: [".compactLayout-meta.xml"],
      },
      {
        objectXmlPropName: "fields",
        packageXmlPropName: "CustomField",
        nameProperty: "fullName",
        translationNameProperty: "name",
        sfdxNameSuffixList: [".field-meta.xml"],
      },
      {
        objectXmlPropName: "listViews",
        packageXmlPropName: "ListView",
        nameProperty: "fullName",
        translationNameProperty: "name",
        sfdxNameSuffixList: [".listView-meta.xml"],
      },
      {
        objectXmlPropName: "layouts",
        packageXmlPropName: "Layout",
        nameProperty: "fullName",
        translationNameProperty: "layout",
        sfdxNameSuffixList: [".layout-meta.xml"],
      },
      {
        objectXmlPropName: "recordTypes",
        packageXmlPropName: "RecordType",
        nameProperty: "fullName",
        translationNameProperty: "name",
        sfdxNameSuffixList: [".recordType-meta.xml"],
      },
      {
        objectXmlPropName: "webLinks",
        packageXmlPropName: "WebLink",
        nameProperty: "fullName",
        translationNameProperty: "name",
        sfdxNameSuffixList: [".webLink-meta.xml"],
      },
      {
        objectXmlPropName: "validationRules",
        packageXmlPropName: "ValidationRule",
        nameProperty: "fullName",
        translationNameProperty: "name",
        sfdxNameSuffixList: [".validationRule-meta.xml"],
      },
      {
        objectXmlPropName: "fieldSets",
        packageXmlPropName: "FieldSet",
        nameProperty: "fullName",
        translationNameProperty: "name",
        sfdxNameSuffixList: [".fieldSet-meta.xml"],
      },
    ];
    return objectFilteringProperties;
  }

  public static listMetadatasNotManagedBySfdx() {
    return [
      "ApexEmailNotifications",
      "AppMenu",
      "AppointmentSchedulingPolicy",
      "Audience",
      "BlacklistedConsumer",
      "ConnectedApp",
      "CustomIndex",
      "ForecastingType",
      "IframeWhiteListUrlSettings",
      "ManagedContentType",
      "NotificationTypeConfig",
      "Settings",
      "TopicsForObjects",
    ];
  }

  // Get default org that is currently selected for user
  public static async getCurrentOrg() {
    const displayOrgCommand = "sfdx force:org:display";
    const displayResult = await execSfdxJson(displayOrgCommand, this, {
      fail: false,
      output: false,
    });
    if (displayResult?.result?.id) {
      return displayResult.result;
    }
    return null;
  }

  // List local orgs for user
  public static async listLocalOrgs(type = "any", options: any = {}) {
    let orgListResult = await getCache("force:org:list", null);
    if (orgListResult == null) {
      orgListResult = await execSfdxJson("sfdx force:org:list", this);
      await setCache("force:org:list", orgListResult);
    }
    // All orgs
    if (type === "any") {
      return orgListResult?.result || [];
    }
    // Sandbox
    else if (type === "sandbox") {
      return (
        orgListResult?.result?.nonScratchOrgs?.filter((org: any) => {
          return org.loginUrl.includes("--") || org.loginUrl.includes("test.salesforce.com");
        }) || []
      );
    }
    // Sandbox
    else if (type === "devSandbox") {
      const allSandboxes =
        orgListResult?.result?.nonScratchOrgs?.filter((org: any) => {
          return org.loginUrl.includes("--") || org.loginUrl.includes("test.salesforce.com");
        }) || [];
      const majorOrgs = await listMajorOrgs();
      const devSandboxes = allSandboxes.filter((org: any) => {
        return (
          majorOrgs.filter(
            (majorOrg) =>
              majorOrg.targetUsername === org.username ||
              (majorOrg.instanceUrl === org.instanceUrl && !majorOrg.instanceUrl.includes("test.salesforce.com")),
          ).length === 0
        );
      });
      return devSandboxes;
    }
    // scratch
    else if (type === "scratch") {
      return (
        orgListResult?.result?.scratchOrgs?.filter((org: any) => {
          return org.status === "Active" && (options.devHubUsername && org.devHubUsername !== options.devHubUsername ? false : true);
        }) || []
      );
    }
    return [];
  }

  // List installed packages on a org
  public static async listInstalledPackages(orgAlias: string = null, commandThis: any): Promise<any[]> {
    let listCommand = "sfdx force:package:installed:list";
    if (orgAlias != null) {
      listCommand += ` -u ${orgAlias}`;
    }
    try {
      const alreadyInstalled = await execSfdxJson(listCommand, commandThis, {
        fail: true,
        output: true,
      });
      return alreadyInstalled?.result || [];
    } catch (e) {
      uxLog(this, c.yellow(`Unable to list installed packages: This is probably a @salesforce/cli bug !\n${e.message}\n${e.stack}`));
      globalThis.workaroundCliPackages = true;
      return [];
    }
  }

  // Install package on existing org
  public static async installPackagesOnOrg(packages: any[], orgAlias: string = null, commandThis: any = null, context = "none") {
    const alreadyInstalled = await MetadataUtils.listInstalledPackages(orgAlias, this);
    if (globalThis?.workaroundCliPackages === true) {
      uxLog(
        commandThis,
        c.yellow(`Skip packages installation because of a @salesforce/cli bug.
Until it is solved, please install packages manually in target org if necessary.
Issue tracking: https://github.com/forcedotcom/cli/issues/2426`),
      );
      return;
    }
    for (const package1 of packages) {
      if (
        alreadyInstalled.filter((installedPackage: any) => package1.SubscriberPackageVersionId === installedPackage.SubscriberPackageVersionId)
          .length === 0
      ) {
        if (context === "scratch" && package1.installOnScratchOrgs === false) {
          uxLog(
            commandThis,
            c.cyan(`Skip installation of ${c.green(package1.SubscriberPackageName)} as it is configured to not be installed on scratch orgs`),
          );
          continue;
        }
        if (context === "deploy" && package1.installDuringDeployments === false) {
          uxLog(
            commandThis,
            c.cyan(`Skip installation of ${c.green(package1.SubscriberPackageName)} as it is configured to not be installed on scratch orgs`),
          );
          continue;
        }
        uxLog(
          commandThis,
          c.cyan(
            `Installing package ${c.green(
              `${c.bold(package1.SubscriberPackageName || "")} - ${c.bold(package1.SubscriberPackageVersionName || "")}`,
            )}...`,
          ),
        );
        if (package1.SubscriberPackageVersionId == null) {
          throw new SfdxError(
            c.red(`[sfdx-hardis] You must define ${c.bold("SubscriberPackageVersionId")} in .sfdx-hardis.yml (in installedPackages property)`),
          );
        }
        const securityType = package1.SecurityType || "AdminsOnly";
        let packageInstallCommand =
          "sfdx force:package:install" +
          ` --package ${package1.SubscriberPackageVersionId}` +
          " --noprompt" +
          ` --securitytype ${securityType}` +
          " -w 60" +
          " --json " +
          (package1.installationkey != null && package1.installationkey != "" ? ` --installationkey ${package1.installationkey}` : "");
        if (orgAlias != null) {
          packageInstallCommand += ` -u ${orgAlias}`;
        }
        elapseStart(`Install package ${package1.SubscriberPackageName}`);
        try {
          await execCommand(packageInstallCommand, this, {
            fail: true,
            output: true,
          });
        } catch (ex) {
          const ignoredErrors = ["Une version plus récente de ce package est installée.", "A newer version of this package is currently installed."];
          // If ex.message contains at least one of the ignoredError, don't rethrow exception
          if (!ignoredErrors.some((msg) => ex.message && ex.message.includes(msg))) {
            throw ex;
          }
          uxLog(
            this,
            c.yellow(
              `${c.bold("This is not a real error")}: A newer version of ${package1.SubscriberPackageName
              } has been found. You may update installedPackages property in .sfdx-hardis.yml`,
            ),
          );
          uxLog(this, c.yellow(`You can do that using command ${c.bold("sfdx hardis:org:retrieve:packageconfig")} in a minor git branch`));
        }
        elapseEnd(`Install package ${package1.SubscriberPackageName}`);
      } else {
        uxLog(commandThis, c.cyan(`Skip installation of ${c.green(package1.SubscriberPackageName)} as it is already installed`));
      }
    }
  }

  // Retrieve metadatas from a package.xml
  public static async retrieveMetadatas(
    packageXml: string,
    metadataFolder: string,
    checkEmpty: boolean,
    filteredMetadatas: string[],
    options: any = {},
    commandThis: any,
    debug: boolean,
  ) {
    // Create output folder if not existing
    await fs.ensureDir(metadataFolder);

    // Build package.xml for all org
    await buildOrgManifest(commandThis.org.getUsername(), "package-full.xml");
    await fs.copyFile("package-full.xml", "package.xml");
    // Filter managed items if requested
    if (options.filterManagedItems) {
      uxLog(commandThis, c.cyan("Filtering managed items from package.Xml manifest..."));
      // List installed packages & collect managed namespaces
      let namespaces = [];
      if (isSfdxProject()) {
        // Use sfdx command if possible
        const installedPackages = await this.listInstalledPackages(null, commandThis);
        for (const installedPackage of installedPackages) {
          if (installedPackage?.SubscriberPackageNamespace !== "" && installedPackage?.SubscriberPackageNamespace != null) {
            namespaces.push(installedPackage.SubscriberPackageNamespace);
          }
        }
      } else {
        // Get namespace list from package.xml
        const packageXmlContent = await parsePackageXmlFile("package-full.xml");
        namespaces = packageXmlContent["InstalledPackage"] || [];
      }

      // Filter package XML to remove identified metadatas
      const packageXmlToRemove = fs.existsSync("./remove-items-package.xml")
        ? path.resolve("./remove-items-package.xml")
        : path.resolve(PACKAGE_ROOT_DIR + "/defaults/remove-items-package.xml");
      const removeStandard = options.removeStandard === false ? false : true;
      const filterNamespaceRes = await filterPackageXml(packageXml, packageXml, {
        removeNamespaces: namespaces,
        removeStandard: removeStandard,
        removeFromPackageXmlFile: packageXmlToRemove,
        updateApiVersion: CONSTANTS.API_VERSION,
      });
      uxLog(commandThis, filterNamespaceRes.message);
    }
    // Filter package.xml only using locally defined remove-items-package.xml
    else if (fs.existsSync("./remove-items-package.xml")) {
      const filterNamespaceRes = await filterPackageXml(packageXml, packageXml, {
        removeFromPackageXmlFile: path.resolve("./remove-items-package.xml"),
        updateApiVersion: CONSTANTS.API_VERSION,
      });
      uxLog(commandThis, filterNamespaceRes.message);
    }

    // Filter package XML to remove identified metadatas
    const filterRes = await filterPackageXml(packageXml, packageXml, {
      removeMetadatas: filteredMetadatas,
    });
    uxLog(commandThis, filterRes.message);

    // Filter package XML to keep only selected Metadata types
    if (options.keepMetadataTypes) {
      const filterRes2 = await filterPackageXml(packageXml, packageXml, {
        keepMetadataTypes: options.keepMetadataTypes,
      });
      uxLog(commandThis, filterRes2.message);
    }

    // Retrieve metadatas
    if (fs.readdirSync(metadataFolder).length === 0 || checkEmpty === false) {
      uxLog(commandThis, c.cyan(`Retrieving metadatas in ${c.green(metadataFolder)}...`));
      const retrieveCommand =
        "sfdx force:mdapi:retrieve" +
        ` --retrievetargetdir ${metadataFolder}` +
        ` --unpackaged ${packageXml}` +
        ` --wait ${process.env.SFDX_RETRIEVE_WAIT_MINUTES || "60"}` +
        (debug ? " --verbose" : "");
      const retrieveRes = await execSfdxJson(retrieveCommand, this, {
        output: false,
        fail: true,
        debug,
      });
      if (debug) {
        uxLog(commandThis, retrieveRes);
      }
      // Unzip metadatas
      uxLog(commandThis, c.cyan("Unzipping metadatas..."));
      await extractZip(path.join(metadataFolder, "unpackaged.zip"), {
        dir: metadataFolder,
      });
      await fs.unlink(path.join(metadataFolder, "unpackaged.zip"));
    }
  }

  // Prompt user to select a list of metadata types
  public static async promptMetadataTypes() {
    const metadataTypes = sortArray(listMetadataTypes(), { by: ["xmlName"], order: ["asc"] });
    const metadataResp = await prompts({
      type: "multiselect",
      message: c.cyanBright("Please select metadata types"),
      choices: metadataTypes.map((metadataType: any) => {
        return {
          title: c.cyan(`${metadataType.xmlName || "no xml name"} (${metadataType.directoryName || "no dir name"})`),
          value: metadataType,
        };
      }),
    });
    return metadataResp.value;
  }

  // List updated files and reformat them as string
  public static async listChangedFiles(): Promise<FileStatusResult[]> {
    if (!isGitRepo()) {
      return [];
    }
    const files = (await git().status(["--porcelain"])).files;
    const filesSorted = files
      .sort((a, b) => (a.path > b.path ? 1 : -1))
    return filesSorted;
  }
}

export { MetadataUtils };
