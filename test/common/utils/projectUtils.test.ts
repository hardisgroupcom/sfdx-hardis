import { expect } from 'chai';
import fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import { listApexFiles, listFlowFiles, listPageFiles } from '../../../src/common/utils/projectUtils.js';

describe('projectUtils', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `sfdx-hardis-projectutils-${Date.now()}`);
    await fs.ensureDir(tmpDir);
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  describe('listFlowFiles()', () => {
    it('ignores flow-looking files embedded in static resources', async () => {
      const packageDir = path.join(tmpDir, 'force-app');
      const flowFile = path.join(packageDir, 'main/default/flows/Real_Flow.flow-meta.xml');
      const staticResourceFlowFile = path.join(packageDir, 'main/default/staticresources/vlocity_datapack/salesforce_sfdx/main/default/flows/Broken.flow-meta.xml');

      await fs.ensureDir(path.dirname(flowFile));
      await fs.writeFile(flowFile, `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
    <actionCalls>
        <name>doSomething</name>
        <label>Do Something</label>
    </actionCalls>
    <label>Real Flow</label>
    <processType>Flow</processType>
    <status>Active</status>
</Flow>`);

      await fs.ensureDir(path.dirname(staticResourceFlowFile));
      await fs.writeFile(staticResourceFlowFile, `<?xml version="1.0" encoding="UTF-8"?>
<Flow xmlns="http://soap.sforce.com/2006/04/metadata">
    <screens>
        <name>Broken</name>
    </fields>
</Flow>`);

      const flowFiles = await listFlowFiles([{ path: packageDir }]);

      expect(flowFiles).to.deep.equal([flowFile.replace(/\\/g, '/')]);
    });
  });

  describe('listApexFiles()', () => {
    it('ignores Apex-looking files embedded in static resources', async () => {
      const packageDir = path.join(tmpDir, 'force-app');
      const apexFile = path.join(packageDir, 'main/default/classes/RealClass.cls');
      const staticResourceApexFile = path.join(packageDir, 'main/default/staticresources/datapack/classes/EmbeddedClass.cls');

      await fs.ensureDir(path.dirname(apexFile));
      await fs.writeFile(apexFile, 'public class RealClass {}');

      await fs.ensureDir(path.dirname(staticResourceApexFile));
      await fs.writeFile(staticResourceApexFile, 'public class EmbeddedClass {}');

      const apexFiles = await listApexFiles([{ path: packageDir }]);

      expect(apexFiles).to.deep.equal([apexFile.replace(/\\/g, '/')]);
    });
  });

  describe('listPageFiles()', () => {
    it('ignores flexipage-looking files embedded in static resources', async () => {
      const packageDir = path.join(tmpDir, 'force-app');
      const pageFile = path.join(packageDir, 'main/default/flexipages/Real_Page.flexipage-meta.xml');
      const staticResourcePageFile = path.join(packageDir, 'main/default/staticresources/datapack/flexipages/Embedded_Page.flexipage-meta.xml');

      await fs.ensureDir(path.dirname(pageFile));
      await fs.writeFile(pageFile, '<FlexiPage xmlns="http://soap.sforce.com/2006/04/metadata" />');

      await fs.ensureDir(path.dirname(staticResourcePageFile));
      await fs.writeFile(staticResourcePageFile, '<FlexiPage xmlns="http://soap.sforce.com/2006/04/metadata" />');

      const pageFiles = await listPageFiles([{ path: packageDir }]);

      expect(pageFiles).to.deep.equal([pageFile.replace(/\\/g, '/')]);
    });
  });
});
