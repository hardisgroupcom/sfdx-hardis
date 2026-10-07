/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import * as path from 'path';
import fs from '../../../../../src/common/utils/fsUtils.js';
import CleanReferences from '../../../../../src/commands/hardis/project/clean/references.js';
import LintAccess from '../../../../../src/commands/hardis/lint/access.js';
import CleanEmptyItems from '../../../../../src/commands/hardis/project/clean/emptyitems.js';
import CleanFlowPositions from '../../../../../src/commands/hardis/project/clean/flowpositions.js';
import CleanListViews from '../../../../../src/commands/hardis/project/clean/listviews.js';
import CleanMinimizeProfiles from '../../../../../src/commands/hardis/project/clean/minimizeprofiles.js';
import CleanSensitiveMetadatas from '../../../../../src/commands/hardis/project/clean/sensitive-metadatas.js';
import CleanSystemDebug from '../../../../../src/commands/hardis/project/clean/systemdebug.js';

/**
 * hardis:project:clean:references used to run each command based cleaning as a `sf hardis:...` child
 * process. It now calls the command class in the current process, which saves a full Salesforce CLI
 * boot per cleaning. These tests run the real cleanings on a throwaway project to check that the
 * cleaning still happens, that the arguments still reach the sub-command, and that nothing runs when
 * the Flow scope is empty.
 *
 * The throwaway project lives under the repository, not under the OS temp folder: the commands run
 * with the process cwd set to it, and a cwd without a reachable node_modules breaks the tsx loader
 * used to import TypeScript sources (`Cannot find package 'tsx'`).
 *
 * The hooks below MUST stay inside the describe block: mocha treats file level hooks as root hooks
 * that run for every test of the whole suite, which would move the cwd under other test files.
 */

