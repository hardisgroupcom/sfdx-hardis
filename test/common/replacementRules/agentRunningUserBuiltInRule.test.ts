import { expect } from 'chai';
import * as os from 'os';
import * as path from 'path';
import fs from '../../../src/common/utils/fsUtils.js';
import {
  AgentRunningUserBuiltInRule,
  buildAgentUserBaseUsername,
  listAgentsWithRunningUser,
} from '../../../src/common/replacementRules/agentRunningUserBuiltInRule.js';
import { findBuiltInReplacementRule } from '../../../src/common/replacementRules/builtIn/builtInReplacementRules.js';

const SOURCE_USER = 'my_agent@00dsource.ext';
const ORG_ID = '00D000000000042';

function buildRule(enabled = true): AgentRunningUserBuiltInRule {
  const builtIn = findBuiltInReplacementRule('builtin-agent-running-user')!;
  return new AgentRunningUserBuiltInRule({ id: builtIn.id, enabled, files: builtIn.files, builtIn } as any);
}

// Answers the User queries: the users of the org, and the agent users created at a previous deployment
function fakeConnection(options: { users?: string[]; agentUsers?: string[] }): any {
  const queries: string[] = [];
  return {
    queries,
    getUsername: () => 'admin@target.example.com',
    getAuthInfoFields: () => ({ orgId: ORG_ID }),
    query: async (soql: string) => {
      queries.push(soql);
      if (soql.includes(' LIKE ')) {
        return { done: true, records: (options.agentUsers || []).map((username) => ({ Username: username })) };
      }
      return { done: true, records: (options.users || []).map((username) => ({ Username: username })) };
    },
  };
}

