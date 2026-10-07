import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import * as path from 'path';
import { isCI, uxLog } from '../../../common/utils/index.js';
import { uxLogTableWithReport } from '../../../common/utils/filesUtils.js';
import { prompts } from '../../../common/utils/prompts.js';
import { t } from '../../../common/utils/i18n.js';
import { WebSocketClient } from '../../../common/websocketClient.js';
import {
  buildTargetComponentSet,
  crudReadMetadatas,
  isOutcomeFailed,
  splitMetadataEntries,
  validateChunkSizeOverride,
} from '../../../common/metadata-utils/crudMetadataApi.js';

export default class MdapiRead extends SfCommand<any> {
  public static title = 'Read metadata using the CRUD-based Metadata API';

  public static description = `
## Command Behavior

**Retrieves metadata from an org using the CRUD-based Metadata API (\`readMetadata\`), writing complete source files.**

This is a standalone, manually invoked alternative to the file-based retrieve (\`sf hardis:org:retrieve:sources:metadata\`). It exists for metadata types that file-based retrieve returns **incomplete** when source tracking is not used, most notably \`Profile\` and \`PermissionSet\`: \`readMetadata\` returns the whole component (every object/field permission, Apex-class access, tab visibility), not just the parts tied to other components in the same package.

Key functionalities:

- **Component selection:** Choose what to read with \`--metadata\` (e.g. \`Profile:Admin\`, or a bare type like \`Profile\` to read every component of that type), \`--manifest\` (a \`package.xml\`), or \`--source-dir\` (refresh the types/names already present in a local folder).
- **Complete components:** Each component is read whole and written to standard source format, so a \`git diff\` shows exactly what file-based retrieve had been dropping.
- **Active permissions only:** With \`--active-only\`, the entries of \`Profile\`, \`PermissionSet\` and \`MutingPermissionSet\` that grant nothing are left out of the files: field access with no read and no edit, object access with every flag false, Apex class, Visualforce page, Flow, custom permission, custom metadata type, custom setting and external data source access disabled, app not visible and not default, record type not visible, user permissions disabled. Tab visibilities (\`Hidden\` included), layout assignments, login hours and login IP ranges are kept, except the tab settings of tabs that do not exist: the API returns one for every standard object, tab or not, and a deployment refuses them (\`You can't edit tab settings for X, as it's not a valid tab\`). Deploying such a file grants what it lists and revokes nothing. The VS Code Metadata Retriever uses it in its Auto mode, the default, for Profiles.
- **Chunking:** Reads are batched to respect the CRUD Metadata API limit (10 components per call, 200 for \`CustomMetadata\` and \`CustomApplication\`).
- **Supported types are adapter-gated:** Compatibility is decided by the metadata type's @salesforce/source-deploy-retrieve registry adapter (\`strategies.adapter\`). Only pure-XML types round-trip through the CRUD Metadata API; types whose source carries non-XML content (code, binaries, multi-file bundles) are reported as skipped with a warning. The incompatible adapters are \`bundle\` (LWC, Aura), \`matchingContentFile\` (Apex classes/triggers/pages/components, Visualforce), \`mixedContent\` (\`StaticResource\`, \`Document\`), and \`digitalExperience\` (\`DigitalExperienceBundle\`). Retrieve those with file-based retrieve (\`sf project retrieve start\`).

The write counterpart is \`sf hardis:mdapi:upsert\`.

<details markdown="1">
<summary>Technical explanations</summary>

- **Input resolution:** \`ComponentSetBuilder\` resolves \`--metadata\` / \`--manifest\` / \`--source-dir\`. Bare types and wildcards are expanded against the org via \`listMetadata\`.
- **Read:** Components are grouped by type, chunked, and read with jsforce \`connection.metadata.read\`.
- **Active only filter:** \`removeInactiveEntries\` runs on each read result before it is serialized. In a permission type, an entry is dropped when it has at least one boolean field and all of them are false (\`readMetadata\` returns booleans or \`"true"\`/\`"false"\` strings, both are handled). Entries without a boolean field are kept. Tab settings (\`tabVisibilities\`, \`tabSettings\`) are compared with the tabs of the org (\`SELECT Name FROM TabDefinition\`): the ones that name no existing tab are dropped. When the org can not be queried, a warning says so and they are all kept. The number of dropped entries is returned per component as \`inactiveEntriesRemoved\`.
- **Conversion:** Read results are serialized to metadata-format XML (\`fast-xml-parser\`), then converted to source format with \`@salesforce/source-deploy-retrieve\`'s public converter, which handles per-type decomposition (e.g. CustomObject into \`fields/\` and \`recordTypes/\`).
- **Adapter rule:** \`partitionCrudCompatibility\` resolves each type to its SDR adapter via \`RegistryAccess.getTypeByName(name).strategies.adapter\`. Types with adapter \`bundle\`, \`matchingContentFile\`, \`mixedContent\`, or \`digitalExperience\` are set aside as skipped; types with \`decomposed\`, \`default\`, or no adapter (e.g. \`CustomObject\`, \`Profile\`, \`PermissionSet\`, \`Layout\`, \`CustomMetadata\`, \`CustomApplication\`) are processed. Unknown type names are treated as compatible so the API call (not the guard) surfaces the real error.
- **Limitations:** Folder-based types (Report, Dashboard, EmailTemplate) require explicit \`Folder/Name\` members; bare-type expansion does not enumerate folders yet.
</details>

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:mdapi:read --metadata Profile,PermissionSet --agent
\`\`\`

In agent mode (and in CI), interactive prompts are skipped. You must pass at least one of \`--metadata\`, \`--manifest\`, or \`--source-dir\`; the command never prompts for what to read.

<!-- training-links:start -->

## Learn by doing

The free [Salesforce DevOps with sfdx-hardis](https://sfdx-hardis-training.github.io) course runs this command, click by click, on an org of your own, in these labs:

- [Lab 2.6 - Permission sets, profiles and why a grant disappears](https://sfdx-hardis-training.github.io/en/level-2-contributor-advanced/2-6-permission-sets-and-profiles/)
- [Lab 2.8 - Recover from committing the wrong metadata](https://sfdx-hardis-training.github.io/en/level-2-contributor-advanced/2-8-recover-from-committing-the-wrong-metadata/)

<!-- training-links:end -->
`;

