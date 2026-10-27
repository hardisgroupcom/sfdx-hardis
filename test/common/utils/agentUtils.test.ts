import { expect } from 'chai';
import * as os from 'os';
import * as path from 'path';
import fs from '../../../src/common/utils/fsUtils.js';
import {
  applyAgentDeploymentGuard,
  buildAgentPackageXmlContent,
  findMissingAgentReferences,
  getAgentNamesFromPackageXml,
  isApiVersionAtLeast,
  mergeIntoPackageXml,
  parseAgentVersionFullName,
  resolveAgentVersion,
} from '../../../src/common/utils/agentUtils.js';
import { parsePackageXmlFile } from '../../../src/common/utils/xmlUtils.js';

function packageXml(types: Record<string, string[]>): string {
  const typesXml = Object.keys(types)
    .map((type) => `  <types>\n${types[type].map((member) => `    <members>${member}</members>`).join('\n')}\n    <name>${type}</name>\n  </types>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Package xmlns="http://soap.sforce.com/2006/04/metadata">\n${typesXml}\n  <version>68.0</version>\n</Package>\n`;
}

function fakeConnection(options: { apiVersion: string; orgAgents?: string[] }): any {
  return {
    getApiVersion: () => options.apiVersion,
    getUsername: () => 'admin@example.com',
    metadata: {
      list: async () => {
        if (!options.orgAgents) {
          throw new Error('must not be called');
        }
        return options.orgAgents.map((fullName) => ({ fullName }));
      },
    },
  };
}

describe('agentUtils versions', () => {
  it('compares API versions', () => {
    expect(isApiVersionAtLeast('68.0')).to.equal(true);
    expect(isApiVersionAtLeast('67.0')).to.equal(false);
    expect(isApiVersionAtLeast(undefined)).to.equal(false);
  });

  it('parses agent version full names', () => {
    expect(parseAgentVersionFullName('My_Agent#12')).to.deep.equal({ agentName: 'My_Agent', version: 12 });
    expect(parseAgentVersionFullName('My_Agent')).to.equal(null);
  });

  it('resolves latest, a number, and a missing version', () => {
    const versions = [
      { agentName: 'A', version: 1, status: 'Inactive' },
      { agentName: 'A', version: 3, status: '' },
      { agentName: 'B', version: 7, status: 'Active' },
    ];
    expect(resolveAgentVersion(versions, 'a', 'latest')?.version).to.equal(3);
    expect(resolveAgentVersion(versions, 'A', undefined)?.version).to.equal(3);
    expect(resolveAgentVersion(versions, 'A', '1')?.version).to.equal(1);
    expect(resolveAgentVersion(versions, 'A', '2')).to.equal(null);
    expect(resolveAgentVersion(versions, 'C', 'latest')).to.equal(null);
  });
});

describe('agentUtils package.xml', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-utils-'));
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  it('builds the package.xml content of a retrieve, always with the whole agent definition', () => {
    const content = buildAgentPackageXmlContent(
      [
        { type: 'AiAgentDefinitionVersion', fullName: 'My_Agent#2', state: 'Changed' },
        { type: 'Flow', fullName: 'Get_Order', state: 'Created' },
        { type: 'Flow', fullName: 'Get_Order', state: 'Changed' },
        { type: 'ApexClass', fullName: 'Broken', state: 'Failed' },
      ],
      'My_Agent'
    );
    expect(content).to.deep.equal({
      AiAgentDefinitionVersion: ['My_Agent#2'],
      Flow: ['Get_Order'],
      AiAgentDefinition: ['My_Agent'],
    });
  });

  it('merges into a package.xml, keeps wildcards, and returns what was added', async () => {
    const file = path.join(tmpDir, 'package.xml');
    await fs.writeFile(file, packageXml({ ApexClass: ['*'], Flow: ['Existing'] }));
    const added = await mergeIntoPackageXml(file, { ApexClass: ['NewClass'], Flow: ['Existing', 'Get_Order'], AiAgentDefinition: ['My_Agent'] });
    expect(added).to.deep.equal([
      { type: 'Flow', member: 'Get_Order' },
      { type: 'AiAgentDefinition', member: 'My_Agent' },
    ]);
    const merged = await parsePackageXmlFile(file);
    expect(merged.ApexClass).to.deep.equal(['*']);
    expect(merged.Flow).to.deep.equal(['Existing', 'Get_Order']);
    expect(merged.AiAgentDefinition).to.deep.equal(['My_Agent']);
  });

  it('finds the agents deployed as a version only', async () => {
    const file = path.join(tmpDir, 'package.xml');
    await fs.writeFile(file, packageXml({ AiAgentDefinition: ['Full_Agent'], AiAgentDefinitionVersion: ['Full_Agent#2', 'Delta_Agent#4'] }));
    expect(await getAgentNamesFromPackageXml(file)).to.deep.equal({ definitions: ['Full_Agent'], versionOnly: ['Delta_Agent'] });
  });
});

