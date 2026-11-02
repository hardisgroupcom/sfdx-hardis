import { expect } from 'chai';
import { execSync } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import fs from '../../../src/common/utils/fsUtils.js';
import {
  buildAgentPackageXmlContent,
  convertRetrievedAgentToBundle,
  findLegacyAgentEntries,
  findMissingAgentReferences,
  hasBotUserReplacementRule,
  isApiVersionAtLeast,
  listAgentsChangedSince,
  listOrgAuthoringBundleNames,
  mergeIntoPackageXml,
  readAgentBotUsers,
  removeAgentVersionEntries,
  removeLegacyAgentEntries,
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

// metadata.list answers the members of the org
function fakeConnection(orgMembers: string[]): any {
  return { metadata: { list: async () => orgMembers.map((fullName) => ({ fullName })) } };
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

  it('builds the package.xml content of a retrieve: the dependencies and the bundle of the agent, no version', () => {
    const content = buildAgentPackageXmlContent(
      [
        { type: 'AiAgentDefinitionVersion', fullName: 'My_Agent#2', state: 'Changed' },
        { type: 'AiAgentDefinition', fullName: 'My_Agent', state: 'Changed' },
        { type: 'AiAuthoringBundle', fullName: 'My_Agent_2', state: 'Changed' },
        { type: 'Flow', fullName: 'Get_Order', state: 'Created' },
        { type: 'Flow', fullName: 'Get_Order', state: 'Changed' },
        { type: 'ApexClass', fullName: 'Broken', state: 'Failed' },
      ],
      'My_Agent'
    );
    expect(content).to.deep.equal({
      Flow: ['Get_Order'],
      AiAuthoringBundle: ['My_Agent'],
    });
  });

  it('removes the definition, the versions and the version bundles of the agent from a package.xml', async () => {
    const file = path.join(tmpDir, 'package.xml');
    await fs.writeFile(
      file,
      packageXml({
        AiAgentDefinition: ['My_Agent', 'Other_Agent'],
        AiAgentDefinitionVersion: ['My_Agent#1', 'My_Agent#2', 'Other_Agent#1'],
        AiAuthoringBundle: ['My_Agent', 'My_Agent_1', 'My_Agent_2', 'My_Agent_Helper'],
        Flow: ['Get_Order'],
      }, '67.0')
    );
    expect(await removeAgentVersionEntries(file, 'my_agent')).to.deep.equal([
      'AiAgentDefinition:My_Agent',
      'AiAgentDefinitionVersion:My_Agent#1',
      'AiAgentDefinitionVersion:My_Agent#2',
      'AiAuthoringBundle:My_Agent_1',
      'AiAuthoringBundle:My_Agent_2',
    ]);
    const content = await parsePackageXmlFile(file);
    expect(content.AiAgentDefinition).to.deep.equal(['Other_Agent']);
    expect(content.AiAgentDefinitionVersion).to.deep.equal(['Other_Agent#1']);
    expect(content.AiAuthoringBundle).to.deep.equal(['My_Agent', 'My_Agent_Helper']);
    expect(await fs.readFile(file, 'utf8')).to.contain('<version>67.0</version>');
    expect(await removeAgentVersionEntries(file, 'My_Agent')).to.deep.equal([]);
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
});

describe('agentUtils sources of the deployment actions', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-sources-'));
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  async function writeBundle(bundleName: string): Promise<void> {
    const folder = path.join(tmpDir, 'force-app', 'main', 'default', 'aiAuthoringBundles', bundleName);
    await fs.ensureDir(folder);
    await fs.writeFile(path.join(folder, `${bundleName}.agent`), `config:\n    developer_name: "${bundleName}"\n`);
  }

  it('lists the agents with a bundle changed since a commit, committed or not tracked yet, without the version bundles', async () => {
    const previousCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      execSync('git init -q && git config user.email test@example.com && git config user.name test', { cwd: tmpDir });
      await writeBundle('Old_Agent');
      execSync('git add -A && git commit -q -m init', { cwd: tmpDir });
      await writeBundle('Committed_Agent');
      execSync('git add -A && git commit -q -m story', { cwd: tmpDir });
      await writeBundle('New_Agent');
      await writeBundle('New_Agent_3');
      expect(await listAgentsChangedSince('HEAD~1')).to.deep.equal(['Committed_Agent', 'New_Agent']);
    } finally {
      process.chdir(previousCwd);
    }
  });
});

