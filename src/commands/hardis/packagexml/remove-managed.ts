import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { uxLog } from '../../../common/utils/index.js';
import { isManagedPackageMember, parsePackageXmlFile, writePackageXmlFile } from '../../../common/utils/xmlUtils.js';
import { t } from '../../../common/utils/i18n.js';

export class PackageXmlRemoveManaged extends SfCommand<any> {
  public static readonly description = `
## Command Behavior

**Removes all managed package items from a \`package.xml\` file, while preserving custom metadata created on top of managed objects.**

Managed items - those whose API name starts with a namespace prefix (e.g. \`SBQQ__Quote__c\`, \`nCino__Loan__c\`) - are automatically excluded from deployments that target orgs where the managed package is already installed. Keeping them in a \`package.xml\` causes unnecessary noise and can block deployments.

Key functionalities:

- **Namespace detection:**
  - \`--namespaces\` flag - explicit comma-separated list (e.g. \`SBQQ,nCino\`). When provided, \`--namespace-detection\` is ignored.
  - When \`--namespaces\` is omitted, \`--namespace-detection\` selects the auto-detection strategy:
    - \`api-name\` *(default)* - scans every member name for the \`NS__Name__suffix\` pattern (three or more double-underscore segments) and extracts the leading prefix as a namespace.
    - \`installed-packages\` - reads the \`InstalledPackage\` entries already present in the \`package.xml\`.
- **Smart child-item preservation:** For metadata that lives under a managed object (e.g. a \`CustomField\` or \`ValidationRule\`), the member is removed **only** if the child part of the API name is itself namespaced. A custom field such as \`SBQQ__Quote__c.My_Status__c\` is therefore kept, while \`SBQQ__Quote__c.SBQQ__Status__c\` is removed.
- **Output file:** By default the result is written to \`<input>-without-managed.xml\` (e.g. \`package-without-managed.xml\`). Use \`--outputfile\` to choose a different path.
- **Summary report:** Logs the number of removed items per metadata type. Use \`--debug\` for a full itemised list.

<details markdown="1">
<summary>Technical explanations</summary>

- **Parsing:** Uses \`parsePackageXmlFile\` to load the manifest into a flat \`{ TypeName: string[] }\` dictionary.
- **Namespace resolution:** \`--namespaces\` flag takes priority. When absent, \`--namespace-detection\` selects the strategy: \`api-name\` scans member API names for the \`NS__Name__suffix\` pattern (≥ 3 segments when split by \`__\`, first segment validated against \`/^[A-Za-z][A-Za-z0-9]{0,14}$/\`); \`installed-packages\` reads \`InstalledPackage\` type members from the manifest.
- **Filtering rule:**
  - A member is removed when it starts with \`<namespace>__\` (top-level item) **or** when its child part (the segment after \`.\`) also starts with \`<namespace>__\` (namespaced sub-item).
  - A member whose object is managed but whose child is *not* namespaced is retained (e.g. a developer-created custom field on a managed object).
- **Output:** The filtered manifest is written with \`writePackageXmlFile\` to \`<input>-without-managed.xml\` by default.
- **Empty types:** Metadata types that have no remaining members after filtering are removed from the manifest.
</details>

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:packagexml:remove-managed --packagexml manifest/package.xml --namespaces SBQQ,nCino --agent
\`\`\`

In agent mode all interactive prompts are skipped and default values are used.
The command is fully non-interactive regardless of this flag.
`;

  public static readonly examples = [
    '$ sf hardis:packagexml:remove-managed',
    '$ sf hardis:packagexml:remove-managed --packagexml manifest/package.xml --namespaces SBQQ,cpq',
    '$ sf hardis:packagexml:remove-managed -p package.xml -n SBQQ --outputfile package-no-managed.xml',
    '$ sf hardis:packagexml:remove-managed --namespace-detection installed-packages',
    '$ sf hardis:packagexml:remove-managed --agent',
  ];

  public static readonly requiresProject = false;

  public static readonly flags: any = {
    packagexml: Flags.string({
      char: 'p',
      default: 'package.xml',
      description: 'Path to the package.xml file to filter',
    }),
    namespaces: Flags.string({
      char: 'n',
      description:
        'Comma-separated list of namespace prefixes to remove (e.g. SBQQ,cpq). ' +
        'When provided, --namespace-detection is ignored.',
    }),
    'namespace-detection': Flags.string({
      options: ['api-name', 'installed-packages'],
      default: 'api-name',
      description:
        'Auto-detection strategy used when --namespaces is not provided. ' +
        '"api-name" (default) infers namespaces from member API name patterns (NS__Name__suffix). ' +
        '"installed-packages" reads InstalledPackage entries from the package.xml.',
    }),
    outputfile: Flags.string({
      char: 'o',
      description: 'Output package.xml file path. Defaults to <input>-without-managed.xml (e.g. package-without-managed.xml).',
    }),
    agent: Flags.boolean({
      default: false,
      description: 'Run in non-interactive mode for agents and automation',
    }),
    debug: Flags.boolean({
      char: 'd',
      default: false,
      description: 'debug',
    }),
    websocket: Flags.string({
      description: 'websocket',
    }),
  };

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(PackageXmlRemoveManaged);
    const packageXmlFile: string = flags.packagexml ?? 'package.xml';
    const outputFile: string = flags.outputfile ?? packageXmlFile.replace(/\.xml$/i, '-without-managed.xml');
    const debugMode: boolean = flags.debug === true;

