import { expect } from 'chai';
import * as os from 'os';
import * as path from 'path';
import fs from '../../../src/common/utils/fsUtils.js';
import {
  applyAgentDeploymentGuard,
  buildAgentAutoActivateCommands,
  buildAgentPackageXmlContent,
  findMissingAgentReferences,
  getAgentNamesFromPackageXml,
  isApiVersionAtLeast,
  listOrgAuthoringBundleNames,
  mergeIntoPackageXml,
  readAgentBotUsers,
  parseAgentVersionFullName,
  resolveAgentVersion,
} from '../../../src/common/utils/agentUtils.js';
import { parsePackageXmlFile } from '../../../src/common/utils/xmlUtils.js';

function packageXml(types: Record<string, string[]>, version = '68.0'): string {
  const typesXml = Object.keys(types)
    .map((type) => `  <types>\n${types[type].map((member) => `    <members>${member}</members>`).join('\n')}\n    <name>${type}</name>\n  </types>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Package xmlns="http://soap.sforce.com/2006/04/metadata">\n${typesXml}\n  <version>${version}</version>\n</Package>\n`;
}

// Collects what uxLog writes, as the ux of a command would
function fakeCommand(): { ux: { log: (text: string) => void }; logs: string[] } {
  const logs: string[] = [];
  return { ux: { log: (text: string) => logs.push(text) }, logs };
}

// metadata.list answers by type, query answers BotVersion statuses and User lookups
function fakeConnection(options: {
  apiVersion: string;
  orgAgents?: string[];
  orgVersions?: Array<{ fullName: string; status: string }>;
  orgUsers?: string[];
}): any {
  return {
    getApiVersion: () => options.apiVersion,
    getUsername: () => 'admin@example.com',
    query: async (soql: string) => {
      if (soql.includes('FROM BotVersion')) {
        return {
          done: true,
          records: (options.orgVersions || []).map((version) => {
            const [name, number] = version.fullName.split('#');
            return { BotDefinition: { DeveloperName: name }, VersionNumber: Number(number), Status: version.status };
          }),
        };
      }
      return { done: true, records: (options.orgUsers || []).map((username) => ({ Username: username })) };
    },
    metadata: {
      list: async (queries: Array<{ type: string }>) => {
        if (queries[0]?.type === 'AiAgentDefinitionVersion') {
          return (options.orgVersions || []).map((version) => ({ fullName: version.fullName }));
        }
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

describe('agentUtils.applyAgentDeploymentGuard versions already in the org', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-versions-'));
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  it('leaves out the versions the target org has, active or not, in a copy that keeps the package.xml version', async () => {
    const file = path.join(tmpDir, 'package.xml');
    await fs.writeFile(
      file,
      packageXml({ AiAgentDefinition: ['My_Agent'], AiAgentDefinitionVersion: ['My_Agent#1', 'My_Agent#2', 'My_Agent#3'], AiAuthoringBundle: ['My_Agent_3'] })
    );
    const conn = fakeConnection({
      apiVersion: '68.0',
      orgVersions: [
        { fullName: 'My_Agent#1', status: 'Inactive' },
        { fullName: 'My_Agent#2', status: 'Active' },
      ],
    });
    const command = fakeCommand();
    const guarded = await applyAgentDeploymentGuard(file, conn, command);
    expect(guarded).to.not.equal(file);
    const guardedContent = await parsePackageXmlFile(guarded);
    expect(guardedContent.AiAgentDefinitionVersion).to.deep.equal(['My_Agent#3']);
    expect(guardedContent.AiAuthoringBundle).to.deep.equal(['My_Agent_3']);
    expect(await fs.readFile(guarded, 'utf8')).to.contain('<version>68.0</version>');
    expect((await parsePackageXmlFile(file)).AiAgentDefinitionVersion).to.have.length(3);
    expect(command.logs.join('\n')).to.contain('My_Agent#1').and.contain('My_Agent#2');
  });

  it('removes the version type when the org has every deployed version', async () => {
    const file = path.join(tmpDir, 'package.xml');
    await fs.writeFile(file, packageXml({ AiAgentDefinition: ['My_Agent'], AiAgentDefinitionVersion: ['My_Agent#1'] }));
    const conn = fakeConnection({ apiVersion: '68.0', orgVersions: [{ fullName: 'My_Agent#1', status: 'Active' }] });
    const guarded = await applyAgentDeploymentGuard(file, conn, null);
    const guardedContent = await parsePackageXmlFile(guarded);
    expect(guardedContent.AiAgentDefinitionVersion).to.equal(undefined);
    expect(guardedContent.AiAgentDefinition).to.deep.equal(['My_Agent']);
  });

  it('adds the definition of a new agent and keeps its new version', async () => {
    const file = path.join(tmpDir, 'package.xml');
    await fs.writeFile(file, packageXml({ AiAgentDefinitionVersion: ['New_Agent#1'] }));
    const guarded = await applyAgentDeploymentGuard(file, fakeConnection({ apiVersion: '68.0', orgAgents: [], orgVersions: [] }), null);
    const guardedContent = await parsePackageXmlFile(guarded);
    expect(guardedContent.AiAgentDefinition).to.deep.equal(['New_Agent']);
    expect(guardedContent.AiAgentDefinitionVersion).to.deep.equal(['New_Agent#1']);
  });
});

describe('agentUtils deployment API version warning', () => {
  let tmpDir: string;
  let previousCwd: string;
  let previousEnvVersion: string | undefined;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-api-'));
    previousCwd = process.cwd();
    previousEnvVersion = process.env.SF_ORG_API_VERSION;
    // The org version, without reading the sf config of the machine
    process.env.SF_ORG_API_VERSION = '68.0';
    process.chdir(tmpDir);
  });

  afterEach(async () => {
    process.chdir(previousCwd);
    if (previousEnvVersion === undefined) {
      delete process.env.SF_ORG_API_VERSION;
    } else {
      process.env.SF_ORG_API_VERSION = previousEnvVersion;
    }
    await fs.remove(tmpDir);
  });

  it('warns when sourceApiVersion is below 68.0, and still deploys', async () => {
    await fs.writeFile('sfdx-project.json', JSON.stringify({ sourceApiVersion: '64.0' }));
    const file = path.join(tmpDir, 'package.xml');
    await fs.writeFile(file, packageXml({ AiAgentDefinition: ['My_Agent'], AiAgentDefinitionVersion: ['My_Agent#2'] }));
    const command = fakeCommand();
    expect(await applyAgentDeploymentGuard(file, fakeConnection({ apiVersion: '68.0' }), command)).to.equal(file);
    expect(command.logs.join('\n')).to.contain('API 64.0');
  });

  it('warns when the package.xml version is below 68.0', async () => {
    await fs.writeFile('sfdx-project.json', JSON.stringify({ sourceApiVersion: '68.0' }));
    const file = path.join(tmpDir, 'package.xml');
    await fs.writeFile(file, packageXml({ AiAgentDefinition: ['My_Agent'] }, '66.0'));
    const command = fakeCommand();
    await applyAgentDeploymentGuard(file, fakeConnection({ apiVersion: '68.0' }), command);
    expect(command.logs.join('\n')).to.contain('66.0');
  });

  it('does not warn when the project is on 68.0', async () => {
    await fs.writeFile('sfdx-project.json', JSON.stringify({ sourceApiVersion: '68.0' }));
    const file = path.join(tmpDir, 'package.xml');
    await fs.writeFile(file, packageXml({ AiAgentDefinition: ['My_Agent'] }));
    const command = fakeCommand();
    await applyAgentDeploymentGuard(file, fakeConnection({ apiVersion: '68.0' }), command);
    expect(command.logs).to.deep.equal([]);
  });

  it('does not warn when the deployment holds no agent', async () => {
    await fs.writeFile('sfdx-project.json', JSON.stringify({ sourceApiVersion: '64.0' }));
    const file = path.join(tmpDir, 'package.xml');
    await fs.writeFile(file, packageXml({ ApexClass: ['MyClass'] }, '64.0'));
    const command = fakeCommand();
    await applyAgentDeploymentGuard(file, fakeConnection({ apiVersion: '64.0' }), command);
    expect(command.logs).to.deep.equal([]);
  });
});

describe('agentUtils botUser', () => {
  let tmpDir: string;
  let previousCwd: string;
  let previousEnvVersion: string | undefined;

  async function writeAgent(agentName: string, botUser: string | null): Promise<void> {
    const dir = path.join(tmpDir, 'force-app', 'main', 'default', 'aiAgents');
    await fs.ensureDir(dir);
    await fs.writeFile(
      path.join(dir, `${agentName}.aiAgentDefinition-meta.xml`),
      `<AiAgentDefinition>${botUser ? `<botUser>${botUser}</botUser>` : ''}<type>ExternalCopilot</type></AiAgentDefinition>`
    );
  }

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-user-'));
    previousCwd = process.cwd();
    previousEnvVersion = process.env.SF_ORG_API_VERSION;
    process.env.SF_ORG_API_VERSION = '68.0';
    process.chdir(tmpDir);
    await fs.writeFile('sfdx-project.json', JSON.stringify({ sourceApiVersion: '68.0' }));
  });

  afterEach(async () => {
    process.chdir(previousCwd);
    if (previousEnvVersion === undefined) {
      delete process.env.SF_ORG_API_VERSION;
    } else {
      process.env.SF_ORG_API_VERSION = previousEnvVersion;
    }
    await fs.remove(tmpDir);
  });

  it('reads the running user of the requested agents only', async () => {
    await writeAgent('Service_Agent', 'agent.user@example.com');
    await writeAgent('Employee_Agent', null);
    await writeAgent('Other_Agent', 'other@example.com');
    expect(await readAgentBotUsers(['service_agent', 'Employee_Agent'], tmpDir)).to.deep.equal([
      { agentName: 'Service_Agent', botUser: 'agent.user@example.com', file: 'force-app/main/default/aiAgents/Service_Agent.aiAgentDefinition-meta.xml' },
    ]);
  });

  it('warns when the target org does not have the running user and the built-in rule is off', async () => {
    await writeAgent('Service_Agent', 'agent.user@example.com');
    await fs.ensureDir('config');
    await fs.writeFile(path.join('config', '.sfdx-hardis.yml'), 'replacementRules:\n  - id: builtin-agent-running-user\n    enabled: false\n');
    const file = path.join(tmpDir, 'package.xml');
    await fs.writeFile(file, packageXml({ AiAgentDefinition: ['Service_Agent'] }));
    const command = fakeCommand();
    await applyAgentDeploymentGuard(file, fakeConnection({ apiVersion: '68.0', orgUsers: [] }), command);
    expect(command.logs.join('\n')).to.contain('agent.user@example.com');
  });

  it('does not warn when the built-in rule writes the running user', async () => {
    await writeAgent('Service_Agent', 'agent.user@example.com');
    const file = path.join(tmpDir, 'package.xml');
    await fs.writeFile(file, packageXml({ AiAgentDefinition: ['Service_Agent'] }));
    const command = fakeCommand();
    await applyAgentDeploymentGuard(file, fakeConnection({ apiVersion: '68.0', orgUsers: [] }), command);
    expect(command.logs).to.deep.equal([]);
  });

  it('does not warn when the target org has the running user', async () => {
    await writeAgent('Service_Agent', 'agent.user@example.com');
    await fs.ensureDir('config');
    await fs.writeFile(path.join('config', '.sfdx-hardis.yml'), 'replacementRules:\n  - id: builtin-agent-running-user\n    enabled: false\n');
    const file = path.join(tmpDir, 'package.xml');
    await fs.writeFile(file, packageXml({ AiAgentDefinition: ['Service_Agent'] }));
    const command = fakeCommand();
    await applyAgentDeploymentGuard(file, fakeConnection({ apiVersion: '68.0', orgUsers: ['Agent.User@example.com'] }), command);
    expect(command.logs).to.deep.equal([]);
  });

  it('does not warn when a text rule from a CI/CD variable writes the running user', async () => {
    await writeAgent('Service_Agent', 'agent.user@example.com');
    await fs.ensureDir('config');
    await fs.writeFile(
      path.join('config', '.sfdx-hardis.yml'),
      "replacementRules:\n  - id: agent-user\n    type: text\n    files: '**/aiAgents/*.aiAgentDefinition-meta.xml'\n    find: '(?<=<botUser>)[^<]+(?=</botUser>)'\n    regex: true\n    secret: AGENT_RUNNING_USER\n"
    );
    const file = path.join(tmpDir, 'package.xml');
    await fs.writeFile(file, packageXml({ AiAgentDefinition: ['Service_Agent'] }));
    const command = fakeCommand();
    await applyAgentDeploymentGuard(file, fakeConnection({ apiVersion: '68.0', orgUsers: [] }), command);
    expect(command.logs).to.deep.equal([]);
  });

  it('warns when the target org has agent versions the project does not have', async () => {
    const versionDir = path.join(tmpDir, 'force-app', 'main', 'default', 'aiAgentDefinitionVersions', 'Service_Agent#1');
    await fs.ensureDir(versionDir);
    await fs.writeFile(path.join(versionDir, 'Service_Agent#1.aiAgentDefinitionVersion-meta.xml'), '<AiAgentDefinitionVersion/>');
    const file = path.join(tmpDir, 'package.xml');
    await fs.writeFile(file, packageXml({ AiAgentDefinition: ['Service_Agent'], AiAgentDefinitionVersion: ['Service_Agent#1'] }));
    const conn = fakeConnection({
      apiVersion: '68.0',
      orgVersions: [
        { fullName: 'Service_Agent#1', status: 'Inactive' },
        { fullName: 'Service_Agent#3', status: 'Inactive' },
        { fullName: 'Service_Agent#2', status: 'Active' },
        { fullName: 'Other_Agent#4', status: 'Active' },
      ],
    });
    const command = fakeCommand();
    await applyAgentDeploymentGuard(file, conn, command);
    const logs = command.logs.join('\n');
    expect(logs).to.contain('(2, 3)');
    expect(logs).to.not.contain('Other_Agent');
  });

  it('does not warn about the versions of the project', async () => {
    const versionDir = path.join(tmpDir, 'force-app', 'main', 'default', 'aiAgentDefinitionVersions', 'Service_Agent#1');
    await fs.ensureDir(versionDir);
    await fs.writeFile(path.join(versionDir, 'Service_Agent#1.aiAgentDefinitionVersion-meta.xml'), '<AiAgentDefinitionVersion/>');
    const file = path.join(tmpDir, 'package.xml');
    await fs.writeFile(file, packageXml({ AiAgentDefinition: ['Service_Agent'] }));
    const command = fakeCommand();
    await applyAgentDeploymentGuard(file, fakeConnection({ apiVersion: '68.0', orgVersions: [{ fullName: 'Service_Agent#1', status: 'Active' }] }), command);
    expect(command.logs).to.deep.equal([]);
  });

  it('does not warn when a branch replacement rule writes the running user', async () => {
    await writeAgent('Service_Agent', 'agent.user@example.com');
    await fs.ensureDir(path.join('config', 'branches'));
    await fs.writeFile(
      path.join('config', 'branches', '.sfdx-hardis.uat.yml'),
      'replacementRules:\n  - id: agent-user\n    type: xml-value\n    files: "**/aiAgents/*.aiAgentDefinition-meta.xml"\n    xmlPath: AiAgentDefinition/botUser\n    value: agent@uat.example.com\n'
    );
    const file = path.join(tmpDir, 'package.xml');
    await fs.writeFile(file, packageXml({ AiAgentDefinition: ['Service_Agent'] }));
    const command = fakeCommand();
    await applyAgentDeploymentGuard(file, fakeConnection({ apiVersion: '68.0', orgUsers: [] }), command);
    expect(command.logs).to.deep.equal([]);
  });
});

