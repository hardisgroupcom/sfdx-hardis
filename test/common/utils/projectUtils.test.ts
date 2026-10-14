import { expect } from 'chai';
import fs from '../../../src/common/utils/fsUtils.js';
import * as os from 'os';
import * as path from 'path';
import { getSfdxProjectPackageDirectories, listApexFiles, listAuraBundleFiles, listFlowFiles, listPageFiles, listVisualforceComponentFiles, listVisualforcePageFiles } from '../../../src/common/utils/projectUtils.js';

describe('projectUtils', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = path.join(os.tmpdir(), `sfdx-hardis-projectutils-${Date.now()}`);
    await fs.ensureDir(tmpDir);
  });

  afterEach(async () => {
    await fs.remove(tmpDir);
  });

  describe('getSfdxProjectPackageDirectories()', () => {
    it('returns package directories declared in sfdx-project.json', async () => {
      await fs.writeJson(path.join(tmpDir, 'sfdx-project.json'), {
        packageDirectories: [{ path: 'src-dx', default: true }, { path: 'src-extra' }],
      });

      const packageDirectories = await getSfdxProjectPackageDirectories(tmpDir);

      expect(packageDirectories).to.deep.equal([
        { path: 'src-dx', fullPath: path.join(tmpDir, 'src-dx') },
        { path: 'src-extra', fullPath: path.join(tmpDir, 'src-extra') },
      ]);
    });

    it('falls back to force-app when sfdx-project.json is missing', async () => {
      const packageDirectories = await getSfdxProjectPackageDirectories(tmpDir);

      expect(packageDirectories).to.deep.equal([{ path: 'force-app', fullPath: path.join(tmpDir, 'force-app') }]);
    });

    it('falls back to force-app when sfdx-project.json has no package directories', async () => {
      await fs.writeJson(path.join(tmpDir, 'sfdx-project.json'), { name: 'empty-project' });

      const packageDirectories = await getSfdxProjectPackageDirectories(tmpDir);

      expect(packageDirectories).to.deep.equal([{ path: 'force-app', fullPath: path.join(tmpDir, 'force-app') }]);
    });
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

  describe('listVisualforcePageFiles()', () => {
    it('lists Visualforce page metadata, ignoring static resources and managed pages', async () => {
      const packageDir = path.join(tmpDir, 'force-app');
      const pageMetaFile = path.join(packageDir, 'main/default/pages/Real_Page.page-meta.xml');
      const managedPageMetaFile = path.join(packageDir, 'main/default/pages/pkg__Managed_Page.page-meta.xml');
      const staticResourcePageMetaFile = path.join(packageDir, 'main/default/staticresources/datapack/pages/Embedded.page-meta.xml');

      for (const file of [pageMetaFile, managedPageMetaFile, staticResourcePageMetaFile]) {
        await fs.ensureDir(path.dirname(file));
        await fs.writeFile(file, '<ApexPage xmlns="http://soap.sforce.com/2006/04/metadata" />');
      }

      const visualforcePageFiles = await listVisualforcePageFiles([{ path: packageDir }]);

      expect(visualforcePageFiles).to.deep.equal([pageMetaFile.replace(/\\/g, '/')]);
    });
  });

  describe('listVisualforceComponentFiles()', () => {
    it('lists Visualforce component metadata, ignoring static resources and managed components', async () => {
      const packageDir = path.join(tmpDir, 'force-app');
      const componentMetaFile = path.join(packageDir, 'main/default/components/Real_Component.component-meta.xml');
      const managedComponentMetaFile = path.join(packageDir, 'main/default/components/pkg__Managed.component-meta.xml');
      const staticResourceComponentMetaFile = path.join(packageDir, 'main/default/staticresources/datapack/components/Embedded.component-meta.xml');

      for (const file of [componentMetaFile, managedComponentMetaFile, staticResourceComponentMetaFile]) {
        await fs.ensureDir(path.dirname(file));
        await fs.writeFile(file, '<ApexComponent xmlns="http://soap.sforce.com/2006/04/metadata" />');
      }

      const visualforceComponentFiles = await listVisualforceComponentFiles([{ path: packageDir }]);

      expect(visualforceComponentFiles).to.deep.equal([componentMetaFile.replace(/\\/g, '/')]);
    });
  });

  describe('listAuraBundleFiles()', () => {
    it('lists every Aura bundle definition type, ignoring static resources and managed bundles', async () => {
      const packageDir = path.join(tmpDir, 'force-app');
      const componentMetaFile = path.join(packageDir, 'main/default/aura/realCmp/realCmp.cmp-meta.xml');
      const appMetaFile = path.join(packageDir, 'main/default/aura/realApp/realApp.app-meta.xml');
      const eventMetaFile = path.join(packageDir, 'main/default/aura/realEvent/realEvent.evt-meta.xml');
      const managedMetaFile = path.join(packageDir, 'main/default/aura/pkg__managedCmp/pkg__managedCmp.cmp-meta.xml');
      const staticResourceMetaFile = path.join(packageDir, 'main/default/staticresources/datapack/aura/embedded/embedded.cmp-meta.xml');

      for (const file of [componentMetaFile, appMetaFile, eventMetaFile, managedMetaFile, staticResourceMetaFile]) {
        await fs.ensureDir(path.dirname(file));
        await fs.writeFile(file, '<AuraDefinitionBundle xmlns="http://soap.sforce.com/2006/04/metadata" />');
      }

      const auraBundleFiles = await listAuraBundleFiles([{ path: packageDir }]);

      expect(auraBundleFiles).to.deep.equal([
        appMetaFile.replace(/\\/g, '/'),
        componentMetaFile.replace(/\\/g, '/'),
        eventMetaFile.replace(/\\/g, '/'),
      ]);
    });
  });
});
