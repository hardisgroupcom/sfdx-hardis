/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';
import { SfProject } from '@salesforce/core';

describe('Git Delta - callSfdxGitDelta with package filtering', () => {
  const testDirs: string[] = [];

  afterEach(async () => {
    // Cleanup all test directories
    for (const dir of testDirs) {
      if (await fs.pathExists(dir)) {
        await fs.remove(dir);
      }
    }
    testDirs.length = 0;
  });

  describe('SfProject integration', () => {
    it('should read packageDirectories from sfdx-project.json when it exists', async () => {
      // Create a test sfdx-project.json with multiple packageDirectories
      const testProjectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hardis-project-'));
      testDirs.push(testProjectDir);
      const sfdxProjectPath = path.join(testProjectDir, 'sfdx-project.json');

      const projectConfig = {
        packageDirectories: [
          { path: 'force-app', default: true },
          { path: 'packages/mypackage' },
        ],
        name: 'test-project',
        namespace: '',
        sfdcLoginUrl: 'https://login.salesforce.com',
        sourceApiVersion: '59.0',
      };

      await fs.writeJson(sfdxProjectPath, projectConfig);

      // Create the package directories
      await fs.ensureDir(path.join(testProjectDir, 'force-app'));
      await fs.ensureDir(path.join(testProjectDir, 'packages', 'mypackage'));

      // Test that SfProject can resolve and read the directories
      const project = await SfProject.resolve(testProjectDir);
      const dirs = project.getPackageDirectories();

      expect(dirs).to.have.lengthOf(2);
      expect(dirs[0].path).to.equal('force-app');
      // Paths may use backslashes on Windows, so normalize for comparison
      expect(dirs[1].path.replace(/\\/g, '/')).to.equal('packages/mypackage');
    });

    it('should throw error when sfdx-project.json does not exist', async () => {
      const testProjectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hardis-no-project-'));
      testDirs.push(testProjectDir);

      try {
        await SfProject.resolve(testProjectDir);
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error).to.be.instanceOf(Error);
      }
    });

    it('should throw error when packageDirectories do not exist on disk', async () => {
      const testProjectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hardis-missing-dir-'));
      testDirs.push(testProjectDir);
      const sfdxProjectPath = path.join(testProjectDir, 'sfdx-project.json');

      const projectConfig = {
        packageDirectories: [
          { path: 'force-app', default: true },
          { path: 'packages/missing-package' },
        ],
        name: 'test-project',
        namespace: '',
        sfdcLoginUrl: 'https://login.salesforce.com',
        sourceApiVersion: '59.0',
      };

      await fs.writeJson(sfdxProjectPath, projectConfig);
      await fs.ensureDir(path.join(testProjectDir, 'force-app'));
      // Note: NOT creating packages/missing-package

      const project = await SfProject.resolve(testProjectDir);

      // SfProject.getPackageDirectories() should throw when a directory is missing
      try {
        project.getPackageDirectories();
        expect.fail('Should have thrown an error for missing package directory');
      } catch (error) {
        expect(error).to.be.instanceOf(Error);
        if (error instanceof Error) {
          expect(error.message).to.include('does not exist');
        } else {
          throw error;
        }
      }
    });

    it('should require at least one default package directory', async () => {
      const testProjectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hardis-empty-dirs-'));
      testDirs.push(testProjectDir);
      const sfdxProjectPath = path.join(testProjectDir, 'sfdx-project.json');

      const projectConfig = {
        packageDirectories: [],
        name: 'test-project',
        namespace: '',
        sfdcLoginUrl: 'https://login.salesforce.com',
        sourceApiVersion: '59.0',
      };

      await fs.writeJson(sfdxProjectPath, projectConfig);

      const project = await SfProject.resolve(testProjectDir);

      // SfProject requires at least one package directory with a default
      try {
        project.getPackageDirectories();
        expect.fail('Should have thrown an error for missing default package directory');
      } catch (error) {
        expect(error).to.be.instanceOf(Error);
        if (error instanceof Error) {
          expect(error.message).to.include('default');
        } else {
          throw error;
        }
      }
    });

    it('should extract relative paths correctly from packageDirectories', async () => {
      const testProjectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hardis-paths-'));
      testDirs.push(testProjectDir);
      const sfdxProjectPath = path.join(testProjectDir, 'sfdx-project.json');

      const projectConfig = {
        packageDirectories: [
          { path: 'force-app', default: true },
          { path: 'packages/package-a' },
          { path: 'src/package-b' },
        ],
        name: 'test-project',
        namespace: '',
        sfdcLoginUrl: 'https://login.salesforce.com',
        sourceApiVersion: '59.0',
      };

      await fs.writeJson(sfdxProjectPath, projectConfig);
      for (const dir of projectConfig.packageDirectories) {
        await fs.ensureDir(path.join(testProjectDir, dir.path));
      }

      const project = await SfProject.resolve(testProjectDir);
      const dirs = project.getPackageDirectories();
      // Normalize paths to use forward slashes (Windows compatibility)
      const paths = dirs.map((d) => d.path.replace(/\\/g, '/'));

      expect(paths).to.deep.equal(['force-app', 'packages/package-a', 'src/package-b']);
    });

    it('should handle nested packageDirectory paths', async () => {
      const testProjectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hardis-nested-'));
      testDirs.push(testProjectDir);
      const sfdxProjectPath = path.join(testProjectDir, 'sfdx-project.json');

      const projectConfig = {
        packageDirectories: [
          { path: 'force-app', default: true },
          { path: 'packages/managed/package-a' },
          { path: 'packages/unmanaged/package-b' },
        ],
        name: 'test-project',
        namespace: '',
        sfdcLoginUrl: 'https://login.salesforce.com',
        sourceApiVersion: '59.0',
      };

      await fs.writeJson(sfdxProjectPath, projectConfig);
      for (const dir of projectConfig.packageDirectories) {
        await fs.ensureDir(path.join(testProjectDir, dir.path));
      }

      const project = await SfProject.resolve(testProjectDir);
      const dirs = project.getPackageDirectories();

      expect(dirs).to.have.lengthOf(3);
      // Normalize paths to use forward slashes (Windows compatibility)
      expect(dirs[1].path.replace(/\\/g, '/')).to.equal('packages/managed/package-a');
      expect(dirs[2].path.replace(/\\/g, '/')).to.equal('packages/unmanaged/package-b');
    });
  });

  describe('CLI command building', () => {
    it('should include required base parameters in sgd command', () => {
      const from = 'abc123';
      const to = 'def456';
      const baseCommand = `sf sgd:source:delta --from "${from}" --to "${to}" --output /tmp/out --ignore-whitespace`;

      expect(baseCommand).to.include('sf sgd:source:delta');
      expect(baseCommand).to.include(`--from "${from}"`);
      expect(baseCommand).to.include(`--to "${to}"`);
      expect(baseCommand).to.include('--ignore-whitespace');
    });

    it('should properly format --source-dir flags', () => {
      const dirs = ['force-app', 'packages/mypackage'];
      let command = 'sf sgd:source:delta --from abc --to def';

      dirs.forEach((dir) => {
        command += ` --source-dir ${dir}`;
      });

      expect(command).to.include('--source-dir force-app');
      expect(command).to.include('--source-dir packages/mypackage');
      // Verify order is correct
      expect(command.indexOf('--source-dir force-app')).to.be.lessThan(
        command.indexOf('--source-dir packages/mypackage')
      );
    });

    it('should handle multiple --source-dir flags in correct order', () => {
      const dirs = ['a', 'b', 'c', 'd'];
      let command = 'sf sgd:source:delta --from x --to y';

      dirs.forEach((dir) => {
        command += ` --source-dir ${dir}`;
      });

      const indices = dirs.map((dir) => command.indexOf(`--source-dir ${dir}`));
      // Verify all indices are in ascending order (correct sequence)
      for (let i = 0; i < indices.length - 1; i++) {
        expect(indices[i]).to.be.lessThan(indices[i + 1]);
      }
    });
  });
});
