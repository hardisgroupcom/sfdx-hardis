import { Flags, SfCommand, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { AnyJson } from '@salesforce/ts-types';
import { Messages } from '@salesforce/core';
import c from 'chalk';
import { isCI, uxLog } from '../../../common/utils/index.js';
import { prompts } from '../../../common/utils/prompts.js';
import { WebSocketClient } from '../../../common/websocketClient.js';
import { listOrgSObjects } from '../../../common/utils/orgUtils.js';
import { t } from '../../../common/utils/i18n.js';
import {
  collectDataCloudDictionaries,
  collectObjectDictionary,
  fetchDataCloudRelationships,
  fetchRecordTypes,
  fetchValidationRules,
  getDataCloudEntityType,
  hasLocalCustomizations,
  listDataCloudObjectNamesForPrompt,
  ObjectDataDictionary,
  writeDataDictionaryReports,
} from '../../../common/utils/dataDictionaryUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class HardisDocDataDictionary extends SfCommand<any> {
  public static description = `
## Command Behavior

**Generates an Excel (.xlsx) data dictionary for one or more Salesforce objects, read live from the target org, including Data Cloud (Data 360) Data Model Objects and Data Lake Objects.**

This command describes the selected objects and exports their definitions into a single multi-sheet workbook, useful for documentation, audits, and onboarding.

The \`Index\` sheet lists every documented object with its field, validation rule and record type counts, and links to each object sheet.

![Data dictionary index sheet](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/screenshot-data-dictionary-index.png)

Each object sheet details its fields (type, required, unique, reference target, picklist values, and more).

![Data dictionary object fields sheet](https://github.com/hardisgroupcom/sfdx-hardis/raw/main/docs/assets/images/screenshot-data-dictionary-fields.png)

- **Target Org:** Use \`--target-org\` to pick the org connection context.
- **Object selection:** Provide one or more API names via \`--objects\` (comma-separated, e.g. \`Account,Contact,MyObject__c\`). If omitted in interactive mode, a prompt lists available objects.
- **Data Cloud objects:** Data Model Objects (\`__dlm\`) and Data Lake Objects (\`__dll\`) can be listed in \`--objects\` like any other object. Use \`--datacloud\` to document every Data Model Object and Data Lake Object the org lists. In interactive mode, the prompt also lists them when Data Cloud is enabled.
- **Customized objects only:** Use \`--customizedonly\` to exclude objects that have no local customizations. This drops standard objects without custom fields and managed package objects without local custom fields, while keeping local custom objects and any object that has at least one local custom field. In interactive mode, a prompt offers the same filter.
- **Workbook structure:** One \`Index\` sheet listing the objects, one fields sheet per object, plus consolidated \`Validation Rules\` and \`Record Types\` sheets. When Data Cloud objects are documented, the \`Index\` sheet also shows their object type, category and relationship count, and a \`Data Cloud Relationships\` sheet lists the relationships of the Data Model Objects (from and to object, field and object type, cardinality, status, origin), including relationships to CRM objects on either side.
- **Navigation:** The \`Index\` sheet links to each object, Validation Rules and Record Types sheet, and every other sheet has a "Back to Index" link below its data.
- **Fields detail:** API name, label, type, required, unique, external id, length/precision, reference target, picklist values, default value, formula, help text, description, and custom flag. Fields are sorted alphabetically by API name.
- **Data Cloud fields detail:** API name, label, type, data type, primary key, key qualifier, and custom flag.
- **Output:** The XLSX is generated alongside the intermediate CSV files in the report directory. Use \`--outputfile\` to force the consolidated report path.

<details markdown="1">
<summary>Technical explanations</summary>

- **Fields:** Retrieved with \`connection.describe(objectName)\`, then sorted alphabetically by API name. Field types are mapped to their Salesforce names (e.g. \`reference\` becomes \`Lookup\` or \`MasterDetail\`, \`int\`/\`double\` become \`Number\`), and formula / roll-up summary fields are tagged. Required is derived from \`nillable === false\`; picklist values are the active values, capped at 50 with an overflow note.
- **Validation Rules:** Retrieved via the Metadata API (\`metadata.list\` then \`metadata.read\` in batches of 10) to include the error condition formula, which is not exposed by describe.
- **Record Types:** Retrieved with a single SOQL query on \`RecordType\` filtered by \`SobjectType\`.
- **Data Cloud objects:** Data Model Objects and Data Lake Objects are not in \`EntityDefinition\`, and their describe shows relationships as generated reference fields and primary keys as optional. They are read from \`ssot/metadata\` instead, one call per object type, which returns the field types, primary keys and key qualifiers. This listing only contains the objects the org uses: a standard Data Model Object that nothing is mapped to is reported as not found.
- **Data Cloud relationships:** Retrieved for each documented Data Model Object with \`ssot/data-model-objects/<name>/relationships\`, which returns both directions with their status and includes relationships to CRM objects. That response also contains the standard relationships the org never activated (origin \`Standard\`, status \`INACTIVE\`): they are left out. A relationship listed by two documented objects appears once.
- **Reporting:** Each sheet is first written as a CSV, then consolidated into one XLSX via \`createXlsxFromCsvFiles\`, with explicit worksheet names.
- **Resilience:** Objects that cannot be described, Data Cloud objects the org does not list, and validation rule / record type / Data Cloud relationship retrieval failures are logged as warnings and skipped without aborting the run. On an org without Data Cloud, \`--datacloud\` only logs a warning.
</details>

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:doc:data-dictionary --agent --objects Account,Contact
\`\`\`

In agent mode:
- The \`--objects\` flag or the \`--datacloud\` flag is **required** (no interactive prompt for object selection).
- No other prompt is displayed; the workbook is generated directly.
- Pass \`--customizedonly\` to restrict the workbook to objects that have local customizations (the prompt is skipped).
`;

  public static examples = [
    '$ sf hardis:doc:data-dictionary',
    '$ sf hardis:doc:data-dictionary --objects Account,Contact',
    '$ sf hardis:doc:data-dictionary --target-org myOrgAlias --objects CustomObject__c',
    '$ sf hardis:doc:data-dictionary --customizedonly',
    '$ sf hardis:doc:data-dictionary --agent --objects Account,Contact --customizedonly',
    '$ sf hardis:doc:data-dictionary --objects Account,ssot__Individual__dlm,Crm_Contact__dll',
    '$ sf hardis:doc:data-dictionary --agent --datacloud',
  ];

  public static flags: any = {
    'target-org': requiredOrgFlagWithDeprecations,
    objects: Flags.string({
      char: 'o',
      description: 'Comma-separated API names of the objects to document (e.g. Account,Contact,CustomObject__c). If omitted, an interactive prompt lists available objects.',
      required: false,
    }),
    outputfile: Flags.string({
      char: 'f',
      description: 'Force the path and name of the consolidated output report file (the XLSX is generated alongside)',
      required: false,
    }),
    datacloud: Flags.boolean({
      default: false,
      description:
        'Also document every Data Cloud (Data 360) Data Model Object (__dlm) and Data Lake Object (__dll) listed by the org, with a Data Cloud Relationships sheet',
    }),
    customizedonly: Flags.boolean({
      default: false,
      description:
        'Exclude objects that have no local customizations (standard objects without custom fields and managed package objects without local custom fields). Local custom objects and objects with at least one local custom field are kept.',
    }),
    agent: Flags.boolean({
      default: false,
      description: 'Run in non-interactive mode for agents and automation',
    }),
    websocket: Flags.string({
      description: messages.getMessage("websocket"),
    }),
    skipauth: Flags.boolean({
      description: "Skip authentication check when a default username is required",
    }),
  };

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(HardisDocDataDictionary);
    const conn = flags['target-org'].getConnection();
    const agentMode = flags.agent === true;
    const outputFile = flags.outputfile || null;
    let customizedOnly = flags.customizedonly === true;
    const includeAllDataCloud = flags.datacloud === true;

    let objectNames: string[] = (flags.objects || '')
      .split(',')
      .map((name: string) => name.trim())
      .filter((name: string) => name.length > 0);

    if (objectNames.length === 0 && !includeAllDataCloud) {
      if (!isCI && !agentMode) {
        const availableSObjects = await listOrgSObjects(conn);
        const sObjectApiNames = (availableSObjects?.records || [])
          .map((record: any) => record?.QualifiedApiName)
          .filter((apiName: any) => typeof apiName === 'string' && apiName.length > 0)
          .filter((apiName: string) => !apiName.endsWith('__Share') && !apiName.endsWith('__ChangeEvent'))
          .sort();
        // Data Cloud objects are not in EntityDefinition: list them from Data Cloud when it is enabled.
        sObjectApiNames.push(...(await listDataCloudObjectNamesForPrompt(conn, this)).sort());

        const promptObjectsRes = await prompts({
          type: 'multiselect',
          name: 'value',
          message: t('selectTheSobjectsToAnalyze'),
          description: t('excludeObjectsYouDontWantToAnalyze'),
          choices: sObjectApiNames.map((apiName: string) => ({ title: apiName, value: apiName })),
        });
        objectNames = promptObjectsRes.value || [];
        if (objectNames.length === 0) {
          uxLog("action", this, c.cyan(t('noObjectsSelectedAborting')));
          return { outputString: 'No objects selected; aborting.', cancelled: true };
        }
        uxLog("log", this, t('sObjectsSelectedForAnalysis', { count: objectNames.length }));
      } else {
        const outputString = t('objectsFlagRequiredInAgentMode');
        uxLog("error", this, c.red(outputString));
        return { outputString, cancelled: true };
      }
    }

    objectNames = Array.from(new Set(objectNames)).sort();

    // Offer the "customized objects only" filter interactively when it was not requested via the flag.
    if (!customizedOnly && !isCI && !agentMode) {
      const customizedPromptRes = await prompts({
        type: 'confirm',
        name: 'value',
        initial: false,
        message: t('excludeUncustomizedObjects'),
        description: t('excludeUncustomizedObjectsDesc'),
      });
      customizedOnly = customizedPromptRes.value === true;
    }

    // Data Cloud objects (__dlm, __dll) are documented from the Data Cloud metadata, not from describe.
    const sObjectNames = objectNames.filter((name) => getDataCloudEntityType(name) === null);
    const dataCloudNames = objectNames.filter((name) => getDataCloudEntityType(name) !== null);

    const objectDicts: ObjectDataDictionary[] = [];
    if (sObjectNames.length > 0) {
      uxLog("action", this, c.cyan(t('describingObjects', { count: sObjectNames.length })));
      WebSocketClient.sendProgressStartMessage(t('describingObjects', { count: sObjectNames.length }));
      let counter = 0;
      for (const objectName of sObjectNames) {
        const dict = await collectObjectDictionary(conn, objectName, this);
        if (dict) {
          objectDicts.push(dict);
        }
        WebSocketClient.sendProgressStepMessage(++counter, sObjectNames.length);
      }
      WebSocketClient.sendProgressEndMessage(sObjectNames.length);
    }
    if (dataCloudNames.length > 0 || includeAllDataCloud) {
      uxLog("action", this, c.cyan(t('collectingDataCloudObjects')));
      const dataCloudDicts = await collectDataCloudDictionaries(conn, dataCloudNames, includeAllDataCloud, this);
      uxLog("log", this, t('dataCloudObjectsCollected', { count: dataCloudDicts.length }));
      objectDicts.push(...dataCloudDicts);
    }

    if (objectDicts.length === 0) {
      uxLog("warning", this, c.yellow(t('noObjectsSelectedAborting')));
      return { outputString: 'No objects could be described; aborting.', cancelled: true };
    }

    let dictsToReport = objectDicts;
    if (customizedOnly) {
      dictsToReport = objectDicts.filter((dict) => hasLocalCustomizations(dict));
      const excludedCount = objectDicts.length - dictsToReport.length;
      if (excludedCount > 0) {
        uxLog("log", this, t('excludedUncustomizedObjects', { count: excludedCount }));
      }
      if (dictsToReport.length === 0) {
        uxLog("warning", this, c.yellow(t('noObjectsWithLocalCustomizations')));
        return { outputString: 'No objects with local customizations found; aborting.', cancelled: true };
      }
    }

    const describedObjectNames = dictsToReport.map((dict) => dict.apiName);
    const describedSObjectNames = dictsToReport.filter((dict) => !dict.objectType).map((dict) => dict.apiName);
    const describedDmoNames = dictsToReport
      .filter((dict) => getDataCloudEntityType(dict.apiName) === 'DataModelObject')
      .map((dict) => dict.apiName);
    const validationRules = await fetchValidationRules(conn, describedSObjectNames, this);
    const recordTypes = await fetchRecordTypes(conn, describedSObjectNames, this);
    const dataCloudRelationships = await fetchDataCloudRelationships(conn, describedDmoNames, this);

    uxLog("action", this, c.cyan(t('generatingDataDictionaryForObjects', { count: dictsToReport.length })));
    const reportFiles = await writeDataDictionaryReports(
      this,
      dictsToReport,
      validationRules,
      recordTypes,
      outputFile,
      dataCloudRelationships
    );

    uxLog("success", this, c.green(t('dataDictionaryGeneratedForObjects', { count: dictsToReport.length })));

    return {
      outputString: `Data dictionary generated for ${dictsToReport.length} objects.`,
      reportFiles,
      objects: describedObjectNames,
    };
  }
}
