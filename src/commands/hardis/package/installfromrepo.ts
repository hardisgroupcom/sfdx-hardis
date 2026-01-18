/* jscpd:ignore-start */
import { SfCommand, Flags } from '@salesforce/sf-plugins-core';
import { Messages } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import c from 'chalk';
import fs from 'fs-extra';
import * as path from 'path';
import { createTempDir, execCommand, uxLog } from '../../../common/utils/index.js';
import { promptOrgUsernameDefault } from '../../../common/utils/orgUtils.js';
import { isSfdxProject } from '../../../common/utils/projectUtils.js';
import { prompts } from '../../../common/utils/prompts.js';
import { MetadataUtils } from '../../../common/metadata-utils/index.js';

Messages.importMessagesDirectoryFromMetaUrl(import.meta.url);
const messages = Messages.loadMessages('sfdx-hardis', 'org');

export default class PackageInstallFromRepo extends SfCommand<any> {
  public static title = 'Install package from GitHub repository';

  public static description = `
## Command Behavior

**Installs a Salesforce package from a GitHub repository, either as source code or as a managed/unlocked package.**

This command streamlines the process of discovering, cloning, and installing Salesforce packages directly from GitHub repositories. It provides flexibility to either copy the source code locally for customization or install the package directly into an org.

Key functionalities:

- **Repository Discovery:** Prompts for a GitHub repository URL containing an SFDX project (e.g., https://github.com/SalesforceLabs/LightningWebChartJS).
- **Package Selection:** Clones the repository to a temporary directory, parses its \`sfdx-project.json\`, and allows you to select which package to install from available options.
- **Local Installation:** If the current directory is an SFDX project, offers to copy the package source code locally with a custom folder name.
- **sfdx-project.json Update:** Automatically updates the local \`sfdx-project.json\` to include the new package directory.
- **Org Deployment:** Provides options to deploy the package to an org either:
  - By deploying the source code using \`sf project deploy start\`
  - By installing the package using its ID (04t...) via \`sf package install\`

<details markdown="1">
<summary>Technical explanations</summary>

The command's technical implementation involves:

- **Temporary Directory Management:** Uses \`createTempDir\` to create a temporary workspace for cloning the GitHub repository.
- **Git Integration:** Executes \`git clone\` commands to fetch the repository contents.
- **SFDX Project Parsing:** Reads and parses \`sfdx-project.json\` from both the cloned repository and the current directory (if applicable).
- **Interactive Prompts:** Uses the \`prompts\` utility to guide users through package selection, local installation preferences, and deployment options.
- **File System Operations:** Uses \`fs-extra\` for directory copying and JSON file manipulation.
- **Salesforce CLI Integration:** 
  - Constructs and executes \`sf project deploy start\` commands for source-based deployments
  - Uses \`sf package install\` for package ID-based installations via MetadataUtils
- **Org Selection:** Leverages \`promptOrgUsernameDefault\` for target org selection when deploying.
</details>
`;

  public static examples = [
    '$ sf hardis:package:installfromrepo',
    '$ sf hardis:package:installfromrepo --debug'
  ];

  public static flags: any = {
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
  };

  /* jscpd:ignore-end */

