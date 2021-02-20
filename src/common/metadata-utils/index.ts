import * as child from 'child_process';
import * as extractZip from 'extract-zip';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as sfdx from 'sfdx-node';
import * as util from 'util';
import { execSfdxJson, filterPackageXml, uxLog } from '../../common/utils';
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

  // List installed packages on a org
  public static async listInstalledPackages(orgAlias: string = null, commandThis: any): Promise<any[]> {
    const alreadyInstalled = await execSfdxJson('sfdx force:package:installed:list', commandThis, { fail: true });
    return alreadyInstalled?.result || [];
  }

  // Retrieve metadatas from a package.xml
  public static async retrieveMetadatas(packageXml: string, metadataFolder: string, checkEmpty: boolean,
                                        filteredMetadatas: string[], options: any = {}, commandThis: any, debug: boolean) {

    // Build package.xml for all org
    uxLog(commandThis, `[sfdx-hardis] Generating full package.xml from ${commandThis.org.getUsername()}...`);
    const manifestRes = await exec('sfdx sfpowerkit:org:manifest:build -o package.xml');
    if (debug) {
      uxLog(commandThis, manifestRes.stdout + manifestRes.stderr);
    }

    // Filter managed items if requested
    if (options.filterManagedItems) {
      uxLog(commandThis, '[sfdx-hardis] Filtering managed items from package.Xml manifest');
      // List installed packages & collect managed namespaces
      const installedPackages = await this.listInstalledPackages(null, commandThis);
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
      const filterNamespaceRes = await filterPackageXml(packageXml, packageXml, {
        removeNamespaces: namespaces,
        removeStandard: true,
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
      uxLog(commandThis, `[sfdx-hardis] Retrieving metadatas in ${metadataFolder}...`);
      const retrieveRes = await sfdx.mdapi.retrieve({
        retrievetargetdir: metadataFolder,
        unpackaged: packageXml,
        wait: 60,
        verbose: debug,
        _quiet: !debug,
        _rejectOnError: true
      });
      if (debug) {
        uxLog(commandThis, retrieveRes);
      }
      // Unzip metadatas
      uxLog(commandThis, '[sfdx-hardis] Unzipping metadatas...');
      await extractZip(path.join(metadataFolder, 'unpackaged.zip'), { dir: metadataFolder });
      await fs.unlink(path.join(metadataFolder, 'unpackaged.zip'));
    }
  }

}

export { MetadataUtils };
