// Parsing of an Azure DevOps git remote URL into the organization, project and repository it names.
//
// A leaf module on purpose: pure string work, zero imports. Both the git provider and the Azure
// Boards ticket connector need it, and putting it in either of them would close an import cycle
// through utils/index -> gitUtils -> ticketProvider/index.

export interface AzureRepoUrlParts {
  /** Organization URL, with the trailing slash Azure Pipelines' System.CollectionUri also carries */
  collectionUri: string;
  teamProject: string;
  repositoryId: string;
}

/**
 * Extracts the organization, project and repository from an Azure DevOps remote URL.
 *
 * Handles the three shapes a clone can produce - modern `dev.azure.com` (with or without the
 * `user@` prefix), legacy `*.visualstudio.com`, and SSH - and URL-decodes the project and repository
 * names, which are percent-encoded whenever they contain a space.
 *
 * Returns null when the URL belongs to another provider.
 */
export function parseAzureRepoUrl(remoteUrl: string): AzureRepoUrlParts | null {
  if (remoteUrl.startsWith("https://")) {
    // https://dev.azure.com/{org}/{project}/_git/{repo}, optionally prefixed with {user}@
    const devAzureMatch = remoteUrl.match(/https:\/\/(?:[^@]+@)?dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/?]+)/);
    if (devAzureMatch) {
      return {
        collectionUri: `https://dev.azure.com/${devAzureMatch[1]}/`,
        teamProject: decodeURIComponent(devAzureMatch[2]),
        repositoryId: decodeURIComponent(devAzureMatch[3]),
      };
    }

    // https://{org}.visualstudio.com/{project}/_git/{repo}
    const vsMatch = remoteUrl.match(/https:\/\/(?:[^@]+@)?([^.]+)\.visualstudio\.com\/([^/]+)\/_git\/([^/?]+)/);
    if (vsMatch) {
      return {
        collectionUri: `https://${vsMatch[1]}.visualstudio.com/`,
        teamProject: decodeURIComponent(vsMatch[2]),
        repositoryId: decodeURIComponent(vsMatch[3]),
      };
    }
  } else if (remoteUrl.startsWith("git@")) {
    // git@ssh.dev.azure.com:v3/{org}/{project}/{repo}
    const sshMatch = remoteUrl.match(/git@ssh\.dev\.azure\.com:v3\/([^/]+)\/([^/]+)\/([^/]+)/);
    if (sshMatch) {
      return {
        collectionUri: `https://dev.azure.com/${sshMatch[1]}/`,
        teamProject: decodeURIComponent(sshMatch[2]),
        repositoryId: decodeURIComponent(sshMatch[3]),
      };
    }
  }
  return null;
}
