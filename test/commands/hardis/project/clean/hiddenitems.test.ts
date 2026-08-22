/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import fs from '../../../../../src/common/utils/fsUtils.js';
import * as os from 'os';
import * as path from 'path';
import CleanHiddenItems from '../../../../../src/commands/hardis/project/clean/hiddenitems.js';

function setupProjectTmpDir(prefix: string): { getForceApp: () => string } {
  const projectRoot = process.cwd();
  const projectFile = path.join(projectRoot, 'sfdx-project.json');
  let projectFileCreatedByUs = false;
  let tmpDir = '';

  before(async () => {
    if (!fs.existsSync(projectFile)) {
      await fs.writeJson(projectFile, {
        packageDirectories: [{ path: 'force-app', default: true }],
        namespace: '',
        sfdcLoginUrl: 'https://login.salesforce.com',
        sourceApiVersion: '66.0',
      });
      projectFileCreatedByUs = true;
    }
  });

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    await fs.ensureDir(tmpDir);
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  after(async () => {
    if (projectFileCreatedByUs) {
      await fs.remove(projectFile);
    }
  });

  return {
    getForceApp: () => tmpDir,
  };
}

async function writeFile(filePath: string, content: string): Promise<void> {
  await fs.ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, content);
}

describe('hardis:project:clean:hiddenitems', () => {
  const ctx = setupProjectTmpDir('hiddenitems');

  it('removes hidden managed package source files and their companion metadata files', async () => {
    const root = ctx.getForceApp();
    const hiddenClass = path.join(root, 'classes', 'HiddenClass.cls');
    const hiddenClassMeta = `${hiddenClass}-meta.xml`;
    const hiddenTrigger = path.join(root, 'triggers', 'HiddenTrigger.trigger');
    const hiddenTriggerMeta = `${hiddenTrigger}-meta.xml`;
    const hiddenComponent = path.join(root, 'components', 'HiddenComponent.component');
    const hiddenComponentMeta = `${hiddenComponent}-meta.xml`;
    const visibleClass = path.join(root, 'classes', 'VisibleClass.cls');
    const visibleClassMeta = `${visibleClass}-meta.xml`;

    await writeFile(hiddenClass, '(hidden)');
    await writeFile(hiddenClassMeta, '<ApexClass/>');
    await writeFile(hiddenTrigger, '\n  (hidden)');
    await writeFile(hiddenTriggerMeta, '<ApexTrigger/>');
    await writeFile(hiddenComponent, '\uFEFF(hidden)');
    await writeFile(hiddenComponentMeta, '<ApexComponent/>');
    await writeFile(visibleClass, 'public class VisibleClass {}');
    await writeFile(visibleClassMeta, '<ApexClass/>');

    await CleanHiddenItems.run(['-f', root]);

    expect(fs.existsSync(hiddenClass), 'hidden Apex class should be removed').to.be.false;
    expect(fs.existsSync(hiddenClassMeta), 'hidden Apex class metadata should be removed').to.be.false;
    expect(fs.existsSync(hiddenTrigger), 'hidden Apex trigger should be removed').to.be.false;
    expect(fs.existsSync(hiddenTriggerMeta), 'hidden Apex trigger metadata should be removed').to.be.false;
    expect(fs.existsSync(hiddenComponent), 'hidden Visualforce component should be removed').to.be.false;
    expect(fs.existsSync(hiddenComponentMeta), 'hidden Visualforce component metadata should be removed').to.be.false;
    expect(fs.existsSync(visibleClass), 'visible Apex class should be kept').to.be.true;
    expect(fs.existsSync(visibleClassMeta), 'visible Apex class metadata should be kept').to.be.true;
  });

  it('ignores matching directories and removes hidden files', async () => {
    const root = ctx.getForceApp();
    const matchingDirectory = path.join(root, 'objects', 'FolderWithXmlExtension.xml');
    const hiddenFile = path.join(root, 'classes', 'HiddenClass.xml');
    const normalFile = path.join(root, 'classes', 'VisibleClass.xml');

    await fs.ensureDir(matchingDirectory);
    await writeFile(hiddenFile, '(hidden)');
    await writeFile(normalFile, '<xml/>');

    await CleanHiddenItems.run(['-f', root]);

    expect(fs.existsSync(matchingDirectory), 'matching directory should be ignored').to.be.true;
    expect(fs.existsSync(hiddenFile), 'hidden file should be removed').to.be.false;
    expect(fs.existsSync(normalFile), 'normal file should be kept').to.be.true;
  });
});