function buildAutoLayoutFlow(label: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>65.0</apiVersion>
    <processMetadataValues>
        <name>CanvasMode</name>
        <value>
            <stringValue>AUTO_LAYOUT_CANVAS</stringValue>
        </value>
    </processMetadataValues>
    <label>${label}</label>
    <processType>AutoLaunchedFlow</processType>
    <status>Active</status>
    <recordCreates>
        <name>Create_Record</name>
        <locationX>176</locationX>
        <locationY>323</locationY>
        <object>Account</object>
    </recordCreates>
</Flow>
`;
}

const APEX_WITH_DEBUG = [
  'public with sharing class DispatchSample {',
  '  public static void hello() {',
  "    System.debug('hello');",
  '  }',
  '}',
].join('\n');

const FLOW_NAMES = ['Dispatch_Flow_One', 'Dispatch_Flow_Two'];
const UNCLEANED_POSITIONS = ['<locationX>176</locationX>', '<locationY>323</locationY>'];
const CLEANED_POSITIONS = ['<locationX>0</locationX>', '<locationY>0</locationY>'];

describe('hardis:project:clean:references in-process cleaning dispatch', () => {
  const tmpRoot = path.join(process.cwd(), 'tmp');
  let tmpDir = '';
  let previousCwd = '';

  const flowPath = (flowName: string) =>
    path.join(tmpDir, 'force-app', 'main', 'default', 'flows', `${flowName}.flow-meta.xml`);
  const certPath = () => path.join(tmpDir, 'force-app', 'main', 'default', 'certs', 'MyCert.crt');
  const apexPath = () => path.join(tmpDir, 'force-app', 'main', 'default', 'classes', 'DispatchSample.cls');

  async function positionsOf(flowName: string): Promise<string[]> {
    const flowXml = await fs.readFile(flowPath(flowName), 'utf8');
    return flowXml
      .split('\n')
      .filter((line) => line.includes('<locationX>') || line.includes('<locationY>'))
      .map((line) => line.trim());
  }

  beforeEach(async () => {
    tmpDir = path.join(tmpRoot, `hardis-dispatch-${process.pid}-${Math.random().toString(36).slice(2, 8)}`);
    await fs.ensureDir(path.join(tmpDir, 'force-app', 'main', 'default', 'flows'));
    await fs.ensureDir(path.join(tmpDir, 'force-app', 'main', 'default', 'certs'));
    await fs.ensureDir(path.join(tmpDir, 'force-app', 'main', 'default', 'classes'));
    await fs.writeJson(path.join(tmpDir, 'sfdx-project.json'), {
      packageDirectories: [{ path: 'force-app', default: true }],
      namespace: '',
      sfdcLoginUrl: 'https://login.salesforce.com',
      sourceApiVersion: '65.0',
    });
    for (const flowName of FLOW_NAMES) {
      await fs.writeFile(flowPath(flowName), buildAutoLayoutFlow(flowName));
    }
    await fs.writeFile(certPath(), ['-----BEGIN CERTIFICATE-----', 'SECRET', '-----END CERTIFICATE-----'].join('\n'));
    await fs.writeFile(apexPath(), APEX_WITH_DEBUG);
    previousCwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(async () => {
    process.chdir(previousCwd);
    await fs.remove(tmpDir);
  });

  it('maps every command based cleaning type to its command class', () => {
    const cleaningTypes = (new (CleanReferences as any)([], {}) as any).allCleaningTypes;
    const byValue = new Map(cleaningTypes.map((cleaningType: any) => [cleaningType.value, cleaningType]));
    const expectedClasses: Record<string, any> = {
      checkPermissions: LintAccess,
      emptyItems: CleanEmptyItems,
      flowPositions: CleanFlowPositions,
      sensitiveMetadatas: CleanSensitiveMetadatas,
      listViewsMine: CleanListViews,
      minimizeProfiles: CleanMinimizeProfiles,
      systemDebug: CleanSystemDebug,
    };
    for (const [value, expectedClass] of Object.entries(expectedClasses)) {
      expect((byValue.get(value) as any)?.commandClass, `cleaning type ${value}`).to.equal(expectedClass);
    }
    // No cleaning type may keep a `sf ...` command line: it would silently never run any more
    const leftOvers = cleaningTypes.filter((cleaningType: any) => cleaningType.command !== undefined);
    expect(leftOvers.map((cleaningType: any) => cleaningType.value)).to.deep.equal([]);
  });

  // checkPermissions, listViewsMine, systemDebug and v60 used to be missing from the --type options, so
  // they could not be requested at all even though they are valid cleaning types
  it('accepts every cleaning type in --type', () => {
    const cleaningTypes = (new (CleanReferences as any)([], {}) as any).allCleaningTypes;
    const typeOptions: string[] = (CleanReferences as any).flags.type.options;
    expect(typeOptions).to.include('all');
    expect(typeOptions.filter((option) => option !== 'all').sort()).to.deep.equal(
      cleaningTypes.map((cleaningType: any) => cleaningType.value).sort()
    );
  });

  it('runs the Flow positions cleaning on every Flow when no scope is given', async () => {
    await CleanReferences.run(['--type', 'flowPositions', '--agent']);
    for (const flowName of FLOW_NAMES) {
      expect(await positionsOf(flowName), flowName).to.deep.equal(CLEANED_POSITIONS);
    }
  });

  it('passes --flows down to the sub-command and cleans only the scoped Flow', async () => {
    await CleanReferences.run(['--type', 'flowPositions', '--flows', 'Dispatch_Flow_One', '--agent']);
    expect(await positionsOf('Dispatch_Flow_One')).to.deep.equal(CLEANED_POSITIONS);
    expect(await positionsOf('Dispatch_Flow_Two')).to.deep.equal(UNCLEANED_POSITIONS);
  });

  it('skips the cleaning entirely when the Flow scope is empty', async () => {
    await CleanReferences.run(['--type', 'flowPositions', '--flows', '', '--agent']);
    for (const flowName of FLOW_NAMES) {
      expect(await positionsOf(flowName), flowName).to.deep.equal(UNCLEANED_POSITIONS);
    }
  });

  it('dispatches a cleaning type served by another command class', async () => {
    await CleanReferences.run(['--type', 'sensitiveMetadatas', '--agent']);
    const certContent = await fs.readFile(certPath(), 'utf8');
    expect(certContent).to.not.include('SECRET');
  });

  it('dispatches a cleaning type that was not selectable before', async () => {
    await CleanReferences.run(['--type', 'systemDebug', '--agent']);
    const apexContent = await fs.readFile(apexPath(), 'utf8');
    expect(apexContent).to.include("// System.debug('hello');");
  });

  it('passes --delta-from down to the empty items cleaning, which deletes a new empty object and its package.xml member', async () => {
    const objectDir = path.join(tmpDir, 'force-app', 'main', 'default', 'objects', 'Acme__c');
    await fs.ensureDir(path.join(objectDir, 'fields'));
    const objectFile = path.join(objectDir, 'Acme__c.object-meta.xml');
    const fieldFile = path.join(objectDir, 'fields', 'Flag__c.field-meta.xml');
    await fs.writeFile(
      objectFile,
      '<?xml version="1.0" encoding="UTF-8"?>\n<CustomObject xmlns="http://soap.sforce.com/2006/04/metadata"></CustomObject>\n'
    );
    await fs.writeFile(
      fieldFile,
      '<?xml version="1.0" encoding="UTF-8"?>\n<CustomField xmlns="http://soap.sforce.com/2006/04/metadata"><fullName>Flag__c</fullName></CustomField>\n'
    );
    await fs.ensureDir(path.join(tmpDir, 'manifest'));
    await fs.writeFile(
      path.join(tmpDir, 'manifest', 'package.xml'),
      [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<Package xmlns="http://soap.sforce.com/2006/04/metadata">',
        '<types><members>Acme__c</members><members>Other__c</members><name>CustomObject</name></types>',
        '<version>65.0</version>',
        '</Package>',
      ].join('\n')
    );
    // The throwaway project is not in HEAD, so the object file does not exist at the delta start
    await CleanReferences.run(['--type', 'emptyItems', '--delta-from', 'HEAD', '--agent']);
    expect(fs.existsSync(objectFile), 'empty object file').to.be.false;
    expect(fs.existsSync(fieldFile), 'field of the object').to.be.true;
    const packageXml = await fs.readFile(path.join(tmpDir, 'manifest', 'package.xml'), 'utf8');
    expect(packageXml).to.not.include('<members>Acme__c</members>');
    expect(packageXml).to.include('<members>Other__c</members>');
  });
});
