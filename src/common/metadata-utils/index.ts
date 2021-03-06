import { SfdxError } from '@salesforce/core';
import * as c from 'chalk';
import * as child from 'child_process';
import * as extractZip from 'extract-zip';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import * as util from 'util';
import { execCommand, execSfdxJson, filterPackageXml, uxLog } from '../../common/utils';
import { CONSTANTS } from '../../config';
const exec = util.promisify(child.exec);

class MetadataUtils {

  // Describe packageXml <=> metadata folder correspondance
  public static describeMetadataTypes() {

    // folder is the corresponding folder in metadatas folder
    // nameSuffixList are the files and/or folder names , built from the name of the package.xml item ( in <members> )

    const metadataTypesDescription = {

      // Metadatas to use for copy
      ApexClass: { folder: 'classes', nameSuffixList: ['.cls', '.cls-meta.xml'], sfdxNameSuffixList: ['.cls', '-meta.xml'], permissionSetTypeName: 'classAccesses', permissionSetMemberName: 'apexClass' },
      ApexComponent: { folder: 'components', nameSuffixList: ['.component', '.component-meta.xml'], sfdxNameSuffixList: ['.component', '.component-meta.xml'] },
      ApexPage: { folder: 'pages', nameSuffixList: ['.page', '.page-meta.xml'], sfdxNameSuffixList: ['.page', '-meta.xml'], permissionSetTypeName: 'pageAccesses', permissionSetMemberName: 'apexPage' },
      ApexTrigger: { folder: 'triggers', nameSuffixList: ['.trigger', '.trigger-meta.xml'], sfdxNameSuffixList: ['.trigger', '-meta.xml'] },
      ApprovalProcess: { folder: 'approvalProcesses', nameSuffixList: ['.approvalProcess'], sfdxNameSuffixList: ['.approvalProcess-meta.xml'] },
      AuraDefinitionBundle: { folder: 'aura', nameSuffixList: [''], sfdxNameSuffixList: [''] },
      AuthProvider: { folder: 'authproviders', nameSuffixList: ['.authprovider'], sfdxNameSuffixList: ['.authprovider-meta.xml'] },
      LightningComponentBundle: { folder: 'lwc', nameSuffixList: [''], sfdxNameSuffixList: [''] },
      ContentAsset: { folder: 'contentassets', nameSuffixList: ['.asset', '.asset-meta.xml'], sfdxNameSuffixList: ['.asset', '.asset-meta.xml'] },
      CustomApplication: { folder: 'applications', nameSuffixList: ['.app'], sfdxNameSuffixList: ['.app-meta.xml'], permissionSetTypeName: 'applicationVisibilities', permissionSetMemberName: 'application' },
      CustomLabel: { folder: 'labels', nameSuffixList: ['.labels'], sfdxNameSuffixList: ['.labels-meta.xml'] },
      CustomMetadata: { folder: 'customMetadata', nameSuffixList: ['.md'], sfdxNameSuffixList: ['.md-meta.xml'] },
      CustomMetadataType: { virtual: true, permissionSetTypeName: 'customMetadataTypeAccesses', permissionSetMemberName: 'name' },
      CustomSettings: { virtual: true, permissionSetTypeName: 'customSettingAccesses', permissionSetMemberName: 'name' },
      CustomSite: { folder: 'sites', nameSuffixList: ['.site'], sfdxNameSuffixList: ['.site-meta.xml'] },
      CustomObjectTranslation: { folder: 'objectTranslations', nameSuffixList: ['.objectTranslation'] }, // We use Translations to define the list of objectTranslations to filter & copy
      CustomPermission: { folder: 'customPermissions', nameSuffixList: ['.customPermission'], sfdxNameSuffixList: ['.customPermission-meta.xml'] },
      CustomPlatformEvent: { virtual: true, permissionSetTypeName: 'objectPermissions', permissionSetMemberName: 'object' },
      CustomTab: { folder: 'tabs', nameSuffixList: ['.tab'], sfdxNameSuffixList: ['.tab-meta.xml'], permissionSetTypeName: 'tabSettings', permissionSetMemberName: 'tab' },
      Document: { folder: 'documents', nameSuffixList: ['', '-meta.xml'], sfdxNameSuffixList: ['.documentFolder-meta.xml', '.document-meta.xml', '.png'], metasInSubFolders: true },
      EmailTemplate: { folder: 'email', nameSuffixList: ['', '.email', '.email-meta.xml'], sfdxNameSuffixList: ['.email', '.email-meta.xml'], metasInSubFolders: true },
      EscalationRules: { folder: 'escalationRules', nameSuffixList: ['.escalationRules'], sfdxNameSuffixList: ['.escalationRules-meta.xml'] },
      FlexiPage: { folder: 'flexipages', nameSuffixList: ['.flexipage'], sfdxNameSuffixList: ['.flexipage-meta.xml'] },
      Flow: { folder: 'flows', nameSuffixList: ['.flow'], sfdxNameSuffixList: ['.flow-meta.xml'] },
      GlobalValueSet: { folder: 'globalValueSets', nameSuffixList: ['.globalValueSet'], sfdxNameSuffixList: ['.globalValueSet-meta.xml'] },
      GlobalValueSetTranslation: { folder: 'globalValueSetTranslations', nameSuffixList: ['.globalValueSetTranslation'], sfdxNameSuffixList: ['.globalValueSetTranslation-meta.xml'] },
      HomePageLayout: { folder: 'homePageLayouts', nameSuffixList: ['.homePageLayout'], sfdxNameSuffixList: ['.homePageLayout-meta.xml'] },
      Layout: { folder: 'layouts', nameSuffixList: ['.layout'], sfdxNameSuffixList: ['.layout-meta.xml'] },
      NamedCredential: { folder: 'namedCredentials', nameSuffixList: ['.namedCredential'], sfdxNameSuffixList: ['.namedCredential-meta.xml'] },
      Network: { folder: 'networks', nameSuffixList: ['.network'], sfdxNameSuffixList: ['.network-meta.xml'] },
      NetworkBranding: { folder: 'networkBranding', nameSuffixList: ['', '.networkBranding', '.networkBranding-meta.xml'], sfdxNameSuffixList: ['.networkBranding-meta.xml', '.networkBranding'] },
      NotificationTypeConfig: { folder: 'notificationtypes', nameSuffixList: ['.notiftype'], sfdxNameSuffixList: ['.notiftype-meta.xml'] },
      PermissionSet: { folder: 'permissionsets', nameSuffixList: ['.permissionset'], sfdxNameSuffixList: ['.permissionset-meta.xml'] },
      PlatformCachePartition: { folder: 'cachePartitions', nameSuffixList: ['.cachePartition'], sfdxNameSuffixList: ['.cachePartition-meta.xml'] },
      Profile: { folder: 'profiles', nameSuffixList: ['.profile'], sfdxNameSuffixList: ['.profile-meta.xml'] },
      Queue: { folder: 'queues', nameSuffixList: ['.queue'], sfdxNameSuffixList: ['.queue-meta.xml'] },
      QuickAction: { folder: 'quickActions', nameSuffixList: ['.quickAction'], sfdxNameSuffixList: ['.quickAction-meta.xml'] },
      RemoteSiteSetting: { folder: 'remoteSiteSettings', nameSuffixList: ['.remoteSite'], sfdxNameSuffixList: ['.remoteSite-meta.xml'] },
      Report: { folder: 'reports', nameSuffixList: ['', '-meta.xml'], sfdxNameSuffixList: ['.reportFolder-meta.xml'] },
      Role: { folder: 'roles', nameSuffixList: ['.role'], sfdxNameSuffixList: ['.role-meta.xml'] },
      Settings: { folder: 'settings', nameSuffixList: ['.settings'], sfdxNameSuffixList: ['.settings-meta.xml'] },
      SiteDotCom: { folder: 'siteDotComSites', nameSuffixList: ['.site', '.site-meta.xml'], sfdxNameSuffixList: ['.site', '.site-meta.xml'] },
      StandardValueSet: { folder: 'standardValueSets', nameSuffixList: ['.standardValueSet'], sfdxNameSuffixList: ['.standardValueSet-meta.xml'] },
      StandardValueSetTranslation: { folder: 'standardValueSetTranslations', nameSuffixList: ['.standardValueSetTranslation'], sfdxNameSuffixList: ['.standardValueSetTranslation-meta.xml'] },
      StaticResource: { folder: 'staticresources', nameSuffixList: ['.resource', '.resource-meta.xml'], sfdxNameSuffixList: ['.resource-meta.xml', '.json', '.txt', '.bin', '.js', '.mp3', '.gif'] },
      //      'Translations': { folder: 'translations', nameSuffixList: ['.translation'] }, processed apart, as they need to be filtered
      Workflow: { folder: 'workflows', nameSuffixList: ['.workflow'], sfdxNameSuffixList: ['.workflow-meta.xml'] },

      // Metadatas to use for building objects folder ( SObjects )
      BusinessProcess: { sobjectRelated: true },
      CompactLayout: { sobjectRelated: true },
      CustomField: { sobjectRelated: true, permissionSetTypeName: 'fieldPermissions', permissionSetMemberName: 'field' },
      CustomObject: { sobjectRelated: true, permissionSetTypeName: 'objectPermissions', permissionSetMemberName: 'object' },
      FieldSet: { sobjectRelated: true },
      ListView: { sobjectRelated: true },
      RecordType: { sobjectRelated: true, permissionSetTypeName: 'recordTypeVisibilities', permissionSetMemberName: 'recordType' },
      UserPermission: { sobjectRelated: false, permissionSetTypeName: 'userPermissions', permissionSetMemberName: 'name' },
      ValidationRule: { sobjectRelated: true },
      WebLink: { sobjectRelated: true },

      // Special case: Translations, used for object copy and for filtering
      Translations: { translationRelated: true, folder: 'translations', nameSuffixList: ['.translation'], sfdxNameSuffixList: ['.translation-meta.xml'] }

    };

    return metadataTypesDescription;
  }

