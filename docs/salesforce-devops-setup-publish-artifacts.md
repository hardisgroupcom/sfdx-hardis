---
title: Publish sfdx-hardis reports as CI job artifacts
description: Add the hardis-report artifact upload step to existing GitHub, GitLab, Azure, Bitbucket or Jenkins pipelines, so deployment result files remain available after the job
---

<!-- markdownlint-disable MD013 -->

## Publish job artifacts

During check and deployment jobs, sfdx-hardis writes its detailed reports in the **hardis-report** folder of the workspace:

- the complete deployment result JSON (`deploy-result-*.json`), not displayed in the console anymore to keep logs readable
- Apex tests and coverage outputs
- various command reports (CSV, XLSX, JSON, logs)

If your pipeline was generated recently, the artifact upload step is already there. Pipelines created with an older version of sfdx-hardis may miss it: without it, the reports are lost when the job ends, and the `Full deployment JSON: ...` line of the deployment summary points to a file nobody can open.

Add the step matching your platform at the end of every job running `sf hardis:project:deploy:smart` (check and deployment jobs), or any other sfdx-hardis command whose reports you want to keep.

### GitHub Actions

Add at the end of the `steps` of the job, in `.github/workflows/check-deploy.yml` and `.github/workflows/process-deploy.yml`:

```yaml
# Upload sfdx-hardis reports, including the complete deployment result JSON
- name: Archive sfdx-hardis reports
  if: success() || failure()
  uses: actions/upload-artifact@v4
  with:
    name: sfdx-hardis reports
    path: hardis-report
```

Artifacts are then downloadable from the run page, in the **Artifacts** section.

### GitLab CI

Add an `artifacts` property to the check and deployment jobs of `.gitlab-ci.yml`:

```yaml
artifacts:
  when: always
  paths:
    - hardis-report
  expire_in: 8 week
```

Artifacts are then downloadable from the job page, in the right side panel.

### Azure Pipelines

Add at the end of the `steps` of the job, in `azure-pipelines-checks.yml` and `azure-pipelines-deployment.yml`:

```yaml
# Publish sfdx-hardis reports, including the complete deployment result JSON
- publish: $(System.DefaultWorkingDirectory)/hardis-report/
  condition: succeededOrFailed()
  artifact: hardis-report
  displayName: Publish sfdx-hardis reports
```

Artifacts are then available from the run page, in **Related > Published artifacts**.

### Bitbucket Pipelines

Add an `artifacts` property to the check and deployment steps of `bitbucket-pipelines.yml`:

```yaml
artifacts:
  - hardis-report/**
```

Artifacts are then downloadable from the pipeline page, in the **Artifacts** tab.

### Jenkins

Add a `post` section to the check and deployment stages of your `Jenkinsfile`:

```groovy
            post {
                always {
                    archiveArtifacts allowEmptyArchive: true, artifacts: 'hardis-report/**', defaultExcludes: false, followSymlinks: false
                }
            }
```

Artifacts are then available from the build page, in **Archived artifacts**.

### Reference pipelines

The up-to-date pipeline templates shipped with sfdx-hardis already contain these steps: [defaults/ci](https://github.com/hardisgroupcom/sfdx-hardis/tree/main/defaults/ci). Compare them with your own pipelines when in doubt.
