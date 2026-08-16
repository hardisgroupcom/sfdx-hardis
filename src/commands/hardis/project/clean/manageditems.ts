/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import fs from 'fs-extra';
import { glob } from 'glob';
import * as path from 'path';
import { uxLog } from '../../../../common/utils/index.js';
import { GLOB_IGNORE_PATTERNS } from '../../../../common/utils/projectUtils.js';
import { parseXmlFile } from '../../../../common/utils/xmlUtils.js';
import { t } from '../../../../common/utils/i18n.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

interface CompoundMetadataSpec {
  suffix: string;
  separator: string;
}

// lower case suffixes for easier comparison
const COMPOUND_METADATA_SPECS: CompoundMetadataSpec[] = [
  { suffix: '.layout-meta.xml', separator: '-' },
  { suffix: '.quickaction-meta.xml', separator: '.' }
];

interface XmlItemInspectionSpec {
  suffix: string;
  rootElement: string;
  // XML element under each child that carries the item's API name
  // (e.g. 'fullName' for Workflow/SharingRules, 'name' for some other types).
  itemNameField: string;
  i18nKey: string;
}

// Metadata types whose XML root holds many sub-items each carrying an API name.
// When at least one item name is not namespaced, the file is preserved.
// lower case suffixes for easier comparison.
const XML_ITEM_INSPECTION_SPECS: XmlItemInspectionSpec[] = [
  { suffix: '.workflow-meta.xml', rootElement: 'Workflow', itemNameField: 'fullName', i18nKey: 'keepingManagedWorkflowWithLocalItems' },
  { suffix: '.sharingrules-meta.xml', rootElement: 'SharingRules', itemNameField: 'fullName', i18nKey: 'keepingManagedSharingRulesWithLocalItems' },
];

type XmlObject = Record<string, unknown>;

export default class CleanManagedItems extends SfCommand<any> {
  public static title = 'Clean retrieved managed items in dx sources';

  public static description: string = `
## Command Behavior

**Removes unwanted managed package items from your Salesforce DX project sources.**

This command helps clean up your local Salesforce project by deleting metadata files that belong to a specific managed package namespace. This is particularly useful when you retrieve metadata from an org that contains managed packages, and you only want to keep the unmanaged or custom metadata in your local repository.

Key functionalities:

- **Namespace-Based Filtering:** Requires a \`--namespace\` flag to specify which managed package namespace's files should be removed.
- **Targeted File Deletion:** Scans for files and folders that start with the specified namespace prefix (e.g., \`yourNamespace__*\`).
- **Intelligent Folder Handling:** Prevents the deletion of managed folders if they contain local custom items. This ensures that if you have custom metadata within a managed package's folder structure, only the managed components are removed, preserving your local customizations.
- **Object Metadata Preservation:** Specifically, it will not remove .object-meta.xml files if there are local custom items defined within that object's folder.
- **Custom Items on Managed Objects:** Preserves custom Layouts and QuickActions whose filename starts with a managed object's API name but whose own item name is not namespaced (e.g., \`conference360__Event__c.New_Event_Item.quickAction-meta.xml\` is kept, while \`conference360__Event__c.conference360__Managed_Action.quickAction-meta.xml\` is removed).
- **Managed Workflow Files with Custom Sub-items:** For \`.workflow-meta.xml\` files attached to a managed object, the XML is parsed and the file is preserved when at least one inner \`<fullName>\` (alert, rule, fieldUpdate, task, outboundMessage, ...) is not namespaced.
- **Managed Sharing Rules Files with Custom Sub-items:** For \`.sharingRules-meta.xml\` files attached to a managed object, the same logic applies: the file is preserved when at least one \`sharingCriteriaRules\`, \`sharingOwnerRules\`, \`sharingTerritoryRules\`, or \`sharingGuestRules\` sub-item has a \`<fullName>\` that is not namespaced.

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Namespace Validation:** Ensures that a namespace is provided, throwing an \`SfError\` if it's missing.
- **File Discovery:** Uses \`glob\` to find all files and directories within the specified \`folder\` (defaults to \`force-app\`) that match the managed package namespace pattern (\`**/\${this.namespace}__*\`).
- **Folder Content Check:** For identified managed folders, the \`folderContainsLocalItems\` function is called. This function uses \`glob\` again to check for the presence of any files within that folder that *do not* start with the managed package namespace, indicating local customizations.
- **Conditional Deletion:** Based on the \`folderContainsLocalItems\` check, it conditionally removes files and folders using \`fs.remove\`. If a managed folder contains local items, it is skipped to prevent accidental deletion of custom work.
- **Compound Filename Detection:** For Layouts (\`<Object>-<Name>.layout-meta.xml\`), and QuickActions (\`<Object>.<Name>.quickAction-meta.xml\`), the filename is split into its object and item parts. When the object part is namespaced but the item part is not, the file is preserved as a custom item on a managed object.
- **XML Item-Name Inspection:** \`.workflow-meta.xml\` and \`.sharingRules-meta.xml\` files are parsed via \`parseXmlFile\`. A generic \`metadataXmlContainsLocalItems\` helper, driven by the top-level \`XML_ITEM_INSPECTION_SPECS\` table (\`suffix\`, \`rootElement\`, \`itemNameField\`, \`i18nKey\`), iterates every child of the configured XML root element and preserves the file when any sub-item carries an item-name (e.g. \`fullName\`, configurable per type) that is not prefixed with \`<namespace>__\`. Adding a new metadata type is a one-line addition to that table. If the file cannot be parsed, it is kept to avoid accidental data loss.
- **Logging:** Provides clear messages about which managed items are being removed.
</details>

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:project:clean:manageditems --agent
\`\`\`

In agent mode, all interactive prompts are skipped and default values are used.

`;

