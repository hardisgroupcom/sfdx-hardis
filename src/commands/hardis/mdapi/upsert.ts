import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { isCI, uxLog, uxLogTable } from '../../../common/utils/index.js';
import { prompts } from '../../../common/utils/prompts.js';
import { t } from '../../../common/utils/i18n.js';
import {
  buildTargetComponentSet,
  crudUpsertMetadatas,
  isOutcomeFailed,
  partitionCrudCompatibility,
  splitMetadataEntries,
  validateChunkSizeOverride,
} from '../../../common/metadata-utils/crudMetadataApi.js';

export default class MdapiUpsert extends SfCommand<any> {
  public static title = 'Upsert metadata using the CRUD-based Metadata API';

  public static description = `
## Command Behavior

**Deploys local source files to an org using the CRUD-based Metadata API (\`upsertMetadata\`), pushing each component whole.**

This is a standalone, manually invoked command. It is the mirror of \`sf hardis:mdapi:read\` and exists for the same reason: types like \`Profile\` and \`PermissionSet\` deploy **completely** this way. File-based deploy of a Profile only writes permissions for components present in the same deployment; \`upsertMetadata\` writes the whole Profile.

> **Warning - whole-component overwrite.** \`upsertMetadata\` replaces each component entirely. Any object/field permission, Apex-class access, or tab visibility that is **not** in your local file is **removed** in the org. A stale or partial local file will strip permissions. There is no check-only / validation mode for the CRUD Metadata API.

This command is **not** part of the CI/CD pipeline and runs **no** Apex tests, **no** check-only validation, **no** quick deploy, and **no** coverage gate. Use \`sf hardis:project:deploy:smart\` for gated deployments.

Key functionalities:

- **Component selection:** \`--source-dir\` (default: the project package directories), \`--manifest\` (a \`package.xml\`), or \`--metadata\` to filter.
- **Confirmation:** In interactive mode it lists the components that will be overwritten whole and asks for confirmation before pushing.
- **Chunking:** Upserts are batched to respect the CRUD Metadata API limit (10 components per call, 200 for \`CustomMetadata\` and \`CustomApplication\`).
- **Supported types are adapter-gated:** Compatibility is decided by the metadata type's @salesforce/source-deploy-retrieve registry adapter (\`strategies.adapter\`). Only pure-XML types are upserted through the CRUD Metadata API; types whose source carries non-XML content (code, binaries, multi-file bundles) are reported as skipped with a warning. The incompatible adapters are \`bundle\` (LWC, Aura), \`matchingContentFile\` (Apex classes/triggers/pages/components, Visualforce), \`mixedContent\` (\`StaticResource\`, \`Document\`), and \`digitalExperience\` (\`DigitalExperienceBundle\`). Deploy those with file-based deploy (\`sf project deploy start\`).

<details markdown="1">
<summary>Technical explanations</summary>

- **Input resolution:** \`ComponentSetBuilder\` resolves \`--source-dir\` / \`--manifest\` / \`--metadata\` from local source.
- **Recomposition:** Source is converted to metadata format with \`@salesforce/source-deploy-retrieve\` (recomposing decomposed types such as CustomObject into a single file), then each top-level component is upserted with jsforce \`connection.metadata.upsert\`.
- **Granularity:** Components are upserted at the top-level-type granularity; child types (e.g. RecordType) are deployed inside their parent component.
- **Adapter rule:** \`partitionCrudCompatibility\` resolves each type to its SDR adapter via \`RegistryAccess.getTypeByName(name).strategies.adapter\`. Types with adapter \`bundle\`, \`matchingContentFile\`, \`mixedContent\`, or \`digitalExperience\` are set aside as skipped (and re-checked before sending); types with \`decomposed\`, \`default\`, or no adapter (e.g. \`CustomObject\`, \`Profile\`, \`PermissionSet\`, \`Layout\`, \`CustomMetadata\`, \`CustomApplication\`) are processed. Unknown type names are treated as compatible so the API call (not the guard) surfaces the real error.
</details>

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:mdapi:upsert --source-dir force-app/main/default/profiles --agent
\`\`\`

In agent mode (and in CI), the overwrite confirmation prompt is skipped and the deployment proceeds. The caller owns the risk of the whole-component overwrite.
`;

  public static examples = [
    '$ sf hardis:mdapi:upsert --metadata Profile',
    '$ sf hardis:mdapi:upsert --source-dir force-app/main/default/profiles',
    '$ sf hardis:mdapi:upsert --manifest manifest/package.xml',
    '$ sf hardis:mdapi:upsert --source-dir force-app/main/default/profiles --agent',
  ];

