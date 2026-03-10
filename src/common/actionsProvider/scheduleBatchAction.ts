import { Connection } from '@salesforce/core';
import { ActionsProvider, ActionResult, PrePostCommand } from './actionsProvider.js';
import { createTempDir, execCommand, uxLog } from '../utils/index.js';
import { soqlQuery, soqlQueryTooling } from '../utils/apiUtils.js';
import { t } from '../utils/i18n.js';
import c from 'chalk';
import fs from 'fs-extra';
import path from 'path';

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

  public async run(cmd: PrePostCommand): Promise<ActionResult> {
    const validity = await this.checkValidityIssues(cmd);
    if (validity) return validity;

    const className = (cmd.parameters?.className as string) || '';
    const cronExpression = (cmd.parameters?.cronExpression as string) || '';
    const jobName = (cmd.parameters?.jobName as string) || `${className}_Schedule`;
    const targetOrgFlag = this.customUsernameToUse ? ` --target-org ${this.customUsernameToUse}` : '';

    const conn: Connection = globalThis.jsForceConn;

    // 1. Verify the Apex class exists and implements Schedulable
    uxLog('log', this, c.grey(`[DeploymentActions] ${t('scheduleBatchVerifyingClass', { className })}`));
    const classQuery = `SELECT Id, Name, Body FROM ApexClass WHERE Name = '${className.replace(/'/g, "\\'")}' AND ManageableState = 'unmanaged'`;
    const classResult = await soqlQueryTooling(classQuery, conn);
    if (!classResult.records || classResult.records.length === 0) {
      uxLog('error', this, c.red(`[DeploymentActions] ${t('scheduleBatchClassNotFound', { className })}`));
      return { statusCode: 'failed', output: t('scheduleBatchClassNotFound', { className }) };
    }
    const apexClass = classResult.records[0];
    if (!apexClass.Body || !apexClass.Body.includes('Schedulable')) {
      uxLog('error', this, c.red(`[DeploymentActions] ${t('scheduleBatchClassNotSchedulable', { className })}`));
      return { statusCode: 'failed', output: t('scheduleBatchClassNotSchedulable', { className }) };
    }

    // 2. Check for existing scheduled jobs with the same name
    uxLog('log', this, c.grey(`[DeploymentActions] ${t('scheduleBatchCheckingExisting', { jobName })}`));
    const cronQuery = `SELECT Id, CronExpression, CronJobDetail.Name, State FROM CronTrigger WHERE CronJobDetail.Name = '${jobName.replace(/'/g, "\\'")}' AND State IN ('WAITING','ACQUIRED','EXECUTING','PAUSED','BLOCKED','PAUSED_BLOCKED')`;
    const cronResult = await soqlQuery(cronQuery, conn);
    if (cronResult.records && cronResult.records.length > 0) {
      const existingJob = cronResult.records[0];
      if (existingJob.CronExpression === cronExpression) {
        // Identical schedule already exists — skip
        uxLog('log', this, c.green(`[DeploymentActions] ${t('scheduleBatchAlreadyScheduled', { jobName, cronExpression })}`));
        return { statusCode: 'success', output: t('scheduleBatchAlreadyScheduled', { jobName, cronExpression }) };
      }
      // Different schedule with the same name — error
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
      return { statusCode: 'success', output: (res.stdout || '') + '\n' + (res.stderr || '') };
    }
    return { statusCode: 'failed', output: (res.stdout || '') + '\n' + (res.stderr || '') };
  }
}