  public static examples = [
    '$ sf hardis:mdapi:read --metadata Profile',
    '$ sf hardis:mdapi:read --source-dir force-app/main/default/profiles',
    '$ sf hardis:mdapi:read --metadata "Profile:Admin" --metadata PermissionSet',
    '$ sf hardis:mdapi:read --manifest manifest/package.xml',
    '$ sf hardis:mdapi:read --metadata Profile --active-only',
    '$ sf hardis:mdapi:read --metadata Profile,PermissionSet --agent',
  ];

  public static flags: any = {
    metadata: Flags.string({
      char: 'm',
      multiple: true,
      description: 'Metadata to read, as Type or Type:Name (e.g. Profile, "Profile:Admin"). Repeatable.',
    }),
    manifest: Flags.string({
      char: 'x',
      description: 'Path to a package.xml listing the metadata to read',
    }),
    'source-dir': Flags.string({
      multiple: true,
      description: 'Local source path whose components should be re-read from the org',
    }),
    'output-dir': Flags.string({
      description:
        'Directory where source files are written. When set, all files are written here instead of being refreshed in place in the project package directories (default: the project default package directory)',
    }),
    'active-only': Flags.boolean({
      default: false,
      description:
        'Leave out the Profile, PermissionSet and MutingPermissionSet entries that grant nothing (all their flags false), and the tab settings of tabs that do not exist',
    }),
    /* jscpd:ignore-start */
    'chunk-size': Flags.integer({
      description: 'Components read per API call (max 10, or 200 for CustomMetadata/CustomApplication)',
    }),
    'ignore-errors': Flags.boolean({
      default: false,
      description: 'Report component failures but exit with code 0',
    }),
    agent: Flags.boolean({
      default: false,
      description: 'Run in non-interactive mode for agents and automation',
    }),
    debug: Flags.boolean({
      char: 'd',
      default: false,
      description: 'Activate debug mode (more logs)',
    }),
    websocket: Flags.string({
      description: 'Websocket host:port for VsCode SFDX Hardis UI integration',
    }),
    skipauth: Flags.boolean({
      description: 'Skip authentication check when a default username is required',
    }),
    'target-org': requiredOrgFlagWithDeprecations,
    /* jscpd:ignore-end */
  };

  public static requiresProject = true;

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(MdapiRead);
    const agentMode = flags.agent === true;
    const debugMode = flags.debug || false;
    const ignoreErrors = flags['ignore-errors'] || false;
    const activeOnly = flags['active-only'] === true;

    let metadataEntries: string[] = splitMetadataEntries(flags.metadata);
    const manifestPath: string | undefined = flags.manifest || undefined;
    const sourceDirs: string[] | undefined = flags['source-dir'] || undefined;