describe('AgentRunningUserBuiltInRule', () => {
  let tmpDir: string;
  let previousCwd: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-running-user-'));
    previousCwd = process.cwd();
    process.chdir(tmpDir);
    const base = path.join('force-app', 'main', 'default');
    await fs.ensureDir(path.join(base, 'aiAgents'));
    await fs.writeFile(path.join(base, 'aiAgents', 'My_Agent.aiAgentDefinition-meta.xml'), `<AiAgentDefinition><botUser>${SOURCE_USER}</botUser></AiAgentDefinition>`);
    await fs.ensureDir(path.join(base, 'aiAuthoringBundles', 'My_Agent_2'));
    await fs.writeFile(path.join(base, 'aiAuthoringBundles', 'My_Agent_2', 'My_Agent_2.agent'), `access:\n    default_agent_user: "${SOURCE_USER}"\n`);
    await fs.ensureDir(path.join(base, 'aiAgents'));
    await fs.writeFile(path.join(base, 'aiAgents', 'Employee_Agent.aiAgentDefinition-meta.xml'), '<AiAgentDefinition><type>EmployeeCopilot</type></AiAgentDefinition>');
  });

  afterEach(async () => {
    process.chdir(previousCwd);
    await fs.remove(tmpDir);
  });

  it('builds a base username of the target org without LIKE wildcards', () => {
    expect(buildAgentUserBaseUsername('My_Agent', ORG_ID)).to.equal('my-agent@00d000000000042.ext');
  });

  it('lists the agents of the deployment with the usernames of their files', async () => {
    const packageXml = path.join(tmpDir, 'package.xml');
    await fs.writeFile(
      packageXml,
      '<?xml version="1.0" encoding="UTF-8"?><Package xmlns="http://soap.sforce.com/2006/04/metadata"><types><members>My_Agent#2</members><name>AiAgentDefinitionVersion</name></types><version>68.0</version></Package>'
    );
    expect(await listAgentsWithRunningUser([packageXml], tmpDir)).to.deep.equal([{ agentName: 'My_Agent', usernames: [SOURCE_USER] }]);
    const otherPackageXml = path.join(tmpDir, 'other.xml');
    await fs.writeFile(
      otherPackageXml,
      '<?xml version="1.0" encoding="UTF-8"?><Package xmlns="http://soap.sforce.com/2006/04/metadata"><types><members>MyClass</members><name>ApexClass</name></types><version>68.0</version></Package>'
    );
    expect(await listAgentsWithRunningUser([otherPackageXml], tmpDir)).to.deep.equal([]);
  });

  it('uses the agent user created at a previous deployment, in the definition and the bundles', async () => {
    const rule = buildRule();
    const conn = fakeConnection({ users: [], agentUsers: ['my-agent.a1b2c3d4e5f6@00d000000000042.ext'] });
    await rule.prepare({ target: { targetBranch: 'main', label: 'main', apiVersion: 68 }, conn, write: true, checkOnly: false });
    expect(conn.queries.some((soql: string) => soql.includes("LIKE 'my-agent.%@00d000000000042.ext'"))).to.equal(true);
    const xml = rule.applyToText(`<AiAgentDefinition><botUser>${SOURCE_USER}</botUser></AiAgentDefinition>`);
    expect(xml.status).to.equal('changed');
    expect(xml.content).to.contain('<botUser>my-agent.a1b2c3d4e5f6@00d000000000042.ext</botUser>');
    const script = rule.applyToText(`    default_agent_user: "${SOURCE_USER}"`);
    expect(script.content).to.equal('    default_agent_user: "my-agent.a1b2c3d4e5f6@00d000000000042.ext"');
  });

  it('keeps the username of git when the target org has this user', async () => {
    const rule = buildRule();
    await rule.prepare({ target: { targetBranch: 'uat', label: 'uat', apiVersion: 68 }, conn: fakeConnection({ users: [SOURCE_USER.toUpperCase()] }), write: true });
    expect(rule.applyToText(`<botUser>${SOURCE_USER}</botUser>`).status).to.equal('unchanged');
  });

  it('never creates a user in a deployment check or a preview', async () => {
    for (const options of [{ write: true, checkOnly: true }, { write: false, checkOnly: false }]) {
      const rule = buildRule();
      const conn = fakeConnection({ users: [], agentUsers: [] });
      await rule.prepare({ target: { targetBranch: 'main', label: 'main', apiVersion: 68 }, conn, ...options });
      expect(rule.applyToText(`<botUser>${SOURCE_USER}</botUser>`).status).to.equal('unchanged');
    }
  });

  it('creates no user when a rule of the project writes the running user', async () => {
    await fs.ensureDir('config');
    await fs.writeFile(
      path.join('config', '.sfdx-hardis.yml'),
      "replacementRules:\n  - id: agent-user\n    type: text\n    files: '**/aiAgents/*.aiAgentDefinition-meta.xml'\n    find: '(?<=<botUser>)[^<]+(?=</botUser>)'\n    regex: true\n    secret: AGENT_RUNNING_USER\n"
    );
    const rule = buildRule();
    const conn = fakeConnection({ users: [], agentUsers: [] });
    await rule.prepare({ target: { targetBranch: 'main', label: 'main', apiVersion: 68 }, conn, write: true, checkOnly: false });
    expect(conn.queries).to.deep.equal([]);
    expect(rule.applyToText(`<botUser>${SOURCE_USER}</botUser>`).status).to.equal('unchanged');
  });

  it('does nothing when turned off', async () => {
    const rule = buildRule(false);
    const conn = fakeConnection({ agentUsers: ['my-agent.a1b2c3d4e5f6@00d000000000042.ext'] });
    await rule.prepare({ target: { targetBranch: 'main', label: 'main', apiVersion: 68 }, conn, write: true });
    expect(conn.queries).to.deep.equal([]);
    expect(rule.applyToText(`<botUser>${SOURCE_USER}</botUser>`).status).to.equal('unchanged');
  });

  it('reports not-found on a file without running user', () => {
    expect(buildRule().applyToText('<AiAgentDefinition><type>EmployeeCopilot</type></AiAgentDefinition>').status).to.equal('not-found');
  });
});
