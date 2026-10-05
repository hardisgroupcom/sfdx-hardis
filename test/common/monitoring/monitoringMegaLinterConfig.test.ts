/* eslint-disable @typescript-eslint/no-unused-expressions */
import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as yaml from 'js-yaml';
import {
  MEGALINTER_CONFIG_FILE,
  addDisableErrors,
  ensureMonitoringMegaLinterConfig,
} from '../../../src/common/monitoring/monitoringMegaLinterConfig.js';

describe('monitoringMegaLinterConfig', () => {
  describe('addDisableErrors', () => {
    it('appends the key and keeps the comments and the content of the file', () => {
      const content = '# Our settings\nEXTENDS:\n  - https://example.com/config.yml\nDISABLE_ERRORS_LINTERS:\n  - CSS_STYLELINT\n';
      const updated = addDisableErrors(content) as string;
      expect(updated.startsWith(content)).to.be.true;
      const parsed = yaml.load(updated) as any;
      expect(parsed.DISABLE_ERRORS).to.be.true;
      expect(parsed.DISABLE_ERRORS_LINTERS).to.deep.equal(['CSS_STYLELINT']);
    });

    it('never overrides a value the team wrote', () => {
      expect(addDisableErrors('DISABLE_ERRORS: false\n')).to.be.null;
      expect(addDisableErrors('DISABLE_ERRORS: true\n')).to.be.null;
    });

    it('handles a file without a final line break, CRLF line ends and an empty file', () => {
      expect(yaml.load(addDisableErrors('APPLY_FIXES: none') as string)).to.deep.equal({ APPLY_FIXES: 'none', DISABLE_ERRORS: true });
      const crlf = addDisableErrors('APPLY_FIXES: none\r\n') as string;
      expect(crlf.replace(/\r\n/g, '')).to.not.include('\n');
      expect(yaml.load(addDisableErrors('') as string)).to.deep.equal({ DISABLE_ERRORS: true });
    });

    it('throws on a file that is not a list of properties', () => {
      expect(() => addDisableErrors('- a\n- b\n')).to.throw();
      expect(() => addDisableErrors('key: [unclosed\n')).to.throw();
    });
  });

  describe('ensureMonitoringMegaLinterConfig', () => {
    let repoDir: string;

    beforeEach(() => {
      repoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hardis-megalinter-'));
    });

    afterEach(() => {
      fs.rmSync(repoDir, { recursive: true, force: true });
    });

    it('creates the file from the monitoring template when the repository has none', async () => {
      const result = await ensureMonitoringMegaLinterConfig(repoDir);
      expect(result.status).to.equal('created');
      const parsed = yaml.load(fs.readFileSync(path.join(repoDir, MEGALINTER_CONFIG_FILE), 'utf8')) as any;
      expect(parsed.DISABLE_ERRORS).to.be.true;
      expect(parsed.EXTENDS).to.be.an('array');
    });

    it('updates a file once, then leaves it alone', async () => {
      const configFile = path.join(repoDir, MEGALINTER_CONFIG_FILE);
      fs.writeFileSync(configFile, 'APPLY_FIXES: none\n');
      expect((await ensureMonitoringMegaLinterConfig(repoDir)).status).to.equal('updated');
      const afterFirstRun = fs.readFileSync(configFile, 'utf8');
      expect((await ensureMonitoringMegaLinterConfig(repoDir)).status).to.equal('unchanged');
      expect(fs.readFileSync(configFile, 'utf8')).to.equal(afterFirstRun);
    });

    it('leaves a file it cannot read as YAML untouched', async () => {
      const configFile = path.join(repoDir, MEGALINTER_CONFIG_FILE);
      fs.writeFileSync(configFile, 'key: [unclosed\n');
      const result = await ensureMonitoringMegaLinterConfig(repoDir);
      expect(result.status).to.equal('unparsable');
      expect(result.message).to.be.a('string');
      expect(fs.readFileSync(configFile, 'utf8')).to.equal('key: [unclosed\n');
    });
  });
});
