/* jscpd:ignore-start */
import { SfCommand, Flags, requiredOrgFlagWithDeprecations } from '@salesforce/sf-plugins-core';
import fs, { ensureDir } from 'fs-extra';
import c from "chalk";
import * as path from "path";
import { Messages, SfError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import { createTempDir, execCommand, isCI, uxLog } from '../../../common/utils/index.js';
import { createBlankSfdxProject } from '../../../common/utils/projectUtils.js';
import { initPermissionSetAssignments, isProductionOrg } from '../../../common/utils/orgUtils.js';
import { CONSTANTS } from '../../../config/index.js';
import { readMkDocsFile, writeMkDocsFile } from '../../../common/utils/docUtils.js';


Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class MkDocsToSalesforce extends SfCommand<any> {
  public static title = 'MkDocs to Salesforce';

  public static description = `Generates MkDocs HTML pages and upload them to Salesforce as a static resource

This command performs the following operations:

- Generates MkDocs HTML pages (using locally installed mkdocs-material, or using mkdocs docker image)
- Creates a Static Resource, a VisualForce page and a Custom Tab metadata
- Upload the metadatas to the default org
- Opens the Custom Tab in the default browser (only if not in CI context)

Note: the documentation must have been previously generated using "sf hardis:doc:project2markdown --with-history"

You can:

- Specify the type of documentation to generate (CICD or Monitoring) using the --type flag. Default is CICD.
- Override default styles by customizing mkdocs.yml

More info on [Documentation section](${CONSTANTS.DOC_URL_ROOT}/salesforce-project-documentation/)
`;

  public static examples = [
    '$ sf hardis:doc:mkdocs-to-salesforce',
  ];

  public static flags: any = {
    type: Flags.string({
      char: 't',
      options: ["CICD", "Monitoring"],
      default: "CICD",
      description: 'Type of the documentation to generate. Default is "all"',
    }),
    debug: Flags.boolean({
      char: 'd',
      default: false,
      description: messages.getMessage('debugMode'),
    }),
    websocket: Flags.string({
      description: messages.getMessage('websocket'),
    }),
    skipauth: Flags.boolean({
      description: 'Skip authentication check when a default username is required',
    }),
    'target-org': requiredOrgFlagWithDeprecations,
  };

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  public static requiresProject = true;

  protected debugMode = false;
  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(MkDocsToSalesforce);
    const type = flags.type || "CICD";
    const targetUsername = flags['target-org'].getUsername();
    const conn = flags['target-org'].getConnection();
    this.debugMode = flags.debug || false;

    // Check if the project is a MkDocs project
    const mkdocsYmlFile = path.join(process.cwd(), "mkdocs.yml");
    if (!fs.existsSync(mkdocsYmlFile)) {
      throw new SfError('This command needs a mkdocs.yml config file. Generate one using "sf hardis:doc:project2markdown --with-history"');
    }

    // Update mkdocs.yml so it is compliant with being hosted in a static resource
    const mkdocsYml: any = readMkDocsFile(mkdocsYmlFile);
    const mkdocsYmlCopy = Object.assign({}, mkdocsYml);
    mkdocsYmlCopy.use_directory_urls = false;
    await writeMkDocsFile(mkdocsYmlFile, mkdocsYmlCopy);

    try {
      // Generate HTML pages
      await this.generateMkDocsHTML();

      // Create temp sfdx project
      const tmpDirForSfdxProject = await createTempDir();
      const tmpProjectPath = await createBlankSfdxProject(tmpDirForSfdxProject);
      const defaultProjectPath = path.join(tmpProjectPath, "force-app", "main", "default");

      // Create static resource folder
      const resName = `SfdxHardis_MkDocsSite_${type}`;
      const { mkDocsResourcePath, vfPageMetaFile, tabMetaFile, permissionSetFile } = await this.createDocMetadatas(resName, defaultProjectPath, type);

      // Upload resource to remote org
      const deployRes = await this.uploadDocMetadatas(resName, targetUsername, conn, tmpProjectPath, mkDocsResourcePath, vfPageMetaFile, tabMetaFile, permissionSetFile);

      const success = deployRes.status === 0;

      if (success) {
        // Assign current user to newly created permission set
        await initPermissionSetAssignments([resName], targetUsername);
      }

      if (success && !isCI) {
        uxLog(this, c.cyan(`Opening the Custom Tab ${c.green(resName)} in your default browser...`));
        uxLog(this, c.yellow(`If you have an access issue, make sure the tab ${resName} is not hidden on your Profile...`));
        const sfPath = `lightning/n/${resName}`;
        await execCommand(`sf org open --path ${sfPath} --target-org ${targetUsername}`, this, { fail: false, output: true, debug: this.debugMode });
      }
      // Restore previous mkdocs.yml version
      await writeMkDocsFile(mkdocsYmlFile, mkdocsYml);
      return { success: success };
    } catch (e) {
      // Restore previous mkdocs.yml version
      await writeMkDocsFile(mkdocsYmlFile, mkdocsYml);
      throw e;
    }
  }

  private async installMkDocs() {
    uxLog(this, c.cyan("Managing mkdocs-material local installation..."));
    let mkdocsLocalOk = false;
    const installMkDocsRes = await execCommand("pip install mkdocs-material mdx_truly_sane_lists || python -m install mkdocs-material mdx_truly_sane_lists || py -m install mkdocs-material mdx_truly_sane_lists", this, { fail: false, output: true, debug: this.debugMode });
    if (installMkDocsRes.status === 0) {
      mkdocsLocalOk = true;
    }
    return mkdocsLocalOk;
  }

  private async generateMkDocsHTML() {
    const mkdocsLocalOk = await this.installMkDocs();
    if (mkdocsLocalOk) {
      // Generate MkDocs HTML pages with local MkDocs
      uxLog(this, c.cyan("Generating HTML pages with mkdocs..."));
      const mkdocsBuildRes = await execCommand("mkdocs build || python -m mkdocs build || py -m mkdocs build", this, { fail: false, output: true, debug: this.debugMode });
      if (mkdocsBuildRes.status !== 0) {
        throw new SfError('MkDocs build failed:\n' + mkdocsBuildRes.stderr + "\n" + mkdocsBuildRes.stdout);
      }
    }
    else {
      // Generate MkDocs HTML pages with Docker
      uxLog(this, c.cyan("Generating HTML pages with Docker..."));
      const mkdocsBuildRes = await execCommand("docker run --rm -v $(pwd):/docs squidfunk/mkdocs-material build", this, { fail: false, output: true, debug: this.debugMode });
      if (mkdocsBuildRes.status !== 0) {
        throw new SfError('MkDocs build with docker failed:\n' + mkdocsBuildRes.stderr + "\n" + mkdocsBuildRes.stdout);
      }
    }
  }

  private async createDocMetadatas(resName: string, defaultProjectPath: string, type: any) {
    uxLog(this, c.cyan(`Creating Static Resource ${resName} metadata...`));
    const staticResourcePath = path.join(defaultProjectPath, "staticresources");
    const mkDocsResourcePath = path.join(staticResourcePath, resName);
    await ensureDir(mkDocsResourcePath);
    await fs.move(path.join(process.cwd(), "site"), mkDocsResourcePath, { overwrite: true });

    // Create Static resource metadata
    uxLog(this, c.cyan(`Creating Static Resource ${resName} metadata...`));
    const mkDocsResourceFileName = path.join(staticResourcePath, `${resName}.resource-meta.xml`);
    const mkDocsResourceMeta = `<?xml version="1.0" encoding="UTF-8"?>
<StaticResource xmlns="http://soap.sforce.com/2006/04/metadata">
    <cacheControl>Private</cacheControl>
    <contentType>application/x-zip-compressed</contentType>
</StaticResource>
`;
    await fs.writeFile(mkDocsResourceFileName, mkDocsResourceMeta);

    // Create visual force page
    uxLog(this, c.cyan(`Creating VisualForce page ${resName} metadata...`));
    const vfPagesPath = path.join(defaultProjectPath, "pages");
    await ensureDir(vfPagesPath);
    const vfPageFileName = path.join(vfPagesPath, `${resName}.page`);
    const vfPageCode = `<apex:page >
    <iframe src="/resource/${resName}/index.html" width="100%" height="1000px" frameborder="0"></iframe>
</apex:page>
`;
    await fs.writeFile(vfPageFileName, vfPageCode);

    // Create visual force page metadata
    const vfPageMetaFile = path.join(vfPagesPath, `${resName}.page-meta.xml`);
    const vfPageMeta = `<?xml version="1.0" encoding="UTF-8"?>
<ApexPage xmlns="http://soap.sforce.com/2006/04/metadata">
    <apiVersion>62.0</apiVersion>
    <availableInTouch>false</availableInTouch>
    <confirmationTokenRequired>false</confirmationTokenRequired>
    <label>${resName}</label>
</ApexPage>
`;
    await fs.writeFile(vfPageMetaFile, vfPageMeta);

    // Create custom tab metadata
    const tabsPath = path.join(defaultProjectPath, "tabs");
    await ensureDir(tabsPath);
    const tabMetaFile = path.join(tabsPath, `${resName}.tab-meta.xml`);
    const tabMeta = `<?xml version="1.0" encoding="UTF-8"?>
<CustomTab xmlns="http://soap.sforce.com/2006/04/metadata">
    <label>${type === 'CICD' ? 'Sfdx-Hardis DOC (from CI/CD)' : 'Sfdx-Hardis DOC (from Monitoring)'}</label>
    <motif>Custom46: Postage</motif>
    <page>${resName}</page>
</CustomTab>
`;
    await fs.writeFile(tabMetaFile, tabMeta);

    // Create Permission Set metadata
    const permissionSetsPath = path.join(defaultProjectPath, "permissionsets");
    await ensureDir(permissionSetsPath);
    const permissionSetFile = path.join(tabsPath, `${resName}.permissionset-meta.xml`);
    const permissionSetMeta = `<?xml version="1.0" encoding="UTF-8"?>
<PermissionSet xmlns="http://soap.sforce.com/2006/04/metadata">
    <description>Permissions to Visualize Project Documentation, including Flow history, generated with sfdx-hardis from Git</description>
    <hasActivationRequired>true</hasActivationRequired>
    <label>${resName}</label>
    <pageAccesses>
        <apexPage>${resName}</apexPage>
        <enabled>true</enabled>
    </pageAccesses>
</PermissionSet>
`;
    await fs.writeFile(permissionSetFile, permissionSetMeta);

    return { mkDocsResourcePath, vfPageMetaFile, tabMetaFile, permissionSetFile };
  }

  private async uploadDocMetadatas(resName: string, targetUsername: any, conn: any, tmpProjectPath: string, mkDocsResourcePath: string, vfPageMetaFile: string, tabMetaFile: string, permissionSetFile: string) {
    uxLog(this, c.cyan(`Deploying Static Resource ${resName}, VisualForce page ${resName}, Custom Tab ${resName} and Permission Set ${resName} to org ${targetUsername}...`));
    let deployCommand = `sf project deploy start -m StaticResource:${resName} -m ApexPage:${resName} -m CustomTab:${resName} -m PermissionSet:${resName} --ignore-conflicts --ignore-warnings --target-org ${targetUsername}`;
    const isProdOrg = await isProductionOrg(targetUsername, { conn: conn });
    if (isProdOrg) {
      deployCommand += " --test-level RunLocalTests";
    }
    else {
      deployCommand += " --test-level NoTestRun";
    }

    let deployRes = { status: 1, stdout: "", stderr: "" };
    try {
      deployRes = await execCommand(deployCommand, this, { cwd: tmpProjectPath, fail: false, output: true, debug: this.debugMode });
    } catch (e: any) {
      deployRes.status = e.code;
      deployRes.stderr = e.stderr;
      deployRes.stdout = e.stdout;
    }
    if (deployRes.status !== 0) {
      uxLog(this, c.red(`Deployment failed:\n${deployRes.stderr + "\n" + deployRes.stdout}`));
      uxLog(this, c.yellow(`You can manually deploy the Static Resource ${resName},the VisualForce page ${resName} and the custom tab ${resName} to your org
- Static Resource: ${mkDocsResourcePath} (If you upload using UI, zip the folder and make sure to have index.html at the zip root)
- VisualForce page: ${vfPageMetaFile}
- Custom tab: ${tabMetaFile}
- Permission Set: ${permissionSetFile}
`));
    }
    else {
      uxLog(this, c.green(`SFDX Project documentation uploaded to salesforce and available in Custom Tab ${resName}`));
    }
    return deployRes;
  }
}
