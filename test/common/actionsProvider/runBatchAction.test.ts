import { expect } from 'chai';
import {
  applyRunBatchFlags,
  buildRunBatchApex,
  decideExistingBatchJob,
  evaluateBatchJob,
  extractBatchJobId,
  hasRunBatchFlags,
  isBatchableApexBody,
  listRunBatchParameterErrors,
  normalizeRunBatchParameters,
  resolveRunBatchOptions,
} from '../../../src/common/actionsProvider/runBatchAction.js';
import { hasNoVisibleNoArgConstructor } from '../../../src/common/actionsProvider/apexClassActionUtils.js';

describe('resolveRunBatchOptions', () => {
  it('waits, with a batch size of 200 and a timeout of 60 minutes, by default', () => {
    expect(resolveRunBatchOptions({ className: 'CrewCapacityBatch' })).to.deep.equal({
      runMode: 'wait',
      batchSize: 200,
      waitTimeoutMinutes: 60,
      successEvenIfBatchErrors: false,
    });
  });

  it('reads the values of the action', () => {
    expect(
      resolveRunBatchOptions({ runMode: 'no-wait', batchSize: 50, waitTimeoutMinutes: 5, successEvenIfBatchErrors: true })
    ).to.deep.equal({ runMode: 'no-wait', batchSize: 50, waitTimeoutMinutes: 5, successEvenIfBatchErrors: true });
  });
});

describe('listRunBatchParameterErrors', () => {
  it('accepts a class name alone', () => {
    expect(listRunBatchParameterErrors({ type: 'run-batch', parameters: { className: 'CrewCapacityBatch' } })).to.deep.equal([]);
  });

  it('requires a class name', () => {
    expect(listRunBatchParameterErrors({ type: 'run-batch', parameters: {} })).to.have.lengthOf(1);
  });

  it('rejects an unknown run mode, a batch size out of range and a negative timeout', () => {
    const errors = listRunBatchParameterErrors({
      type: 'run-batch',
      parameters: { className: 'CrewCapacityBatch', runMode: 'later' as any, batchSize: 5000, waitTimeoutMinutes: -1 },
    });
    expect(errors).to.have.lengthOf(3);
  });

  it('rejects a batch size that is not an integer', () => {
    const errors = listRunBatchParameterErrors({
      type: 'run-batch',
      parameters: { className: 'CrewCapacityBatch', batchSize: 'many' as any },
    });
    expect(errors).to.have.lengthOf(1);
  });

  it('rejects a wait timeout that is not a whole number of minutes', () => {
    for (const waitTimeoutMinutes of [0.5, 0, 'soon']) {
      const errors = listRunBatchParameterErrors({
        type: 'run-batch',
        parameters: { className: 'CrewCapacityBatch', waitTimeoutMinutes: waitTimeoutMinutes as any },
      });
      expect(errors, String(waitTimeoutMinutes)).to.have.lengthOf(1);
    }
  });

  it('only accepts the process-deployment-only context', () => {
    const parameters = { className: 'CrewCapacityBatch' };
    expect(listRunBatchParameterErrors({ type: 'run-batch', parameters, context: 'process-deployment-only' })).to.deep.equal([]);
    expect(listRunBatchParameterErrors({ type: 'run-batch', parameters, context: 'all' })).to.have.lengthOf(1);
    expect(listRunBatchParameterErrors({ type: 'run-batch', parameters, context: 'check-deployment-only' })).to.have.lengthOf(1);
  });
});

describe('normalizeRunBatchParameters', () => {
  it('stores numbers as numbers and leaves the empty optional values out', () => {
    expect(
      normalizeRunBatchParameters({ runMode: 'wait', batchSize: '50', waitTimeoutMinutes: '', successEvenIfBatchErrors: false })
    ).to.deep.equal({ runMode: 'wait', batchSize: 50 });
  });

  it('drops the wait-only parameters when the batch is not waited for', () => {
    expect(
      normalizeRunBatchParameters({ runMode: 'no-wait', batchSize: 50, waitTimeoutMinutes: 30, successEvenIfBatchErrors: true })
    ).to.deep.equal({ runMode: 'no-wait', batchSize: 50 });
  });

  it('keeps a value that is not a number, so the validation reports it', () => {
    expect(normalizeRunBatchParameters({ batchSize: 'many' })).to.deep.equal({ runMode: 'wait', batchSize: 'many' });
  });
});

describe('applyRunBatchFlags', () => {
  it('only changes the parameters whose flag is passed', () => {
    const current = { className: 'CrewCapacityBatch', runMode: 'wait' as const, batchSize: 50, successEvenIfBatchErrors: true };
    expect(applyRunBatchFlags(current, { 'wait-timeout': 15 })).to.deep.equal({ ...current, waitTimeoutMinutes: 15 });
  });

  it('removes successEvenIfBatchErrors with the negated flag', () => {
    const current = { className: 'CrewCapacityBatch', runMode: 'wait' as const, successEvenIfBatchErrors: true };
    expect(applyRunBatchFlags(current, { 'success-even-if-batch-errors': false })).to.deep.equal({
      className: 'CrewCapacityBatch',
      runMode: 'wait',
    });
  });
});

describe('hasRunBatchFlags', () => {
  it('is true as soon as one run-batch flag is passed, even a negated one', () => {
    expect(hasRunBatchFlags({ 'batch-size': 50 })).to.equal(true);
    expect(hasRunBatchFlags({ 'success-even-if-batch-errors': false })).to.equal(true);
  });

  it('is false for the flags shared with other types', () => {
    expect(hasRunBatchFlags({ 'class-name': 'CrewCapacityBatch', label: 'Recalculate' })).to.equal(false);
  });
});

