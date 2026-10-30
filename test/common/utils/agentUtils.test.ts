import { expect } from 'chai';
import { execSync } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import fs from '../../../src/common/utils/fsUtils.js';
import {
  buildAgentPackageXmlContent,
  checkAgentDeployment,
  ensureAgentVersionsInPackageNoOverwrite,
  findLegacyAgentEntries,
  findMissingAgentReferences,
  getAgentNamesFromPackageXml,
  isApiVersionAtLeast,
  listAgentsChangedSince,
  listLocalAgentLatestVersions,
  listOrgAuthoringBundleNames,
  mergeIntoPackageXml,
  readAgentBotUsers,
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

describe('agentUtils.checkAgentDeployment', () => {
  let tmpDir: string;
  let previousCwd: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-guard-'));
    previousCwd = process.cwd();
    process.chdir(tmpDir);
    // The package-no-overwrite.xml lookup reads the branch config
    execSync('git init -q', { cwd: tmpDir });
  });

  afterEach(async () => {
    process.chdir(previousCwd);
    await fs.remove(tmpDir);
  });

  it('does nothing when the package holds no agent', async () => {
    const file = path.join(tmpDir, 'package.xml');
    await fs.writeFile(file, packageXml({ ApexClass: ['A'] }));
    await checkAgentDeployment(file, fakeConnection({ apiVersion: '60.0' }), null);
  });

  it('stops when the target org is below API 68.0', async () => {
    const file = path.join(tmpDir, 'package.xml');
    await fs.writeFile(file, packageXml({ AiAgentDefinitionVersion: ['My_Agent#2'] }));
    expect(await checkError(file, fakeConnection({ apiVersion: '67.0' }))).to.not.equal(null);
  });

  it('stops when a new agent is deployed without its definition, and never changes the package.xml', async () => {
    const file = path.join(tmpDir, 'package.xml');
    const content = packageXml({ AiAgentDefinitionVersion: ['New_Agent#1', 'Known_Agent#5'] });
    await fs.writeFile(file, content);
    const error = await checkError(file, fakeConnection({ apiVersion: '68.0', orgAgents: ['Known_Agent'] }));
    expect(String(error?.message)).to.contain('New_Agent').and.not.contain('Known_Agent');
    expect(await fs.readFile(file, 'utf8')).to.equal(content);
  });

  it('accepts a version only when the target org already has the agent', async () => {
    const file = path.join(tmpDir, 'package.xml');
    await fs.writeFile(file, packageXml({ AiAgentDefinitionVersion: ['Known_Agent#5'] }));
    await checkAgentDeployment(file, fakeConnection({ apiVersion: '68.0', orgAgents: ['known_agent'] }), null);
  });

  it('stops when the deployment holds the active version and package-no-overwrite.xml does not protect it', async () => {
    const file = path.join(tmpDir, 'package.xml');
    await fs.writeFile(file, packageXml({ AiAgentDefinition: ['My_Agent'], AiAgentDefinitionVersion: ['My_Agent#1', 'My_Agent#2'] }));
    const conn = fakeConnection({
      apiVersion: '68.0',
      orgVersions: [
        { fullName: 'My_Agent#1', status: 'Inactive' },
        { fullName: 'My_Agent#2', status: 'Active' },
      ],
    });
    const error = await checkError(file, conn);
    expect(String(error?.message)).to.contain('My_Agent#2').and.not.contain('My_Agent#1,');
  });

  it('accepts the active version when package-no-overwrite.xml protects it', async () => {
    const file = path.join(tmpDir, 'package.xml');
    await fs.writeFile(file, packageXml({ AiAgentDefinition: ['My_Agent'], AiAgentDefinitionVersion: ['My_Agent#2'] }));
    await ensureAgentVersionsInPackageNoOverwrite(path.join(tmpDir, 'manifest', 'package-no-overwrite.xml'));
    const conn = fakeConnection({ apiVersion: '68.0', orgVersions: [{ fullName: 'My_Agent#2', status: 'Active' }] });
    await checkAgentDeployment(file, conn, null);
  });

  it('stops when a wildcard deploys the active version, even when package-no-overwrite.xml lists the type', async () => {
    const file = path.join(tmpDir, 'package.xml');
    await fs.writeFile(file, packageXml({ AiAgentDefinition: ['*'], AiAgentDefinitionVersion: ['*'] }));
    await fs.ensureDir(path.join(tmpDir, 'force-app', 'aiAgentDefinitionVersions', 'My_Agent#2'));
    await fs.writeFile(path.join(tmpDir, 'force-app', 'aiAgentDefinitionVersions', 'My_Agent#2', 'My_Agent#2.aiAgentDefinitionVersion-meta.xml'), '<x/>');
    await ensureAgentVersionsInPackageNoOverwrite(path.join(tmpDir, 'manifest', 'package-no-overwrite.xml'));
    const conn = fakeConnection({ apiVersion: '68.0', orgVersions: [{ fullName: 'My_Agent#2', status: 'Active' }] });
    const error = await checkError(file, conn);
    expect(String(error?.message)).to.contain('My_Agent#2').and.contain('package.xml');
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

  async function writeVersion(fullName: string): Promise<void> {
    const folder = path.join(tmpDir, 'force-app', 'main', 'default', 'aiAgentDefinitionVersions', fullName);
    await fs.ensureDir(folder);
    await fs.writeFile(path.join(folder, `${fullName}.aiAgentDefinitionVersion-meta.xml`), '<AiAgentDefinitionVersion/>');
  }

  it('lists the highest version of each agent of the project, or of the requested agents', async () => {
    await writeVersion('B_Agent#1');
    await writeVersion('B_Agent#10');
    await writeVersion('A_Agent#2');
    expect(await listLocalAgentLatestVersions(null, tmpDir)).to.deep.equal([
      { agentName: 'A_Agent', version: 2 },
      { agentName: 'B_Agent', version: 10 },
    ]);
    expect(await listLocalAgentLatestVersions(['b_agent'], tmpDir)).to.deep.equal([{ agentName: 'B_Agent', version: 10 }]);
  });

  it('lists the agents with a version changed since a commit, committed or not tracked yet', async () => {
    const previousCwd = process.cwd();
    process.chdir(tmpDir);
    try {
      execSync('git init -q && git config user.email test@example.com && git config user.name test', { cwd: tmpDir });
      await writeVersion('Old_Agent#1');
      execSync('git add -A && git commit -q -m init', { cwd: tmpDir });
      await writeVersion('Committed_Agent#1');
      execSync('git add -A && git commit -q -m story', { cwd: tmpDir });
      await writeVersion('New_Agent#3');
      expect(await listAgentsChangedSince('HEAD~1')).to.deep.equal(['Committed_Agent', 'New_Agent']);
    } finally {
      process.chdir(previousCwd);
    }
  });

  it('adds AiAgentDefinitionVersion to package-no-overwrite.xml once, and keeps what it holds', async () => {
    const file = path.join(tmpDir, 'manifest', 'package-no-overwrite.xml');
    await fs.ensureDir(path.dirname(file));
    await fs.writeFile(file, packageXml({ Certificate: ['*'] }, '62.0'));
    expect(await ensureAgentVersionsInPackageNoOverwrite(file)).to.equal(true);
    expect(await ensureAgentVersionsInPackageNoOverwrite(file)).to.equal(false);
    const content = await parsePackageXmlFile(file);
    expect(content.AiAgentDefinitionVersion).to.deep.equal(['*']);
    expect(content.Certificate).to.deep.equal(['*']);
    expect(await fs.readFile(file, 'utf8')).to.contain('<version>62.0</version>');
  });

  it('keeps the comments and the layout of package-no-overwrite.xml', async () => {
    const file = path.join(tmpDir, 'package-no-overwrite.xml');
    const original = [
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
      '<Package xmlns="http://soap.sforce.com/2006/04/metadata">',
      '  <!-- Certificates are a very sensitive data -->',
      '  <types>',
      '      <members>*</members>',
      '      <name>Certificate</name>',
      '  </types>',
      '  <version>62.0</version>',
      '</Package>',
      '',
    ].join('\n');
    await fs.writeFile(file, original);
    expect(await ensureAgentVersionsInPackageNoOverwrite(file)).to.equal(true);
    const written = await fs.readFile(file, 'utf8');
    // Sorted with the other types, above the comment of the type that follows
    const [head, tail] = written.split('  <!-- Certificates are a very sensitive data -->\n');
    expect(head).to.match(/<Package [^>]*>\n {2}<types>\n[\s\S]*<name>AiAgentDefinitionVersion<\/name>\n {2}<\/types>\n$/);
    expect(tail).to.equal(original.split('  <!-- Certificates are a very sensitive data -->\n')[1]);
    expect(written).to.contain('standalone="yes"');
    expect((await parsePackageXmlFile(file)).AiAgentDefinitionVersion).to.deep.equal(['*']);
  });

  it('adds AiAgentDefinitionVersion after the types that sort before it, and keeps the header comment on top', async () => {
    const file = path.join(tmpDir, 'package-no-overwrite.xml');
    const original = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Package xmlns="http://soap.sforce.com/2006/04/metadata">',
      '    <!-- The list every project starts with -->',
      '    <types>',
      '        <members>*</members>',
      '        <name>AccountRelationshipShareRule</name>',
      '    </types>',
      '    <!-- Approval processes can contain usernames -->',
      '    <types>',
      '        <members>*</members>',
      '        <name>ApprovalProcess</name>',
      '    </types>',
      '    <version>62.0</version>',
      '</Package>',
      '',
    ].join('\n');
    await fs.writeFile(file, original);
    await ensureAgentVersionsInPackageNoOverwrite(file);
    const written = await fs.readFile(file, 'utf8');
    const names = [...written.matchAll(/<name>([^<]+)<\/name>/g)].map((match) => match[1]);
    expect(names).to.deep.equal(['AccountRelationshipShareRule', 'AiAgentDefinitionVersion', 'ApprovalProcess']);
    expect(written).to.contain('    </types>\n    <types>\n        <!-- An agent version').and.contain('    </types>\n    <!-- Approval processes can contain usernames -->\n    <types>');
  });

  it('adds the wildcard to an AiAgentDefinitionVersion entry that lists some versions', async () => {
    const file = path.join(tmpDir, 'package-no-overwrite.xml');
    await fs.writeFile(file, packageXml({ AiAgentDefinitionVersion: ['My_Agent#1'] }));
    expect(await ensureAgentVersionsInPackageNoOverwrite(file)).to.equal(true);
    expect((await parsePackageXmlFile(file)).AiAgentDefinitionVersion).to.deep.equal(['My_Agent#1', '*']);
  });

  it('creates package-no-overwrite.xml when the project has none', async () => {
    const file = path.join(tmpDir, 'manifest', 'package-no-overwrite.xml');
    expect(await ensureAgentVersionsInPackageNoOverwrite(file)).to.equal(true);
    expect((await parsePackageXmlFile(file)).AiAgentDefinitionVersion).to.deep.equal(['*']);
  });
});