  // Describe .object file <=> package.xml formats
  public static describeObjectProperties() {

    const objectFilteringProperties = [
      {
        objectXmlPropName: 'businessProcesses', packageXmlPropName: 'BusinessProcess', nameProperty: 'fullName', translationNameProperty: 'name',
        sfdxNameSuffixList: ['.businessProcess-meta.xml']
      },
      {
        objectXmlPropName: 'compactLayouts', packageXmlPropName: 'CompactLayout', nameProperty: 'fullName', translationNameProperty: 'layout',
        sfdxNameSuffixList: ['.compactLayout-meta.xml']
      },
      {
        objectXmlPropName: 'fields', packageXmlPropName: 'CustomField', nameProperty: 'fullName', translationNameProperty: 'name',
        sfdxNameSuffixList: ['.field-meta.xml']
      },
      {
        objectXmlPropName: 'listViews', packageXmlPropName: 'ListView', nameProperty: 'fullName', translationNameProperty: 'name',
        sfdxNameSuffixList: ['.listView-meta.xml']
      },
      {
        objectXmlPropName: 'layouts', packageXmlPropName: 'Layout', nameProperty: 'fullName', translationNameProperty: 'layout',
        sfdxNameSuffixList: ['.layout-meta.xml']
      },
      {
        objectXmlPropName: 'recordTypes', packageXmlPropName: 'RecordType', nameProperty: 'fullName', translationNameProperty: 'name',
        sfdxNameSuffixList: ['.recordType-meta.xml']
      },
      {
        objectXmlPropName: 'webLinks', packageXmlPropName: 'WebLink', nameProperty: 'fullName', translationNameProperty: 'name',
        sfdxNameSuffixList: ['.webLink-meta.xml']
      },
      {
        objectXmlPropName: 'validationRules', packageXmlPropName: 'ValidationRule', nameProperty: 'fullName', translationNameProperty: 'name',
        sfdxNameSuffixList: ['.validationRule-meta.xml']
      },
      {
        objectXmlPropName: 'fieldSets', packageXmlPropName: 'FieldSet', nameProperty: 'fullName', translationNameProperty: 'name',
        sfdxNameSuffixList: ['.fieldSet-meta.xml']
      }
    ];
    return objectFilteringProperties;
  }

