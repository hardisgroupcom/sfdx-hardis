// QUESTION: Where are the objects extracted in this code?
// ANSWER: The objects are extracted in the generateObjectsList function.
// This function calls conn.describeGlobal() to get all SObjects, then queries each one to check if it has records.
// The user is then prompted to select which objects to extract. The selected objects are returned and used in the rest of the extraction process.
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { prompts } from '../../../../common/utils/prompts.js';
import { uxLog } from '../../../../common/utils/index.js';
import c from 'chalk';
import { generateCsvFile, generateReportPath, createXlsxFromCsvFiles } from '../../../../common/utils/filesUtils.js';
import { bulkQuery, soqlQuery } from '../../../../common/utils/apiUtils.js';
import { listOrgSObjectsFilteredWithQualifiedNames } from '../../../../common/utils/orgUtils.js';
import * as path from 'path';
import { getConfig, getReportDirectory, setConfig } from '../../../../config/index.js';
import { Messages } from '@salesforce/core';
import { PromisePool } from '@supercharge/promise-pool';
import sortArray from 'sort-array';
import { WebSocketClient } from '../../../../common/websocketClient.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

// Main command class for extracting Salesforce org profiles and related metadata
export default class ProfilesExtract extends SfCommand<void> {
  public static readonly description = `
## Command Behavior

**Guides administrators through extracting Salesforce profiles, personas, and related metadata into structured CSV/XLSX deliverables.**

The command inventories SObjects that contain data, lets the user pick the ones to document, and then produces persona-centric spreadsheets that cover users, personas, relationships, record types, apps, permissions, tabs, fields, and permission sets. The output consolidates everything into both CSV files and a single Excel workbook, making it easy to audit access models or prepare remediation plans.

Key capabilities:

- **Interactive object discovery:** Lists queryable objects with records and allows multi-selection.
- **Persona modeling:** Lets users define the number of personas and generates cross-object matrices that leverage Excel formulas for faster updates.
- **Comprehensive metadata export:** Captures users, record types, apps, permissions, tabs, fields, and permission sets with persona/profile visibility indicators.
- **Profile field access coverage:** Retrieves FieldPermissions to surface read/edit status per profile and field.
- **Consolidated reporting:** Produces standalone CSVs plus an aggregated XLSX stored in the report directory.

<details markdown="1">
<summary>Technical explanations</summary>

- **Salesforce connectivity:** Uses the requested target org connection from \`Flags.requiredOrg\` to fetch metadata and records.
- **Bulk/REST queries:** Relies on \`bulkQuery\` and standard SOQL to evaluate record counts and pull FieldPermissions, Users, RecordTypes, Applications, Tabs, and PermissionSets.
- **Describe calls:** Invokes \`describeGlobal\` and \`describeSObject\` to enumerate objects and field-level metadata, including picklists and formulas.
- **Prompt-driven input:** Utilizes the shared \`prompts\` utility to collect object selections and persona counts, ensuring consistent CLI UX.
- **Reporting pipeline:** Writes intermediate CSV files via \`generateCsvFile\`, stores them under the report directory from \`getReportDirectory\`, and finally merges them using \`createXlsxFromCsvFiles\`.
- **Logging & diagnostics:** Uses \`uxLog\` with chalk coloring for progress, warnings, and debug output, integrating with the project-wide logging style.

</details>
`;

  public static readonly examples = [
    `$ sf hardis:project:clean:profiles-extract`,
    `$ sf hardis:project:clean:profiles-extract --target-org my-org`,
  ];