async function checkError(file: string, conn: any): Promise<any> {
  try {
    await checkAgentDeployment(file, conn, null);
  } catch (e) {
    return e;
  }
  return null;
}

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
    await checkAgentDeployment(file, fakeConnection({ apiVersion: '68.0' }), command);
    expect(command.logs.join('\n')).to.contain('API 64.0');
  });

  it('warns when the package.xml version is below 68.0', async () => {
    await fs.writeFile('sfdx-project.json', JSON.stringify({ sourceApiVersion: '68.0' }));
    const file = path.join(tmpDir, 'package.xml');
    await fs.writeFile(file, packageXml({ AiAgentDefinition: ['My_Agent'] }, '66.0'));
    const command = fakeCommand();
    await checkAgentDeployment(file, fakeConnection({ apiVersion: '68.0' }), command);
    expect(command.logs.join('\n')).to.contain('66.0');
  });

  it('does not warn when the project is on 68.0', async () => {
    await fs.writeFile('sfdx-project.json', JSON.stringify({ sourceApiVersion: '68.0' }));
    const file = path.join(tmpDir, 'package.xml');
    await fs.writeFile(file, packageXml({ AiAgentDefinition: ['My_Agent'] }));
    const command = fakeCommand();
    await checkAgentDeployment(file, fakeConnection({ apiVersion: '68.0' }), command);
    expect(command.logs).to.deep.equal([]);
  });

  it('does not warn when the deployment holds no agent', async () => {
    await fs.writeFile('sfdx-project.json', JSON.stringify({ sourceApiVersion: '64.0' }));
    const file = path.join(tmpDir, 'package.xml');
    await fs.writeFile(file, packageXml({ ApexClass: ['MyClass'] }, '64.0'));
    const command = fakeCommand();
    await checkAgentDeployment(file, fakeConnection({ apiVersion: '64.0' }), command);
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
    await checkAgentDeployment(file, fakeConnection({ apiVersion: '68.0', orgUsers: [] }), command);
    expect(command.logs.join('\n')).to.contain('agent.user@example.com');
  });

  it('does not warn when the built-in rule writes the running user', async () => {
    await writeAgent('Service_Agent', 'agent.user@example.com');
    const file = path.join(tmpDir, 'package.xml');
    await fs.writeFile(file, packageXml({ AiAgentDefinition: ['Service_Agent'] }));
    const command = fakeCommand();
    await checkAgentDeployment(file, fakeConnection({ apiVersion: '68.0', orgUsers: [] }), command);
    expect(command.logs).to.deep.equal([]);
  });

  it('does not warn when the target org has the running user', async () => {
    await writeAgent('Service_Agent', 'agent.user@example.com');
    await fs.ensureDir('config');
    await fs.writeFile(path.join('config', '.sfdx-hardis.yml'), 'replacementRules:\n  - id: builtin-agent-running-user\n    enabled: false\n');
    const file = path.join(tmpDir, 'package.xml');
    await fs.writeFile(file, packageXml({ AiAgentDefinition: ['Service_Agent'] }));
    const command = fakeCommand();
    await checkAgentDeployment(file, fakeConnection({ apiVersion: '68.0', orgUsers: ['Agent.User@example.com'] }), command);
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
    await checkAgentDeployment(file, fakeConnection({ apiVersion: '68.0', orgUsers: [] }), command);
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
    await checkAgentDeployment(file, conn, command);
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
    await checkAgentDeployment(file, fakeConnection({ apiVersion: '68.0', orgVersions: [{ fullName: 'Service_Agent#1', status: 'Active' }] }), command);
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
    await checkAgentDeployment(file, fakeConnection({ apiVersion: '68.0', orgUsers: [] }), command);
    expect(command.logs).to.deep.equal([]);
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

  it('stops a deployment at API 68.0 that holds an agent in the old format next to a new one', async () => {
    process.env.SF_ORG_API_VERSION = '68.0';
    await fs.writeFile('sfdx-project.json', JSON.stringify({ sourceApiVersion: '68.0' }));
    const file = path.join(tmpDir, 'package.xml');
    await fs.writeFile(file, packageXml({ GenAiPlannerBundle: ['Old_Agent_v2'], AiAgentDefinition: ['New_Agent'], AiAgentDefinitionVersion: ['New_Agent#1'] }));
    let error: any = null;
    try {
      await checkAgentDeployment(file, fakeConnection({ apiVersion: '68.0', orgVersions: [] }), null);
    } catch (e) {
      error = e;
    }
    expect(error?.message || '').to.contain('GenAiPlannerBundle:Old_Agent_v2');
  });

  it('lets a deployment at API 67.0 hold the old format', async () => {
    process.env.SF_ORG_API_VERSION = '67.0';
    await fs.writeFile('sfdx-project.json', JSON.stringify({ sourceApiVersion: '67.0' }));
    const file = path.join(tmpDir, 'package.xml');
    await fs.writeFile(file, packageXml({ GenAiPlannerBundle: ['Old_Agent_v2'], Bot: ['Old_Agent'] }, '67.0'));
    await checkAgentDeployment(file, fakeConnection({ apiVersion: '67.0' }), null);
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
