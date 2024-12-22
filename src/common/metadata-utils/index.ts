import { SfError } from '@salesforce/core';
import c from 'chalk';
import extractZip from 'extract-zip';
import fs from 'fs-extra';
import * as path from 'path';
import sortArray from 'sort-array';
import {
  elapseEnd,
  elapseStart,
  execCommand,
  execSfdxJson,
  filterPackageXml,
  git,
  isGitRepo,
  uxLog,
} from '../../common/utils/index.js';
import { CONSTANTS } from '../../config/index.js';
import { PACKAGE_ROOT_DIR } from '../../settings.js';
import { getCache, setCache } from '../cache/index.js';
import { buildOrgManifest } from '../utils/deployUtils.js';
import { listMajorOrgs } from '../utils/orgConfigUtils.js';
import { isSfdxProject } from '../utils/projectUtils.js';
import { prompts } from '../utils/prompts.js';
import { parsePackageXmlFile } from '../utils/xmlUtils.js';
import { listMetadataTypes } from './metadataList.js';
import { FileStatusResult } from 'simple-git';
import { glob } from 'glob';

class MetadataUtils {
  // Describe packageXml <=> metadata folder correspondance

  public static listMetadatasNotManagedBySfdx() {
    return [
      'ApexEmailNotifications',
      'AppMenu',
      'AppointmentSchedulingPolicy',
      'Audience',
      'BlacklistedConsumer',
      'ConnectedApp',
      'CustomIndex',
      'ForecastingType',
      'IframeWhiteListUrlSettings',
      'ManagedContentType',
      'NotificationTypeConfig',
      'Settings',
      'TopicsForObjects',
    ];
  }