    // Prompt for metadata when nothing was provided and we can interact.
    if (!metadataEntries.length && !manifestPath && !sourceDirs?.length) {
      if (isCI || agentMode) {
        throw new SfError(t('crudNoInputProvided'));
      }
      const promptResult = await prompts({
        type: 'text',
        name: 'value',
        message: t('crudPromptMetadataToRetrieve'),
        description: t('crudPromptMetadataToRetrieveDesc'),
        placeholder: 'Profile, PermissionSet:Admin',
      });
      metadataEntries = (promptResult.value || '')
        .split(',')
        .map((e: string) => e.trim())
        .filter(Boolean);
      if (!metadataEntries.length) {
        throw new SfError(t('crudNoInputProvided'));
      }
    }

    if (flags['chunk-size'] != null) {
      validateChunkSizeOverride(flags['chunk-size']);
    }

    const packageDirs = (this.project?.getPackageDirectories() || []).map((dir: any) => dir.fullPath);
    const defaultPackageDir =
      (this.project?.getPackageDirectories() || []).find((dir: any) => dir.default)?.fullPath ||
      packageDirs[0] ||
      process.cwd();
    const outputDirExplicit = Boolean(flags['output-dir']);
    const outputDir = outputDirExplicit ? path.resolve(flags['output-dir']) : defaultPackageDir;

    const conn = flags['target-org'].getConnection();

    uxLog('action', this, c.cyan(t('crudReadingMetadata')));
    const componentSet = await buildTargetComponentSet({
      metadataEntries,
      manifestPath,
      sourceDirs,
      packageDirs,
      username: flags['target-org'].getUsername(),
      resolveFromOrg: true,
    });

    if (componentSet.size === 0) {
      uxLog('warning', this, c.yellow(t('crudNothingToRetrieve')));
      return { successes: [], failures: [], skipped: [], outputDir };
    }

    const outcome = await crudReadMetadatas({
      conn,
      componentSet,
      outputDir,
      // packageDirs is used only to merge (overwrite in place) with existing source. When the user
      // explicitly sets --output-dir, merge within that directory so every file lands there instead
      // of being written back to wherever it already lives in the project package directories.
      packageDirs: outputDirExplicit ? [outputDir] : packageDirs,
      chunkSizeOverride: flags['chunk-size'],
      commandThis: this,
      debug: debugMode,
      activeOnly,
    });

    const inactiveEntriesRemoved = outcome.successes.reduce((sum, s) => sum + (s.inactiveEntriesRemoved || 0), 0);
    if (inactiveEntriesRemoved > 0) {
      uxLog('log', this, c.grey(t('crudActiveOnlyRemovedEntries', { count: String(inactiveEntriesRemoved) })));
    }

    await this.displaySummary(outcome.successes, outcome.failures, outcome.skipped, outputDir);
    WebSocketClient.sendRefreshCommandsMessage();

    if (isOutcomeFailed(outcome, ignoreErrors)) {
      throw new SfError(t('crudReadFailedSummary', { count: String(outcome.failures.length) }));
    }

    return {
      successes: outcome.successes,
      failures: outcome.failures,
      skipped: outcome.skipped,
      outputDir,
      activeOnly,
      orgId: flags['target-org'].getOrgId(),
    };
  }

  private async displaySummary(successes: any[], failures: any[], skipped: any[], outputDir: string): Promise<void> {
    if (successes.length > 0) {
      uxLog('success', this, c.green(t('crudReadSuccessCount', { count: String(successes.length), outputDir })));
      await uxLogTableWithReport(this, successes.map((s) => ({ type: s.type, fullName: s.fullName, status: 'OK' })), ['type', 'fullName', 'status'], { fileNamePrefix: 'mdapi-read-successes', fileTitle: 'Metadata read successes' });
    }
    if (failures.length > 0) {
      uxLog('warning', this, c.yellow(t('crudReadFailureCount', { count: String(failures.length) })));
      await uxLogTableWithReport(this, failures.map((f) => ({ type: f.type, fullName: f.fullName, error: f.error })), ['type', 'fullName', 'error'], { fileNamePrefix: 'mdapi-read-failures', fileTitle: 'Metadata read failures' });
    }
    if (skipped.length > 0) {
      uxLog('warning', this, c.yellow(t('crudSkippedReadCount', { count: String(skipped.length) })));
      await uxLogTableWithReport(this, skipped.map((s) => ({ type: s.type, fullName: s.fullName })), ['type', 'fullName'], { fileNamePrefix: 'mdapi-read-skipped', fileTitle: 'Metadata read skipped items' });
    }
  }
}
