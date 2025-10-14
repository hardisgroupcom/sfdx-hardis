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
import { generateMkDocsHTML, readMkDocsFile, writeMkDocsFile } from '../../../common/docBuilder/docUtils.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class MkDocsToSalesforce extends SfCommand<any> {
  public static title = 'MkDocs to Salesforce';

  public static description = `
## Command Behavior\

**Generates MkDocs HTML pages and deploys them to a Salesforce org as a static resource, Visualforce page, and Custom Tab.**

This command provides a convenient way to host your project's documentation directly within Salesforce, making it easily accessible to users. It automates the entire process of converting your MkDocs project into a deployable Salesforce package.

Key operations performed:

- **MkDocs HTML Generation:** Builds the MkDocs project into static HTML pages. It can use a locally installed \`mkdocs-material\` or a \`mkdocs\` Docker image.
- **Salesforce Metadata Creation:** Creates the necessary Salesforce metadata components:
  - A **Static Resource** to store the generated HTML, CSS, and JavaScript files.
  - A **Visualforce Page** that embeds the static resource, allowing it to be displayed within Salesforce.
  - A **Custom Tab** to provide a user-friendly entry point to the documentation from the Salesforce navigation.
  - A **Permission Set** to grant access to the Visualforce page and Custom Tab.
- **Metadata Deployment:** Deploys these newly created metadata components to the specified Salesforce org.
- **Permission Set Assignment:** Assigns the newly created permission set to the current user, ensuring immediate access to the documentation.
- **Browser Opening (Non-CI):** Opens the Custom Tab in your default browser if the command is not run in a CI/CD environment.

**Prerequisite:** The documentation must have been previously generated using \`sf hardis:doc:project2markdown --with-history\`.

**Customization:**

- You can specify the type of documentation to generate (e.g., \`CICD\` or \`Monitoring\`) using the \`--type\` flag. The default is \`CICD\`.
- You can override default styles by customizing your \`mkdocs.yml\` file.

More information can be found in the [Documentation section]($\{CONSTANTS.DOC_URL_ROOT}/salesforce-project-documentation/).\

<details markdown="1">
<summary>Technical explanations</summary>

The command orchestrates interactions with MkDocs, Salesforce CLI, and file system operations:

- **MkDocs Integration:** It first modifies the \`mkdocs.yml\` file to ensure compatibility with Salesforce static resources (e.g., setting \`use_directory_urls\` to \`false\`). Then, it calls \`generateMkDocsHTML()\` to build the static HTML content.
- **Temporary SFDX Project:** It creates a temporary SFDX project using \`createTempDir\` and \`createBlankSfdxProject\` to stage the generated Salesforce metadata before deployment.
- **Metadata Generation:** It dynamically creates the XML metadata files for the Static Resource, Visualforce Page, Custom Tab, and Permission Set. The HTML content from the MkDocs build is moved into the static resource folder.
- **Salesforce CLI Deployment:** It constructs and executes a \`sf project deploy start\` command to deploy the generated metadata to the target Salesforce org. It intelligently adds \`--test-level RunLocalTests\` for production orgs and \`--test-level NoTestRun\` for sandboxes.
- **Permission Set Assignment:** After successful deployment, it calls \`initPermissionSetAssignments\` to assign the newly created permission set to the current user.
- **Browser Launch:** For non-CI environments, it uses \`execCommand\` to open the deployed Custom Tab in the user's default browser.
- **Error Handling and Cleanup:** It includes error handling for deployment failures (e.g., static resource size limits) and ensures that the \`mkdocs.yml\` file is restored to its original state after execution.
- **File System Operations:** It extensively uses \`fs-extra\` for file manipulation, including creating directories, moving files, and writing XML content.
</details>
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
      await generateMkDocsHTML();

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
        uxLog("action", this, c.cyan(`Opening the Custom Tab ${c.green(resName)} in your default browser.`));
        uxLog("warning", this, c.yellow(`If you have an access issue, make sure the tab ${resName} is not hidden on your profile.`));
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

  private async createDocMetadatas(resName: string, defaultProjectPath: string, type: any) {
    uxLog("action", this, c.cyan(`Creating Static Resource ${resName} metadata.`));
    const staticResourcePath = path.join(defaultProjectPath, "staticresources");
    const mkDocsResourcePath = path.join(staticResourcePath, resName);
    await ensureDir(mkDocsResourcePath);
    await fs.move(path.join(process.cwd(), "site"), mkDocsResourcePath, { overwrite: true });

    // Create Static resource metadata
    uxLog("action", this, c.cyan(`Creating Static Resource ${resName} metadata.`));
    const mkDocsResourceFileName = path.join(staticResourcePath, `${resName}.resource-meta.xml`);
    const mkDocsResourceMeta = `<?xml version="1.0" encoding="UTF-8"?>
<StaticResource xmlns="http://soap.sforce.com/2006/04/metadata">
    <cacheControl>Private</cacheControl>
    <contentType>application/x-zip-compressed</contentType>
</StaticResource>
`;
    await fs.writeFile(mkDocsResourceFileName, mkDocsResourceMeta);

    // Create visual force page
    uxLog("action", this, c.cyan(`Creating Visualforce page ${resName} metadata.`));
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
    uxLog("action", this, c.cyan(`Deploying Static Resource ${resName}, Visualforce page ${resName}, Custom Tab ${resName}, and Permission Set ${resName} to org ${targetUsername}.`));
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
      uxLog("error", this, c.red(`Deployment failed:\n${deployRes.stderr + "\n" + deployRes.stdout}`));
      if ((deployRes.stderr + deployRes.stdout).includes("static resource cannot exceed")) {
        uxLog("error", this, c.red('Documentation is too big to be hosted in a static resource.'));
        uxLog("warning", this, c.yellow('Cloudity can help you host it elsewhere.'));
        uxLog("warning", this, c.yellow(`If you're interested, contact us at ${c.green(c.bold(CONSTANTS.CONTACT_URL))}.`));
      }
      else {
        uxLog("warning", this, c.yellow(`You can manually deploy the Static Resource ${resName}, the Visualforce page ${resName}, and the Custom Tab ${resName} to your org:
  - Static Resource: ${mkDocsResourcePath} (If you upload via the UI, zip the folder and ensure index.html is at the root of the zip.)
  - Visualforce page: ${vfPageMetaFile}
  - Custom Tab: ${tabMetaFile}
  - Permission Set: ${permissionSetFile}
You can also run the documentation locally using: "mkdocs serve -v" or "python -m mkdocs serve -v" or "py -m mkdocs serve -v".`));
      }
    }
    else {
      uxLog("success", this, c.green(`SFDX project documentation uploaded to Salesforce and is available in the Custom Tab ${resName}.`));
    }
    return deployRes;
  }
}
