import { expect } from 'chai';
// Load the barrel first: gitProvider modules take part in a pre-existing import cycle
// (azureDevops -> utils/index -> gitUtils -> ticketProvider/index -> jiraProvider, which extends
// TicketProviderRoot), and entering through a leaf module of it throws.
import '../../../src/common/gitProvider/index.js';
import { AzureDevopsProvider } from '../../../src/common/gitProvider/azureDevops.js';

const parseAzureRepoUrl = (url: string) => AzureDevopsProvider.parseAzureRepoUrl(url);

describe('AzureDevopsProvider.parseAzureRepoUrl', () => {
  it('parses a modern dev.azure.com remote', () => {
    expect(parseAzureRepoUrl('https://dev.azure.com/acme/Salesforce/_git/sfdx-project')).to.deep.equal({
      collectionUri: 'https://dev.azure.com/acme/',
      teamProject: 'Salesforce',
      repositoryId: 'sfdx-project',
    });
  });

  it('ignores the user prefix a clone adds to the URL', () => {
    // What `git clone` writes into origin for an Azure repo
    const parsed = parseAzureRepoUrl('https://AcmeGlobalIT@dev.azure.com/AcmeGlobalIT/QRM%20-%20Billing/_git/billing-sfdx');
    expect(parsed).to.deep.equal({
      collectionUri: 'https://dev.azure.com/AcmeGlobalIT/',
      teamProject: 'QRM - Billing',
      repositoryId: 'billing-sfdx',
    });
  });

  it('decodes a project name that contains spaces', () => {
    expect(parseAzureRepoUrl('https://dev.azure.com/acme/My%20Project/_git/repo')?.teamProject).to.equal('My Project');
  });

  it('parses a legacy visualstudio.com remote', () => {
    expect(parseAzureRepoUrl('https://acme.visualstudio.com/Salesforce/_git/sfdx-project')).to.deep.equal({
      collectionUri: 'https://acme.visualstudio.com/',
      teamProject: 'Salesforce',
      repositoryId: 'sfdx-project',
    });
  });

  it('parses an SSH remote', () => {
    expect(parseAzureRepoUrl('git@ssh.dev.azure.com:v3/acme/Salesforce/sfdx-project')).to.deep.equal({
      collectionUri: 'https://dev.azure.com/acme/',
      teamProject: 'Salesforce',
      repositoryId: 'sfdx-project',
    });
  });

  it('returns null for another provider, or for nonsense', () => {
    for (const url of [
      'https://github.com/acme/repo.git',
      'https://gitlab.com/acme/group/repo.git',
      'git@github.com:acme/repo.git',
      'https://bitbucket.org/acme/repo.git',
      '',
      'not a url',
    ]) {
      expect(parseAzureRepoUrl(url), url).to.equal(null);
    }
  });
});