  public static flags: any = {
    metadata: Flags.string({
      char: 'm',
      multiple: true,
      description: 'Metadata to deploy, as Type or Type:Name (e.g. Profile, "Profile:Admin"). Repeatable.',
    }),
    manifest: Flags.string({
      char: 'x',
      description: 'Path to a package.xml listing the metadata to deploy',
    }),
    'source-dir': Flags.string({
      multiple: true,
      description: 'Local source path to deploy (default: the project package directories)',
    }),
    'chunk-size': Flags.integer({
      description: 'Components upserted per API call (max 10, or 200 for CustomMetadata/CustomApplication)',
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
  };

  public static requiresProject = true;

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(MdapiUpsert);
    const agentMode = flags.agent === true;
    const debugMode = flags.debug || false;
    const ignoreErrors = flags['ignore-errors'] || false;

    const metadataEntries: string[] = splitMetadataEntries(flags.metadata);
    const manifestPath: string | undefined = flags.manifest || undefined;
    let sourceDirs: string[] | undefined = flags['source-dir'] || undefined;

    if (flags['chunk-size'] != null) {
      validateChunkSizeOverride(flags['chunk-size']);
    }

    const packageDirs = (this.project?.getPackageDirectories() || []).map((dir: any) => dir.fullPath);
    // Resolve local source from the project package directories unless an explicit source/manifest is given.
    // This makes `--metadata` act as a filter over the project source, and a bare invocation deploy everything.
    if (!sourceDirs?.length && !manifestPath) {
      sourceDirs = packageDirs;
    }

    const componentSet = await buildTargetComponentSet({
      metadataEntries,
      manifestPath,
      sourceDirs,
      packageDirs,
      resolveFromOrg: false,
    });

    if (componentSet.size === 0) {
      uxLog('warning', this, c.yellow(t('crudNothingToDeploy')));
      return { successes: [], failures: [], skipped: [] };
    }

    // Only types addressable by the CRUD Metadata API are confirmed/overwritten; the rest are
    // reported as skipped in the summary (crudUpsertMetadatas re-checks and never sends them).
    const { supported } = partitionCrudCompatibility(componentSet.toArray());
    const components = supported.map((cmp) => ({ type: cmp.type.name, fullName: cmp.fullName }));

    // Whole-component overwrite confirmation (interactive only).
    if (!isCI && !agentMode && components.length > 0) {
      uxLog('warning', this, c.yellow(t('crudOverwriteWarning', { count: String(components.length) })));
      uxLogTable(this, components, ['type', 'fullName']);
      const confirm = await prompts({
        type: 'confirm',
        name: 'value',
        message: t('crudConfirmOverwrite', { count: String(components.length) }),
        description: t('crudConfirmOverwriteDesc'),
        initial: false,
      });
      if (confirm.value !== true) {
        uxLog('log', this, t('crudDeployCancelled'));
        return { successes: [], failures: [], cancelled: true };
      }
    }

    const conn = flags['target-org'].getConnection();
    uxLog('action', this, c.cyan(t('crudDeployingMetadata')));
    const outcome = await crudUpsertMetadatas({
      conn,
      componentSet,
      chunkSizeOverride: flags['chunk-size'],
      commandThis: this,
      debug: debugMode,
    });

    this.displaySummary(outcome.successes, outcome.failures, outcome.skipped);

    if (isOutcomeFailed(outcome, ignoreErrors)) {
      throw new SfError(t('crudDeployFailedSummary', { count: String(outcome.failures.length) }));
    }

    return {
      successes: outcome.successes,
      failures: outcome.failures,
      skipped: outcome.skipped,
      orgId: flags['target-org'].getOrgId(),
    };
  }

  private displaySummary(successes: any[], failures: any[], skipped: any[]): void {
    if (successes.length > 0) {
      uxLog('success', this, c.green(t('crudDeploySuccessCount', { count: String(successes.length) })));
      uxLogTable(
        this,
        successes.map((s) => ({ type: s.type, fullName: s.fullName, action: s.created ? 'created' : 'updated' })),
        ['type', 'fullName', 'action']
      );
    }
    if (failures.length > 0) {
      uxLog('warning', this, c.yellow(t('crudDeployFailureCount', { count: String(failures.length) })));
      uxLogTable(this, failures.map((f) => ({ type: f.type, fullName: f.fullName, error: f.error })), ['type', 'fullName', 'error']);
    }
    if (skipped.length > 0) {
      uxLog('warning', this, c.yellow(t('crudSkippedUpsertCount', { count: String(skipped.length) })));
      uxLogTable(this, skipped.map((s) => ({ type: s.type, fullName: s.fullName })), ['type', 'fullName']);
    }
  }
}
