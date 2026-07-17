/* jscpd:ignore-start */
import { SfCommand, Flags, optionalOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import { uxLog, uxLogTable } from '../../../../common/utils/index.js';
import { isSfdxProject } from '../../../../common/utils/projectUtils.js';
import { t } from '../../../../common/utils/i18n.js';
import {
  buildPermissionsAuditReport,
  collectFromLocal,
  collectFromOrg,
  getEffectiveDangerousUserPermissions,
  DANGEROUS_OBJECT_PERMISSIONS,
  PermissionGrant,
  PermissionsAuditSource,
} from '../../../../common/utils/permissionsAuditUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class DiagnoseUnsecurePermissions extends SfCommand<any> {
  public static title = 'Audit dangerous permissions';

  public static description = `
## Command Behavior

**Audits dangerous permissions granted through Profiles, Permission Sets and Permission Set Groups, and resolves which active users hold them.**

Dangerous permissions are broad administrative, identity, sharing-bypass, exfiltration or control-weakening rights (for example Modify All Data, Author Apex, Manage Users, View All Data, Weekly Data Export). They are grouped into criticality tiers, from Tier 0 (full org compromise) to Tier 4 (control weakening).

Key functionalities:

- **Two sources:** Analyze a connected org via SOQL (\`--source org\`, default), local metadata files (\`--source local\`), or both (\`--source both\`).
- **User and object permissions:** Detects both user permissions (\`Permissions*\`) and object permissions (View All / Modify All per object).
- **Assignments:** In org mode, resolves which active users hold each dangerous permission and through which container, with their last login date.
- **Configurable list:** The built-in list is additive: use \`dangerousPermissionsExtra\` (or \`DANGEROUS_PERMISSIONS_EXTRA\`) to add permissions and \`dangerousPermissionsIgnore\` (or \`DANGEROUS_PERMISSIONS_IGNORE\`) to remove them.
- **Excel report:** Generates a multi-sheet Excel file with an Index sheet linking to a Tiers Legend, Profiles, Permission Sets, Permission Set Groups and Assignments sheets. Columns and rows are auto-sized.

<details markdown="1">
<summary>Technical explanations</summary>

- **Field availability:** Describes the \`PermissionSet\` object and keeps only the dangerous permission fields that exist in the org, so a missing field never breaks the query.
- **Containers:** Queries \`PermissionSet\` (profile-owned and standalone) for user permissions and \`ObjectPermissions\` for View All / Modify All. Permission Set Groups are resolved through \`PermissionSetGroupComponent\`.
- **Assignments:** Queries \`PermissionSetAssignment\` for active users, resolving group membership so permissions granted through a Permission Set Group are attributed to their users.
- **Local mode:** Parses \`.profile-meta.xml\`, \`.permissionset-meta.xml\` and \`.permissionsetgroup-meta.xml\` files. Assignments cannot be resolved offline and the Assignments sheet is omitted.
- **Report:** Uses \`createXlsxFromCsvFiles\` with a post-processing step that turns Index cells into internal hyperlinks and adds a "Back to Index" link on every other sheet.
</details>

### Agent Mode

Supports non-interactive execution with \`--agent\`:

\`\`\`sh
sf hardis:org:diagnose:unsecure-permissions --agent --target-org myorg@example.com
\`\`\`

The command has no interactive prompts, so agent mode behaves like a normal run. Use \`--source\` to control what is analyzed and \`--outputfile\` to set the report path.`;

  public static examples = [
    '$ sf hardis:org:diagnose:unsecure-permissions',
    '$ sf hardis:org:diagnose:unsecure-permissions --source local',
    '$ sf hardis:org:diagnose:unsecure-permissions --source both',
    '$ sf hardis:org:diagnose:unsecure-permissions --agent --target-org myorg@example.com',
  ];

  public static flags: any = {
    source: Flags.string({
      char: 's',
      options: ['org', 'local', 'both'],
      default: 'org',
      description: 'Where to read permission definitions from: org (SOQL), local (metadata files) or both',
    }),
    outputfile: Flags.string({
      char: 'f',
      description: 'Force the path and name of output report file. Must end with .csv',
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
    agent: Flags.boolean({
      default: false,
      description: 'Run in non-interactive mode for agents and automation',
    }),
    'target-org': optionalOrgFlagWithDeprecations,
  };

  public static requiresProject = false;

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(DiagnoseUnsecurePermissions);
    const source = flags.source as PermissionsAuditSource;
    const outputFile = flags.outputfile || null;

    const needsProject = source === 'local' || source === 'both';
    const needsOrg = source === 'org' || source === 'both';
    if (needsProject && !isSfdxProject()) {
      throw new SfError(t('unsecurePermissionsProjectRequired', { source }));
    }
    if (needsOrg && !flags['target-org']) {
      throw new SfError(t('unsecurePermissionsOrgRequired', { source }));
    }

    uxLog('action', this, c.cyan(t('unsecurePermissionsHeader', { source })));

    const userPerms = await getEffectiveDangerousUserPermissions();
    const objectPerms = DANGEROUS_OBJECT_PERMISSIONS;

    let grants: PermissionGrant[] = [];
    let permSetGroupGrants: any[] = [];
    let assignments: any[] = [];

    if (needsOrg) {
      const conn = flags['target-org'].getConnection();
      const orgResult = await collectFromOrg(conn, userPerms, objectPerms, this);
      grants = grants.concat(orgResult.grants);
      permSetGroupGrants = permSetGroupGrants.concat(orgResult.permSetGroupGrants);
      assignments = orgResult.assignments;
    }
    if (needsProject) {
      const localResult = await collectFromLocal(userPerms, objectPerms, this);
      grants = grants.concat(localResult.grants);
      permSetGroupGrants = permSetGroupGrants.concat(localResult.permSetGroupGrants);
    }
    if (source === 'local') {
      uxLog('warning', this, c.yellow(t('unsecurePermissionsAssignmentsNeedOrg')));
    }

    const profileGrants = grants.filter((g) => g.containerType === 'Profile');
    const permSetGrants = grants.filter((g) => g.containerType === 'PermissionSet');
    const containersCount = new Set(grants.map((g) => `${g.origin}:${g.containerName}`)).size;

    const auditData = {
      profileGrants,
      permSetGrants,
      permSetGroupGrants,
      assignments,
      containersCount,
      usersCount: assignments.length,
    };

    const totalGrants = grants.length;
    let statusCode = 0;
    if (totalGrants === 0) {
      uxLog('success', this, c.green(t('unsecurePermissionsNoneFound')));
    } else {
      statusCode = 1;
      uxLog(
        'action',
        this,
        c.cyan(
          t('unsecurePermissionsFoundSummary', {
            grants: totalGrants,
            containers: containersCount,
            users: assignments.length,
          })
        )
      );
      const summaryRows = [
        { Sheet: 'Profiles', Count: profileGrants.length },
        { Sheet: 'Permission Sets', Count: permSetGrants.length },
        { Sheet: 'Permission Set Groups', Count: permSetGroupGrants.length },
        { Sheet: 'Assignments', Count: assignments.length },
      ];
      uxLogTable(this, summaryRows);

      const report = await buildPermissionsAuditReport(this, auditData, outputFile, source);
      uxLog('action', this, c.cyan(t('unsecurePermissionsReportGenerated', { file: report.xlsxFile })));
    }

    if ((this.argv || []).includes('unsecure-permissions')) {
      process.exitCode = statusCode;
    }

    return {
      status: statusCode,
      source,
      dangerousGrants: totalGrants,
      containers: containersCount,
      usersWithDangerousPermissions: assignments.length,
      profileGrants: profileGrants as any,
      permSetGrants: permSetGrants as any,
      permSetGroupGrants,
      assignments,
    };
  }
}