  public static listMetadatasNotManagedBySfdx() {
    return [
      'ApexEmailNotifications',
      'AppMenu',
      'AppointmentSchedulingPolicy',
      'Audience',
      'BlacklistedConsumer',
      'ConnectedApp',
      'IframeWhiteListUrlSettings',
      'ManagedContentType',
      'NotificationTypeConfig',
      'Settings',
      'TopicsForObjects'
    ];
  }

  // Get default org that is currently selected for user
  public static async getCurrentOrg(type = 'any') {
    const displayOrgCommand = 'sfdx force:org:display --verbose';
    const displayResult = await execSfdxJson(displayOrgCommand, this, { fail: false, output: true });
    if (displayResult.id && type === 'scratch' && displayResult.scratchOrg) {
      return displayResult;
    } else if (displayResult.id && type === 'any') {
      return displayResult;
    }
    return null;
  }

  // List local orgs for user
  public static async listLocalOrgs(type = 'any') {
    const orgListResult = await execSfdxJson('sfdx force:org:list', this);
    if (type === 'any') {
      return orgListResult?.result || [];
    } else if (type === 'scratch') {
      return (orgListResult?.result?.scratchOrgs.filter((org: any) => {
        return org.status === 'Active';
      })) || [];
    }
    return [];
  }

