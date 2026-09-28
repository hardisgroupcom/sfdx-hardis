/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import * as os from 'os';
import * as path from 'path';
import fs from '../../../src/common/utils/fsUtils.js';
import { MetadataUtils } from '../../../src/common/metadata-utils/index.js';

const APEX_META =
  '<?xml version="1.0" encoding="UTF-8"?>\n<ApexClass xmlns="http://soap.sforce.com/2006/04/metadata"><apiVersion>65.0</apiVersion><status>Active</status></ApexClass>\n';
const LWC_META =
  '<?xml version="1.0" encoding="UTF-8"?>\n<LightningComponentBundle xmlns="http://soap.sforce.com/2006/04/metadata"><apiVersion>65.0</apiVersion><isExposed>false</isExposed></LightningComponentBundle>\n';
const FIELD_META =
  '<?xml version="1.0" encoding="UTF-8"?>\n<CustomField xmlns="http://soap.sforce.com/2006/04/metadata"><fullName>Status__c</fullName><type>Text</type><length>10</length></CustomField>\n';
const OBJECT_META =
  '<?xml version="1.0" encoding="UTF-8"?>\n<CustomObject xmlns="http://soap.sforce.com/2006/04/metadata"></CustomObject>\n';
const FLOW_META =
  '<?xml version="1.0" encoding="UTF-8"?>\n<Flow xmlns="http://soap.sforce.com/2006/04/metadata"><apiVersion>65.0</apiVersion><status>Active</status></Flow>\n';

// Temp source tree written once for the whole suite
const FILES: Record<string, string> = {
  'force-app/main/default/classes/MyClass.cls': 'public class MyClass {}\n',
  'force-app/main/default/classes/MyClass.cls-meta.xml': APEX_META,
  'force-app/main/default/lwc/myLwc/myLwc.js': 'export default class MyLwc {}\n',
  'force-app/main/default/lwc/myLwc/myLwc.js-meta.xml': LWC_META,
  'force-app/main/default/objects/Account/Account.object-meta.xml': OBJECT_META,
  'force-app/main/default/objects/Account/fields/Status__c.field-meta.xml': FIELD_META,
  'force-app/main/default/flows/MyFlow.flow-meta.xml': FLOW_META,
  'README.md': '# Not metadata\n',
};

describe('MetadataUtils.resolveMetadataFromFile', () => {
  let root: string;

  before(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'resolve-metadata-'));
    for (const [file, content] of Object.entries(FILES)) {
      await fs.outputFile(path.join(root, file), content);
    }
  });

  after(async () => {
    await fs.remove(root);
  });

  const resolve = (file: string) => MetadataUtils.resolveMetadataFromFile(path.join(root, file));

  it('resolves an Apex class from its code file and its meta file', () => {
    expect(resolve('force-app/main/default/classes/MyClass.cls')).to.deep.equal({ type: 'ApexClass', name: 'MyClass' });
    expect(resolve('force-app/main/default/classes/MyClass.cls-meta.xml')).to.deep.equal({
      type: 'ApexClass',
      name: 'MyClass',
    });
  });

  it('resolves a file of a LWC bundle to the bundle', () => {
    expect(resolve('force-app/main/default/lwc/myLwc/myLwc.js')).to.deep.equal({
      type: 'LightningComponentBundle',
      name: 'myLwc',
    });
  });

  it('resolves a field file to Object.Field__c', () => {
    expect(resolve('force-app/main/default/objects/Account/fields/Status__c.field-meta.xml')).to.deep.equal({
      type: 'CustomField',
      name: 'Account.Status__c',
    });
  });

  it('resolves an object and a Flow', () => {
    expect(resolve('force-app/main/default/objects/Account/Account.object-meta.xml')).to.deep.equal({
      type: 'CustomObject',
      name: 'Account',
    });
    expect(resolve('force-app/main/default/flows/MyFlow.flow-meta.xml')).to.deep.equal({ type: 'Flow', name: 'MyFlow' });
  });

  it('returns null for a file that is not metadata', () => {
    expect(resolve('README.md')).to.be.null;
    expect(resolve('does/not/exist.cls')).to.be.null;
  });
});