    // 1. Parse the manifest into a flat { TypeName: string[] } dict
    const content: Record<string, string[]> = await parsePackageXmlFile(packageXmlFile);

    // 2. Resolve namespace prefixes to remove
    const detectionMode = (flags['namespace-detection'] ?? 'api-name') as 'api-name' | 'installed-packages';
    const namespaces = resolveNamespaces(flags.namespaces, detectionMode, content, packageXmlFile, this);

    if (namespaces.length === 0) {
      uxLog('warning', this, c.yellow(t('noNamespacesToFilter')));
      return { outputPackageXmlFile: outputFile, namespaces: [], removedCount: 0, removedByType: {} };
    }

    uxLog('action', this, c.cyan(t('removingManagedItemsFromPackageXml', { namespaces: namespaces.join(', '), packageXmlFile })));

    // 3. Filter members and collect statistics
    const removedByType: Record<string, string[]> = {};
    let totalRemovedCount = 0;
    const filtered: Record<string, string[]> = {};

    for (const [typeName, members] of Object.entries(content)) {
      const after = members.filter((member) => !isManagedPackageMember(member, namespaces));
      const removed = members.filter((m) => !after.includes(m));
      if (removed.length > 0) {
        removedByType[typeName] = removed;
        totalRemovedCount += removed.length;
      }
      if (after.length > 0) {
        filtered[typeName] = after;
      }
      // Empty types are simply not included in filtered → removed from manifest
    }

    // 4. Write result
    if (totalRemovedCount > 0) {
      await writePackageXmlFile(outputFile, filtered);
      uxLog('success', this, c.green(t('removedManagedItemsCount', { count: totalRemovedCount, packageXmlFile: outputFile })));

      if (debugMode) {
        for (const [typeName, members] of Object.entries(removedByType)) {
          uxLog('log', this, c.grey(`  ${typeName} (${members.length}): ${members.join(', ')}`));
        }
      } else {
        for (const [typeName, members] of Object.entries(removedByType)) {
          uxLog('log', this, c.grey(`  - ${typeName}: ${members.length} item(s) removed`));
        }
      }
    } else {
      uxLog('log', this, c.grey(t('noManagedItemsFound', { packageXmlFile })));
    }

    return {
      outputPackageXmlFile: outputFile,
      namespaces,
      removedCount: totalRemovedCount,
      removedByType,
    };
  }
}

/**
 * Resolves the list of namespace prefixes to filter out.
 *
 * Priority:
 *   1. Explicit --namespaces flag (ignores detectionMode)
 *   2. Auto-detection according to detectionMode:
 *      - 'installed-packages': reads InstalledPackage members from the manifest
 *      - 'api-name' (default): infers prefixes from NS__Name__suffix API name patterns
 */
function resolveNamespaces(
  namespacesFlag: string | undefined,
  detectionMode: 'api-name' | 'installed-packages',
  content: Record<string, string[]>,
  packageXmlFile: string,
  commandThis: any
): string[] {
  // 1. Explicit flag - detection mode is irrelevant
  if (namespacesFlag) {
    return namespacesFlag
      .split(',')
      .map((ns) => ns.trim())
      .filter(Boolean);
  }

  // 2. InstalledPackage entries in the manifest
  if (detectionMode === 'installed-packages') {
    const fromInstalledPkg = (content['InstalledPackage'] ?? []).filter((m) => m && m !== '*');
    if (fromInstalledPkg.length > 0) {
      uxLog(
        'log',
        commandThis,
        c.grey(
          t('autoDetectedNamespacesFromPackageXml', {
            count: fromInstalledPkg.length,
            packageXmlFile,
            namespaces: fromInstalledPkg.join(', '),
          })
        )
      );
    }
    return fromInstalledPkg;
  }

  // 3. Infer from API name patterns (detectionMode === 'api-name').
  // A managed-package member follows NS__Name__suffix (≥ 3 segments when split by '__').
  // The first segment is the namespace prefix; must be 1–15 alphanumeric chars starting with a letter.
  const NS_PATTERN = /^[A-Za-z][A-Za-z0-9]{0,14}$/;
  const detected = new Set<string>();
  for (const members of Object.values(content)) {
    for (const member of members) {
      // Examine both sides of a dotted member (e.g. Object.Field)
      for (const part of member.split('.')) {
        const segments = part.split('__');
        if (segments.length >= 3 && NS_PATTERN.test(segments[0])) {
          detected.add(segments[0]);
        }
      }
    }
  }
  const fromApiNames = Array.from(detected).sort();
  if (fromApiNames.length > 0) {
    uxLog(
      'log',
      commandThis,
      c.grey(
        t('autoDetectedNamespacesFromApiNames', {
          count: fromApiNames.length,
          packageXmlFile,
          namespaces: fromApiNames.join(', '),
        })
      )
    );
  }
  return fromApiNames;
}