describe('agentUtils.buildAgentAutoActivateCommands', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-activate-'));
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  it('activates the highest deployed version of each agent', async () => {
    const file = path.join(tmpDir, 'package.xml');
    await fs.writeFile(file, packageXml({ AiAgentDefinition: ['B_Agent', 'A_Agent'], AiAgentDefinitionVersion: ['B_Agent#1', 'B_Agent#3', 'A_Agent#2'] }));
    const commands = await buildAgentAutoActivateCommands(file);
    expect(commands.map((cmd) => [cmd.id, cmd.type, cmd.parameters.agentName, cmd.parameters.agentVersion, cmd.context, cmd.preOrPost])).to.deep.equal([
      ['AGENT_ACTIVATE_A_Agent', 'agent-activate', 'A_Agent', '2', 'process-deployment-only', 'commandsPostDeploy'],
      ['AGENT_ACTIVATE_B_Agent', 'agent-activate', 'B_Agent', '3', 'process-deployment-only', 'commandsPostDeploy'],
    ]);
  });

  it('activates the latest version of the agents of a wildcard', async () => {
    const file = path.join(tmpDir, 'package.xml');
    await fs.writeFile(file, packageXml({ AiAgentDefinition: ['My_Agent', '*'], AiAgentDefinitionVersion: ['*'] }));
    const commands = await buildAgentAutoActivateCommands(file);
    expect(commands.map((cmd) => `${cmd.parameters.agentName}:${cmd.parameters.agentVersion}`)).to.deep.equal(['My_Agent:latest']);
  });

  it('activates nothing when only the agent definition or an authoring bundle is deployed', async () => {
    const file = path.join(tmpDir, 'package.xml');
    await fs.writeFile(file, packageXml({ AiAgentDefinition: ['My_Agent'], AiAuthoringBundle: ['My_Agent_1'] }));
    expect(await buildAgentAutoActivateCommands(file)).to.deep.equal([]);
    expect(await buildAgentAutoActivateCommands(path.join(tmpDir, 'missing.xml'))).to.deep.equal([]);
  });
});

describe('agentUtils.listOrgAuthoringBundleNames', () => {
  it('lists the authoring bundles of the org, sorted', async () => {
    expect(await listOrgAuthoringBundleNames(fakeConnection({ apiVersion: '68.0', orgAgents: ['b_1', 'a_2'] }))).to.deep.equal(['a_2', 'b_1']);
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