  /* jscpd:ignore-start */
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
  /* jscpd:ignore-end */
  protected csvFiles: string[] = [];
  protected outputFile = '';
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
      uxLog("action", this, c.cyan('Handling extract of Users...'));
      await this.generateUsersExtract(conn);
      numberOfPersonas = await this.generatePersonaExtract();
      uxLog("action", this, c.cyan(`Generating extracts for ${numberOfPersonas} personas...`));
      uxLog("log", this, c.cyan('Generating Relation extract...'));
      await this.generateRelationExtract(selectedObjects, numberOfPersonas);
      uxLog("log", this, c.cyan('Generating Record Types extract...'));
      await this.generateRTExtract(conn, selectedObjects, numberOfPersonas);
      uxLog("log", this, c.cyan('Generating Applications extract...'));
      await this.generateAppsExtract(conn, numberOfPersonas);
      uxLog("log", this, c.cyan('Generating Permissions extract...'));
      await this.generatePermissionsExtract(conn, numberOfPersonas);
      uxLog("log", this, c.cyan('Generating Tabs extract...'));
      await this.generateTabsExtract(conn, numberOfPersonas);
      uxLog("log", this, c.cyan('Generating Permission Sets extract...'));
      await this.generatePermissionSetsExtract(conn, numberOfPersonas);

      // 1. Extract profile field access and get all profiles
      uxLog("action", this, c.cyan('Extracting profile field access...'));
      const profileFieldAccess = await this.getProfileFieldAccessData(conn, selectedObjects);
      const profileNames = Array.from(new Set(profileFieldAccess.map(r => r.Profile).filter(Boolean)));

      // 2. Pass profileNames to generateObjectFieldsExtract
      await this.generateObjectFieldsExtract(conn, selectedObjects, numberOfPersonas, profileNames, profileFieldAccess);

      // 3. Write the profile field access CSV (as before)
      if (profileFieldAccess.length > 0) {
        const reportDir = await getReportDirectory();
        this.outputFile = path.join(reportDir, 'ProfileFieldAccess.csv');
        await generateCsvFile(profileFieldAccess, this.outputFile, { fileTitle: 'Profile Field Access', noExcel: true, skipNotifyToWebSocket: true });
        this.csvFiles.push(this.outputFile);
      } else {
        uxLog('log', this, c.yellow('No profile field access records found, skipping ProfileFieldAccess.csv.'));
      }

      this.outputFile = '';
      this.outputFile = await generateReportPath('profiles-extract', this.outputFile);
      uxLog("action", this, c.cyan('Generating final XLSX report...'));
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
      // Step 1: Get Profile IDs based on active profile names
      let profileIds: string[] = [];
      if (this.activeProfileNames && this.activeProfileNames.size > 0) {
        const profileNames = Array.from(this.activeProfileNames).filter((name) => !!name);
        const profileNameList = profileNames.map(name => `'${name.replace(/'/g, "''")}'`).join(", ");
        const profileQuery = `SELECT Id, Name FROM Profile WHERE Name IN (${profileNameList})`;

        try {
          const profileResult = await soqlQuery(profileQuery, conn);
          profileIds = profileResult.records.map((p: any) => p.Id);
        } catch (profileError) {
          uxLog('warning', this, c.yellow(`Failed to query Profile IDs: ${(profileError as Error).message}`));
          return fieldAccessRecords; // Return empty array if profile query fails
        }
      }

      // Step 2: Build FieldPermissions query using ProfileIds
      let soql = `SELECT Field, PermissionsRead, PermissionsEdit, SObjectType, Parent.ProfileId FROM FieldPermissions WHERE Parent.ProfileId != null`;

      if (profileIds.length > 0) {
        const profileIdList = profileIds.map(id => `'${id}'`).join(", ");
        soql += ` AND Parent.ProfileId IN (${profileIdList})`;
      }

      if (selectedObjects && selectedObjects.length > 0) {
        const objectList = selectedObjects.map(obj => `'${obj}'`).join(", ");
        soql += ` AND SObjectType IN (${objectList})`;
      }

      // Step 3: Query FieldPermissions using bulk API
      const result = await bulkQuery(soql, conn);

      // Step 4: Map ProfileIds back to Profile Names for the report
      const profileIdToName = new Map();
      if (this.activeProfileNames && this.activeProfileNames.size > 0) {
        const profileNames = Array.from(this.activeProfileNames).filter((name) => !!name);
        const profileNameList = profileNames.map(name => `'${name.replace(/'/g, "''")}'`).join(", ");
        const profileQuery = `SELECT Id, Name FROM Profile WHERE Name IN (${profileNameList})`;
        const profileResult = await soqlQuery(profileQuery, conn);
        profileResult.records.forEach((p: any) => {
          profileIdToName.set(p.Id, p.Name);
        });
      }

