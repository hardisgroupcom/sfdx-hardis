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
  collectObjectDictionary,
  fetchRecordTypes,
  fetchValidationRules,
  ObjectDataDictionary,
  writeDataDictionaryReports,
} from '../../../common/utils/dataDictionaryUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages("sfdx-hardis", "org");

export default class HardisDocDataDictionary extends SfCommand<any> {
  public static description = `
## Command Behavior

**Generates an Excel (.xlsx) data dictionary for one or more Salesforce objects, read live from the target org.**

This command describes the selected objects and exports their definitions into a single multi-sheet workbook, useful for documentation, audits, and onboarding.

- **Target Org:** Use \`--target-org\` to pick the org connection context.
- **Object selection:** Provide one or more API names via \`--objects\` (comma-separated, e.g. \`Account,Contact,MyObject__c\`). If omitted in interactive mode, a prompt lists available objects.
- **Workbook structure:** One \`Index\` sheet listing the objects, one fields sheet per object, plus consolidated \`Validation Rules\` and \`Record Types\` sheets.
- **Fields detail:** API name, label, type, required, unique, external id, length/precision, reference target, picklist values, default value, formula, help text, description, and custom flag.
- **Output:** The XLSX is generated alongside the intermediate CSV files in the report directory. Use \`--outputfile\` to force the consolidated report path.

<details markdown="1">
<summary>Technical explanations</summary>

- **Fields:** Retrieved with \`connection.describe(objectName)\`. Required is derived from \`nillable === false\`; picklist values are the active values, capped at 50 with an overflow note.
- **Validation Rules:** Retrieved via the Metadata API (\`metadata.list\` then \`metadata.read\` in batches of 10) to include the error condition formula, which is not exposed by describe.
- **Record Types:** Retrieved with a single SOQL query on \`RecordType\` filtered by \`SobjectType\`.
- **Reporting:** Each sheet is first written as a CSV, then consolidated into one XLSX via \`createXlsxFromCsvFiles\`, with explicit worksheet names.
- **Resilience:** Objects that cannot be described, and validation rule / record type retrieval failures, are logged as warnings and skipped without aborting the run.
</details>

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:doc:data-dictionary --agent --objects Account,Contact
\`\`\`

In agent mode:
- The \`--objects\` flag is **required** (no interactive prompt for object selection).
- No other prompt is displayed; the workbook is generated directly.
`;

  public static examples = [
    '$ sf hardis:doc:data-dictionary',
    '$ sf hardis:doc:data-dictionary --objects Account,Contact',
    '$ sf hardis:doc:data-dictionary --target-org myOrgAlias --objects CustomObject__c',
    '$ sf hardis:doc:data-dictionary --agent --objects Account,Contact',
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

    let objectNames: string[] = (flags.objects || '')
      .split(',')
      .map((name: string) => name.trim())
      .filter((name: string) => name.length > 0);

    if (objectNames.length === 0) {
      if (!isCI && !agentMode) {
        const availableSObjects = await listOrgSObjects(conn);
        const sObjectApiNames = (availableSObjects?.records || [])
          .map((record: any) => record?.QualifiedApiName)
          .filter((apiName: any) => typeof apiName === 'string' && apiName.length > 0)
          .filter((apiName: string) => !apiName.endsWith('__Share') && !apiName.endsWith('__ChangeEvent'))
          .sort();

        const promptObjectsRes = await prompts({
          type: 'multiselect',
          name: 'value',
          message: t('selectTheSobjectsToAnalyze'),
          description: t('excludeObjectsYouDontWantToAnalyze'),
          choices: sObjectApiNames.map((apiName: string) => ({ title: apiName, value: apiName })),
        });
        objectNames = promptObjectsRes.value || [];
        if (objectNames.length === 0) {
          uxLog("warning", this, c.yellow(t('noObjectsSelectedAborting')));
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

    WebSocketClient.sendProgressStartMessage(t('describingObjects', { count: objectNames.length }));
    const objectDicts: ObjectDataDictionary[] = [];
    let counter = 0;
    for (const objectName of objectNames) {
      const dict = await collectObjectDictionary(conn, objectName, this);
      if (dict) {
        objectDicts.push(dict);
      }
      WebSocketClient.sendProgressStepMessage(++counter, objectNames.length);
    }
    WebSocketClient.sendProgressEndMessage(objectNames.length);

    if (objectDicts.length === 0) {
      uxLog("warning", this, c.yellow(t('noObjectsSelectedAborting')));
      return { outputString: 'No objects could be described; aborting.', cancelled: true };
    }

    const describedObjectNames = objectDicts.map((dict) => dict.apiName);
    const validationRules = await fetchValidationRules(conn, describedObjectNames, this);
    const recordTypes = await fetchRecordTypes(conn, describedObjectNames, this);

    uxLog("action", this, c.cyan(t('generatingDataDictionaryForObjects', { count: objectDicts.length })));
    const reportFiles = await writeDataDictionaryReports(this, objectDicts, validationRules, recordTypes, outputFile);

    uxLog("success", this, c.green(t('dataDictionaryGeneratedForObjects', { count: objectDicts.length })));

    return {
      outputString: `Data dictionary generated for ${objectDicts.length} objects.`,
      reportFiles,
      objects: describedObjectNames,
    };
  }
}
