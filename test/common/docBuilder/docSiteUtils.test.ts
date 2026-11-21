import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  fitSearchIndexToSize,
  listSiteFilesOverSize,
  removeDocCacheFromSite,
} from '../../../src/common/docBuilder/docSiteUtils.js';

// The search index of a large org went over the 25 MiB Cloudflare Pages accepts: a third of it was
// the AI cache of every language, built as pages nobody links to
describe('documentation site cleaning', () => {
  let siteDir: string;

  beforeEach(() => {
    siteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-site-'));
  });

  afterEach(() => {
    fs.rmSync(siteDir, { recursive: true, force: true });
  });

  const writeSite = (files: Record<string, string>) => {
    for (const [file, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(siteDir, file)), { recursive: true });
      fs.writeFileSync(path.join(siteDir, file), content);
    }
  };
  const readSearchIndex = () => JSON.parse(fs.readFileSync(path.join(siteDir, 'search.json'), 'utf8'));

  describe('removeDocCacheFromSite', () => {
    it('removes the cache folders and their search entries, and keeps the pages', async () => {
      writeSite({
        'cache-ai-results/fr-PROMPT-Account-123/index.html': '<p>cache</p>',
        'cache-mermaid/mermaid-apex-Foo-0-123.png': 'png',
        'objects/Account/index.html': '<p>Account</p>',
        'search.json': JSON.stringify({
          config: { lang: ['fr'] },
          items: [
            { location: 'cache-ai-results/fr-PROMPT-Account-123/#fields', title: 'Fields', text: 'cached' },
            { location: 'cache-ai-results/en-PROMPT-Account-123.html', title: 'Fields', text: 'cached' },
            { location: 'objects/Account/', title: 'Account', text: 'Account object' },
          ],
        }),
      });
      expect(await removeDocCacheFromSite(siteDir)).to.equal(2);
      expect(fs.existsSync(path.join(siteDir, 'cache-ai-results'))).to.equal(false);
      expect(fs.existsSync(path.join(siteDir, 'cache-mermaid'))).to.equal(false);
      expect(fs.existsSync(path.join(siteDir, 'objects/Account/index.html'))).to.equal(true);
      const searchIndex = readSearchIndex();
      expect(searchIndex.config).to.deep.equal({ lang: ['fr'] });
      expect(searchIndex.items.map((item: any) => item.location)).to.deep.equal(['objects/Account/']);
    });

    it('reads the search index of MkDocs Material, in search/search_index.json with entries called docs', async () => {
      writeSite({
        'search/search_index.json': JSON.stringify({ docs: [{ location: 'cache-mermaid/x/', title: 'x', text: 'x' }, { location: 'apex/', title: 'Apex', text: '' }] }),
      });
      expect(await removeDocCacheFromSite(siteDir)).to.equal(1);
      expect(JSON.parse(fs.readFileSync(path.join(siteDir, 'search', 'search_index.json'), 'utf8')).docs).to.have.length(1);
    });

    it('does nothing without a site or a search index it knows', async () => {
      expect(await removeDocCacheFromSite(path.join(siteDir, 'missing'))).to.equal(0);
      writeSite({ 'search.json': '{"something": "else"}' });
      expect(await removeDocCacheFromSite(siteDir)).to.equal(0);
      expect(fs.readFileSync(path.join(siteDir, 'search.json'), 'utf8')).to.equal('{"something": "else"}');
    });
  });

  describe('fitSearchIndexToSize', () => {
    const items = [
      { location: 'apex/Big/#apex-code', title: 'Apex code', text: 'a'.repeat(5000) },
      { location: 'flows/Flow-history/#flow-diagram', title: 'Flow diagram', text: 'b'.repeat(3000) },
      { location: 'objects/Account/', title: 'Account', text: 'c'.repeat(1000) },
    ];

    it('empties the largest texts first and stops as soon as the index fits', async () => {
      writeSite({ 'search.json': JSON.stringify({ config: {}, items }) });
      const result = await fitSearchIndexToSize(siteDir, 6000);
      expect(result.trimmed).to.equal(1);
      expect(result.largest).to.deep.equal(['apex/Big/#apex-code']);
      const fitted = readSearchIndex();
      expect(fitted.items[0]).to.deep.equal({ location: 'apex/Big/#apex-code', title: 'Apex code', text: '' });
      expect(fitted.items[1].text).to.have.length(3000);
      expect(fs.statSync(path.join(siteDir, 'search.json')).size).to.be.at.most(6000);
    });

    it('empties as many texts as needed', async () => {
      writeSite({ 'search.json': JSON.stringify({ config: {}, items }) });
      const result = await fitSearchIndexToSize(siteDir, 2000);
      expect(result.trimmed).to.equal(2);
      expect(fs.statSync(path.join(siteDir, 'search.json')).size).to.be.at.most(2000);
      expect(readSearchIndex().items.map((item: any) => item.title)).to.deep.equal(['Apex code', 'Flow diagram', 'Account']);
    });

    it('leaves an index under the limit as it is', async () => {
      const content = JSON.stringify({ config: {}, items }, null, 2);
      writeSite({ 'search.json': content });
      expect(await fitSearchIndexToSize(siteDir, 100000)).to.deep.equal({ trimmed: 0, largest: [] });
      expect(fs.readFileSync(path.join(siteDir, 'search.json'), 'utf8')).to.equal(content);
    });
  });

  describe('listSiteFilesOverSize', () => {
    it('lists the files over the limit, largest first, with their path from the site root', async () => {
      writeSite({
        'search.json': 'x'.repeat(300),
        'assets/big.js': 'x'.repeat(500),
        'objects/Account/index.html': 'x'.repeat(50),
      });
      expect(await listSiteFilesOverSize(siteDir, 100)).to.deep.equal([
        { file: 'assets/big.js', size: 500 },
        { file: 'search.json', size: 300 },
      ]);
      expect(await listSiteFilesOverSize(path.join(siteDir, 'missing'), 100)).to.deep.equal([]);
    });
  });
});