      result.records.forEach((rec: any) => {
        const profileName = profileIdToName.get(rec['Parent.ProfileId']) || 'Unknown';
        fieldAccessRecords.push({
          Profile: profileName,
          SObjectType: rec['SobjectType'],
          Field: rec['Field'],
          PermissionsRead: rec['PermissionsRead'] === true || rec['PermissionsRead'] === 'true' ? 'Yes' : 'No',
          PermissionsEdit: rec['PermissionsEdit'] === true || rec['PermissionsEdit'] === 'true' ? 'Yes' : 'No',
        });
      });
      uxLog('log', this, c.cyan(`Fetched ${fieldAccessRecords.length} profile field access records.`));
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
    uxLog('action', this, c.cyan('Fetching SObjects list...'));
    let sobjectsList: { label: string; name: string; masterObject: string; objectType: string }[] = [];
    try {
      // Use listOrgSObjectsFilteredWithQualifiedNames to get filtered SObjects with qualified API names
      const sObjectsFilteredRecords = await listOrgSObjectsFilteredWithQualifiedNames(conn);

      // Convert records to sobjectsList format: { label, name, masterObject, objectType }
      sobjectsList = sObjectsFilteredRecords.map((record) => ({
        label: record.Label,
        name: record.QualifiedApiName,
        masterObject: '',
        objectType: record.QualifiedApiName.endsWith('__c') ? 'Custom' : 'Standard',
      }));

      uxLog('log', this, c.cyan('Fetching SObjects completed.'));
      uxLog('log', this, c.cyan(`Fetched ${sobjectsList.length} SObjects.`));

      const sobjectsWithRecords: { API_Name: string; Object_Label: string; Object_Type: string }[] = [];

      WebSocketClient.sendProgressStartMessage('Checking SObjects for records...', sobjectsList.length);
      let counter = 0;
      await PromisePool.withConcurrency(5)
        .for(sobjectsList)
        .process(async (sobject) => {
          try {
            const result = await conn.query(`SELECT COUNT() FROM ${sobject.name}`);
            if (result.totalSize > 0) {
              sobjectsWithRecords.push({ API_Name: sobject.name, Object_Label: sobject.label, Object_Type: sobject.objectType });
            }
            uxLog('log', this, `Checked ${sobject.name}: ${result.totalSize} records.`);
          } catch (error) {
            uxLog('warning', this, c.yellow(`Failed to query ${sobject.name}: ${(error as Error).message}`));
          } finally {
            counter++;
            WebSocketClient.sendProgressStepMessage(counter, sobjectsList.length);
          }
        });
      WebSocketClient.sendProgressEndMessage();
      this.spinner.stop();

      if (sobjectsWithRecords.length === 0) {
        uxLog('warning', this, c.red('No SObjects with records found.'));
        return [];
      }

      const config = await getConfig("user");
      const initialSelection = config.profilesExtractCachedSelection || [];

      const choices: { title: string; value: string }[] = [];
      for (const sobject of sobjectsWithRecords) {
        choices.push({
          title: `${sobject.API_Name} - ${sobject.Object_Label} - ${sobject.Object_Type}`,
          value: sobject.API_Name,
        });
      }
      sortArray(choices, { by: 'title', order: 'asc' });

      const statusRes = await prompts({
        message: "Please select SObjects to add in the output Excel file",
        type: "multiselect",
        description: "Be careful, you can't update the selection later without re-running the command :)",
        choices: choices,
        initial: initialSelection.filter((sel => choices.some(choice => choice.value === sel))),
      });

      await setConfig("user", { profilesExtractCachedSelection: statusRes.value });

      if (statusRes && statusRes.value !== "all") {
        selectedObjects = statusRes.value;
        uxLog('log', this, `You selected ${selectedObjects.length} objects.`);
      }

      uxLog("log", this, c.cyan('Generating Objects.csv report...'));
      const reportDir = await getReportDirectory();
      this.outputFile = path.join(reportDir, 'Objects.csv');
      const objectsToWrite = sobjectsWithRecords.filter((sobj) => selectedObjects.includes(sobj.API_Name));
      sortArray(objectsToWrite, { by: 'API_Name', order: 'asc' });
      // Without xlsx
      await generateCsvFile(objectsToWrite, this.outputFile, { fileTitle: 'profiles extract', noExcel: true, skipNotifyToWebSocket: true });
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
    const usersRecords: { User: string; Role: string; Profile: string; Profile_to_Associate: string; New_Persona: string; New_Role: string; }[] = [];
    const userQuery = "SELECT username, UserRole.Name, Profile.Name FROM User WHERE IsActive = true order by username";
    const userResult = await bulkQuery(userQuery, conn);
    usersRecords.push(...userResult.records.map((user) => ({
      User: user.Username,
      Role: user['UserRole.Name'],
      Profile: user['Profile.Name'],
      Profile_to_Associate: '',
      New_Persona: '',
      New_Role: '',
    })));
    // Build set of active profile names (filter out empty/null)
    this.activeProfileNames = new Set(userResult.records.map((user) => user['Profile.Name']).filter((n) => !!n));
    uxLog('log', this, c.cyan(`Fetched ${userResult.records.length} active users.`));
    uxLog('log', this, c.cyan(`Active profiles: ${Array.from(this.activeProfileNames).join(', ')}`));
    const reportDir = await getReportDirectory();
    this.outputFile = path.join(reportDir, 'Users.csv');
    sortArray(usersRecords, { by: 'User', order: 'asc' });
    await generateCsvFile(usersRecords, this.outputFile, { fileTitle: 'Users extract', noExcel: true, skipNotifyToWebSocket: true });
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
      description: "One tab by personal will be created in the final Excel file",
      placeholder: "Input a number of personas (better too much than too few!)",
    });
    if (statusRes && statusRes.value !== 0) {
      numberOfPersonas = statusRes.value;
      uxLog('log', this, `Creation of ${numberOfPersonas} personas.`);
    }

    const persona: { 'Persona Name': string }[] = [];
    for (let i = 1; i <= numberOfPersonas; i++) {
      persona.push({ 'Persona Name': `Persona${i}` });
    }

    const reportDir = await getReportDirectory();
    this.outputFile = path.join(reportDir, 'persona.csv');
    await generateCsvFile(persona, this.outputFile, { fileTitle: 'persona extract', noExcel: true, skipNotifyToWebSocket: true });
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
    sortArray(relationRecords, { by: 'Object', order: 'asc' });
    await generateCsvFile(relationRecords, this.outputFile, { fileTitle: 'Relation Object Persona', noExcel: true, skipNotifyToWebSocket: true });
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
            personaCols[`=persona!A${personaRow}&"_Active"`] = '';
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
    sortArray(recordTypesRecords, { by: 'Object', order: 'asc' });
    await generateCsvFile(recordTypesRecords, this.outputFile, { fileTitle: 'Record Types extract', noExcel: true, skipNotifyToWebSocket: true });
    this.csvFiles.push(this.outputFile);
    return;
  }

  /**
   * Extracts custom applications (AppDefinition) and maps persona access (Active, Default).
   * Generates a CSV report of applications.
   * @param conn Salesforce connection
   * @param numberOfPersonas Number of personas
   */
  /* jscpd:ignore-start */
  async generateAppsExtract(conn: any, numberOfPersonas: number) {
    const appsRecords: any[] = [];
    try {
      const rtResult = await conn.query(`SELECT Id, DurableId, DeveloperName, MasterLabel FROM AppDefinition WHERE NamespacePrefix != 'standard'`);
      rtResult.records.forEach((rt) => {
        const personaCols: Record<string, string> = {};
        for (let i = 1; i <= numberOfPersonas; i++) {
          const personaRow = i + 1;
          personaCols[`=persona!A${personaRow}&"_Active"`] = '';
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
    sortArray(appsRecords, { by: 'Application', order: 'asc' });
    await generateCsvFile(appsRecords, this.outputFile, { fileTitle: 'Applications extract', noExcel: true, skipNotifyToWebSocket: true });
    this.csvFiles.push(this.outputFile);
    return;
  }
  /* jscpd:ignore-end */

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
    sortArray(permissionsRecords, { by: 'Permission_Label', order: 'asc' });
    await generateCsvFile(permissionsRecords, this.outputFile, { fileTitle: 'Permissions extract', noExcel: true, skipNotifyToWebSocket: true });
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
      sortArray(tabsRecords, { by: 'Tab_Label', order: 'asc' });
      await generateCsvFile(tabsRecords, this.outputFile, { fileTitle: 'Tabs extract', noExcel: true, skipNotifyToWebSocket: true });
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
    WebSocketClient.sendProgressStartMessage('Extracting object fields...', selectedObjects.length);
    const outputFiles: string[] = new Array(selectedObjects.length);
    let counter = 0;
    await PromisePool.withConcurrency(5)
      .for(selectedObjects.map((objName, index) => ({ objName, index })))
      .process(async ({ objName, index }) => {
        try {
          const fieldsRecords: any[] = [];
          const desc = await conn.describeSObject(objName);
          desc.fields.forEach((field) => {
            // Skip system fields that can't have field-level security set
            if (field.permissionable === false) {
              return;
            }
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
              API_Name: field.name,
              Field_Label: field.label,
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
          const reportDir = await getReportDirectory();
          const outputFile = path.join(reportDir, `${objName} Fields.csv`);
          sortArray(fieldsRecords, { by: 'API_Name', order: 'asc' });
          await generateCsvFile(fieldsRecords, outputFile, { fileTitle: `${objName} Fields extract`, noExcel: true, skipNotifyToWebSocket: true });
          outputFiles[index] = outputFile;
        } catch (error) {
          uxLog('warning', this, c.yellow(`Failed to describe fields for ${objName}: ${(error as Error).message}`));
        } finally {
          counter++;
          WebSocketClient.sendProgressStepMessage(counter, selectedObjects.length);
        }
      });
    WebSocketClient.sendProgressEndMessage();
    this.csvFiles.push(...outputFiles.filter(Boolean));
    return;
  }

  /**
   * Extracts all Permission Sets in the org.
   * Generates a CSV report mapping each permission set to personas.
   * @param conn 
   * @param numberOfPersonas 
   */
  async generatePermissionSetsExtract(conn: any, numberOfPersonas: number) {
    const permissionSetsRecords: { Name: string; Label: string; Description: string; IsCustom: string;[key: string]: string }[] = [];

    try {
      const result = await conn.query(
        `SELECT Name, Label, Description, IsCustom FROM PermissionSet WHERE IsOwnedByProfile = false`
      );

      result.records.forEach((ps: any) => {
        const personaCols: Record<string, string> = {};
        for (let i = 1; i <= numberOfPersonas; i++) {
          const personaRow = i + 1;
          personaCols[`=persona!A${personaRow}&"_Assigned"`] = ''; // Dynamic column for each persona
        }

        permissionSetsRecords.push({
          Name: ps.Name,
          Label: ps.Label || '',
          Description: ps.Description || '',
          IsCustom: ps.IsCustom ? 'Yes' : 'No',
          ...personaCols,
        });
      });

      const reportDir = await getReportDirectory();
      this.outputFile = path.join(reportDir, 'PermissionSets.csv');
      sortArray(permissionSetsRecords, { by: 'Name', order: 'asc' });
      await generateCsvFile(permissionSetsRecords, this.outputFile, {
        fileTitle: 'Permission Sets extract',
        noExcel: true,
        skipNotifyToWebSocket: true,
      });
      this.csvFiles.push(this.outputFile);
    } catch (error) {
      uxLog('warning', this, c.yellow(`Failed to query PermissionSets: ${(error as Error).message}`));
    }
  }

}