describe('agentUtils.applyAgentDeploymentGuard', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-guard-'));
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  it('does nothing when the package holds no agent', async () => {
    const file = path.join(tmpDir, 'package.xml');
    await fs.writeFile(file, packageXml({ ApexClass: ['A'] }));
    expect(await applyAgentDeploymentGuard(file, fakeConnection({ apiVersion: '60.0' }), null)).to.equal(file);
  });

  it('stops when the target org is below API 68.0', async () => {
    const file = path.join(tmpDir, 'package.xml');
    await fs.writeFile(file, packageXml({ AiAgentDefinitionVersion: ['My_Agent#2'] }));
    let error: any = null;
    try {
      await applyAgentDeploymentGuard(file, fakeConnection({ apiVersion: '67.0' }), null);
    } catch (e) {
      error = e;
    }
    expect(error).to.not.equal(null);
  });

  it('adds the definition of a new agent to a copy, and leaves the project file alone', async () => {
    const file = path.join(tmpDir, 'package.xml');
    await fs.writeFile(file, packageXml({ AiAgentDefinitionVersion: ['New_Agent#1', 'Known_Agent#5'] }));
    const guarded = await applyAgentDeploymentGuard(file, fakeConnection({ apiVersion: '68.0', orgAgents: ['Known_Agent'] }), null);
    expect(guarded).to.not.equal(file);
    expect((await parsePackageXmlFile(guarded)).AiAgentDefinition).to.deep.equal(['New_Agent']);
    expect((await parsePackageXmlFile(file)).AiAgentDefinition).to.equal(undefined);
  });

  it('keeps the package when every agent already exists in the target org', async () => {
    const file = path.join(tmpDir, 'package.xml');
    await fs.writeFile(file, packageXml({ AiAgentDefinitionVersion: ['Known_Agent#5'] }));
    expect(await applyAgentDeploymentGuard(file, fakeConnection({ apiVersion: '68.0', orgAgents: ['known_agent'] }), null)).to.equal(file);
  });
});

describe('agentUtils.findMissingAgentReferences', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-refs-'));
    const objectDir = path.join(tmpDir, 'force-app', 'main', 'default', 'objects', 'Order__c');
    await fs.ensureDir(path.join(objectDir, 'fields'));
    await fs.writeFile(path.join(objectDir, 'Order__c.object-meta.xml'), '<CustomObject/>');
    await fs.writeFile(path.join(objectDir, 'fields', 'Status__c.field-meta.xml'), '<CustomField/>');
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  it('lists the custom objects, fields and Data 360 objects the project does not hold', async () => {
    const agentFile = path.join(tmpDir, 'force-app', 'main', 'default', 'aiAgentDefinitionVersions', 'My_Agent_2.xml');
    await fs.ensureDir(path.dirname(agentFile));
    await fs.writeFile(
      agentFile,
      '<x>Order__c.Status__c Order__c.Amount__c Invoice__c Customer_Profile__dlm Order__c</x>'
    );
    const missing = await findMissingAgentReferences([agentFile], tmpDir);
    expect(missing.map((reference) => `${reference.type}:${reference.name}`)).to.deep.equal([
      'CustomField:Order__c.Amount__c',
      'CustomObject:Customer_Profile__dlm',
      'CustomObject:Invoice__c',
    ]);
    expect(missing[0].referencedBy).to.equal('force-app/main/default/aiAgentDefinitionVersions/My_Agent_2.xml');
  });
});
