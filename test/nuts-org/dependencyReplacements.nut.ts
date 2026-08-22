/**
 * Integration tests for the dependency replacements against a real scratch org.
 *
 * The dependency reduction work replaced org-facing libraries with native
 * implementations (make-fetch-happen -> fetch in FileDownloader, xml2js ->
 * fast-xml-parser in xmlUtils). Unit tests pin their behavior on fixtures;
 * these scenarios prove the replacements against real Salesforce endpoints:
 *  - FileDownloader streams a ContentVersion through the org REST API
 *    (Bearer auth, redirects, binary streaming) and fails cleanly on a 404.
 *  - xmlUtils round-trips metadata actually retrieved from the org, and the
 *    rewritten XML deploys back successfully, proving the Metadata API accepts
 *    the fast-xml-parser output (encoding, escaping, self-closing tags).
 *
 * Runs only via `yarn test:nuts:org`.
 */
import { expect } from 'chai';
import fs from '../../src/common/utils/fsUtils.js';
import * as path from 'path';
import {
  getSharedNutOrgSession,
  NutOrgContext,
  queryRecords,
  runSf,
} from './helpers/nutOrgProject.js';
import { FileDownloader } from '../../src/common/utils/fileDownloader.js';
import { parseXmlFile, writeXmlFile } from '../../src/common/utils/xmlUtils.js';

const API_VERSION = 'v62.0';

describe('dependency replacements against a real scratch org', () => {
  let ctx: NutOrgContext;
  let accessToken: string;
  let instanceUrl: string;

  before(async function () {
    this.timeout(1800000); // may create the scratch org when running this file alone
    ctx = await getSharedNutOrgSession();
    const display = runSf<any>(`org display --target-org ${ctx.orgAlias} --json`, {
      cwd: ctx.projectDir,
      // The CLI redacts accessToken in org display output unless explicitly asked
      env: { SF_TEMP_SHOW_SECRETS: 'true' },
    });
    accessToken = display.result?.accessToken || '';
    instanceUrl = (display.result?.instanceUrl || '').replace(/\/$/, '');
    expect(accessToken, 'org access token must be available').to.have.length.greaterThan(0);
    expect(accessToken, 'org access token must not be redacted').to.not.include('REDACTED');
    expect(instanceUrl, 'org instance url must be available').to.match(/^https:/);
  });

  describe('FileDownloader (native fetch replacement of make-fetch-happen)', () => {
    it('downloads a ContentVersion binary from the org REST API', async function () {
      this.timeout(300000);
      const fileContent = `sfdx-hardis FileDownloader NUT content ${Date.now().toString(36)}`;
      const base64 = Buffer.from(fileContent, 'utf8').toString('base64');
      const title = `HardisNutDl${Date.now().toString(36)}`;
      runSf(
        `data create record --sobject ContentVersion --values "Title='${title}' PathOnClient='${title}.txt' VersionData='${base64}'" --json --target-org ${ctx.orgAlias}`,
        { cwd: ctx.projectDir, devHubUsername: ctx.devHubUsername }
      );
      const records = queryRecords(ctx, `SELECT Id FROM ContentVersion WHERE Title='${title}'`);
      expect(records.length, 'the ContentVersion should have been created').to.equal(1);

      const downloadUrl = `${instanceUrl}/services/data/${API_VERSION}/sobjects/ContentVersion/${records[0].Id}/VersionData`;
      const outputFile = path.join(ctx.projectDir, `${title}-downloaded.txt`);
      // Same shape as the real call sites: conn only carries the accessToken
      const result = await new FileDownloader(downloadUrl, {
        conn: { accessToken },
        outputFile,
        label: 'file',
      }).download();

      expect(result.success, `download should succeed (error: ${result.error?.message || 'none'})`).to.be.true;
      expect(await fs.readFile(outputFile, 'utf8')).to.equal(fileContent);
    });

    it('fails cleanly without retry storm on a 404', async function () {
      this.timeout(120000);
      const bogusUrl = `${instanceUrl}/services/data/${API_VERSION}/sobjects/ContentVersion/068000000000000AAA/VersionData`;
      const outputFile = path.join(ctx.projectDir, 'nut-download-404.txt');
      const startTime = Date.now();
      const result = await new FileDownloader(bogusUrl, {
        conn: { accessToken },
        outputFile,
        fetchOptions: {
          method: 'GET',
          headers: { Authorization: 'Bearer ' + accessToken },
          retry: { retries: 5, factor: 1, randomize: false },
        },
      }).download();
      expect(result.success).to.be.false;
      expect(result.error).to.exist;
      // A 404 must not be retried: 5 configured retries with backoff would take > 5s
      expect(Date.now() - startTime, '404 should fail fast without retries').to.be.lessThan(5000);
    });
  });

  describe('xmlUtils (fast-xml-parser replacement of xml2js) on real org metadata', () => {
    const profileRelPath = path.join('force-app', 'main', 'default', 'profiles', 'Admin.profile-meta.xml');

    it('round-trips a Profile retrieved from the org without losing data', async function () {
      this.timeout(600000);
      runSf(
        `project retrieve start --metadata Profile:Admin --target-org ${ctx.orgAlias} --json`,
        { cwd: ctx.projectDir, devHubUsername: ctx.devHubUsername }
      );
      const profileFile = path.join(ctx.projectDir, profileRelPath);
      expect(await fs.pathExists(profileFile), 'Admin profile should have been retrieved').to.be.true;

      const parsedOriginal = await parseXmlFile(profileFile);
      // A real Admin profile is a large document: make sure the round-trip is meaningful
      expect(parsedOriginal.Profile, 'parsed Profile root').to.exist;
      expect(parsedOriginal.Profile.userPermissions?.length ?? 0, 'Admin profile should carry many userPermissions').to.be.greaterThan(10);

      await writeXmlFile(profileFile, parsedOriginal);
      const parsedRewritten = await parseXmlFile(profileFile);
      expect(parsedRewritten).to.deep.equal(parsedOriginal);

      const rawRewritten = await fs.readFile(profileFile, 'utf8');
      expect(rawRewritten.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).to.be.true;
    });

    it('deploys the rewritten Profile back to the org successfully', async function () {
      this.timeout(600000);
      const deploy = runSf<any>(
        `project deploy start --source-dir ${path.dirname(profileRelPath)} --target-org ${ctx.orgAlias} --json`,
        { cwd: ctx.projectDir, devHubUsername: ctx.devHubUsername }
      );
      expect(deploy.result?.success, 'the Metadata API should accept the xmlUtils-written Profile').to.be.true;
      expect(deploy.result?.numberComponentErrors ?? 0).to.equal(0);
    });
  });
});