describe('agentUtils.convertRetrievedAgentToBundle', () => {
  let tmpDir: string;
  let previousCwd: string;
  const base = path.join('force-app', 'main', 'default');

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-bundle-'));
    previousCwd = process.cwd();
    process.chdir(tmpDir);
    execSync('git init -q && git config user.email test@example.com && git config user.name test', { cwd: tmpDir });
  });

  afterEach(async () => {
    process.chdir(previousCwd);
    await fs.remove(tmpDir);
  });

  async function write(relativePath: string, content: string): Promise<void> {
    await fs.ensureDir(path.dirname(path.join(tmpDir, relativePath)));
    await fs.writeFile(path.join(tmpDir, relativePath), content);
  }

  // What "sf project retrieve start --root-type-with-dependencies AiAgentDefinitionVersion" writes for My_Agent#3
  async function writeRetrievedVersion(): Promise<any[]> {
    const files = [
      { type: 'AiAuthoringBundle', fullName: 'My_Agent_3', filePath: path.join(base, 'aiAuthoringBundles', 'My_Agent_3', 'My_Agent_3.agent'), content: 'config:\n    developer_name: "My_Agent"\n' },
      {
        type: 'AiAuthoringBundle',
        fullName: 'My_Agent_3',
        filePath: path.join(base, 'aiAuthoringBundles', 'My_Agent_3', 'My_Agent_3.bundle-meta.xml'),
        content: '<?xml version="1.0" encoding="UTF-8"?>\n<AiAuthoringBundle xmlns="http://soap.sforce.com/2006/04/metadata">\n    <bundleType>AGENT</bundleType>\n    <target>My_Agent.v3</target>\n</AiAuthoringBundle>\n',
      },
      { type: 'AiAgentDefinitionVersion', fullName: 'My_Agent#3', filePath: path.join(base, 'aiAgentDefinitionVersions', 'My_Agent#3', 'My_Agent#3.aiAgentDefinitionVersion-meta.xml'), content: '<AiAgentDefinitionVersion/>' },
      { type: 'AiAgentDefinitionVersion', fullName: 'My_Agent#3', filePath: path.join(base, 'aiAgentDefinitionVersions', 'My_Agent#3', 'agentGraph', 'My_Agent_v3_graph.json'), content: '{}' },
      { type: 'AiAgentDefinition', fullName: 'My_Agent', filePath: path.join(base, 'aiAgents', 'My_Agent.aiAgentDefinition-meta.xml'), content: '<AiAgentDefinition/>' },
      { type: 'Flow', fullName: 'Get_Order', filePath: path.join(base, 'flows', 'Get_Order.flow-meta.xml'), content: '<Flow/>' },
    ];
    for (const file of files) {
      await write(file.filePath, file.content);
    }
    return files.map((file) => ({ type: file.type, fullName: file.fullName, filePath: file.filePath, state: 'Created' }));
  }

  it('writes the bundle of the agent without its target, and removes the files of the version and of the definition', async () => {
    const retrieved = await writeRetrievedVersion();
    const result = await convertRetrievedAgentToBundle(retrieved, 'My_Agent', 3, tmpDir);
    expect(result?.bundleFolder).to.equal(`${base.replace(/\\/g, '/')}/aiAuthoringBundles/My_Agent`);
    expect(result?.keptFiles).to.deep.equal([]);
    const bundleFolder = path.join(tmpDir, base, 'aiAuthoringBundles', 'My_Agent');
    expect(await fs.readFile(path.join(bundleFolder, 'My_Agent.agent'), 'utf8')).to.equal('config:\n    developer_name: "My_Agent"\n');
    const meta = await fs.readFile(path.join(bundleFolder, 'My_Agent.bundle-meta.xml'), 'utf8');
    expect(meta).to.contain('<bundleType>AGENT</bundleType>').and.not.contain('<target>');
    expect(fs.existsSync(path.join(tmpDir, base, 'aiAuthoringBundles', 'My_Agent_3'))).to.equal(false);
    expect(fs.existsSync(path.join(tmpDir, base, 'aiAgentDefinitionVersions', 'My_Agent#3'))).to.equal(false);
    expect(fs.existsSync(path.join(tmpDir, base, 'aiAgents', 'My_Agent.aiAgentDefinition-meta.xml'))).to.equal(false);
    expect(fs.existsSync(path.join(tmpDir, base, 'flows', 'Get_Order.flow-meta.xml'))).to.equal(true);
  });

  it('keeps the files that git tracks with their content of git: their deletion would be a destructive change', async () => {
    const definitionFile = path.join(base, 'aiAgents', 'My_Agent.aiAgentDefinition-meta.xml');
    const versionFile = path.join(base, 'aiAgentDefinitionVersions', 'My_Agent#3', 'My_Agent#3.aiAgentDefinitionVersion-meta.xml');
    await write(definitionFile, '<AiAgentDefinition>committed</AiAgentDefinition>');
    await write(versionFile, '<AiAgentDefinitionVersion>committed</AiAgentDefinitionVersion>');
    execSync('git add -A && git commit -q -m init', { cwd: tmpDir });
    const retrieved = await writeRetrievedVersion();
    const result = await convertRetrievedAgentToBundle(retrieved, 'My_Agent', 3, tmpDir);
    const posixBase = base.replace(/\\/g, '/');
    expect(result?.keptFiles).to.deep.equal([`${posixBase}/aiAgentDefinitionVersions/My_Agent#3`, `${posixBase}/aiAgents/My_Agent.aiAgentDefinition-meta.xml`]);
    expect(result?.removedFiles).to.deep.equal([`${posixBase}/aiAgentDefinitionVersions/My_Agent#3`, `${posixBase}/aiAuthoringBundles/My_Agent_3`]);
    expect(await fs.readFile(path.join(tmpDir, definitionFile), 'utf8')).to.equal('<AiAgentDefinition>committed</AiAgentDefinition>');
    expect(await fs.readFile(path.join(tmpDir, versionFile), 'utf8')).to.equal('<AiAgentDefinitionVersion>committed</AiAgentDefinitionVersion>');
    // The retrieved file that git does not track is removed
    expect(fs.existsSync(path.join(tmpDir, base, 'aiAgentDefinitionVersions', 'My_Agent#3', 'agentGraph'))).to.equal(false);
  });

  it('returns null when the retrieve holds no bundle for the version', async () => {
    const retrieved = (await writeRetrievedVersion()).filter((file) => file.type !== 'AiAuthoringBundle');
    expect(await convertRetrievedAgentToBundle(retrieved, 'My_Agent', 3, tmpDir)).to.equal(null);
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

  it('reads the running user of the Agent Script of an agent bundle', async () => {
    const dir = path.join(tmpDir, 'force-app', 'main', 'default', 'aiAuthoringBundles', 'Bundle_Agent');
    await fs.ensureDir(dir);
    await fs.writeFile(path.join(dir, 'Bundle_Agent.agent'), 'access:\n    default_agent_user: "bundle.user@example.com"\n');
    expect(await readAgentBotUsers(['Bundle_Agent'], tmpDir)).to.deep.equal([
      { agentName: 'Bundle_Agent', botUser: 'bundle.user@example.com', file: 'force-app/main/default/aiAuthoringBundles/Bundle_Agent/Bundle_Agent.agent' },
    ]);
  });

  it('finds no rule for the running user when the built-in rule is off', async () => {
    await fs.ensureDir('config');
    await fs.writeFile(path.join('config', '.sfdx-hardis.yml'), 'replacementRules:\n  - id: builtin-agent-running-user\n    enabled: false\n');
    expect(await hasBotUserReplacementRule()).to.equal(false);
  });

  it('finds no rule for the running user when the target branch skips the replacement rules', async () => {
    await fs.ensureDir(path.join('config', 'branches'));
    await fs.writeFile(path.join('config', 'branches', '.sfdx-hardis.uat.yml'), 'skipReplacementRules: true\n');
    expect(await hasBotUserReplacementRule('uat')).to.equal(false);
  });

  it('finds the built-in rule that writes the running user', async () => {
    expect(await hasBotUserReplacementRule()).to.equal(true);
  });

  it('finds a text rule from a CI/CD variable that writes the running user', async () => {
    await fs.ensureDir('config');
    await fs.writeFile(
      path.join('config', '.sfdx-hardis.yml'),
      "replacementRules:\n  - id: builtin-agent-running-user\n    enabled: false\n  - id: agent-user\n    type: text\n    files: '**/aiAgents/*.aiAgentDefinition-meta.xml'\n    find: '(?<=<botUser>)[^<]+(?=</botUser>)'\n    regex: true\n    secret: AGENT_RUNNING_USER\n"
    );
    expect(await hasBotUserReplacementRule()).to.equal(true);
  });
});

