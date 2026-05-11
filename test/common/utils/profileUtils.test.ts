import { expect } from 'chai';
import fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import { minimizeProfile } from '../../../src/common/utils/profileUtils.js';

describe('profileUtils.minimizeProfile', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `sfdx-hardis-profileutils-${Date.now()}`);
    await fs.ensureDir(tmpDir);
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  async function writeProfile(fileName: string, bodySections: string): Promise<string> {
    const xml =
      `<?xml version="1.0" encoding="UTF-8"?>\n` +
      `<Profile xmlns="http://soap.sforce.com/2006/04/metadata">\n` +
      `${bodySections}\n` +
      `</Profile>`;
    const filePath = path.join(tmpDir, fileName);
    await fs.writeFile(filePath, xml, 'utf8');
    return filePath;
  }

  // ===== New nodes added in the bugfix =====

  it('removes agentAccesses (new node added in bugfix)', async () => {
    const profileFile = await writeProfile(
      'Test.profile-meta.xml',
      `    <agentAccesses>\n        <agentDefinition>MyAgent</agentDefinition>\n        <enabled>true</enabled>\n    </agentAccesses>`
    );
    const result = await minimizeProfile(profileFile);
    expect(result.removed).to.include('agentAccesses');
    expect(result.updated).to.be.true;
  });

  it('removes customPermissions (new node added in bugfix)', async () => {
    const profileFile = await writeProfile(
      'Test.profile-meta.xml',
      `    <customPermissions>\n        <enabled>true</enabled>\n        <name>MyPermission</name>\n    </customPermissions>`
    );
    const result = await minimizeProfile(profileFile);
    expect(result.removed).to.include('customPermissions');
    expect(result.updated).to.be.true;
  });

  it('removes flowAccesses (new node added in bugfix)', async () => {
    const profileFile = await writeProfile(
      'Test.profile-meta.xml',
      `    <flowAccesses>\n        <enabled>true</enabled>\n        <flow>MyFlow</flow>\n    </flowAccesses>`
    );
    const result = await minimizeProfile(profileFile);
    expect(result.removed).to.include('flowAccesses');
    expect(result.updated).to.be.true;
  });

  it('removes ServicePresenceStatusAccesses (new node added in bugfix)', async () => {
    const profileFile = await writeProfile(
      'Test.profile-meta.xml',
      `    <ServicePresenceStatusAccesses>\n        <enabled>true</enabled>\n        <servicePresenceStatus>MyStatus</servicePresenceStatus>\n    </ServicePresenceStatusAccesses>`
    );
    const result = await minimizeProfile(profileFile);
    expect(result.removed).to.include('ServicePresenceStatusAccesses');
    expect(result.updated).to.be.true;
  });

  // ===== Off-by-one bug fix: updated when removed.length === 1 =====

  it('marks profile as updated when exactly one section is removed (off-by-one fix)', async () => {
    // Before fix: removed.length > 1  => 1 > 1 = false => not written (bug)
    // After fix:  removed.length >= 1 => 1 >= 1 = true => written (correct)
    const profileFile = await writeProfile(
      'Test.profile-meta.xml',
      `    <classAccesses>\n        <apexClass>MyClass</apexClass>\n        <enabled>true</enabled>\n    </classAccesses>`
    );
    const result = await minimizeProfile(profileFile);
    expect(result.removed).to.deep.equal(['classAccesses']);
    expect(result.updated).to.be.true;
  });

  it('does not mark profile as updated when nothing is removed or changed', async () => {
    // layoutAssignments is not in the remove list or the defaults-filter list
    const profileFile = await writeProfile(
      'Test.profile-meta.xml',
      `    <layoutAssignments>\n        <layout>Account-Account Layout</layout>\n        <recordType>Account.Standard</recordType>\n    </layoutAssignments>`
    );
    const result = await minimizeProfile(profileFile);
    expect(result.removed).to.be.empty;
    expect(result.updated).to.be.false;
  });

  // ===== Regression: pre-existing nodes in nodesToRemoveDefault =====

  it('removes classAccesses (pre-existing node)', async () => {
    const profileFile = await writeProfile(
      'Test.profile-meta.xml',
      `    <classAccesses>\n        <apexClass>MyClass</apexClass>\n        <enabled>true</enabled>\n    </classAccesses>`
    );
    const result = await minimizeProfile(profileFile);
    expect(result.removed).to.include('classAccesses');
  });

  it('removes fieldPermissions (pre-existing node)', async () => {
    const profileFile = await writeProfile(
      'Test.profile-meta.xml',
      `    <fieldPermissions>\n        <editable>true</editable>\n        <field>Account.Name</field>\n        <readable>true</readable>\n    </fieldPermissions>`
    );
    const result = await minimizeProfile(profileFile);
    expect(result.removed).to.include('fieldPermissions');
  });

  it('removes objectPermissions (pre-existing node)', async () => {
    const profileFile = await writeProfile(
      'Test.profile-meta.xml',
      `    <objectPermissions>\n        <allowCreate>true</allowCreate>\n        <object>Account</object>\n    </objectPermissions>`
    );
    const result = await minimizeProfile(profileFile);
    expect(result.removed).to.include('objectPermissions');
  });

  // ===== Multiple sections removed at once =====

  it('removes multiple new and existing sections and reports all in removed list', async () => {
    const profileFile = await writeProfile(
      'Test.profile-meta.xml',
      [
        `    <agentAccesses>\n        <agentDefinition>MyAgent</agentDefinition>\n        <enabled>true</enabled>\n    </agentAccesses>`,
        `    <classAccesses>\n        <apexClass>MyClass</apexClass>\n        <enabled>true</enabled>\n    </classAccesses>`,
        `    <customPermissions>\n        <enabled>true</enabled>\n        <name>MyPerm</name>\n    </customPermissions>`,
        `    <flowAccesses>\n        <enabled>true</enabled>\n        <flow>MyFlow</flow>\n    </flowAccesses>`,
      ].join('\n')
    );
    const result = await minimizeProfile(profileFile);
    expect(result.removed).to.include('agentAccesses');
    expect(result.removed).to.include('classAccesses');
    expect(result.removed).to.include('customPermissions');
    expect(result.removed).to.include('flowAccesses');
    expect(result.updated).to.be.true;
  });
});
