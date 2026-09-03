import { expect } from 'chai';
import * as os from 'os';
import * as path from 'path';
import fs from '../../../src/common/utils/fsUtils.js';
import { setFetchForTests } from '../../../src/common/utils/httpUtils.js';
import {
  capText,
  classifyAttachment,
  detectManualActions,
  downloadTicketAttachment,
  htmlToPlainText,
  isSameHost,
  newTicketDetails,
  renderTicketDetailsMarkdown,
  sanitizeAttachmentFileName,
  TicketAttachment,
} from '../../../src/common/ticketProvider/ticketDetails.js';

function makeAttachment(overrides: Partial<TicketAttachment> = {}): TicketAttachment {
  return {
    filename: 'note.txt',
    contentType: 'text/plain',
    size: 0,
    created: '',
    author: '',
    url: 'https://jira.example.com/secure/attachment/1/note.txt',
    kind: 'text',
    localPath: null,
    textContent: null,
    truncated: false,
    error: null,
    ...overrides,
  };
}

/** Minimal stand-in for a fetch Response carrying `body` as a byte stream */
function fakeResponse(body: Buffer, ok = true, status = 200): any {
  let sent = false;
  return {
    ok,
    status,
    body: {
      getReader: () => ({
        read: async () => {
          if (sent) {
            return { done: true, value: undefined };
          }
          sent = true;
          return { done: false, value: new Uint8Array(body) };
        },
        cancel: async () => undefined,
      }),
    },
    arrayBuffer: async () => body,
  };
}

