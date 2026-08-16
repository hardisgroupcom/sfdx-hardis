/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import CleanManagedItems from '../../../../../src/commands/hardis/project/clean/manageditems.js';

/**
 * Test fixture: writes a temporary `sfdx-project.json` at the repo root so the
 * SfCommand framework's `requiresProject = true` check passes WITHOUT chdir
 * (chdir into a folder without `node_modules` confuses oclif's tsx-loader
 * registration when an early test throws). Each test gets a fresh tmp folder
 * to point `--folder` at, isolating filesystem effects.
 */
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

function buildWorkflowXml(alertNames: string[]): string {
  const alerts = alertNames
    .map((name) => `  <alerts><fullName>${name}</fullName></alerts>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<Workflow xmlns="http://soap.sforce.com/2006/04/metadata">
${alerts}
</Workflow>
`;
}

function buildSharingRulesXml(criteriaNames: string[]): string {
  const rules = criteriaNames
    .map((name) => `  <sharingCriteriaRules><fullName>${name}</fullName></sharingCriteriaRules>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<SharingRules xmlns="http://soap.sforce.com/2006/04/metadata">
${rules}
</SharingRules>
`;
}

describe('hardis:project:clean:manageditems', () => {
  const ctx = setupProjectTmpDir('manageditems');

  it('throws when --namespace is empty', async () => {
    let err: Error | undefined;
    try {
      await CleanManagedItems.run(['-n', '', '-f', ctx.getForceApp()]);
    } catch (e) {
      err = e as Error;
    }
    expect(err, 'should throw when namespace is missing').to.exist;
    expect(err!.message).to.include('namespace');
  });

  it('returns the expected JSON output on success', async () => {
    const result: any = await CleanManagedItems.run(['-n', 'crta', '-f', ctx.getForceApp()]);
    expect(result).to.deep.equal({ outputString: 'Cleaned managed items from sfdx project' });
  });

  it('removes namespaced files and keeps non-namespaced ones', async () => {
    const root = ctx.getForceApp();
    const managed = path.join(root, 'classes', 'crta__SomeClass.cls');
    const custom = path.join(root, 'classes', 'MyClass.cls');
    await writeFile(managed, 'managed');
    await writeFile(custom, 'custom');

    await CleanManagedItems.run(['-n', 'crta', '-f', root]);

    expect(fs.existsSync(managed), 'managed class should be removed').to.be.false;
    expect(fs.existsSync(custom), 'custom class should be kept').to.be.true;
  });

  it('removes a managed folder and everything inside when no local items exist', async () => {
    const root = ctx.getForceApp();
    const managedFolder = path.join(root, 'objects', 'crta__Foo__c');
    await writeFile(path.join(managedFolder, 'crta__Foo__c.object-meta.xml'), '<x/>');
    await writeFile(path.join(managedFolder, 'fields', 'crta__Bar__c.field-meta.xml'), '<x/>');

    await CleanManagedItems.run(['-n', 'crta', '-f', root]);

    expect(fs.existsSync(managedFolder), 'fully-managed folder should be removed').to.be.false;
  });

  it('preserves a managed folder (and its .object-meta.xml) when it contains local items', async () => {
    const root = ctx.getForceApp();
    const managedFolder = path.join(root, 'objects', 'crta__Foo__c');
    const objectMeta = path.join(managedFolder, 'crta__Foo__c.object-meta.xml');
    const managedField = path.join(managedFolder, 'fields', 'crta__Bar__c.field-meta.xml');
    const customField = path.join(managedFolder, 'fields', 'MyCustomField__c.field-meta.xml');
    await writeFile(objectMeta, '<x/>');
    await writeFile(managedField, '<x/>');
    await writeFile(customField, '<x/>');

    await CleanManagedItems.run(['-n', 'crta', '-f', root]);

    expect(fs.existsSync(managedFolder), 'folder should be preserved (has local items)').to.be.true;
    expect(fs.existsSync(objectMeta), '.object-meta.xml should be preserved').to.be.true;
    expect(fs.existsSync(customField), 'custom field should be preserved').to.be.true;
    expect(fs.existsSync(managedField), 'managed field should be removed').to.be.false;
  });

  it('preserves a custom Layout defined on a managed object', async () => {
    const root = ctx.getForceApp();
    const customOnManaged = path.join(root, 'layouts', 'crta__Foo__c-MyCustomLayout.layout-meta.xml');
    const fullyManaged = path.join(root, 'layouts', 'crta__Foo__c-crta__ManagedLayout.layout-meta.xml');
    await writeFile(customOnManaged, '<x/>');
    await writeFile(fullyManaged, '<x/>');

    await CleanManagedItems.run(['-n', 'crta', '-f', root]);

    expect(fs.existsSync(customOnManaged), 'custom layout on managed object should be kept').to.be.true;
    expect(fs.existsSync(fullyManaged), 'fully managed layout should be removed').to.be.false;
  });

  it('preserves a custom QuickAction defined on a managed object', async () => {
    const root = ctx.getForceApp();
    const customOnManaged = path.join(root, 'quickActions', 'crta__Foo__c.MyAction.quickAction-meta.xml');
    const fullyManaged = path.join(root, 'quickActions', 'crta__Foo__c.crta__ManagedAction.quickAction-meta.xml');
    await writeFile(customOnManaged, '<x/>');
    await writeFile(fullyManaged, '<x/>');

    await CleanManagedItems.run(['-n', 'crta', '-f', root]);

    expect(fs.existsSync(customOnManaged), 'custom quick action on managed object should be kept').to.be.true;
    expect(fs.existsSync(fullyManaged), 'fully managed quick action should be removed').to.be.false;
  });

  it('preserves a managed Workflow file when it contains at least one local sub-item', async () => {
    const root = ctx.getForceApp();
    const workflowFile = path.join(root, 'workflows', 'crta__Foo__c.workflow-meta.xml');
    await writeFile(workflowFile, buildWorkflowXml(['crta__ManagedAlert', 'My_Custom_Alert']));

    await CleanManagedItems.run(['-n', 'crta', '-f', root]);

    expect(fs.existsSync(workflowFile), 'workflow file with a local sub-item should be preserved').to.be.true;
  });

  it('removes a managed Workflow file when every sub-item is namespaced', async () => {
    const root = ctx.getForceApp();
    const workflowFile = path.join(root, 'workflows', 'crta__Foo__c.workflow-meta.xml');
    await writeFile(workflowFile, buildWorkflowXml(['crta__AlertOne', 'crta__AlertTwo']));

    await CleanManagedItems.run(['-n', 'crta', '-f', root]);

    expect(fs.existsSync(workflowFile), 'fully managed workflow file should be removed').to.be.false;
  });

  it('removes a managed Workflow file when it has no sub-items at all', async () => {
    // metadataXmlContainsLocalItems returns false in that case, so the file is removed.
    const root = ctx.getForceApp();
    const workflowFile = path.join(root, 'workflows', 'crta__Empty__c.workflow-meta.xml');
    await writeFile(workflowFile, buildWorkflowXml([]));

    await CleanManagedItems.run(['-n', 'crta', '-f', root]);

    expect(fs.existsSync(workflowFile), 'workflow file with no sub-items should be removed').to.be.false;
  });

  it('preserves a managed SharingRules file when it contains local sub-items', async () => {
    const root = ctx.getForceApp();
    const sharingFile = path.join(root, 'sharingRules', 'crta__Foo__c.sharingRules-meta.xml');
    await writeFile(sharingFile, buildSharingRulesXml(['crta__ManagedRule', 'My_Custom_Rule']));

    await CleanManagedItems.run(['-n', 'crta', '-f', root]);

    expect(fs.existsSync(sharingFile), 'sharing rules file with a local sub-item should be preserved').to.be.true;
  });

  it('removes a managed SharingRules file when every sub-item is namespaced', async () => {
    const root = ctx.getForceApp();
    const sharingFile = path.join(root, 'sharingRules', 'crta__Foo__c.sharingRules-meta.xml');
    await writeFile(sharingFile, buildSharingRulesXml(['crta__RuleOne', 'crta__RuleTwo']));

    await CleanManagedItems.run(['-n', 'crta', '-f', root]);

    expect(fs.existsSync(sharingFile), 'fully managed sharing rules file should be removed').to.be.false;
  });

  it('preserves a managed Workflow file when its XML cannot be parsed (defensive)', async () => {
    const root = ctx.getForceApp();
    const workflowFile = path.join(root, 'workflows', 'crta__Broken__c.workflow-meta.xml');
    await writeFile(workflowFile, '<<not really xml>>');

    await CleanManagedItems.run(['-n', 'crta', '-f', root]);

    expect(fs.existsSync(workflowFile), 'unparseable workflow file should be preserved to avoid data loss').to.be.true;
  });

  it('does not affect files belonging to a different namespace', async () => {
    const root = ctx.getForceApp();
    const targetNs = path.join(root, 'classes', 'crta__SomeClass.cls');
    const otherNs = path.join(root, 'classes', 'foo__SomeClass.cls');
    await writeFile(targetNs, 'managed');
    await writeFile(otherNs, 'other-managed');

    await CleanManagedItems.run(['-n', 'crta', '-f', root]);

    expect(fs.existsSync(targetNs), 'target-namespace file should be removed').to.be.false;
    expect(fs.existsSync(otherNs), 'other-namespace file should be untouched').to.be.true;
  });

  it('removes a managed permission set because it is not compound metadata', async () => {
    // A managed file that does NOT use '-' (layouts) or '.' (quickActions) compound naming
    // is removed unconditionally, e.g. a permissionset file.
    const root = ctx.getForceApp();
    const psetFile = path.join(root, 'permissionsets', 'crta__SomePset.permissionset-meta.xml');
    await writeFile(psetFile, '<x/>');

    await CleanManagedItems.run(['-n', 'crta', '-f', root]);

    expect(fs.existsSync(psetFile), 'managed permission set should be removed').to.be.false;
  });
});
