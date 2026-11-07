import { strict as assert } from 'assert';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

const workflowsDir = path.join(process.cwd(), 'defaults', 'ci', '.github', 'workflows');
const readWorkflow = (file: string): any => yaml.load(fs.readFileSync(path.join(workflowsDir, file), 'utf8'));

describe('GitHub CI templates', () => {
  it('refreshes the scratch org pool only after a snapshot of the default branch is Active, and nightly', () => {
    const snapshotWorkflow = readWorkflow('scratch-snapshot-refresh.yml');
    const poolWorkflow = readWorkflow('scratch-pool-refresh.yml');
    const snapshotJob = snapshotWorkflow.jobs.refresh_scratch_org_snapshot;
    const refreshStep = snapshotJob.steps.find((step: any) => step.id === 'refresh');
    assert.ok(refreshStep?.run.includes('sf hardis:scratch:snapshot:refresh'));
    assert.equal(snapshotJob.outputs.snapshot, '${{ steps.refresh.outputs.snapshot }}');
    const poolJob = snapshotWorkflow.jobs.refresh_scratch_org_pool;
    assert.equal(poolJob.uses, './.github/workflows/scratch-pool-refresh.yml');
    assert.equal(poolJob.needs, 'refresh_scratch_org_snapshot');
    assert.ok(poolJob.if.includes("needs.refresh_scratch_org_snapshot.outputs.snapshot != ''"));
    assert.ok(poolJob.if.includes('github.ref_name == github.event.repository.default_branch'));
    assert.equal(poolJob.permissions.issues, 'write');
    assert.ok('workflow_call' in poolWorkflow.on);
    assert.ok(!('workflow_run' in poolWorkflow.on));
    assert.ok(poolWorkflow.on.schedule?.length > 0, 'the nightly schedule is kept');
    assert.ok(poolWorkflow.jobs.refresh_scratch_org_pool.if.includes("vars.SCRATCH_ORG_POOL == 'true'"));
    // When called, github.workflow is the caller's name: a fixed group keeps nightly and called runs in one queue
    assert.ok(!poolWorkflow.concurrency.group.includes('github.workflow'));
    const artifactNames = [snapshotJob, poolWorkflow.jobs.refresh_scratch_org_pool].map(
      (job) => job.steps.find((step: any) => String(step.uses).startsWith('actions/upload-artifact')).with.name
    );
    assert.notEqual(artifactNames[0], artifactNames[1], 'one workflow run cannot upload two artifacts with one name');
  });
});
