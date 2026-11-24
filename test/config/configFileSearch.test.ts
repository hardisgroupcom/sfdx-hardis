/* eslint-disable @typescript-eslint/no-unused-expressions */
// The project configuration is found like cosmiconfig found it: the first search place of the
// current folder that holds a configuration, package.json only with a "sfdx-hardis" property,
// empty files skipped, and setConfig writes into the file found.
import { expect } from 'chai';
import { execSync } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import fs from '../../src/common/utils/fsUtils.js';
import { getConfig, setConfig } from '../../src/config/index.js';

describe('Configuration file search', () => {
  const previousCwd = process.cwd();
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sfdx-hardis-config-'));
    execSync('git init -q', { cwd: tmpDir });
    process.chdir(tmpDir);
  });

  afterEach(async () => {
    process.chdir(previousCwd);
    await fs.remove(tmpDir);
    await getConfig('user');
  });

  async function write(file: string, content: string): Promise<void> {
    await fs.ensureDir(path.dirname(path.join(tmpDir, file)));
    await fs.writeFile(path.join(tmpDir, file), content);
  }

  it('returns an empty configuration when there is no file', async () => {
    expect(await getConfig('project')).to.deep.equal({});
  });

  it('reads config/.sfdx-hardis.yml', async () => {
    await write('config/.sfdx-hardis.yml', 'projectName: demo\nlist:\n  - a\n');
    expect(await getConfig('project')).to.deep.equal({ projectName: 'demo', list: ['a'] });
  });

  it('skips a package.json without a sfdx-hardis property, and reads it when it has one', async () => {
    await write('package.json', JSON.stringify({ name: 'x' }));
    await write('config/.sfdx-hardis.yml', 'projectName: from-yml\n');
    expect((await getConfig('project')).projectName).to.equal('from-yml');
    await write('package.json', JSON.stringify({ name: 'x', 'sfdx-hardis': { projectName: 'from-package' } }));
    expect((await getConfig('project')).projectName).to.equal('from-package');
  });

  it('skips an empty file or a file of comments', async () => {
    await write('.sfdx-hardis.yml', '# nothing yet\n');
    await write('config/.sfdx-hardis.yml', 'projectName: second\n');
    expect((await getConfig('project')).projectName).to.equal('second');
  });

  it('prefers the first search place holding a configuration', async () => {
    await write('.sfdx-hardis.yml', 'projectName: root\n');
    await write('config/.sfdx-hardis.yml', 'projectName: config\n');
    expect((await getConfig('project')).projectName).to.equal('root');
  });

  it('uses the configuration read earlier when the file becomes invalid YAML', async () => {
    await write('config/.sfdx-hardis.yml', 'projectName: valid\n');
    expect((await getConfig('project')).projectName).to.equal('valid');
    await write('config/.sfdx-hardis.yml', 'projectName: [unclosed\n');
    expect((await getConfig('project')).projectName).to.equal('valid');
  });

  it('writes into the file found, keeping its comments', async () => {
    await write('config/.sfdx-hardis.yml', '# why\nprojectName: demo\n');
    await setConfig('project', { devHubAlias: 'DevHub_demo' });
    const content = await fs.readFile(path.join(tmpDir, 'config', '.sfdx-hardis.yml'), 'utf8');
    expect(content).to.equal('# why\nprojectName: demo\ndevHubAlias: DevHub_demo\n');
    expect(fs.existsSync(path.join(tmpDir, '.sfdx-hardis.yml'))).to.be.false;
  });
});
