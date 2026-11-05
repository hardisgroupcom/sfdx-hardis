import { strict as assert } from 'assert';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

const workflowsDir = path.join(process.cwd(), 'defaults', 'ci', '.github', 'workflows');
const readWorkflow = (file: string): any => yaml.load(fs.readFileSync(path.join(workflowsDir, file), 'utf8'));

describe('GitHub CI templates', () => {
  it('refreshes the scratch org pool after a successful snapshot refresh of the default branch, and nightly', () => {
    const snapshotWorkflow = readWorkflow('scratch-snapshot-refresh.yml');
    const poolWorkflow = readWorkflow('scratch-pool-refresh.yml');
    // The workflow_run trigger matches the snapshot workflow by its name: a rename on one side breaks it silently
    assert.deepEqual(poolWorkflow.on.workflow_run.workflows, [snapshotWorkflow.name]);
    assert.deepEqual(poolWorkflow.on.workflow_run.types, ['completed']);
    assert.deepEqual(poolWorkflow.on.workflow_run.branches, ['main']);
    assert.ok(snapshotWorkflow.on.push.branches.includes('main'));
    assert.ok(poolWorkflow.on.schedule?.length > 0, 'the nightly schedule is kept');
    const jobIf: string = poolWorkflow.jobs.refresh_scratch_org_pool.if;
    assert.ok(jobIf.includes("github.event_name != 'workflow_run' || github.event.workflow_run.conclusion == 'success'"));
    assert.ok(jobIf.includes("vars.SCRATCH_ORG_POOL == 'true'"));
  });
});
