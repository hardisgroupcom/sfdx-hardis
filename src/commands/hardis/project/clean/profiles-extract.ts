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

  public async run(): Promise<void> {
    // Ensure conn is initialized and spinner logic is inside the run method
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

      await this.generateObjectFieldsExtract(conn, selectedObjects, numberOfPersonas);

      this.outputFile = '';
      this.outputFile = await generateReportPath('profiles-extract', this.outputFile);
      await createXlsxFromCsvFiles(this.csvFiles, this.outputFile, { fileTitle: 'profiles extract' });

    } catch (error) {
      uxLog('log', this, c.red('Failed to fetch SObjects.'));
      throw error;
    }
  }

  private async generateObjectsList(conn: any): Promise<string[]> {
    let selectedObjects: string[] = [];
    uxLog('log', this, c.green('Fetching SObjects'));
    let sobjectsList: { label: string; name: string; masterObject: string; objectType: string }[] = [];
    try {
      //ToDo
      const sobjects = await conn.describeGlobal();
      sobjectsList = sobjects.sobjects.filter(sobj => sobj.queryable).map((sobject) => ({
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
    uxLog('log', this, c.green(`Fetched ${userResult.records.length} active users.`));
    const reportDir = await getReportDirectory();
    this.outputFile = path.join(reportDir, 'Users.csv');
    await generateCsvFile(usersRecords, this.outputFile, { fileTitle: 'Users extract', noExcel: true });
    this.csvFiles.push(this.outputFile);
    return;
  }

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

    const persona: { Persona: string }[] = [];
    for (let i = 1; i <= numberOfPersonas; i++) {
      persona.push({ Persona: `Persona${i}` });
    }

    const reportDir = await getReportDirectory();
    this.outputFile = path.join(reportDir, 'persona.csv');
    await generateCsvFile(persona, this.outputFile, { fileTitle: 'persona extract', noExcel: true });
    this.csvFiles.push(this.outputFile);
    return numberOfPersonas;
  }

  async generateRelationExtract(selectedObjects: string[], numberOfPersonas: number) {
    const relationRecords: any[] = [];
    selectedObjects.forEach((objName) => {
      relationRecords.push({
        Object: objName,
        // Dynamically add persona fields based on numberOfPersonas
        ...Array.from({ length: numberOfPersonas }, (_, i) => i + 1).reduce((acc, personaIndex) => {
          acc[`Persona${personaIndex}_Read`] = '';
          acc[`Persona${personaIndex}_Create`] = '';
          acc[`Persona${personaIndex}_Edit`] = '';
          acc[`Persona${personaIndex}_Delete`] = '';
          return acc;
        }, {} as Record<string, string>),
      });
    });
    const reportDir = await getReportDirectory();
    this.outputFile = path.join(reportDir, 'Relation.csv');
    await generateCsvFile(relationRecords, this.outputFile, { fileTitle: 'Relation Object Persona', noExcel: true });
    this.csvFiles.push(this.outputFile);
    return;
  }

  async generateRTExtract(conn: any, selectedObjects: string[], numberOfPersonas: number) {
    const recordTypesRecords: any[] = [];
    for (const objName of selectedObjects) {
      try {
        const rtResult = await conn.query(`SELECT Id, Name, DeveloperName FROM RecordType WHERE SobjectType='${objName}' ORDER BY Name`);
        rtResult.records.forEach((rt) => {
          recordTypesRecords.push({
            Object: objName,
            Record_Type: rt.Name,
            // Dynamically add persona fields based on numberOfPersonas
            ...Array.from({ length: numberOfPersonas }, (_, i) => i + 1).reduce((acc, personaIndex) => {
              acc[`Persona${personaIndex}_Actif`] = '';
              acc[`Persona${personaIndex}_Default`] = '';
              return acc;
            }, {} as Record<string, string>),
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

  async generateAppsExtract(conn: any, numberOfPersonas: number) {
    const appsRecords: any[] = [];
    try {
      const rtResult = await conn.query(`SELECT Id, DurableId, DeveloperName, MasterLabel FROM AppDefinition WHERE NamespacePrefix != 'standard'`);
      rtResult.records.forEach((rt) => {
        appsRecords.push({
          Application: rt.MasterLabel,
          DeveloperName: rt.DeveloperName,
          // Dynamically add persona fields based on numberOfPersonas
          ...Array.from({ length: numberOfPersonas }, (_, i) => i + 1).reduce((acc, personaIndex) => {
            acc[`Persona${personaIndex}_Actif`] = '';
            acc[`Persona${personaIndex}_Default`] = '';
            return acc;
          }, {} as Record<string, string>),
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

  async generatePermissionsExtract(conn: any, numberOfPersonas: number) {
    const permissionsRecords: any[] = [];

    // Describe the PermissionSet object
    const desc = await conn.describeSObject("PermissionSet");

    // Filter only fields that start with "Permissions"
    const permissionFields = desc.fields.filter(f => f.name.startsWith("Permissions") && f.type === "boolean");

    // Print API name + Label
    permissionFields.forEach(field => {
      permissionsRecords.push({
        Permission_Label: field.label,
        Permission_API_Name: field.name,
        // Dynamically add persona fields based on numberOfPersonas
        ...Array.from({ length: numberOfPersonas }, (_, i) => i + 1).reduce((acc, personaIndex) => {
          acc[`Persona${personaIndex}`] = '';
          return acc;
        }, {} as Record<string, string>),
      });
    });
    const reportDir = await getReportDirectory();
    this.outputFile = path.join(reportDir, 'Permissions.csv');
    await generateCsvFile(permissionsRecords, this.outputFile, { fileTitle: 'Permissions extract', noExcel: true });
    this.csvFiles.push(this.outputFile);
    return;
  }

  async generateTabsExtract(conn: any, numberOfPersonas: number) {
    const tabsRecords: any[] = [];
    try {
      const tabsResult = await conn.query(`SELECT Name, Label FROM TabDefinition WHERE IsCustom = true`);
      tabsResult.records.forEach((tab) => {
        tabsRecords.push({
          Tab_Label: tab.Label,
          Tab_API_Name: tab.Name,
          // Dynamically add persona fields based on numberOfPersonas
          ...Array.from({ length: numberOfPersonas }, (_, i) => i + 1).reduce((acc, personaIndex) => {
            acc[`Persona${personaIndex}`] = '';
            return acc;
          }, {} as Record<string, string>),
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

  async generateObjectFieldsExtract(conn: any, selectedObjects: string[], numberOfPersonas: number) {
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
            // Dynamically add persona fields based on numberOfPersonas
            ...Array.from({ length: numberOfPersonas }, (_, i) => i + 1).reduce((acc, personaIndex) => {
              acc[`Persona${personaIndex}_Visible`] = '';
              acc[`Persona${personaIndex}_ReadOnly`] = '';
              return acc;
            }, {} as Record<string, string>),
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
