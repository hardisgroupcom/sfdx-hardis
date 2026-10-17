import { expect } from 'chai';
import { NotifProvider } from '../../src/common/notifProvider/index.js';
import MonitorBackup, { backupErrorMessage } from '../../src/commands/hardis/org/monitor/backup.js';
import { notificationTypesDefault } from '../../src/common/notifProvider/types.js';

// The failure notification is what tells a failed backup apart from a backup that did not run
describe('hardis:org:monitor:backup failure notification', () => {
  const originalPost = NotifProvider.postNotifications;
  let posted: any[] = [];

  beforeEach(() => {
    posted = [];
    (NotifProvider as any).postNotifications = async (message: any) => {
      posted.push(message);
    };
  });

  afterEach(() => {
    (NotifProvider as any).postNotifications = originalPost;
  });

  const postFailure = (flags: any, error: any) =>
    (MonitorBackup.prototype as any).postBackupFailureNotification.call({}, flags, error);

  it('sends an error BACKUP notification with the error message', async () => {
    await postFailure({}, new Error('Retrieve failed: INVALID_SESSION_ID'));
    expect(posted).to.have.length(1);
    expect(posted[0].type).to.equal('BACKUP');
    expect(posted[0].severity).to.equal('error');
    expect(posted[0].data.error).to.equal('Retrieve failed: INVALID_SESSION_ID');
    expect(posted[0].text).to.include('Metadata backup failed');
    // No fake metric: a failure measures nothing
    expect(posted[0].metrics).to.deep.equal({});
  });

  it('never throws, so the job fails with the backup error and not with the notification one', async () => {
    (NotifProvider as any).postNotifications = async () => {
      throw new Error('Slack is down');
    };
    // Resolves instead of rejecting: the warning is logged
    await postFailure({}, new Error('Retrieve failed'));
  });

  it('says only the report failed when the retrieve already succeeded', async () => {
    await (MonitorBackup.prototype as any).postBackupFailureNotification.call({}, {}, new Error('ENOSPC'), true);
    expect(posted[0].text).to.include('retrieved, but its report of the changes failed');
    expect(posted[0].severity).to.equal('error');
  });

  it('drops the command line and keeps the end of a failed CLI call, where the cause is', () => {
    const cliError = new Error(
      'Command failed: sf project retrieve start -o integration@acme.com\n' + 'Warning: progress\n'.repeat(500) + 'ERROR: INVALID_SESSION_ID'
    );
    const message = backupErrorMessage(cliError);
    expect(message).to.not.include('integration@acme.com');
    expect(message.endsWith('ERROR: INVALID_SESSION_ID')).to.equal(true);
    expect(message.length).to.be.at.most(2004);
    expect(backupErrorMessage(new Error('Short error'))).to.equal('Short error');
  });

  it('is a severity the BACKUP type declares, so routing does not clamp it away', () => {
    expect(notificationTypesDefault.BACKUP.emittedSeverities).to.include('error');
  });
});
