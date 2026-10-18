import { ActionsProvider, ActionResult, PrePostCommand } from './actionsProvider.js';
import { uxLog } from '../utils/index.js';
import { initPermissionSetAssignments } from '../utils/orgUtils.js';
import { t } from '../utils/i18n.js';
import c from 'chalk';

// Org initialization step: assigns permission sets to the user of the org being initialized
export class AssignPermissionSetsAction extends ActionsProvider {
  public getLabel(): string {
    return 'AssignPermissionSetsAction';
  }

  public async checkParameters(cmd: PrePostCommand): Promise<ActionResult | null> {
    if (listPermissionSetNames(cmd).length === 0) {
      uxLog('error', this, c.red(`[OrgInit] ${t('orgInitNoPermissionSets', { label: cmd.label })}`));
      return { statusCode: 'failed', skippedReason: t('orgInitNoPermissionSets', { label: cmd.label }) };
    }
    return null;
  }

  public getIdentityParameters(cmd: PrePostCommand): Record<string, any> | null {
    return { permissionSets: [...listPermissionSetNames(cmd)].sort() };
  }

  public async run(cmd: PrePostCommand): Promise<ActionResult> {
    const validity = await this.checkValidityIssues(cmd);
    if (validity) return validity;
    const orgUsername = cmd.orgInitContext?.orgUsername || this.customUsernameToUse || '';
    const failures = await initPermissionSetAssignments(listPermissionSetNames(cmd), orgUsername);
    if (failures.length > 0) {
      return { statusCode: 'failed', output: failures.join('\n') };
    }
    return { statusCode: 'success' };
  }
}

// Accepts a list or a single comma-separated string, as the YAML may be written by hand
function listPermissionSetNames(cmd: PrePostCommand): string[] {
  const raw: any = cmd.parameters?.permissionSets;
  const values: string[] = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [];
  return values.map((value: any) => String(value?.name || value || '').trim()).filter((value) => value !== '');
}