  // List installed packages on a org
  public static async listInstalledPackages(orgAlias: string = null, commandThis: any): Promise<any[]> {
    let listCommand = 'sfdx force:package:installed:list';
    if (orgAlias != null) {
      listCommand += ` -u ${orgAlias}`;
    }
    const alreadyInstalled = await execSfdxJson(listCommand, commandThis, { fail: true });
    return alreadyInstalled?.result || [];
  }

  // Install package on existing org
  public static async installPackagesOnOrg(packages: any[], orgAlias: string = null, commandThis: any = null, context = 'none') {
    const alreadyInstalled = await MetadataUtils.listInstalledPackages(null, this);
    for (const package1 of packages) {
      if (alreadyInstalled.filter((installedPackage: any) =>
        package1.SubscriberPackageVersionId === installedPackage.SubscriberPackageVersionId).length === 0) {
          if (context === 'scratch' && package1.installOnScratchOrgs === false) {
            uxLog(commandThis, c.cyan(`Skip installation of ${c.green(package1.SubscriberPackageName)} as it is configured to not be installed on scratch orgs`));
            continue;
          }
          if (context === 'deploy' && package1.installDuringDeployments === false) {
            uxLog(commandThis, c.cyan(`Skip installation of ${c.green(package1.SubscriberPackageName)} as it is configured to not be installed on scratch orgs`));
            continue;
          }
        uxLog(commandThis, c.cyan(`Installing package ${c.green(`${package1.SubscriberPackageName} ${package1.SubscriberPackageVersionName || ''}`)}...`));
        if (package1.SubscriberPackageVersionId == null) {
          throw new SfdxError(c.red(`[sfdx-hardis] You must define ${c.bold('SubscriberPackageVersionId')} in .sfdx-hardis.yml (in installedPackages property)`));
        }
        const securityType = package1.SecurityType || 'AllUsers';
        let packageInstallCommand = `sfdx force:package:install --package ${package1.SubscriberPackageVersionId} --noprompt --securitytype ${securityType} -w 60`;
        if (orgAlias != null) {
          packageInstallCommand += ` -u ${orgAlias}`;
        }
        await execCommand(packageInstallCommand, this, { fail: true, output: true });
      } else {
        uxLog(commandThis, c.cyan(`Skip installation of ${c.green(package1.SubscriberPackageName)} as it is already installed`));
      }
    }
  }

  // Retrieve metadatas from a package.xml
  public static async retrieveMetadatas(packageXml: string, metadataFolder: string, checkEmpty: boolean,
    filteredMetadatas: string[], options: any = {}, commandThis: any, debug: boolean) {

    // Create output folder if not existing
    await fs.ensureDir(metadataFolder);

    // Build package.xml for all org
    uxLog(commandThis, c.cyan(`Generating full package.xml from ${c.green(commandThis.org.getUsername())}...`));
    const manifestRes = await exec('sfdx sfpowerkit:org:manifest:build -o package.xml');
    if (debug) {
      uxLog(commandThis, manifestRes.stdout + manifestRes.stderr);
    }

    // Filter managed items if requested
    if (options.filterManagedItems) {
      uxLog(commandThis, c.cyan('Filtering managed items from package.Xml manifest...'));
      // List installed packages & collect managed namespaces
      const installedPackages = fs.existsSync('sfdx-project.json')?(await this.listInstalledPackages(null, commandThis)):[];
      const namespaces = [];
      for (const installedPackage of installedPackages) {
        if (installedPackage?.SubscriberPackageNamespace !== '' && installedPackage?.SubscriberPackageNamespace != null) {
          namespaces.push(installedPackage.SubscriberPackageNamespace);
        }
      }

      // Filter package XML to remove identified metadatas
      const packageXmlToRemove = (fs.existsSync('./remove-items-package.xml')) ?
        path.resolve('./remove-items-package.xml') :
        path.resolve(__dirname + '/../../../defaults/remove-items-package.xml');
      const removeStandard = (options.removeStandard === false)? false: true ;
      const filterNamespaceRes = await filterPackageXml(packageXml, packageXml, {
        removeNamespaces: namespaces,
        removeStandard: removeStandard,
        removeFromPackageXmlFile: packageXmlToRemove,
        updateApiVersion: CONSTANTS.API_VERSION
      });
      uxLog(commandThis, filterNamespaceRes.message);
    }

    // Filter package XML to remove identified metadatas
    const filterRes = await filterPackageXml(packageXml, packageXml, { removeMetadatas: filteredMetadatas });
    uxLog(commandThis, filterRes.message);

    // Retrieve metadatas
    if (fs.readdirSync(metadataFolder).length === 0 || checkEmpty === false) {
      uxLog(commandThis, c.cyan(`Retrieving metadatas in ${c.green(metadataFolder)}...`));
      const retrieveCommand = 'sfdx force:mdapi:retrieve' +
        ` --retrievetargetdir ${metadataFolder}` +
        ` --unpackaged ${packageXml}` +
        ' --wait 60' +
        ((debug) ? ' --verbose' : '');
      const retrieveRes = await execSfdxJson(retrieveCommand, this, { output: false, fail: true, debug });
      if (debug) {
        uxLog(commandThis, retrieveRes);
      }
      // Unzip metadatas
      uxLog(commandThis, c.cyan('Unzipping metadatas...'));
      await extractZip(path.join(metadataFolder, 'unpackaged.zip'), { dir: metadataFolder });
      await fs.unlink(path.join(metadataFolder, 'unpackaged.zip'));
    }
  }

