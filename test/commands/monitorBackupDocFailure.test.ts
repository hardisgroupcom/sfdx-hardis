import { expect } from 'chai';
import { NotifProvider } from '../../src/common/notifProvider/index.js';
import MonitorBackup from '../../src/commands/hardis/org/monitor/backup.js';
import { notificationTypesDefault } from '../../src/common/notifProvider/types.js';

// A failed documentation used to fail the whole backup job: the sub-command it ran had set the exit
// code before its error was caught, so the pipeline never committed the org state
describe('hardis:org:monitor:backup documentation failure', () => {
  const originalPost = NotifProvider.postNotifications;
  const originalExitCode = process.exitCode;
  let posted: any[] = [];

  beforeEach(() => {
    posted = [];
    (NotifProvider as any).postNotifications = async (message: any) => {
      posted.push(message);
    };
  });

  afterEach(() => {
    (NotifProvider as any).postNotifications = originalPost;
    process.exitCode = originalExitCode;
  });

  const onDocumentationFailure = (error: any, exitCodeBeforeDoc: number | undefined) =>
    (MonitorBackup.prototype as any).onDocumentationFailure.call({}, {}, 'fr', error, exitCodeBeforeDoc);

  it('sets back the exit code the backup had before the documentation', async () => {
    // What SfCommand.catch does before throwing the error of a sub-command again
    process.exitCode = 1;
    await onDocumentationFailure(new Error('Pages only supports files up to 25 MiB in size'), undefined);
    expect(process.exitCode).to.equal(undefined);
  });

  it('keeps an exit code the backup itself had set', async () => {
    process.exitCode = 1;
    await onDocumentationFailure(new Error('Zensical build failed'), 2);
    expect(process.exitCode).to.equal(2);
  });

  it('sends a DOCUMENTATION warning with the language and the error', async () => {
    await onDocumentationFailure(new Error('Pages only supports files up to 25 MiB in size'), undefined);
    expect(posted).to.have.length(1);
    expect(posted[0].type).to.equal('DOCUMENTATION');
    expect(posted[0].severity).to.equal('warning');
    expect(posted[0].text).to.include('in language fr');
    expect(posted[0].data.language).to.equal('fr');
    expect(posted[0].data.error).to.equal('Pages only supports files up to 25 MiB in size');
    // No fake metric: a failure measures nothing
    expect(posted[0].metrics).to.deep.equal({});
  });

  it('never throws, so the other languages are still generated', async () => {
    (NotifProvider as any).postNotifications = async () => {
      throw new Error('Slack is down');
    };
    process.exitCode = 1;
    await onDocumentationFailure(new Error('Zensical build failed'), undefined);
    expect(process.exitCode).to.equal(undefined);
  });

  it('is a severity the DOCUMENTATION type declares, so routing does not clamp it away', () => {
    expect(notificationTypesDefault.DOCUMENTATION.emittedSeverities).to.include('warning');
  });
});
