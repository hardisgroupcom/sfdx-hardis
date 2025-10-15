// QUESTION: Where are the objects extracted in this code?
// ANSWER: The objects are extracted in the generateObjectsList function.
// This function calls conn.describeGlobal() to get all SObjects, then queries each one to check if it has records.
// The user is then prompted to select which objects to extract. The selected objects are returned and used in the rest of the extraction process.
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { prompts } from '../../../../common/utils/prompts.js';
import { uxLog } from '../../../../common/utils/index.js';
import c from 'chalk';
import { generateCsvFile, generateReportPath, createXlsxFromCsvFiles } from '../../../../common/utils/filesUtils.js';
import { bulkQuery } from '../../../../common/utils/apiUtils.js';
import * as path from 'path';
import { getReportDirectory } from '../../../../config/index.js';
import { Messages } from '@salesforce/core';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

// Main command class for extracting Salesforce org profiles and related metadata
export default class ProfilesExtract extends SfCommand<void> {
  public static readonly description = '';

  public static readonly examples = [
    `$ sf hardis:project:clean:profiles-extract --target-org my-org
    Successfully exported SObjects with records to exports/sobjects_with_records.xlsx`,
  ];

  public static readonly flags = {
    'target-org': Flags.requiredOrg({
      char: 'o',
      description: 'The target Salesforce org to fetch SObjects from.',
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
  };

  protected csvFiles: string[] = [];
  protected outputFile: string;
  protected activeProfileNames: Set<string> = new Set();

  /**
   * Main entry point for the command. Orchestrates the extraction process:
   * - Prompts user to select objects
   * - Extracts users, personas, relations, record types, apps, permissions, tabs, and object fields
   * - Generates CSV and XLSX reports
   */
  public async run(): Promise<void> {
    const { flags } = await this.parse(ProfilesExtract);
    const conn = flags['target-org'].getConnection();
    let selectedObjects: string[] = [];
    let numberOfPersonas = 1;
    try {
      selectedObjects = await this.generateObjectsList(conn);
      await this.generateUsersExtract(conn);
      numberOfPersonas = await this.generatePersonaExtract();
      await this.generateRelationExtract(selectedObjects, numberOfPersonas);
      await this.generateRTExtract(conn, selectedObjects, numberOfPersonas);
      await this.generateAppsExtract(conn, numberOfPersonas);
      await this.generatePermissionsExtract(conn, numberOfPersonas);
      await this.generateTabsExtract(conn, numberOfPersonas);

      // 1. Extract profile field access and get all profiles
      const profileFieldAccess = await this.getProfileFieldAccessData(conn, selectedObjects);
      const profileNames = Array.from(new Set(profileFieldAccess.map(r => r.Profile).filter(Boolean)));

      // 2. Pass profileNames to generateObjectFieldsExtract
  await this.generateObjectFieldsExtract(conn, selectedObjects, numberOfPersonas, profileNames, profileFieldAccess);

      // 3. Write the profile field access CSV (as before)
      if (profileFieldAccess.length > 0) {
        const reportDir = await getReportDirectory();
        this.outputFile = path.join(reportDir, 'ProfileFieldAccess.csv');
        await generateCsvFile(profileFieldAccess, this.outputFile, { fileTitle: 'Profile Field Access', noExcel: true });
        this.csvFiles.push(this.outputFile);
      } else {
        uxLog('log', this, c.yellow('No profile field access records found, skipping ProfileFieldAccess.csv.'));
      }

      this.outputFile = '';
      this.outputFile = await generateReportPath('profiles-extract', this.outputFile);
      await createXlsxFromCsvFiles(this.csvFiles, this.outputFile, { fileTitle: 'profiles extract' });
    } catch (error) {
      uxLog('log', this, c.red('Failed to fetch SObjects.'));
      throw error;
    }
  }
  /**
   * Extracts field-level access for profiles using FieldPermissions object.
   * Generates a CSV report of profile-field access.
   * @param conn Salesforce connection
   */
  // Returns all profile field access records as an array
  async getProfileFieldAccessData(conn: any, selectedObjects: string[]) {
    const fieldAccessRecords: { Profile: string; SObjectType: string; Field: string; PermissionsRead: string; PermissionsEdit: string }[] = [];
    try {
      let soql = `SELECT Field, PermissionsRead, PermissionsEdit, SObjectType, Parent.Profile.Name FROM FieldPermissions WHERE Parent.ProfileId != null`;
      if (selectedObjects && selectedObjects.length > 0) {
        const objectList = selectedObjects.map(obj => `'${obj}'`).join(", ");
        soql += ` AND SObjectType IN (${objectList})`;
      }
      // Add filter for active profiles
      if (this.activeProfileNames && this.activeProfileNames.size > 0) {
        const profileList = Array.from(this.activeProfileNames)
          .filter((name) => !!name)
          .map(name => `'${name.replace(/'/g, "''")}'`).join(", ");
        soql += ` AND Parent.Profile.Name IN (${profileList})`;
      }
      const result = await bulkQuery(soql, conn);
      result.records.forEach((rec: any) => {
        fieldAccessRecords.push({
          Profile: rec['Parent.Profile.Name'],
          SObjectType: rec['SobjectType'],
          Field: rec['Field'],
          PermissionsRead: rec['PermissionsRead'] === true || rec['PermissionsRead'] === 'true' ? 'Yes' : 'No',
          PermissionsEdit: rec['PermissionsEdit'] === true || rec['PermissionsEdit'] === 'true' ? 'Yes' : 'No',
        });
      });
      uxLog('log', this, c.green(`Fetched ${fieldAccessRecords.length} profile field access records.`));
    } catch (error) {
      uxLog('warning', this, c.yellow(`Failed to query FieldPermissions: ${(error as Error).message}`));
    }
    return fieldAccessRecords;
  }

  /**
   * Prompts the user to select Salesforce objects (SObjects) that have records in the org.
   * Generates a CSV report of the selected objects.
   * @param conn Salesforce connection
   * @returns Array of selected object API names
   */
  private async generateObjectsList(conn: any): Promise<string[]> {

    let selectedObjects: string[] = [];
    uxLog('log', this, c.green('Fetching SObjects'));
    let sobjectsList: { label: string; name: string; masterObject: string; objectType: string }[] = [];
    try {
      // Exclude objects whose API names start with any of these prefixes
      const excludedPrefixes = [
        'Active',
        'Apex',
        'AuraDefinition',
        'Business',
        'Content',
        'Dashboard',
        'Email',
        'Flow',
        'Forecasting',
        'Formula',
        'ListView',
        'LoginGeo',
        'Marketing',
        'MatchingRule',
        'PermissionSet',
        'UiFormula',
        'WebLink',
        'pi__'
      ];
      // Exclude objects whose API names are in this explicit list
      const excludedObjects = [
        'AppDefinition', 'AppMenu', 'AssignmentRule', 'AsyncApexJob', 'AuthProvider', 'AuthSession',
        'BrowserPolicyViolation', 'CampaignInfluenceModel', 'CaseStatus', 'ClientBrowser', 'Community',
        'ConnectedApplication', 'ContractStatus', 'CronJobDetail', 'CronTrigger', 'CustomNotificationType',
        'CustomPermission', 'DataType', 'DeleteEvent', 'Domain', 'DuplicateRule', 'EntityDefinition',
        'FeedItem', 'FieldPermissions', 'FieldSecurityClassification', 'FileSearchActivity', 'FiscalYearSettings',
        'Folder', 'Group', 'GroupMember', 'NamedCredential', 'OauthToken', 'ObjectPermissions', 'OrderStatus',
        'OrgWideEmailAddress', 'Organization', 'PackageLicense', 'PartnerRole', 'Period', 'Profile', 'Publisher',
        'QueueSobject', 'RecentlyViewed', 'RecordType', 'Report', 'Scontrol', 'SetupAuditTrail', 'SetupEntityAccess',
        'SolutionStatus', 'StandardInvocableActionType', 'StaticResource', 'TabDefinition', 'TenantUsageEntitlement',
        'Translation', 'VerificationHistory'
      ];
      const sobjects = await conn.describeGlobal();
      sobjectsList = sobjects.sobjects
        .filter(sobj =>
          sobj.queryable &&
          !excludedPrefixes.some(prefix => sobj.name.startsWith(prefix)) &&
          !excludedObjects.includes(sobj.name) &&
          !sobj.name.endsWith('History') &&
          !sobj.name.endsWith('Share')
        )
        .map((sobject) => ({
          label: sobject.label,
          name: sobject.name,
          masterObject: '',
          objectType: sobject.name.endsWith('__c') ? 'Custom' : 'Standard',
        }));

      // Debug: use a fixed list to avoid long waits on orgs with many objects
      // sobjectsList = [{
      //   label: 'Compte', name: 'Account', masterObject: '', objectType: 'Standard'
      // }, {
      //   label: 'Contact', name: 'Contact', masterObject: '', objectType: 'Standard'
      // }, { 
      //   label: 'Opportunité', name: 'Opportunity', masterObject: '', objectType: 'Standard'
      // }, {
      //   label: 'Produit', name: 'Product2', masterObject: '', objectType: 'Standard'
      // }, {
      //   label: 'Abonnement', name: 'sofactoapp__Abonnement__c', masterObject: '', objectType: 'Custom'
      // }, {
      //   label: 'Accès produit', name: 'AccesProduit__c', masterObject: '', objectType: 'Custom' 
      // }, {
      //   label: 'Bénéficiaire', name: 'Beneficiaire__c', masterObject: '', objectType: 'Custom'
      // }, { 
      //   label: 'Grille tarification', name: 'GrilleTarification__c ', masterObject: '', objectType: 'Custom'
      // }]

      uxLog('log', this, c.green('Fetching SObjects completed.'));
      uxLog('log', this, c.green(`Fetched ${sobjectsList.length} SObjects.`));


      const sobjectsWithRecords: { Object_Label: string; API_Name: string; Object_Type: string }[] = [];

      uxLog('log', this, 'Checking SObjects for records');
      for (const sobject of sobjectsList) {
        try {
          const result = await conn.query(`SELECT COUNT() FROM ${sobject.name}`);
          if (result.totalSize > 0) {
            sobjectsWithRecords.push({ Object_Label: sobject.label, API_Name: sobject.name, Object_Type: sobject.objectType });
          }
        } catch (error) {
          uxLog('warning', this, c.yellow(`Failed to query ${sobject.name}: ${(error as Error).message}`));
        }
      }
      this.spinner.stop();

      if (sobjectsWithRecords.length === 0) {
        uxLog('warning', this, c.red('No SObjects with records found.'));
        return [];
      }

      const choices: { title: string; value: string }[] = [];
      for (const sobject of sobjectsWithRecords) {
        choices.push({
          title: `${sobject.API_Name} - ${sobject.Object_Label} - ${sobject.Object_Type}`,
          value: sobject.API_Name,
        });
      }

      const statusRes = await prompts({
        message: "Please select objects to extract",
        type: "multiselect",
        description: "Select objects to extract",
        placeholder: "Select objects",
        choices: choices,
      });

      if (statusRes && statusRes.value !== "all") {
        selectedObjects = statusRes.value;
        uxLog('log', this, `You selected ${selectedObjects.length} objects.`);
      }

      const reportDir = await getReportDirectory();
      this.outputFile = path.join(reportDir, 'Objects.csv');
      // Without xlsx
      await generateCsvFile(sobjectsWithRecords.filter((sobj) => selectedObjects.includes(sobj.API_Name)), this.outputFile, { fileTitle: 'profiles extract', noExcel: true });
      // With xlsx
      // this.outputFilesRes = await generateCsvFile(sobjectsWithRecords.filter((sobj) => selectedObjects.includes(sobj.API_Name)), this.outputFile, { fileTitle: 'profiles extract' });

      this.csvFiles.push(this.outputFile);

    } catch (error) {
      uxLog('log', this, c.red('Failed to fetch SObjects.'));
      throw error;
    }

    return selectedObjects;
  }

  /**
   * Extracts active users from the org, including their username, role, and profile.
   * Generates a CSV report of users.
   * @param conn Salesforce connection
   */
  async generateUsersExtract(conn: any) {
    const usersRecords: { User: string; Role: string; Profil: string; Profil_a_Associe: string; Nouveau_Personna: string; Nouveau_Role: string; }[] = [];
    const userQuery = "SELECT username, UserRole.Name, Profile.Name FROM User WHERE IsActive = true order by username";
    const userResult = await bulkQuery(userQuery, conn);
    usersRecords.push(...userResult.records.map((user) => ({
      User: user.Username,
      Role: user['UserRole.Name'],
      Profil: user['Profile.Name'],
      Profil_a_Associe: '',
      Nouveau_Personna: '',
      Nouveau_Role: '',
    })));
    // Build set of active profile names (filter out empty/null)
    this.activeProfileNames = new Set(userResult.records.map((user) => user['Profile.Name']).filter((n) => !!n));
    uxLog('log', this, c.green(`Fetched ${userResult.records.length} active users.`));
    uxLog('log', this, c.cyan(`Active profiles: ${Array.from(this.activeProfileNames).join(', ')}`));
    const reportDir = await getReportDirectory();
    this.outputFile = path.join(reportDir, 'Users.csv');
    await generateCsvFile(usersRecords, this.outputFile, { fileTitle: 'Users extract', noExcel: true });
    this.csvFiles.push(this.outputFile);
    return;
  }

  /**
   * Prompts the user for the number of personas to create.
   * Generates a CSV report listing the personas.
   * @returns The number of personas
   */
  private async generatePersonaExtract() {
    let numberOfPersonas = 1;
    const statusRes = await prompts({
      message: "Please enter the number of personas to create",
      type: "number",
      description: "Select objects to extract",
      placeholder: "Select objects",
    });
    if (statusRes && statusRes.value !== 0) {
      numberOfPersonas = statusRes.value;
      uxLog('log', this, `Creation of ${numberOfPersonas} personas.`);
    }

    const persona: { 'Nom des personas': string }[] = [];
    for (let i = 1; i <= numberOfPersonas; i++) {
      persona.push({ 'Nom des personas': `Persona${i}` });
    }

    const reportDir = await getReportDirectory();
    this.outputFile = path.join(reportDir, 'persona.csv');
    await generateCsvFile(persona, this.outputFile, { fileTitle: 'persona extract', noExcel: true });
    this.csvFiles.push(this.outputFile);
    return numberOfPersonas;
  }

  /**
   * Generates a CSV mapping each selected object to persona permissions (Read, Create, Edit, Delete).
   * @param selectedObjects Array of object API names
   * @param numberOfPersonas Number of personas
   */
  async generateRelationExtract(selectedObjects: string[], numberOfPersonas: number) {
    const relationRecords: any[] = [];
    // Generate dynamic persona columns using Excel formulas
    selectedObjects.forEach((objName) => {
      const personaCols: Record<string, string> = {};
      for (let i = 1; i <= numberOfPersonas; i++) {
        // Persona row in persona sheet is i+1 (header is row 1)
        const personaRow = i + 1;
        personaCols[`=persona!A${personaRow}&"_Read"`] = '';
        personaCols[`=persona!A${personaRow}&"_Create"`] = '';
        personaCols[`=persona!A${personaRow}&"_Edit"`] = '';
        personaCols[`=persona!A${personaRow}&"_Delete"`] = '';
        personaCols[`=persona!A${personaRow}&"_ViewAll"`] = '';
        personaCols[`=persona!A${personaRow}&"_ModifyAll"`] = '';
      }
      relationRecords.push({
        Object: objName,
        ...personaCols,
      });
    });
    const reportDir = await getReportDirectory();
    this.outputFile = path.join(reportDir, 'Relation.csv');
    await generateCsvFile(relationRecords, this.outputFile, { fileTitle: 'Relation Object Persona', noExcel: true });
    this.csvFiles.push(this.outputFile);
    return;
  }

  /**
   * Extracts record types for each selected object and maps persona access (Active, Default).
   * Generates a CSV report of record types per object.
   * @param conn Salesforce connection
   * @param selectedObjects Array of object API names
   * @param numberOfPersonas Number of personas
   */
  async generateRTExtract(conn: any, selectedObjects: string[], numberOfPersonas: number) {
    const recordTypesRecords: any[] = [];
    for (const objName of selectedObjects) {
      try {
        const rtResult = await conn.query(`SELECT Id, Name, DeveloperName FROM RecordType WHERE SobjectType='${objName}' ORDER BY Name`);
        rtResult.records.forEach((rt) => {
          const personaCols: Record<string, string> = {};
          for (let i = 1; i <= numberOfPersonas; i++) {
            const personaRow = i + 1;
            personaCols[`=persona!A${personaRow}&"_Actif"`] = '';
            personaCols[`=persona!A${personaRow}&"_Default"`] = '';
          }
          recordTypesRecords.push({
            Object: objName,
            Record_Type: rt.Name,
            ...personaCols,
          });
        });
      } catch (error) {
        uxLog('warning', this, c.yellow(`Failed to query RecordTypes for ${objName}: ${(error as Error).message}`));
      }
    }
    const reportDir = await getReportDirectory();
    this.outputFile = path.join(reportDir, 'RecordTypes.csv');
    await generateCsvFile(recordTypesRecords, this.outputFile, { fileTitle: 'Record Types extract', noExcel: true });
    this.csvFiles.push(this.outputFile);
    return;
  }

  /**
   * Extracts custom applications (AppDefinition) and maps persona access (Active, Default).
   * Generates a CSV report of applications.
   * @param conn Salesforce connection
   * @param numberOfPersonas Number of personas
   */
  async generateAppsExtract(conn: any, numberOfPersonas: number) {
    const appsRecords: any[] = [];
    try {
      const rtResult = await conn.query(`SELECT Id, DurableId, DeveloperName, MasterLabel FROM AppDefinition WHERE NamespacePrefix != 'standard'`);
      rtResult.records.forEach((rt) => {
        const personaCols: Record<string, string> = {};
        for (let i = 1; i <= numberOfPersonas; i++) {
          const personaRow = i + 1;
          personaCols[`=persona!A${personaRow}&"_Actif"`] = '';
          personaCols[`=persona!A${personaRow}&"_Default"`] = '';
        }
        appsRecords.push({
          Application: rt.MasterLabel,
          DeveloperName: rt.DeveloperName,
          ...personaCols,
        });
      });
    } catch (error) {
      uxLog('warning', this, c.yellow(`Failed to query Applications : ${(error as Error).message}`));
    }
    const reportDir = await getReportDirectory();
    this.outputFile = path.join(reportDir, 'Applications.csv');
    await generateCsvFile(appsRecords, this.outputFile, { fileTitle: 'Applications extract', noExcel: true });
    this.csvFiles.push(this.outputFile);
    return;
  }

  /**
   * Extracts all boolean permission fields from PermissionSet object.
   * Generates a CSV report mapping each permission to personas.
   * @param conn Salesforce connection
   * @param numberOfPersonas Number of personas
   */
  async generatePermissionsExtract(conn: any, numberOfPersonas: number) {
    const permissionsRecords: any[] = [];

    // Describe the PermissionSet object
    const desc = await conn.describeSObject("PermissionSet");

    // Filter only fields that start with "Permissions"
    const permissionFields = desc.fields.filter(f => f.name.startsWith("Permissions") && f.type === "boolean");

    // Print API name + Label
    permissionFields.forEach(field => {
      const personaCols: Record<string, string> = {};
      for (let i = 1; i <= numberOfPersonas; i++) {
        const personaRow = i + 1;
        personaCols[`=persona!A${personaRow}`] = '';
      }
      permissionsRecords.push({
        Permission_Label: field.label,
        Permission_API_Name: field.name,
        ...personaCols,
      });
    });
    const reportDir = await getReportDirectory();
    this.outputFile = path.join(reportDir, 'Permissions.csv');
    await generateCsvFile(permissionsRecords, this.outputFile, { fileTitle: 'Permissions extract', noExcel: true });
    this.csvFiles.push(this.outputFile);
    return;
  }

  /**
   * Extracts custom tabs and maps persona access.
   * Generates a CSV report of tabs.
   * @param conn Salesforce connection
   * @param numberOfPersonas Number of personas
   */
  async generateTabsExtract(conn: any, numberOfPersonas: number) {
    const tabsRecords: any[] = [];
    try {
      const tabsResult = await conn.query(`SELECT Name, Label FROM TabDefinition WHERE IsCustom = true`);
      tabsResult.records.forEach((tab) => {
        const personaCols: Record<string, string> = {};
        for (let i = 1; i <= numberOfPersonas; i++) {
          const personaRow = i + 1;
          personaCols[`=persona!A${personaRow}`] = '';
        }
        tabsRecords.push({
          Tab_Label: tab.Label,
          Tab_API_Name: tab.Name,
          ...personaCols,
        });
      });
      const reportDir = await getReportDirectory();
      this.outputFile = path.join(reportDir, 'Tabs.csv');
      await generateCsvFile(tabsRecords, this.outputFile, { fileTitle: 'Tabs extract', noExcel: true });
      this.csvFiles.push(this.outputFile);
    } catch (error) {
      uxLog('warning', this, c.yellow(`Failed to query Tabs : ${(error as Error).message}`));
    }
    return;
  }

  /**
   * For each selected object, extracts all fields and their metadata (label, type, picklist values, etc.).
   * Maps persona visibility and read-only status for each field.
   * Generates a CSV report per object.
   * @param conn Salesforce connection
   * @param selectedObjects Array of object API names
   * @param numberOfPersonas Number of personas
   */
  async generateObjectFieldsExtract(conn: any, selectedObjects: string[], numberOfPersonas: number, profileNames: string[] = [], profileFieldAccess: any[] = []) {
    const fieldsRecords: any[] = [];
    for (const objName of selectedObjects) {
      try {
        fieldsRecords.length = 0;
        const desc = await conn.describeSObject(objName);
        desc.fields.forEach((field) => {
          let picklistValues = '';
          if (field.picklistValues && field.picklistValues.length > 0) {
            picklistValues = field.picklistValues.map(pv => pv.value).join('; ');
          }
          // Add persona columns using formula logic
          const personaCols: Record<string, string> = {};
          for (let i = 1; i <= numberOfPersonas; i++) {
            const personaRow = i + 1;
            personaCols[`=persona!A${personaRow}&"_View"`] = '';
            personaCols[`=persona!A${personaRow}&"_Edit"`] = '';
          }
          // Add one column per profile, fill with 'none', 'edit', or 'read'
          const profileCols = (profileNames || []).reduce((acc, profile) => {
            // Find access for this field/profile/object (case-insensitive, and check both SObjectType and API_Name)
            const access = profileFieldAccess.find((rec) => {
              const profileMatch = rec.Profile === profile;
              const objectMatch = (rec.SObjectType === objName || rec.SObjectType?.toLowerCase() === objName.toLowerCase());
              // rec.Field can be 'ObjectName.FieldName' or just 'FieldName'
              let recFieldName = rec.Field;
              if (recFieldName && recFieldName.includes('.')) {
                recFieldName = recFieldName.split('.').pop();
              }
              const fieldMatch = (recFieldName === field.name || recFieldName?.toLowerCase() === field.name.toLowerCase());
              return profileMatch && objectMatch && fieldMatch;
            });
            let value = 'none';
            if (access) {
              if (access.PermissionsEdit === 'Yes') {
                value = 'edit';
              } else if (access.PermissionsRead === 'Yes') {
                value = 'read';
              }
            }
            acc[`Profile_${profile}`] = value;
            return acc;
          }, {} as Record<string, string>);
          fieldsRecords.push({
            Field_Label: field.label,
            API_Name: field.name,
            Data_Type: field.type,
            Length: field.length ? field.length.toString() : '',
            Field_Type: field.calculated ? 'Formula' : (field.type === 'reference' ? 'Lookup' : field.type),
            Required: field.nillable ? 'No' : 'Yes',
            PicklistValues: picklistValues,
            Formula: field.calculated ? field.calculatedFormula : '',
            ExternalId: field.externalId ? 'Yes' : 'No',
            TrackHistory: field.trackHistory ? 'Yes' : 'No',
            Description: field.description ? field.description : '',
            HelpText: field.inlineHelpText ? field.inlineHelpText : '',
            ...personaCols,
            ...profileCols,
          });
        });
      } catch (error) {
        uxLog('warning', this, c.yellow(`Failed to describe fields for ${objName}: ${(error as Error).message}`));
      }
      const reportDir = await getReportDirectory();
      this.outputFile = path.join(reportDir, `${objName} Fields.csv`);
      await generateCsvFile(fieldsRecords, this.outputFile, { fileTitle: `${objName} Fields extract`, noExcel: true });
      this.csvFiles.push(this.outputFile);
    }
    return;
  }
}