  // Get default org that is currently selected for user
  public static async getCurrentOrg() {
    const displayOrgCommand = 'sf org display';
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
  public static async listLocalOrgs(type = 'any', options: any = {}) {
    const quickListParams = options?.quickOrgList === true ? ' --skip-connection-status' : '';
    const orgListCommand = `sf org list${quickListParams}`;
    let orgListResult = await getCache(orgListCommand, null);
    if (orgListResult == null) {
      orgListResult = await execSfdxJson(orgListCommand, this);
      await setCache(orgListCommand, orgListResult);
    }
    // All orgs
    if (type === 'any') {
      return orgListResult?.result || [];
    }
    // Sandbox
    else if (type === 'sandbox') {
      return (
        orgListResult?.result?.nonScratchOrgs?.filter((org: any) => {
          return org.loginUrl.includes('--') || org.loginUrl.includes('test.salesforce.com');
        }) || []
      );
    }
    // Sandbox
    else if (type === 'devSandbox') {
      const allSandboxes =
        orgListResult?.result?.nonScratchOrgs?.filter((org: any) => {
          return org.loginUrl.includes('--') || org.loginUrl.includes('test.salesforce.com');
        }) || [];
      const majorOrgs = await listMajorOrgs();
      const devSandboxes = allSandboxes.filter((org: any) => {
        return (
          majorOrgs.filter(
            (majorOrg) =>
              majorOrg.targetUsername === org.username ||
              (majorOrg.instanceUrl === org.instanceUrl && !majorOrg.instanceUrl.includes('test.salesforce.com'))
          ).length === 0
        );
      });
      return devSandboxes;
    }
    // scratch
    else if (type === 'scratch') {
      return (
        orgListResult?.result?.scratchOrgs?.filter((org: any) => {
          return (
            org.status === 'Active' &&
            (options.devHubUsername && org.devHubUsername !== options.devHubUsername ? false : true)
          );
        }) || []
      );
    }
    return [];
  }

  // List installed packages on a org
  public static async listInstalledPackages(orgAlias: string | null = null, commandThis: any): Promise<any[]> {
    let listCommand = 'sf package installed list';
    if (orgAlias != null) {
      listCommand += ` --target-org ${orgAlias}`;
    }
    try {
      const alreadyInstalled = await execSfdxJson(listCommand, commandThis, {
        fail: true,
        output: true,
      });
      return alreadyInstalled?.result || [];
    } catch (e) {
      uxLog(
        this,
        c.yellow(
          `Unable to list installed packages: This is probably a @salesforce/cli bug !\n${(e as Error).message}\n${(e as Error).stack
          }`
        )
      );
      globalThis.workaroundCliPackages = true;
      return [];
    }
  }

  // Install package on existing org
  public static async installPackagesOnOrg(
    packages: any[],
    orgAlias: string | null = null,
    commandThis: any = null,
    context = 'none'
  ) {
    const alreadyInstalled = await MetadataUtils.listInstalledPackages(orgAlias, this);
    if (globalThis?.workaroundCliPackages === true) {
      uxLog(
        commandThis,
        c.yellow(`Skip packages installation because of a @salesforce/cli bug.
Until it is solved, please install packages manually in target org if necessary.
Issue tracking: https://github.com/forcedotcom/cli/issues/2426`)
      );
      return;
    }
    for (const package1 of packages) {
      if (
        alreadyInstalled.filter(
          (installedPackage: any) => package1.SubscriberPackageVersionId === installedPackage.SubscriberPackageVersionId
        ).length === 0
      ) {
        if (context === 'scratch' && package1.installOnScratchOrgs === false) {
          uxLog(
            commandThis,
            c.cyan(
              `Skip installation of ${c.green(
                package1.SubscriberPackageName
              )} as it is configured to not be installed on scratch orgs`
            )
          );
          continue;
        }
        if (context === 'deploy' && package1.installDuringDeployments === false) {
          uxLog(
            commandThis,
            c.cyan(
              `Skip installation of ${c.green(
                package1.SubscriberPackageName
              )} as it is configured to not be installed on scratch orgs`
            )
          );
          continue;
        }
        uxLog(
          commandThis,
          c.cyan(
            `Installing package ${c.green(
              `${c.bold(package1.SubscriberPackageName || '')} - ${c.bold(package1.SubscriberPackageVersionName || '')}`
            )}...`
          )
        );
        if (package1.SubscriberPackageVersionId == null) {
          throw new SfError(
            c.red(
              `[sfdx-hardis] You must define ${c.bold(
                'SubscriberPackageVersionId'
              )} in .sfdx-hardis.yml (in installedPackages property)`
            )
          );
        }
        const securityType = package1.SecurityType || 'AdminsOnly';
        let packageInstallCommand =
          'sf package install' +
          ` --package ${package1.SubscriberPackageVersionId}` +
          ' --no-prompt' +
          ` --security-type ${securityType}` +
          ' --wait 60' +
          ' --json ' +
          (package1.installationkey != null && package1.installationkey != ''
            ? ` --installationkey ${package1.installationkey}`
            : '');
        if (orgAlias != null) {
          packageInstallCommand += ` -u ${orgAlias}`;
        }
        elapseStart(`Install package ${package1.SubscriberPackageName}`);
        try {
          await execCommand(packageInstallCommand, null, {
            fail: true,
            output: true,
          });
        } catch (ex: any) {
          if (ex.message.includes('Installation key not valid')) {
            uxLog(
              this,
              c.yellow(
                `${c.bold('Package requiring password')}: Please manually install package ${package1.SubscriberPackageName
                } in target org using its password, and define 'installDuringDeployments: false' in its .sfdx-hardis.yml reference`
              )
            );
            throw ex;
          }
          const ignoredErrors = [
            'Une version plus récente de ce package est installée.',
            'A newer version of this package is currently installed.',
          ];
          // If ex.message contains at least one of the ignoredError, don't rethrow exception
          if (!ignoredErrors.some((msg) => ex.message && ex.message.includes(msg))) {
            throw ex;
          }
          uxLog(
            this,
            c.yellow(
              `${c.bold('This is not a real error')}: A newer version of ${package1.SubscriberPackageName
              } has been found. You may update installedPackages property in .sfdx-hardis.yml`
            )
          );
          uxLog(
            this,
            c.yellow(
              `You can do that using command ${c.bold('sf hardis:org:retrieve:packageconfig')} in a minor git branch`
            )
          );
        }
        elapseEnd(`Install package ${package1.SubscriberPackageName}`);
      } else {
        uxLog(
          commandThis,
          c.cyan(`Skip installation of ${c.green(package1.SubscriberPackageName)} as it is already installed`)
        );
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
    orgUsername: string,
    debug: boolean
  ) {
    // Create output folder if not existing
    await fs.ensureDir(metadataFolder);

    // Build package.xml for all org
    await buildOrgManifest(orgUsername, 'package-full.xml');
    await fs.copyFile('package-full.xml', 'package.xml');
    // Filter managed items if requested
    if (options.filterManagedItems) {
      uxLog(commandThis, c.cyan('Filtering managed items from package.Xml manifest...'));
      // List installed packages & collect managed namespaces
      let namespaces: any[] = [];
      if (isSfdxProject()) {
        // Use sfdx command if possible
        const installedPackages = await this.listInstalledPackages(orgUsername, commandThis);
        for (const installedPackage of installedPackages) {
          if (
            installedPackage?.SubscriberPackageNamespace !== '' &&
            installedPackage?.SubscriberPackageNamespace != null
          ) {
            namespaces.push(installedPackage.SubscriberPackageNamespace);
          }
        }
      } else {
        // Get namespace list from package.xml
        const packageXmlContent = await parsePackageXmlFile('package-full.xml');
        namespaces = packageXmlContent['InstalledPackage'] || [];
      }

      // Filter package XML to remove identified metadatas
      const packageXmlToRemove = fs.existsSync('./remove-items-package.xml')
        ? path.resolve('./remove-items-package.xml')
        : path.resolve(PACKAGE_ROOT_DIR + '/defaults/remove-items-package.xml');
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
    else if (fs.existsSync('./remove-items-package.xml')) {
      const filterNamespaceRes = await filterPackageXml(packageXml, packageXml, {
        removeFromPackageXmlFile: path.resolve('./remove-items-package.xml'),
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
        'sf project retrieve start' +
        ` --target-metadata-dir ${metadataFolder}` +
        ` --manifest ${packageXml}` +
        ` --wait ${process.env.SFDX_RETRIEVE_WAIT_MINUTES || '60'}` +
        (debug ? ' --verbose' : '');
      const retrieveRes = await execSfdxJson(retrieveCommand, this, {
        output: false,
        fail: true,
        debug,
      });
      if (debug) {
        uxLog(commandThis, retrieveRes);
      }
      // Unzip metadatas
      uxLog(commandThis, c.cyan('Unzipping metadatas...'));
      await extractZip(path.join(metadataFolder, 'unpackaged.zip'), {
        dir: metadataFolder,
      });
      await fs.unlink(path.join(metadataFolder, 'unpackaged.zip'));
    }
  }

  // Prompt user to select a list of metadata types
  public static async promptMetadataTypes() {
    const metadataTypes = sortArray(listMetadataTypes(), { by: ['xmlName'], order: ['asc'] });
    const metadataResp = await prompts({
      type: 'multiselect',
      message: c.cyanBright('Please select metadata types'),
      choices: metadataTypes.map((metadataType: any) => {
        return {
          title: c.cyan(`${metadataType.xmlName || 'no xml name'} (${metadataType.directoryName || 'no dir name'})`),
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
    const files = (await git().status(['--porcelain'])).files;
    const filesSorted = files.sort((a, b) => (a.path > b.path ? 1 : -1));
    return filesSorted;
  }

  public static getMetadataPrettyNames(metadataFilePaths: string[], bold = false): Map<string, string> {
    const metadataList = listMetadataTypes();
    const metadataFilePathsHuman = new Map<string, string>();
    for (const fileRaw of metadataFilePaths) {
      const file = fileRaw.replace(/\\/g, '/').replace('force-app/main/default/', '');
      let fileHuman = "" + file;
      for (const metadataDesc of metadataList) {
        if (file.includes(metadataDesc.directoryName || "THEREISNOT")) {
          const splits = file.split(metadataDesc.directoryName + "/");
          const endOfPath = splits[1] || splits[0] || "";
          const suffix = metadataDesc.suffix ?? "THEREISNOT";
          let metadataName = endOfPath.includes("." + suffix + "-meta.xml") ?
            endOfPath.replace("." + suffix + "-meta.xml", "") :
            endOfPath.includes("." + suffix) ?
              endOfPath.replace("." + suffix, "") :
              endOfPath;
          if (bold) {
            metadataName = "*" + metadataName + "*";
          }
          fileHuman = metadataDesc.xmlName + " " + metadataName;
          continue;
        }
      }
      metadataFilePathsHuman.set(fileRaw, fileHuman);
    }
    return metadataFilePathsHuman;
  }

  public static async findMetaFileFromTypeAndName(packageXmlType: string, packageXmlName: string, packageDirectories: any[] = []) {
    // Handle default package directory if not provided as input
    if (packageDirectories.length === 0) {
      packageDirectories = [
        {
          fullPath: path.join(process.cwd(), "force-app"),
          path: "force-app"
        }
      ]
    }
    // Find metadata type from packageXmlName
    const metadataList = listMetadataTypes();
    const metadataTypes = metadataList.filter(metadata => metadata.xmlName === packageXmlType);
    if (metadataTypes.length === 0) {
      // Strange, we shouldn't get here, or it means listMetadataTypes content is not up to date
      return null;
    }
    const metadataType = metadataTypes[0];

    // Look for matching file in sources
    const globExpressions = [
      `**/${metadataType.directoryName}/**/${packageXmlName}.${metadataType.suffix || ""}`, // Works for not-xml files
      `**/${metadataType.directoryName}/**/${packageXmlName}.${metadataType.suffix || ""}-meta.xml` // Works for all XML files
    ]
    for (const packageDirectory of packageDirectories) {
      for (const globExpression of globExpressions) {
        const sourceFiles = await glob(globExpression, {
          cwd: packageDirectory.fullPath,
        });
        if (sourceFiles.length > 0) {
          const metaFile = path.join(packageDirectory.path, sourceFiles[0]);
          return metaFile.replace(/\\/g, "/");
        }
      }
    }
    return null;
  }

  public static async promptFlow() {
    const flowFiles = await glob("**/*.flow-meta.xml", { cwd: "force-app/main/default" });
    const flowSelectRes = await prompts({
      type: 'select',
      message: 'Please select the Flow you want to visually compare',
      choices: flowFiles.map(flowFile => {
        return { value: flowFile, title: flowFile }
      })
    });
    return flowSelectRes.value.replace(/\\/g, "/");
  }

}

export { MetadataUtils };