  // Deploy destructive changes
  public static async deployDestructiveChanges(packageDeletedXmlFile: string, options: any = { debug: false, check: false }, commandThis: any) {
    // Create empty deployment file because of sfdx limitation
    // cf https://gist.github.com/benahm/b590ecf575ff3c42265425233a2d727e
    uxLog(commandThis, c.cyan(`Deploying destructive changes from file ${path.resolve(packageDeletedXmlFile)}`));
    const tmpDir = path.join(os.tmpdir(), 'sfdx-hardis-' + parseFloat(Math.random().toString()));
    await fs.ensureDir(tmpDir);
    const emptyPackageXmlFile = path.join(tmpDir, 'package.xml');
    await fs.writeFile(emptyPackageXmlFile,
      `<?xml version="1.0" encoding="UTF-8"?>
        <Package xmlns="http://soap.sforce.com/2006/04/metadata">
          <version>${CONSTANTS.API_VERSION}</version>
        </Package>`, 'utf8');
    await fs.copy(packageDeletedXmlFile, path.join(tmpDir, 'destructiveChanges.xml'));
    const deployDelete = `sfdx force:mdapi:deploy -d ${tmpDir}` +
      ' --wait 60' +
      ' --testlevel NoTestRun' +
      ' --ignorewarnings' + // So it does not fail in case metadata is already deleted
      (options.check ? ' --checkonly' : '') +
      (options.debug ? ' --verbose' : '');
    const deployDeleteRes = await execCommand(deployDelete, this, { output: true, debug: options.debug, fail: true });
    await fs.remove(tmpDir);
    let deleteMsg = '';
    if (deployDeleteRes.status === 0) {
      deleteMsg = `[sfdx-hardis] Successfully ${options.check ? 'checked deployment of' : 'deployed'} destructive changes to Salesforce org`;
      uxLog(commandThis, c.green(deleteMsg));
    } else {
      deleteMsg = '[sfdx-hardis] Unable to deploy destructive changes to Salesforce org';
      uxLog(commandThis, c.red(deployDeleteRes.errorMessage));
    }
  }

  public static async deployMetadatas(options: any = {
    deployDir: '.',
    testlevel: 'RunLocalTests',
    check: false,
    debug: false,
    soap: false
  }) {
    // Perform deployment
    const deployCommand =
      'sfdx force:mdapi:deploy' +
      ` --deploydir ${options.deployDir || '.'}` +
      ' --wait 60' +
      ` --testlevel ${options.testlevel || 'RunLocalTests'}` +
      ` --apiversion ${options.apiVersion || CONSTANTS.API_VERSION}` +
      (options.soap ? ' --soapdeploy' : '') +
      (options.check ? ' --checkonly' : '') +
      (options.debug ? ' --verbose' : '');
    let deployRes;
    try {
      deployRes = await execCommand(deployCommand, this, { output: true, debug: options.debug, fail: true });
    } catch (e) {
      // workaround if --soapdeploy is not available
      if (JSON.stringify(e).includes('--soapdeploy')) {
        uxLog(this, c.yellow("This may be a error with a workaround... let's try it :)"));
        deployRes = await execCommand(deployCommand.replace(' --soapdeploy', ''), this,
          { output: true, debug: options.debug, fail: true });
      } else {
        throw e;
      }
    }
    return deployRes;
  }

}

export { MetadataUtils };