describe('ticketDetails helpers', () => {
  describe('htmlToPlainText', () => {
    it('keeps block boundaries as line breaks', () => {
      expect(htmlToPlainText('<p>First</p><p>Second</p>')).to.equal('First\n\nSecond');
      expect(htmlToPlainText('a<br/>b')).to.equal('a\nb');
      expect(htmlToPlainText('<ul><li>one</li><li>two</li></ul>')).to.equal('one\n\ntwo');
    });

    it('decodes entities and drops every tag, including script content', () => {
      const html = '<div>Caf&eacute; &amp; co<script>alert(1)</script></div>';
      const text = htmlToPlainText(html);
      expect(text).to.include('Café & co');
      expect(text).to.not.include('<');
      expect(text).to.not.include('alert(1)');
    });

    it('returns an empty string for empty input', () => {
      expect(htmlToPlainText(null)).to.equal('');
      expect(htmlToPlainText(undefined)).to.equal('');
    });
  });

  describe('capText', () => {
    it('leaves a short text untouched', () => {
      expect(capText('hello', 10)).to.equal('hello');
    });

    it('truncates and says so', () => {
      const capped = capText('abcdefghij', 4);
      expect(capped).to.contain('abcd');
      expect(capped).to.contain('truncated at 4 characters');
    });
  });

  describe('detectManualActions', () => {
    it('finds French and English hints, deduplicated', () => {
      const hits = detectManualActions([
        'Il faudra assigner le permission set manuellement\nRien à signaler',
        'Nothing here',
        'Il faudra assigner le permission set manuellement',
        'A scheduled job must be created after deploy',
      ]);
      expect(hits).to.have.lengthOf(2);
      expect(hits[0]).to.contain('permission set');
      expect(hits[1]).to.contain('scheduled job');
    });

    it('returns an empty array when nothing matches', () => {
      expect(detectManualActions(['Just a plain requirement', null, undefined])).to.deep.equal([]);
    });

    it('stops at maxHits', () => {
      const many = Array.from({ length: 30 }, (_, i) => `manual action number ${i}`).join('\n');
      expect(detectManualActions([many], 5)).to.have.lengthOf(5);
    });
  });

  describe('classifyAttachment', () => {
    it('classifies by content type', () => {
      expect(classifyAttachment('image/png', 'x')).to.equal('image');
      expect(classifyAttachment('application/pdf', 'x')).to.equal('document');
      expect(classifyAttachment('text/csv', 'x')).to.equal('text');
      expect(classifyAttachment('application/octet-stream', 'x')).to.equal('binary');
    });

    it('falls back to the file extension when the content type is missing', () => {
      expect(classifyAttachment('', 'wireframe.PNG')).to.equal('image');
      expect(classifyAttachment('', 'spec.docx')).to.equal('document');
      expect(classifyAttachment('', 'query.sql')).to.equal('text');
      expect(classifyAttachment('', 'archive.7z')).to.equal('binary');
    });
  });

  describe('sanitizeAttachmentFileName', () => {
    it('strips directory traversal', () => {
      expect(sanitizeAttachmentFileName('../../etc/passwd', 'fallback')).to.equal('passwd');
      expect(sanitizeAttachmentFileName('..\\..\\windows\\system32\\evil.dll', 'fallback')).to.equal('evil.dll');
    });

    it('replaces characters the filesystem reserves', () => {
      expect(sanitizeAttachmentFileName('a<b>c:d"e|f?g*h.txt', 'fallback')).to.equal('a_b_c_d_e_f_g_h.txt');
    });

    it('escapes reserved Windows device names', () => {
      expect(sanitizeAttachmentFileName('CON.txt', 'fallback')).to.equal('_CON.txt');
      expect(sanitizeAttachmentFileName('lpt1', 'fallback')).to.equal('_lpt1');
    });

    it('uses the fallback when nothing usable is left', () => {
      expect(sanitizeAttachmentFileName('...', 'attachment-3')).to.equal('attachment-3');
      expect(sanitizeAttachmentFileName('', 'attachment-3')).to.equal('attachment-3');
    });

    it('bounds the length while keeping the extension', () => {
      const long = 'a'.repeat(400) + '.png';
      const safe = sanitizeAttachmentFileName(long, 'fallback');
      expect(safe.length).to.be.at.most(120);
      expect(safe.endsWith('.png')).to.equal(true);
    });
  });

  describe('isSameHost', () => {
    it('accepts the same host, whatever the path', () => {
      expect(isSameHost('https://jira.example.com/secure/attachment/1/a.png', 'https://jira.example.com')).to.equal(true);
      expect(isSameHost('https://JIRA.example.com/x', 'https://jira.example.com/')).to.equal(true);
    });

    it('rejects another host, a look-alike host and a non-http scheme', () => {
      expect(isSameHost('https://evil.example.com/x', 'https://jira.example.com')).to.equal(false);
      expect(isSameHost('https://jira.example.com.evil.net/x', 'https://jira.example.com')).to.equal(false);
      expect(isSameHost('file:///etc/passwd', 'https://jira.example.com')).to.equal(false);
      expect(isSameHost('not a url', 'https://jira.example.com')).to.equal(false);
    });

    it('rejects a different port on the same domain', () => {
      expect(isSameHost('https://jira.example.com:8443/x', 'https://jira.example.com')).to.equal(false);
    });
  });

  describe('downloadTicketAttachment', () => {
    let tmpDir: string;

    beforeEach(async () => {
      tmpDir = path.join(os.tmpdir(), `sfdx-hardis-ticket-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      await fs.ensureDir(tmpDir);
    });

    afterEach(async () => {
      setFetchForTests(null);
      await fs.remove(tmpDir);
    });

    it('refuses to send credentials to a host that is not the ticketing instance', async () => {
      let called = false;
      setFetchForTests(async () => {
        called = true;
        return fakeResponse(Buffer.from('secret'));
      });
      const attachment = await downloadTicketAttachment({
        attachment: makeAttachment({ url: 'https://evil.example.com/steal' }),
        baseUrl: 'https://jira.example.com',
        headers: { Authorization: 'Basic secret' },
        targetDir: tmpDir,
        maxBytes: 1000,
        index: 1,
      });
      expect(called).to.equal(false);
      expect(attachment.localPath).to.equal(null);
      expect(attachment.error).to.contain('does not match the ticketing instance');
    });

    it('saves the file and extracts the text of a text attachment', async () => {
      setFetchForTests(async () => fakeResponse(Buffer.from('line one\nline two')));
      const attachment = await downloadTicketAttachment({
        attachment: makeAttachment(),
        baseUrl: 'https://jira.example.com',
        headers: {},
        targetDir: tmpDir,
        maxBytes: 1000,
        index: 1,
      });
      expect(attachment.error).to.equal(null);
      expect(attachment.localPath).to.equal(path.resolve(tmpDir, '1-note.txt'));
      expect(await fs.pathExists(attachment.localPath as string)).to.equal(true);
      expect(attachment.textContent).to.equal('line one\nline two');
      expect(attachment.truncated).to.equal(false);
      expect(attachment.size).to.equal(17);
    });

    it('caps the download at maxBytes and flags it as truncated', async () => {
      setFetchForTests(async () => fakeResponse(Buffer.from('0123456789')));
      const attachment = await downloadTicketAttachment({
        attachment: makeAttachment(),
        baseUrl: 'https://jira.example.com',
        headers: {},
        targetDir: tmpDir,
        maxBytes: 4,
        index: 2,
      });
      expect(attachment.truncated).to.equal(true);
      expect(attachment.textContent).to.equal('0123');
    });

    it('does not extract text from a binary attachment', async () => {
      setFetchForTests(async () => fakeResponse(Buffer.from([0x89, 0x50, 0x4e, 0x47])));
      const attachment = await downloadTicketAttachment({
        attachment: makeAttachment({ filename: 'shot.png', contentType: 'image/png', kind: 'image' }),
        baseUrl: 'https://jira.example.com',
        headers: {},
        targetDir: tmpDir,
        maxBytes: 1000,
        index: 3,
      });
      expect(attachment.textContent).to.equal(null);
      expect(attachment.localPath).to.equal(path.resolve(tmpDir, '3-shot.png'));
    });

    it('writes a traversal file name inside the target directory', async () => {
      setFetchForTests(async () => fakeResponse(Buffer.from('x')));
      const attachment = await downloadTicketAttachment({
        attachment: makeAttachment({ filename: '../../escaped.txt' }),
        baseUrl: 'https://jira.example.com',
        headers: {},
        targetDir: tmpDir,
        maxBytes: 1000,
        index: 4,
      });
      expect(attachment.error).to.equal(null);
      expect(attachment.localPath).to.equal(path.resolve(tmpDir, '4-escaped.txt'));
    });

    it('records the error of a failing download without throwing', async () => {
      setFetchForTests(async () => fakeResponse(Buffer.from(''), false, 403));
      const attachment = await downloadTicketAttachment({
        attachment: makeAttachment(),
        baseUrl: 'https://jira.example.com',
        headers: {},
        targetDir: tmpDir,
        maxBytes: 1000,
        index: 5,
      });
      expect(attachment.error).to.contain('403');
      expect(attachment.localPath).to.equal(null);
    });
  });

  describe('renderTicketDetailsMarkdown', () => {
    it('renders only the sections that have content', () => {
      const details = newTicketDetails('JIRA', 'ACME-1');
      details.subject = 'Add a validation rule';
      details.status = 'In Progress';
      details.description = 'The rule must block a past date.';
      const markdown = renderTicketDetailsMarkdown(details);
      expect(markdown).to.contain('# ACME-1 — Add a validation rule');
      expect(markdown).to.contain('| Status | In Progress |');
      expect(markdown).to.contain('## Description');
      expect(markdown).to.not.contain('## Comments');
      expect(markdown).to.not.contain('## Attachments');
      expect(markdown).to.not.contain('| Priority |');
    });

    it('renders comments, attachments and manual actions', () => {
      const details = newTicketDetails('SERVICENOW', 'INC0012345');
      details.comments = [{ author: 'Alice', date: '2026-01-02', body: 'Please assign the permission set manually' }];
      details.attachments = [makeAttachment({ filename: 'shot.png', kind: 'image', localPath: '/tmp/shot.png', size: 12 })];
      details.manualActions = ['Please assign the permission set manually'];
      const markdown = renderTicketDetailsMarkdown(details);
      expect(markdown).to.contain('## Comments (1)');
      expect(markdown).to.contain('### 2026-01-02 — Alice');
      expect(markdown).to.contain('## Attachments (1)');
      expect(markdown).to.contain('/tmp/shot.png');
      expect(markdown).to.contain('## Possible manual actions (1)');
    });
  });
});