describe('isBatchableApexBody', () => {
  it('finds the Database.Batchable interface', () => {
    expect(isBatchableApexBody('public class A implements Database.Batchable<SObject>, Schedulable {')).to.equal(true);
    expect(isBatchableApexBody('global class A implements database.batchable<sObject> {')).to.equal(true);
  });

  it('rejects a class that is only schedulable', () => {
    expect(isBatchableApexBody('public class A implements Schedulable {')).to.equal(false);
  });
});

describe('extractBatchJobId', () => {
  it('reads the job id written in the debug log', () => {
    const log = '12:00:00.1 (1)|USER_DEBUG|[2]|DEBUG|SFDX_HARDIS_BATCH_JOB_ID=7071x00000ABCdeAAH\n12:00:00.2 (2)|CODE_UNIT_FINISHED';
    expect(extractBatchJobId(log)).to.equal('7071x00000ABCdeAAH');
  });

  it('returns null when the debug log does not hold the marker', () => {
    expect(extractBatchJobId('Compiled successfully.\nExecuted successfully.')).to.equal(null);
  });

  it('is not fooled by the source line of the anonymous Apex', () => {
    expect(extractBatchJobId(buildRunBatchApex('CrewCapacityBatch', 200))).to.equal(null);
  });
});

describe('buildRunBatchApex', () => {
  it('launches the class with its batch size', () => {
    expect(buildRunBatchApex('acme.NightlyBatch', 50)).to.contain('Database.executeBatch(new acme.NightlyBatch(), 50);');
  });
});

describe('evaluateBatchJob', () => {
  it('keeps waiting while the job is not over', () => {
    for (const Status of ['Holding', 'Queued', 'Preparing', 'Processing']) {
      expect(evaluateBatchJob({ Status, NumberOfErrors: 0 }, false)).to.equal('running');
    }
    expect(evaluateBatchJob({}, false)).to.equal('running');
  });

  it('succeeds when the job completes without error', () => {
    expect(evaluateBatchJob({ Status: 'Completed', NumberOfErrors: 0 }, false)).to.equal('success');
  });

  it('fails when the job completes with batches in error', () => {
    expect(evaluateBatchJob({ Status: 'Completed', NumberOfErrors: 2 }, false)).to.equal('completedWithErrors');
  });

  it('succeeds with batches in error when the action accepts them', () => {
    expect(evaluateBatchJob({ Status: 'Completed', NumberOfErrors: 2 }, true)).to.equal('successWithErrors');
  });

  it('always fails on a failed or aborted job', () => {
    expect(evaluateBatchJob({ Status: 'Failed', NumberOfErrors: 0 }, true)).to.equal('failed');
    expect(evaluateBatchJob({ Status: 'Aborted', NumberOfErrors: 0 }, true)).to.equal('failed');
  });
});

describe('decideExistingBatchJob', () => {
  const now = Date.parse('2026-10-02T12:00:00.000Z');
  const wait = { runMode: 'wait' as const, batchSize: 200, waitTimeoutMinutes: 60, successEvenIfBatchErrors: false };
  const noWait = { ...wait, runMode: 'no-wait' as const };
  const completed = (minutesAgo: number, NumberOfErrors = 0) => ({
    Id: '7071x00000ABCdeAAH',
    Status: 'Completed',
    NumberOfErrors,
    CompletedDate: new Date(now - minutesAgo * 60 * 1000).toISOString(),
  });

  it('launches when the class has no job', () => {
    expect(decideExistingBatchJob(null, wait, now)).to.equal('launch');
  });

  it('follows a job that is still running', () => {
    for (const Status of ['Holding', 'Queued', 'Preparing', 'Processing']) {
      expect(decideExistingBatchJob({ Status }, wait, now), Status).to.equal('follow');
      expect(decideExistingBatchJob({ Status }, noWait, now), Status).to.equal('follow');
    }
  });

  it('reuses a job completed without error in the last hour', () => {
    expect(decideExistingBatchJob(completed(10), wait, now)).to.equal('reuse');
  });

  it('launches again when the last job is older than an hour', () => {
    expect(decideExistingBatchJob(completed(61), wait, now)).to.equal('launch');
  });

  it('launches again after a recent job with batches in error, unless the action accepts them', () => {
    expect(decideExistingBatchJob(completed(10, 2), wait, now)).to.equal('launch');
    expect(decideExistingBatchJob(completed(10, 2), { ...wait, successEvenIfBatchErrors: true }, now)).to.equal('reuse');
    expect(decideExistingBatchJob(completed(10, 2), noWait, now)).to.equal('reuse');
  });

  it('launches again after a failed or aborted job', () => {
    for (const Status of ['Failed', 'Aborted']) {
      const job = { ...completed(10), Status };
      expect(decideExistingBatchJob(job, wait, now), Status).to.equal('launch');
      expect(decideExistingBatchJob(job, noWait, now), Status).to.equal('launch');
    }
  });
});

describe('hasNoVisibleNoArgConstructor', () => {
  it('accepts a class without any constructor', () => {
    expect(hasNoVisibleNoArgConstructor('public class CrewBatch implements Database.Batchable<SObject> {}', 'CrewBatch')).to.equal(false);
  });

  it('rejects a class whose only constructor takes parameters', () => {
    expect(hasNoVisibleNoArgConstructor('public class CrewBatch { public CrewBatch(String region) {} }', 'CrewBatch')).to.equal(true);
  });

  it('rejects a private no-arg constructor', () => {
    expect(hasNoVisibleNoArgConstructor('public class CrewBatch { private CrewBatch() {} }', 'CrewBatch')).to.equal(true);
  });
});
