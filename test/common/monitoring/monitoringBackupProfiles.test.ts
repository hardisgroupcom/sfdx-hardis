/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import {
  BACKUP_PROFILES_PER_CALL,
  collectProfileNames,
  readBackupProfiles,
} from '../../../src/common/monitoring/monitoringBackupProfiles.js';

const commandThis = { ux: { log: () => { } } };

describe('monitoringBackupProfiles', () => {
  describe('collectProfileNames', () => {
    it('returns the Profile members of a package.xml, once each', () => {
      expect(collectProfileNames({ ApexClass: ['Foo'], Profile: ['Admin', 'Custom%3A Sales Profile', 'Admin'] })).to.deep.equal([
        'Admin',
        'Custom%3A Sales Profile',
      ]);
    });

    it('returns nothing when the package.xml has no Profile', () => {
      expect(collectProfileNames({ ApexClass: ['Foo'] })).to.deep.equal([]);
      expect(collectProfileNames(null)).to.deep.equal([]);
    });
  });

  describe('readBackupProfiles', () => {
    it('reads the Profiles whole, active entries only, 5 by call', async () => {
      let received: any = null;
      const result = await readBackupProfiles({
        conn: {} as any,
        profileNames: ['Admin', 'Standard'],
        outputDir: '/tmp/force-app',
        packageDirs: ['/tmp/force-app'],
        commandThis,
        read: async (options) => {
          received = options;
          return {
            successes: [
              { type: 'Profile', fullName: 'Admin', status: 'success', inactiveEntriesRemoved: 12 },
              { type: 'Profile', fullName: 'Standard', status: 'success' },
            ],
            failures: [],
            skipped: [],
          };
        },
      });
      expect(result).to.deep.equal({ read: 2, inactiveEntriesRemoved: 12 });
      expect(received.activeOnly).to.be.true;
      expect(received.chunkSizeOverride).to.equal(BACKUP_PROFILES_PER_CALL);
      expect(received.componentSet.toArray().map((cmp: any) => `${cmp.type.name}:${cmp.fullName}`).sort()).to.deep.equal([
        'Profile:Admin',
        'Profile:Standard',
      ]);
    });

    it('reads nothing when no Profile was retrieved', async () => {
      let called = false;
      const result = await readBackupProfiles({
        conn: {} as any,
        profileNames: [],
        outputDir: '/tmp/force-app',
        packageDirs: [],
        commandThis,
        read: async () => {
          called = true;
          return { successes: [], failures: [], skipped: [] };
        },
      });
      expect(called).to.be.false;
      expect(result.read).to.equal(0);
    });

    it('lists the Profiles of the org when the manifest holds a wildcard', async () => {
      let received: any = null;
      const conn: any = { metadata: { list: async () => [{ fullName: 'Standard' }, { fullName: 'Admin' }] } };
      await readBackupProfiles({
        conn,
        profileNames: ['*'],
        outputDir: '/tmp/force-app',
        packageDirs: [],
        commandThis,
        read: async (options) => {
          received = options;
          return { successes: [], failures: [], skipped: [] };
        },
      });
      expect(received.componentSet.toArray().map((cmp: any) => cmp.fullName).sort()).to.deep.equal(['Admin', 'Standard']);
    });

    it('fails with the names of the Profiles that could not be read and the first error', async () => {
      let error: any = null;
      try {
        await readBackupProfiles({
          conn: {} as any,
          profileNames: ['Admin', 'Broken'],
          outputDir: '/tmp/force-app',
          packageDirs: [],
          commandThis,
          read: async () => ({
            successes: [{ type: 'Profile', fullName: 'Admin', status: 'success' }],
            failures: [{ type: 'Profile', fullName: 'Broken', status: 'error', error: 'UNKNOWN_EXCEPTION: boom' }],
            skipped: [],
          }),
        });
      } catch (e) {
        error = e;
      }
      expect(error).to.not.be.null;
      expect(error.message).to.contain('Broken');
      expect(error.message).to.contain('UNKNOWN_EXCEPTION: boom');
      expect(error.message).to.contain('package-skip-items.xml');
    });
  });
});
