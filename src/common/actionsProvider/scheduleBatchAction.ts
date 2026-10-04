import { Connection } from '@salesforce/core';
import { ActionsProvider, ActionResult, PrePostCommand, buildActionOutput } from './actionsProvider.js';
import { createTempDir, execCommand, uxLog } from '../utils/index.js';
import { soqlQuery, soqlQueryTooling } from '../utils/apiUtils.js';
import { t } from '../utils/i18n.js';
import c from 'chalk';
import fs from '../utils/fsUtils.js';
import path from 'path';
import {
  HIDDEN_APEX_BODY,
  buildApexClassQuery,
  hasNoVisibleNoArgConstructor,
  parseApexClassName,
  pickApexClassToSchedule,
} from './apexClassActionUtils.js';

// Moved to apexClassActionUtils.ts, which run-batch shares
export { HIDDEN_APEX_BODY, parseApexClassName, pickApexClassToSchedule };

export class ScheduleBatchAction extends ActionsProvider {
  public getLabel(): string {
    return 'ScheduleBatchAction';
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async checkParameters(cmd: PrePostCommand): Promise<ActionResult | null> {
    const className = (cmd.parameters?.className as string) || '';
    if (!className) {
      uxLog('error', this, c.red(`[DeploymentActions] ${t('scheduleBatchNoClassName', { id: cmd.id, label: cmd.label })}`));
      return { statusCode: 'failed', skippedReason: 'No className parameter provided' };
    }
    const cronExpression = (cmd.parameters?.cronExpression as string) || '';
    if (!cronExpression) {
      uxLog('error', this, c.red(`[DeploymentActions] ${t('scheduleBatchNoCronExpression', { id: cmd.id, label: cmd.label })}`));
      return { statusCode: 'failed', skippedReason: 'No cronExpression parameter provided' };
    }
    return null;
  }

  // With its default job name, as run() schedules it
  public getIdentityParameters(cmd: PrePostCommand): Record<string, any> | null {
    const className = String(cmd.parameters?.className || '').trim();
    return {
      className,
      cronExpression: String(cmd.parameters?.cronExpression || '').trim(),
      jobName: String(cmd.parameters?.jobName || '').trim() || `${className}_Schedule`,
    };
  }

  public async run(cmd: PrePostCommand): Promise<ActionResult> {
    const validity = await this.checkValidityIssues(cmd);
    if (validity) return validity;

    // Trimmed once, so the lookup, the job name and the Apex all read the same name
    const className = ((cmd.parameters?.className as string) || '').trim();
    const cronExpression = (cmd.parameters?.cronExpression as string) || '';
    const jobName = (cmd.parameters?.jobName as string) || `${className}_Schedule`;
    const targetOrgFlag = this.customUsernameToUse ? ` --target-org ${this.customUsernameToUse}` : '';

    const conn: Connection = globalThis.jsForceConn;

    // 1. Verify the Apex class exists and implements Schedulable
    uxLog('log', this, c.grey(`[DeploymentActions] ${t('scheduleBatchVerifyingClass', { className })}`));
    // The class can belong to an installed package: ns.ClassName for a managed one
    const { namespace, name: classBareName } = parseApexClassName(className);
    const classQuery = buildApexClassQuery(classBareName, namespace);
    const classResult = await soqlQueryTooling(classQuery, conn);
    const classRecords = classResult.records || [];
    const apexClass = pickApexClassToSchedule(classRecords, namespace);
    if (!apexClass && classRecords.length > 0) {
      // The name only exists with a namespace: say how to write it rather than "not found"
      const qualifiedName = `${classRecords[0].NamespacePrefix}.${classRecords[0].Name}`;
      uxLog('error', this, c.red(`[DeploymentActions] ${t('scheduleBatchClassNeedsNamespace', { className, qualifiedName })}`));
      return { statusCode: 'failed', output: t('scheduleBatchClassNeedsNamespace', { className, qualifiedName }) };
    }
    if (!apexClass) {
      uxLog('error', this, c.red(`[DeploymentActions] ${t('scheduleBatchClassNotFound', { className })}`));
      return { statusCode: 'failed', output: t('scheduleBatchClassNotFound', { className }) };
    }
    // A managed package shows the signature of its global classes and hides every other class,
    // and only a global class can be scheduled from outside its package
    if (apexClass.Body === HIDDEN_APEX_BODY) {
      uxLog('error', this, c.red(`[DeploymentActions] ${t('scheduleBatchClassNotGlobal', { className })}`));
      return { statusCode: 'failed', output: t('scheduleBatchClassNotGlobal', { className }) };
    }
    if (!apexClass.Body || !apexClass.Body.includes('Schedulable')) {
      uxLog('error', this, c.red(`[DeploymentActions] ${t('scheduleBatchClassNotSchedulable', { className })}`));
      return { statusCode: 'failed', output: t('scheduleBatchClassNotSchedulable', { className }) };
    }

    // Check that the class has a public no-arg constructor
    if (hasNoVisibleNoArgConstructor(apexClass.Body, classBareName)) {
      uxLog('error', this, c.red(`[DeploymentActions] ${t('scheduleBatchConstructorNotVisible', { className })}`));
      return { statusCode: 'failed', output: t('scheduleBatchConstructorNotVisible', { className }) };
    }

    // 2. Check for existing scheduled jobs with the same name
    uxLog('log', this, c.grey(`[DeploymentActions] ${t('scheduleBatchCheckingExisting', { jobName })}`));
    const cronQuery = `SELECT Id, CronExpression, CronJobDetail.Name, State FROM CronTrigger WHERE CronJobDetail.Name = '${jobName.replace(/'/g, "\\'")}' AND State IN ('WAITING','ACQUIRED','EXECUTING','PAUSED','BLOCKED','PAUSED_BLOCKED')`;
    const cronResult = await soqlQuery(cronQuery, conn);
    if (cronResult.records && cronResult.records.length > 0) {
      const existingJob = cronResult.records[0];
      if (existingJob.CronExpression === cronExpression) {
        // Identical schedule already exists - skip
        uxLog('log', this, c.green(`[DeploymentActions] ${t('scheduleBatchAlreadyScheduled', { jobName, cronExpression })}`));
        return { statusCode: 'success', output: t('scheduleBatchAlreadyScheduled', { jobName, cronExpression }) };
      }
      // Different schedule with the same name - error
      uxLog('error', this, c.red(`[DeploymentActions] ${t('scheduleBatchConflict', { jobName, existingCron: existingJob.CronExpression, newCron: cronExpression })}`));
      return { statusCode: 'failed', output: t('scheduleBatchConflict', { jobName, existingCron: existingJob.CronExpression, newCron: cronExpression }) };
    }

    // 3. Generate and run the Apex code to schedule the batch
    const apexCode = `${className} job = new ${className}();\nSystem.schedule('${jobName.replace(/'/g, "\\'")}', '${cronExpression.replace(/'/g, "\\'")}', job);`;
    uxLog('log', this, c.grey(`[DeploymentActions] ${t('scheduleBatchScheduling', { jobName, cronExpression })}`));

    const tmpDir = await createTempDir();
    const apexFile = path.join(tmpDir, 'schedule-batch.apex');
    await fs.writeFile(apexFile, apexCode);

    const apexCommand = `sf apex run --file "${apexFile}"${targetOrgFlag}`;
    const res = await execCommand(apexCommand, null, { fail: false, output: true });

    // Clean up temp file
    await fs.remove(tmpDir);

    if (res.status === 0) {
      uxLog('log', this, c.green(`[DeploymentActions] ${t('scheduleBatchSuccess', { jobName, className, cronExpression })}`));
      return { statusCode: 'success', output: buildActionOutput(res) };
    }
    // Reached only when execCommand returns instead of throwing (--json commands).
    // Plain commands throw even with fail:false, and executePrePostCommands catches them.
    return { statusCode: 'failed', output: buildActionOutput(res) };
  }
}
