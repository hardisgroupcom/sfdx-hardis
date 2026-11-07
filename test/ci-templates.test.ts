import { strict as assert } from 'assert';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

const workflowsDir = path.join(process.cwd(), 'defaults', 'ci', '.github', 'workflows');
const readWorkflow = (file: string): any => yaml.load(fs.readFileSync(path.join(workflowsDir, file), 'utf8'));

describe('GitHub CI templates', () => {
  it('starts the scratch org pool refresh only after a new snapshot of the default branch, and nightly', () => {
    const snapshotWorkflow = readWorkflow('scratch-snapshot-refresh.yml');
    const poolWorkflow = readWorkflow('scratch-pool-refresh.yml');
    const snapshotJob = snapshotWorkflow.jobs.refresh_scratch_org_snapshot;
    const stepIndex = (predicate: (step: any) => boolean) => snapshotJob.steps.findIndex(predicate);
    const refreshIndex = stepIndex((step) => step.id === 'refresh');
    assert.ok(snapshotJob.steps[refreshIndex].run.includes('sf hardis:scratch:snapshot:refresh'));
    const startIndex = stepIndex((step) => String(step.run).includes('/actions/workflows/scratch-pool-refresh.yml/dispatches'));
    assert.ok(startIndex > refreshIndex, 'the pool refresh starts after the snapshot refresh');
    const startIf: string = snapshotJob.steps[startIndex].if;
    assert.ok(startIf.includes("steps.refresh.outputs.snapshot != ''"));
    assert.ok(startIf.includes("vars.SCRATCH_ORG_POOL == 'true'"));
    assert.ok(startIf.includes('github.ref_name == github.event.repository.default_branch'));
    // A project without the pool workflow file keeps its snapshots: no reference GitHub validates before the run
    assert.ok(startIf.includes("hashFiles('.github/workflows/scratch-pool-refresh.yml') != ''"));
    assert.ok(!Object.values(snapshotWorkflow.jobs).some((job: any) => job.uses));
    assert.equal(snapshotJob.permissions.actions, 'write');
    assert.ok('workflow_dispatch' in poolWorkflow.on);
    assert.ok(!('workflow_run' in poolWorkflow.on) && !('workflow_call' in poolWorkflow.on));
    assert.ok(poolWorkflow.on.schedule?.length > 0, 'the nightly schedule is kept');
    assert.ok(poolWorkflow.jobs.refresh_scratch_org_pool.if.includes("vars.SCRATCH_ORG_POOL == 'true'"));
  });
});
