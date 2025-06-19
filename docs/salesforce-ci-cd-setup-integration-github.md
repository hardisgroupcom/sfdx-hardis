---
title: Configure Integrations between sfdx-hardis and GitHub
description: Post Deployment Status Comments on GitHub Pull Request from CI jobs
---
<!-- markdownlint-disable MD013 -->

## GitHub Pull Requests comments

In order to avoid to have to open job logs to see deployment errors, sfdx-hardis can post them as Comment on the Pull Request UI

To use this capability, all you need is to have **permissions on your workflows** and send your **GITHUB_TOKEN** (see [full example](https://github.com/hardisgroupcom/sfdx-hardis/blob/main/defaults/ci/.github/workflows/process-deploy.yml))

```yaml
    permissions:
      pull-requests: write

...
      env:
        GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        FORCE_COLOR: "1"
```

Everytime you will make a Pull Request, the CI job will post its result as comment !

- Example with deployment success

![](assets/images/screenshot-gha-success.jpg)

- Example with deployment errors

![](assets/images/screenshot-gha-error.jpg)

Notes:

- This integration works with sfdx-hardis pipeline, but also on home-made pipelines, just call [sf hardis:project:deploy:start](https://sfdx-hardis.cloudity.com/hardis/project/deploy/start/) instead of `sf project:deploy:start` !

- This integration use the following variables:

  - GITHUB_TOKEN (provided by GitHub but has to be send as option to the deployment jobs)

## Using GitHub integration without Github Actions

You might want to use GitHub integration with other tools than GitHub Actions, like Jenkins or Codefresh

In that case, to still benefit from GitHub integration, you need to make sure that the following variables are set.

| Variable                | Description                                                                                                                                                                    |
|:------------------------|:-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| GITHUB_TOKEN            | You might need to Create a [GitHub Personal Access Token](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens) |
| GITHUB_REPOSITORY       | ex: `MyClient/crm-salesforce`                                                                                                                                                  |
| GITHUB_REPOSITORY_OWNER | ex: `MyClient`                                                                                                                                                                 |
| GITHUB_SERVER_URL       | ex: `https://github.mycompanydomain.com`                                                                                                                                       |
| GITHUB_API_URL          | ex: `https://github.mycompanydomain.com/api`                                                                                                                                   |
| GITHUB_GRAPHQL_URL      | ex: `https://github.mycompanydomain.com/api/graphql`                                                                                                                           |
| GITHUB_WORKFLOW         | ex: `Simulate Deployment (sfdx-hardis)`                                                                                                                                        |
| GITHUB_REF              | ex: `refs/pull/503/merge`                                                                                                                                                      |
| GITHUB_REF_NAME         | ex: `503/merge`                                                                                                                                                                |
| GITHUB_RUN_ID           | ex: `14282257027`. If you can't have it, to not set the variable.                                                                                                              |
| PIPELINE_JOB_URL        | Direct link to the page where we can see your job results. ex: `https://yourserver.com/jobs/345`                                                                               |