  public async run(): Promise<AnyJson> {
    const { flags } = await this.parse(PackageInstallFromRepo);
    const debugMode = flags.debug || false;

    // Prompt for GitHub repository URL
    const repoUrlResponse = await prompts({
      type: 'text',
      name: 'value',
      message: c.cyanBright('Please enter the GitHub repository URL (e.g., https://github.com/SalesforceLabs/LightningWebChartJS)'),
      description: 'Enter the full GitHub repository URL containing the SFDX project you want to install',
      placeholder: 'Ex: https://github.com/SalesforceLabs/LightningWebChartJS',
      validate: (value: string) => {
        if (!value || value.trim() === '') {
          return 'Repository URL is required';
        }
        // Validate GitHub URL pattern more strictly
        const githubUrlPattern = /^https?:\/\/(www\.)?github\.com\/[\w-]+\/[\w.-]+\/?$/;
        if (!githubUrlPattern.test(value.trim())) {
          return 'Please provide a valid GitHub repository URL (e.g., https://github.com/owner/repo)';
        }
        return true;
      },
    });

    const repoUrl = repoUrlResponse.value.trim();
    
    // Sanitize repository URL to prevent command injection
    const sanitizedRepoUrl = repoUrl.replace(/[;`$&|<>]/g, '');
    if (sanitizedRepoUrl !== repoUrl) {
      uxLog("error", this, c.red('Invalid characters detected in repository URL'));
      throw new Error('Invalid repository URL');
    }
    
    uxLog("action", this, c.cyan(`Cloning repository ${c.green(repoUrl)}...`));

    // Clone the repository to a temporary directory
    const tempDir = await createTempDir();
    const cloneCommand = `git clone "${sanitizedRepoUrl}" "${tempDir}"`;
    
    try {
      await execCommand(cloneCommand, this, {
        fail: true,
        output: debugMode,
        debug: debugMode,
      });
      uxLog("action", this, c.green('Repository cloned successfully'));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('Authentication failed')) {
        uxLog("error", this, c.red('Failed to clone repository: Authentication required. Please check repository access.'));
      } else if (errorMessage.includes('not found') || errorMessage.includes('Repository not found')) {
        uxLog("error", this, c.red('Failed to clone repository: Repository not found. Please check the URL.'));
      } else if (errorMessage.includes('network') || errorMessage.includes('Could not resolve host')) {
        uxLog("error", this, c.red('Failed to clone repository: Network issue detected. Please check your internet connection.'));
      } else {
        uxLog("error", this, c.red(`Failed to clone repository: ${errorMessage}`));
      }
      throw error;
    }

    // Read sfdx-project.json from cloned repository
    const repoProjectJsonPath = path.join(tempDir, 'sfdx-project.json');
    if (!fs.existsSync(repoProjectJsonPath)) {
      uxLog("error", this, c.red('No sfdx-project.json found in the cloned repository. This does not appear to be a valid SFDX project.'));
      throw new Error('Invalid SFDX project: sfdx-project.json not found');
    }

    const repoProjectJson = await fs.readJson(repoProjectJsonPath);
    const packageDirectories = repoProjectJson.packageDirectories || [];

    if (packageDirectories.length === 0) {
      uxLog("error", this, c.red('No package directories found in sfdx-project.json'));
      throw new Error('No packages found in repository');
    }

    // Prompt user to select a package
    const packageChoices = packageDirectories.map((pkg: any) => ({
      title: `${c.yellow(pkg.package || pkg.path)} ${pkg.versionName ? `- ${pkg.versionName}` : ''}`,
      value: pkg,
      description: pkg.path,
    }));

    const packageResponse = await prompts({
      type: 'select',
      name: 'value',
      message: c.cyanBright('Please select the package to install'),
      description: 'Choose which package from the repository you want to install',
      choices: packageChoices,
    });

    const selectedPackage = packageResponse.value;
    const packagePath = selectedPackage.path;
    const packageFullPath = path.join(tempDir, packagePath);

    uxLog("action", this, c.cyan(`Selected package: ${c.green(selectedPackage.package || packagePath)}`));

    let localPackagePath: string | null = null;
    const isCurrentDirSfdxProject = isSfdxProject();

    // If current folder is an SFDX project, ask if user wants to install sources locally
    if (isCurrentDirSfdxProject) {
      const installLocallyResponse = await prompts({
        type: 'confirm',
        name: 'value',
        message: c.cyanBright('Do you want to install the package sources locally in your current project?'),
        description: 'If yes, the package source code will be copied to your project directory',
        initial: true,
      });

      if (installLocallyResponse.value === true) {
        // Prompt for local package name
        const defaultPackageName = packagePath !== 'force-app' ? packagePath : selectedPackage.package || 'imported-package';
        const packageNameResponse = await prompts({
          type: 'text',
          name: 'value',
          message: c.cyanBright('What should be the local folder name for this package?'),
          description: 'Specify the directory name where the package will be stored locally',
          placeholder: defaultPackageName,
          initial: defaultPackageName,
        });

        const tempLocalPackagePath = packageNameResponse.value.trim();
        const localPackageFullPath = path.join(process.cwd(), tempLocalPackagePath);

        // Check if the directory already exists
        if (fs.existsSync(localPackageFullPath)) {
          uxLog("warning", this, c.yellow(`Directory ${tempLocalPackagePath} already exists. It will be overwritten.`));
          const confirmOverwrite = await prompts({
            type: 'confirm',
            name: 'value',
            message: c.cyanBright(`Are you sure you want to overwrite ${tempLocalPackagePath}?`),
            description: 'Existing files in this directory will be replaced',
            initial: false,
          });

          if (confirmOverwrite.value !== true) {
            uxLog("log", this, c.grey('Skipping local installation'));
            localPackagePath = null;
          } else {
            await fs.remove(localPackageFullPath);
            localPackagePath = tempLocalPackagePath;
          }
        } else {
          localPackagePath = tempLocalPackagePath;
        }

        // Copy the package folder to current directory
        if (localPackagePath) {
          uxLog("action", this, c.cyan(`Copying package sources to ${c.green(localPackagePath)}...`));
          await fs.copy(packageFullPath, path.join(process.cwd(), localPackagePath));
          uxLog("action", this, c.green('Package sources copied successfully'));

          // Update current sfdx-project.json
          const currentProjectJsonPath = path.join(process.cwd(), 'sfdx-project.json');
          const currentProjectJson = await fs.readJson(currentProjectJsonPath);
          
          // Check if package directory already exists in project json
          const existingPkgIndex = currentProjectJson.packageDirectories?.findIndex(
            (pkg: any) => pkg.path === localPackagePath
          );

          if (existingPkgIndex >= 0) {
            uxLog("log", this, c.grey(`Package directory ${localPackagePath} already exists in sfdx-project.json, updating...`));
            currentProjectJson.packageDirectories[existingPkgIndex] = {
              ...currentProjectJson.packageDirectories[existingPkgIndex],
              ...selectedPackage,
              path: localPackagePath,
            };
          } else {
            // Add new package directory
            currentProjectJson.packageDirectories = currentProjectJson.packageDirectories || [];
            currentProjectJson.packageDirectories.push({
              path: localPackagePath,
              default: false,
              package: selectedPackage.package,
              versionName: selectedPackage.versionName,
              versionNumber: selectedPackage.versionNumber,
            });
          }

          await fs.writeJson(currentProjectJsonPath, currentProjectJson, { spaces: 2 });
          uxLog("action", this, c.green('sfdx-project.json updated successfully'));
        }
      }
    }

    // Ask if user wants to deploy the package to an org
    const deployToOrgResponse = await prompts({
      type: 'confirm',
      name: 'value',
      message: c.cyanBright('Do you want to deploy the package to an org?'),
      description: 'Deploy the package sources or install the package by ID to a Salesforce org',
      initial: true,
    });

    if (deployToOrgResponse.value === true) {
      // Get default org
      const currentOrg = await MetadataUtils.getCurrentOrg();
      let targetOrgUsername: string;

      if (currentOrg && !flags.skipauth) {
        targetOrgUsername = await promptOrgUsernameDefault(
          this,
          currentOrg.username,
          { devHub: false, setDefault: true, message: `Do you want to use org ${currentOrg.username}?` }
        );
      } else {
        uxLog("error", this, c.red('No default org found. Please authenticate to an org first using: sf org login web'));
        throw new Error('No authenticated org available');
      }

      uxLog("action", this, c.cyan(`Target org: ${c.green(targetOrgUsername)}`));

      // Determine deployment method
      if (localPackagePath) {
        // Sources are installed locally, ask if user wants to deploy sources or use package ID
        const deployMethodResponse = await prompts({
          type: 'select',
          name: 'value',
          message: c.cyanBright('How do you want to deploy the package?'),
          description: 'Choose between deploying source code or installing via package ID',
          choices: [
            { title: 'Deploy source code from local folder', value: 'source' },
            { title: 'Install package using package ID (04t...)', value: 'packageId' },
          ],
        });

        if (deployMethodResponse.value === 'source') {
          // Deploy sources using sf project deploy start
          await this.deploySourceCode(localPackagePath, targetOrgUsername, debugMode);
        } else {
          // Install using package ID
          await this.installPackageById(selectedPackage, repoProjectJson, targetOrgUsername);
        }
      } else {
        // No local sources, determine if we should deploy from temp or use package ID
        const hasPackageId = selectedPackage.package && repoProjectJson.packageAliases && 
                            repoProjectJson.packageAliases[selectedPackage.package];
        
        if (hasPackageId) {
          const deployMethodResponse = await prompts({
            type: 'select',
            name: 'value',
            message: c.cyanBright('How do you want to deploy the package?'),
            description: 'Choose between deploying source code or installing via package ID',
            choices: [
              { title: 'Deploy source code from repository', value: 'source' },
              { title: 'Install package using package ID (04t...)', value: 'packageId' },
            ],
          });

          if (deployMethodResponse.value === 'source') {
            // Deploy sources from temp directory
            await this.deploySourceCode(packageFullPath, targetOrgUsername, debugMode);
          } else {
            await this.installPackageById(selectedPackage, repoProjectJson, targetOrgUsername);
          }
        } else {
          // No package ID available, only deploy sources
          await this.deploySourceCode(packageFullPath, targetOrgUsername, debugMode);
        }
      }
    }

    uxLog("action", this, c.green('✓ Package installation completed successfully'));

    // Return result
    return {
      outputString: 'Package installed from repository',
      repository: repoUrl,
      package: selectedPackage.package || packagePath,
      localPath: localPackagePath,
    };
  }

  private async deploySourceCode(sourcePath: string, targetOrgUsername: string, debugMode: boolean): Promise<void> {
    // Sanitize paths to prevent command injection
    const sanitizedSourcePath = sourcePath.replace(/[;`$&|<>]/g, '');
    const sanitizedTargetOrg = targetOrgUsername.replace(/[;`$&|<>]/g, '');
    
    if (sanitizedSourcePath !== sourcePath || sanitizedTargetOrg !== targetOrgUsername) {
      uxLog("error", this, c.red('Invalid characters detected in path or org name'));
      throw new Error('Invalid deployment parameters');
    }
    
    uxLog("action", this, c.cyan(`Deploying sources from ${c.green(sourcePath)}...`));
    const deployCommand = `sf project deploy start --source-dir "${sanitizedSourcePath}" --target-org "${sanitizedTargetOrg}" --wait 60`;
    await execCommand(deployCommand, this, {
      fail: true,
      output: true,
      debug: debugMode,
    });
    uxLog("action", this, c.green('Package deployed successfully'));
  }

  private async installPackageById(selectedPackage: any, repoProjectJson: any, targetOrgUsername: string): Promise<void> {
    // Get package version ID from package aliases
    let packageVersionId: string | null = null;
    
    if (selectedPackage.package && repoProjectJson.packageAliases) {
      // Try to find the package version ID in aliases
      const aliases = repoProjectJson.packageAliases;
      
      // First try exact match
      if (aliases[selectedPackage.package]) {
        packageVersionId = aliases[selectedPackage.package];
      } else {
        // Try to find with version suffix
        const matchingAlias = Object.keys(aliases).find(alias => 
          alias.startsWith(selectedPackage.package + '@')
        );
        if (matchingAlias) {
          packageVersionId = aliases[matchingAlias];
        }
      }
    }

    // If no package ID found in aliases, prompt user
    if (!packageVersionId || !packageVersionId.startsWith('04t')) {
      const packageIdResponse = await prompts({
        type: 'text',
        name: 'value',
        message: c.cyanBright('Please enter the package version ID (04t...)'),
        description: 'Enter the 04t package version ID to install',
        placeholder: 'Ex: 04t2p000000XXXXXX',
        validate: (value: string) => {
          if (!value || !value.startsWith('04t')) {
            return 'Package version ID must start with 04t';
          }
          return true;
        },
      });
      packageVersionId = packageIdResponse.value.trim();
    }

    // Ask for installation key if needed
    const installKeyResponse = await prompts({
      type: 'text',
      name: 'value',
      message: c.cyanBright('Enter the installation key (leave empty if package is not password-protected)'),
      description: 'Provide the installation password if the package requires it',
      placeholder: 'Leave empty for public packages',
    });

    const installationKey = installKeyResponse.value?.trim() || '';

    // Install package using MetadataUtils
    uxLog("action", this, c.cyan(`Installing package ${c.green(packageVersionId)}...`));
    
    const packageToInstall = {
      SubscriberPackageVersionId: packageVersionId,
      SubscriberPackageName: selectedPackage.package || 'Package',
      SubscriberPackageVersionName: selectedPackage.versionName,
      installationkey: installationKey || undefined,
    };

    await MetadataUtils.installPackagesOnOrg([packageToInstall], targetOrgUsername, this, 'install');
    uxLog("action", this, c.green('Package installed successfully'));
  }
}