  public static examples = ['$ sf hardis:project:clean:manageditems --namespace crta',
    '$ sf hardis:project:clean:manageditems --agent',];

  public static flags: any = {
    namespace: Flags.string({
      char: 'n',
      default: '',
      description: 'Namespace to remove',
    }),
    folder: Flags.string({
      char: 'f',
      default: 'force-app',
      description: 'Root folder',
    }),
    agent: Flags.boolean({
      default: false,
      description: 'Run in non-interactive mode for agents and automation',
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

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = true;

  protected namespace: string;
  protected folder: string;
  protected debugMode = false;

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(CleanManagedItems);
    this.namespace = flags.namespace || '';
    this.folder = flags.folder || './force-app';
    this.debugMode = flags.debug || false;

    if (this.namespace === '') {
      throw new SfError('namespace argument is mandatory');
    }

    // Delete standard files when necessary
    uxLog("action", this, c.cyan(t('removingUnwantedDxManagedSourceFilesWith', { namespace: c.bold(this.namespace) })));
    /* jscpd:ignore-end */
    const rootFolder = path.resolve(this.folder);
    const findManagedPattern = rootFolder + `/**/${this.namespace}__*`;
    const matchingCustomFiles = await glob(findManagedPattern, { cwd: process.cwd(), ignore: GLOB_IGNORE_PATTERNS });
    for (const matchingCustomFile of matchingCustomFiles) {
      if (!fs.existsSync(matchingCustomFile)) {
        continue;
      }
      // Do not remove managed folders when there are local custom items defined on it
      if (fs.lstatSync(matchingCustomFile).isDirectory()) {
        const localItems = await this.folderContainsLocalItems(matchingCustomFile);
        if (localItems) {
          continue;
        }
      }
      // Keep .object-meta.xml item if there are local custom items defined on it
      if (matchingCustomFile.endsWith('.object-meta.xml')) {
        const localItems = await this.folderContainsLocalItems(path.dirname(matchingCustomFile));
        if (localItems) {
          continue;
        }
      }
      // Keep custom Layouts, and QuickActions defined on managed objects
      if (this.isCustomItemOnManagedObject(matchingCustomFile)) {
        uxLog("log", this, c.grey(t('keepingCustomItemOnManagedObject', { matchingCustomFile: c.yellow(matchingCustomFile) })));
        continue;
      }
      // Keep managed Workflow / SharingRules / ... files that contain at least one custom (non-namespaced) sub-item
      const xmlInspectionSpec = this.getXmlInspectionSpec(matchingCustomFile);
      if (xmlInspectionSpec) {
        const hasLocalItems = await this.metadataXmlContainsLocalItems(matchingCustomFile, xmlInspectionSpec);
        if (hasLocalItems) {
          uxLog("log", this, c.grey(t(xmlInspectionSpec.i18nKey, { matchingCustomFile: c.yellow(matchingCustomFile) })));
          continue;
        }
      }
      await fs.remove(matchingCustomFile);
      uxLog("action", this, c.cyan(t('removedManagedItem', { matchingCustomFile: c.yellow(matchingCustomFile) })));
    }

    // Return an object to be displayed with --json
    return { outputString: 'Cleaned managed items from sfdx project' };
  }

  private getXmlInspectionSpec(filePath: string): XmlItemInspectionSpec | undefined {
    const basenameLower = path.basename(filePath).toLowerCase();
    return XML_ITEM_INSPECTION_SPECS.find((spec) => basenameLower.endsWith(spec.suffix));
  }

  // Detect compound-filename metadata where the object is managed but the item itself is custom.
  // Layout:            <Object>-<LayoutName>.layout-meta.xml          (split on first '-')
  // QuickAction:       <Object>.<ActionName>.quickAction-meta.xml     (split on first '.')
  private isCustomItemOnManagedObject(filePath: string): boolean {
    const basename = path.basename(filePath);
    const lower = basename.toLowerCase();
    const metadataSpec = COMPOUND_METADATA_SPECS.find((spec) => lower.endsWith(spec.suffix));
    if (metadataSpec === undefined) {
      return false;
    }
    const nameWithoutExt = basename.substring(0, basename.length - metadataSpec.suffix.length);
    const sepIdx = nameWithoutExt.indexOf(metadataSpec.separator);
    if (sepIdx <= 0) {
      return false;
    }
    const objectPart = nameWithoutExt.substring(0, sepIdx);
    const itemPart = nameWithoutExt.substring(sepIdx + 1);
    const nsPrefix = `${this.namespace}__`;
    return objectPart.startsWith(nsPrefix) && !itemPart.startsWith(nsPrefix);
  }

  // Inspect a managed metadata XML (Workflow, SharingRules, ...) and return true if any sub-item
  // (alerts, rules, fieldUpdates, tasks, sharingCriteriaRules, sharingOwnerRules, ...) carries an
  // item-name field (configured per spec) whose value does not start with the namespace prefix -
  // meaning custom items live alongside managed ones and the file should be preserved.
  private async metadataXmlContainsLocalItems(filePath: string, spec: XmlItemInspectionSpec): Promise<boolean> {
    let parsed: unknown;
    try {
      parsed = await parseXmlFile(filePath);
    } catch (error: unknown) {
      uxLog("warning", this, c.yellow(t('unableToParseManagedXmlKeepingFile', { filePath, message: this.getErrorMessage(error) })));
      return true;
    }
    if (!this.isXmlObject(parsed)) {
      return false;
    }
    const root = parsed[spec.rootElement];
    if (!this.isXmlObject(root)) {
      return false;
    }
    const nsPrefix = `${this.namespace}__`;
    for (const childKey of Object.keys(root)) {
      const children = root[childKey];
      if (!Array.isArray(children)) continue;
      for (const child of children) {
        if (!this.isXmlObject(child)) continue;
        const itemNames = child[spec.itemNameField];
        const values = Array.isArray(itemNames) ? itemNames : (itemNames != null ? [itemNames] : []);
        for (const name of values) {
          if (typeof name === 'string' && !name.startsWith(nsPrefix)) {
            return true;
          }
        }
      }
    }
    return false;
  }

  private isXmlObject(value: unknown): value is XmlObject {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private async folderContainsLocalItems(folder: string): Promise<boolean> {
    // Do not remove managed folders when there are local custom items defined on it
    const subFiles = await glob('**/*', {
      cwd: folder,
      ignore: GLOB_IGNORE_PATTERNS,
    });
    const standardItems = subFiles.filter((file) => {
      const fullPath = path.join(folder, file);
      return !fs.lstatSync(fullPath).isDirectory() && !path.basename(file).startsWith(`${this.namespace}__`);
    });
    if (standardItems.length > 0) {

      return true;
    }
    return false;
  }
}
