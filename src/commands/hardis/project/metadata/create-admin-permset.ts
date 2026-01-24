import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import { uxLog } from '../../../../common/utils/index.js';
import { parseXmlFile } from '../../../../common/utils/xmlUtils.js';
import fs from 'fs-extra';
import path from 'path';
import xml2js from 'xml2js';
import c from 'chalk';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'create-admin-permset');

export default class CreateAdminPermset extends SfCommand<AnyJson> {
  public static summary = messages.getMessage('summary');
  public static description = `
## Command Behavior

**Generates a Permission Set file with full CRUD and Modify All permissions on all custom objects found in the local source.**

This command scans the \`force-app/main/default/objects\` directory and creates a Permission Set XML file with:

- **Object Permissions:** Full CRUD access (Create, Read, Update, Delete) plus View All and Modify All on each object
- **Field Permissions:** Read access on all fields, Edit access on editable fields (excludes Formula, AutoNumber, Summary, MasterDetail, and required fields)
- **Automatic Filtering:** Skips Platform Events (\`__e\`), Custom Metadata Types (\`__mdt\`), and PersonAccount

Key use cases:
- **Admin Access Setup:** Quickly create an admin permission set for development or testing
- **Sandbox Preparation:** Generate baseline permissions for QA environments
- **Permission Set Templates:** Use as a starting point for role-based access

<details markdown="1">
<summary>Technical explanations</summary>

The command performs the following operations:

1. **Directory Scanning:** Reads all subdirectories in \`force-app/main/default/objects\`
2. **Field Parsing:** For each object, parses all \`.field-meta.xml\` files using \`parseXmlFile()\`
3. **Field Classification:** Determines editability based on field type and attributes:
   - Non-editable types: Formula, Summary, AutoNumber
   - Skipped fields: MasterDetail, required fields, OwnerId, Name
4. **XML Generation:** Uses \`xml2js.Builder\` to create the Permission Set XML structure
5. **File Output:** Writes to \`force-app/main/default/permissionsets/<name>.permissionset-meta.xml\`

</details>
`;
  public static examples = [
    `$ sf hardis:project:metadata:create-admin-permset`,
    `$ sf hardis:project:metadata:create-admin-permset --name MyCustomAdminPS`,
  ];

  public static flags = {
    name: Flags.string({
      char: 'n',
      description: messages.getMessage('flags.name.description'),
      default: 'ObjectRightsModifyAll',
    }),
  };
  public static requiresProject = true;

  async run(): Promise<AnyJson> {
    const { flags } = await this.parse(CreateAdminPermset);
    const permSetName = flags.name;
    uxLog('action', this, c.cyan(`Start creating admin permission set "${permSetName}"...`));

    const objectsDir = path.join('force-app', 'main', 'default', 'objects');
    const objectList: Record<string, { name: string; editable: boolean }[]> = {};

    function normalizeXmlValue(v: any) {
      if (v == null) return undefined;
      if (Array.isArray(v)) return v[0];
      return v;
    }

    function isFieldEditable(parsedField: any) {
      const nonEditableFieldTypes = ["Formula", "Summary", "AutoNumber"];
      const fieldType = normalizeXmlValue(parsedField?.CustomField?.type) ?? "Unknown";
      const formulaVal = parsedField?.CustomField?.formula ?? parsedField?.CustomField?.formula;
      const hasFormula = formulaVal != null && normalizeXmlValue(formulaVal) !== undefined;
      return !nonEditableFieldTypes.includes(fieldType) && !hasFormula;
    }

    function shouldSkipField(parsedField: any) {
      const skipFieldNames = ["OwnerId", "Name"];

      const type = normalizeXmlValue(parsedField?.CustomField?.type) ?? null;
      const required = normalizeXmlValue(parsedField?.CustomField?.required);
      const fullName = normalizeXmlValue(parsedField?.CustomField?.fullName) ?? null;

      if (!fullName) return true; // malformed field

      if (type === 'MasterDetail') return true;
      if (required === 'true' || required === true) return true;
      if (skipFieldNames.includes(fullName)) return true;

      return false;
    }

    if (await fs.pathExists(objectsDir)) {
      const objects = await fs.readdir(objectsDir);
      for (const object of objects) {
        if (object.endsWith('__mdt') || object.endsWith('__e')) {
          continue; // ignore platform metadata and events objects
        }
        if (object === 'PersonAccount') {
          continue; // ignore PersonAccount synthetic folder
        }
        const objectPath = path.join(objectsDir, object);
        const fieldsPath = path.join(objectPath, 'fields');
        if (!(await fs.pathExists(fieldsPath))) continue;
        const fields = await fs.readdir(fieldsPath);
        const fieldInfos: { name: string; editable: boolean }[] = [];
        for (const f of fields) {
          try {
            const parsed = await parseXmlFile(path.join(fieldsPath, f));
            const fullNameRaw = parsed?.CustomField?.fullName ?? null;
            const fullName = normalizeXmlValue(fullNameRaw) ?? null;
            if (!fullName) continue;
            if (shouldSkipField(parsed)) continue;
            fieldInfos.push({ name: fullName, editable: isFieldEditable(parsed) });
          } catch (e) {
            // ignore parse errors per-field
          }
        }
        objectList[object] = fieldInfos;
      }
    } else {
      uxLog('warning', this, c.yellow('No local objects folder found at force-app/main/default/objects'));
    }

    const permSet: any = {
      PermissionSet: {
        $: { xmlns: 'http://soap.sforce.com/2006/04/metadata' },
        label: permSetName,
        hasActivationRequired: false,
      },
    };

    permSet.PermissionSet.fieldPermissions = [];
    permSet.PermissionSet.objectPermissions = [];

    for (const [objectName, fields] of Object.entries(objectList)) {
      permSet.PermissionSet.objectPermissions.push({
        allowCreate: true,
        allowDelete: true,
        allowEdit: true,
        allowRead: true,
        modifyAllRecords: true,
        object: objectName,
        viewAllRecords: true,
      });
      for (const fieldInfo of fields) {
        const fieldFull = fieldInfo.name;
        const editable = !!fieldInfo.editable;
        const fieldName = fieldFull.includes('.') ? fieldFull : `${objectName}.${fieldFull}`;
        permSet.PermissionSet.fieldPermissions.push({
          editable,
          field: fieldName,
          readable: true,
        });
      }
    }

    const builder = new xml2js.Builder({ headless: false, renderOpts: { pretty: true } });
    const xml = builder.buildObject(permSet);

    const outDir = path.join('force-app', 'main', 'default', 'permissionsets');
    await fs.ensureDir(outDir);
    const filename = path.join(outDir, `${permSetName}.permissionset-meta.xml`);
    await fs.writeFile(filename, xml, 'utf8');
    uxLog('success', this, c.green(`Permission set generated at ${filename}`));

    return permSet;
  }
}
