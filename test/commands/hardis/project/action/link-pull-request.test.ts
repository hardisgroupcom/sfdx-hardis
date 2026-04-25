import { expect } from 'chai';
import fs from 'fs-extra';
import * as yaml from 'js-yaml';
import * as path from 'path';
import { renameDraftToPr } from '../../../../../src/common/utils/actionUtils.js';
import { setupTmpDir } from '../../../../common/utils/actionTestHelper.js';

describe('hardis:project:action:link-pull-request - unit logic', () => {
  const ctx = setupTmpDir('sfdx-hardis-action-link-pr');

  describe('renameDraftToPr', () => {
    it('renames draft file to PR-specific file', async () => {
      const draftFile = path.join(ctx.getDir(), 'scripts', 'actions', '.sfdx-hardis.draft.yml');
      await fs.ensureDir(path.dirname(draftFile));
      const actions = { commandsPreDeploy: [{ id: 'test', label: 'Test', type: 'command', command: 'echo hello' }] };
      await fs.writeFile(draftFile, yaml.dump(actions));

      const targetFile = await renameDraftToPr('42');

      expect(targetFile).to.include('42');
      expect(fs.existsSync(targetFile)).to.equal(true);
      expect(fs.existsSync(draftFile)).to.equal(false);

      const doc: any = yaml.load(fs.readFileSync(targetFile, 'utf-8'));
      expect(doc.commandsPreDeploy).to.have.lengthOf(1);
      expect(doc.commandsPreDeploy[0].id).to.equal('test');
    });

    it('throws when draft file does not exist', async () => {
      try {
        await renameDraftToPr('99');
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e.message).to.include('draft');
      }
    });

    it('throws when target file already exists', async () => {
      const scriptsDir = path.join(ctx.getDir(), 'scripts', 'actions');
      await fs.ensureDir(scriptsDir);
      await fs.writeFile(path.join(scriptsDir, '.sfdx-hardis.draft.yml'), yaml.dump({ test: true }));
      await fs.writeFile(path.join(scriptsDir, '.sfdx-hardis.55.yml'), yaml.dump({ existing: true }));

      try {
        await renameDraftToPr('55');
        expect.fail('Should have thrown');
      } catch (e: any) {
        expect(e.message).to.include('55');
      }
    });
  });
});