describe('agentUtils agents in the format before API 68.0', () => {
  let tmpDir: string;
  let previousCwd: string;
  let previousEnvVersion: string | undefined;

  async function writeBot(botName: string, agent: boolean): Promise<void> {
    const dir = path.join(tmpDir, 'force-app', 'main', 'default', 'bots', botName);
    await fs.ensureDir(dir);
    await fs.writeFile(
      path.join(dir, `${botName}.bot-meta.xml`),
      agent ? '<Bot><agentType>EinsteinServiceAgent</agentType><type>ExternalCopilot</type></Bot>' : '<Bot><type>Bot</type></Bot>'
    );
  }

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-legacy-'));
    previousCwd = process.cwd();
    previousEnvVersion = process.env.SF_ORG_API_VERSION;
    process.chdir(tmpDir);
    await writeBot('Old_Agent', true);
    await writeBot('Classic_Bot', false);
    await fs.ensureDir(path.join(tmpDir, 'force-app', 'main', 'default', 'genAiPlannerBundles', 'Old_Agent_v2'));
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

  it('finds the planner bundles, and the bots of agents but not the classic bots', async () => {
    const file = path.join(tmpDir, 'package.xml');
    await fs.writeFile(
      file,
      packageXml({ Bot: ['Old_Agent', 'Classic_Bot'], BotVersion: ['Old_Agent.v2', 'Classic_Bot.v1'], GenAiPlannerBundle: ['Old_Agent_v2'], AiAgentDefinition: ['New_Agent'] })
    );
    expect((await findLegacyAgentEntries(file, tmpDir)).map((entry) => `${entry.type}:${entry.member}:${entry.agentName}`)).to.deep.equal([
      'GenAiPlannerBundle:Old_Agent_v2:Old_Agent',
      'Bot:Old_Agent:Old_Agent',
      'BotVersion:Old_Agent.v2:Old_Agent',
    ]);
  });

  it('removes the old entries of an agent, keeps the package.xml version and lists the old folders', async () => {
    const file = path.join(tmpDir, 'package.xml');
    await fs.writeFile(file, packageXml({ Bot: ['Old_Agent', 'Classic_Bot'], GenAiPlannerBundle: ['Old_Agent_v2'], AiAgentDefinition: ['Old_Agent'] }, '68.0'));
    const entries = await findLegacyAgentEntries(file, tmpDir);
    const folders = await removeLegacyAgentEntries(file, entries, tmpDir);
    const content = await parsePackageXmlFile(file);
    expect(content.Bot).to.deep.equal(['Classic_Bot']);
    expect(content.GenAiPlannerBundle).to.equal(undefined);
    expect(content.AiAgentDefinition).to.deep.equal(['Old_Agent']);
    expect(await fs.readFile(file, 'utf8')).to.contain('<version>68.0</version>');
    expect(folders).to.deep.equal(['force-app/main/default/bots/Old_Agent', 'force-app/main/default/genAiPlannerBundles/Old_Agent_v2']);
  });

  it('keeps the package.xml version when components are merged', async () => {
    const file = path.join(tmpDir, 'package.xml');
    await fs.writeFile(file, packageXml({ ApexClass: ['MyClass'] }, '66.0'));
    await mergeIntoPackageXml(file, { AiAgentDefinition: ['New_Agent'] });
    expect(await fs.readFile(file, 'utf8')).to.contain('<version>66.0</version>');
  });
});

describe('agentUtils.listOrgAuthoringBundleNames', () => {
  it('lists the authoring bundles of the org, sorted', async () => {
    expect(await listOrgAuthoringBundleNames(fakeConnection(['b_1', 'a_2']))).to.deep.equal(['a_2', 'b_1']);
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
