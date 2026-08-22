import { Connection } from '@salesforce/core';
import { getNested, uxLog } from './index.js';
import c from 'chalk';
import fs from './fsUtils.js';
import * as path from 'path';
import { t } from './i18n.js';

export async function sendEmail(emailMessage: EmailMessage) {
  const conn: Connection = globalThis.jsForceConn || null;
  if (!conn) {
    uxLog("log", this, c.grey(t('globalthisJsforceconnIsNotSetCanNot')));
    return;
  }
  // Init message
  let soapBody = `
    <soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:enterprise.soap.sforce.com" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
      <soapenv:Header>
         <urn:SessionHeader>
            <urn:sessionId>${conn.accessToken}</urn:sessionId>
         </urn:SessionHeader>
      </soapenv:Header>
      <soapenv:Body>
         <urn:sendEmail>
            <urn:messages xsi:type="urn:SingleEmailMessage">
               <urn:charset>utf8</urn:charset>
               <urn:senderDisplayName>${emailMessage.senderDisplayName || 'SFDX-HARDIS Notifications'
    }</urn:senderDisplayName>
               <urn:subject>${emailMessage.subject}</urn:subject>
    `;

  // Plain text Body
  if (emailMessage.body_text) {
    soapBody += `           <urn:plainTextBody>${sanitizeForXml(emailMessage.body_text || '')}</urn:plainTextBody>\n`;
  } else if (emailMessage.body_html) {
    soapBody += `           <urn:htmlBody>${sanitizeForXml(emailMessage.body_html || '')}</urn:htmlBody>\n`;
  }
  // Addresses
  if (emailMessage?.to?.length && emailMessage?.to?.length > 0) {
    soapBody += buildArrayOfStrings(emailMessage.to, '             <urn:toAddresses>', '</urn:toAddresses>');
  }
  if (emailMessage?.cc?.length && emailMessage?.cc?.length > 0) {
    soapBody += buildArrayOfStrings(emailMessage.cc, '             <urn:ccAddresses>', '</urn:ccAddresses>');
  }
  if (emailMessage?.cci?.length && emailMessage?.cci?.length > 0) {
    soapBody += buildArrayOfStrings(emailMessage.cci, '             <urn:bccAddresses>', '</urn:bccAddresses>');
  }
  // Attachments
  if (emailMessage?.attachments?.length && emailMessage?.attachments?.length > 0) {
    let totalSize = 0;
    for (const attachment of emailMessage?.attachments || []) {
      if (fs.existsSync(attachment)) {
        const { size: fileSize } = fs.statSync(attachment);
        totalSize += fileSize;
        if (totalSize > 8e7) {
          // 10MB
          uxLog("other", this, `[EmailUtils] Skipped attachment ${attachment} to avoid the reach size limit`);
          continue;
        }
        const fileName = path.basename(attachment);
        const fileBody = fs.readFileSync(attachment).toString('base64');
        soapBody += `           <urn:fileAttachments xsi:type="urn:EmailFileAttachment">\n`;
        soapBody += `             <urn:fileName>${fileName}</urn:fileName>\n`;
        soapBody += `             <urn:body>${fileBody}</urn:body>\n`;
        soapBody += `           </urn:fileAttachments>\n`;
      } else {
        uxLog("other", this, `[EmailUtils] Skipped not found attachment ${attachment}`);
      }
    }
  }
  soapBody += `           
            </urn:messages>
         </urn:sendEmail>
      </soapenv:Body>
    </soapenv:Envelope>
    `;
  const soapResponse = await conn.request(
    {
      method: 'POST',
      url: `${conn.instanceUrl}/services/Soap/c/${conn.version}`,
      body: soapBody,
      headers: {
        'Content-Type': 'text/xml;charset=utf-8',
        Accept: 'text/xml;charset=utf-8',
        SOAPAction: '""',
      },
    },
    { responseType: 'text/xml' }
  );
  const resultTag = getNested(soapResponse, [
    'soapenv:Envelope',
    'soapenv:Body',
    'sendEmailResponse',
    'result',
    'success',
  ]);
  if (resultTag === 'true') {
    return { success: true, detail: soapResponse };
  }
  return { success: false, detail: soapResponse };
}

function buildArrayOfStrings(elements: string[], openingTag: string, closingTag: string): string {
  let result = '';
  for (const element of elements) {
    result += `${openingTag}${element}${closingTag}\n`;
  }
  return result;
}

function sanitizeForXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export interface EmailSoapError {
  statusCode: string;
  message: string;
}

/*
 * Walk the SOAP envelope returned by `sendEmail` and extract one or more
 * `<errors>` entries. Salesforce returns either a single object or an array
 * depending on how many errors fired; we always return an array.
 */
export function extractEmailSoapErrors(detail: any): EmailSoapError[] {
  const errors = getNested(detail, [
    'soapenv:Envelope',
    'soapenv:Body',
    'sendEmailResponse',
    'result',
    'errors',
  ]);
  if (!errors) return [];
  const list = Array.isArray(errors) ? errors : [errors];
  return list
    .map((e: any) => ({
      statusCode: (e?.statusCode || '').toString(),
      message: (e?.message || '').toString(),
    }))
    .filter((e: EmailSoapError) => e.statusCode || e.message);
}

/*
 * Known Salesforce sendEmail failure patterns -> actionable i18n key.
 * Adding a new pattern is a one-line change: extend this list with an
 * `i18nKey` that resolves to the remediation message.
 */
const EMAIL_ERROR_REMEDIATIONS: { match: (e: EmailSoapError) => boolean; i18nKey: string }[] = [
  {
    /* Spring '26 Email-Sending Domain Verification: domain not verified */
    match: (e) =>
      e.statusCode === 'INSUFFICIENT_ACCESS_OR_READONLY' &&
      /domain\s+isn[’']?t\s+verified|domain\s+is\s+not\s+verified/i.test(e.message),
    i18nKey: 'emailErrorAdviceDomainNotVerified',
  },
  {
    /* Deliverability "Access level" too low (System email only) - blocks single email send */
    match: (e) =>
      e.statusCode === 'NO_SINGLE_MAIL_PERMISSION' || e.statusCode === 'NO_MASS_MAIL_PERMISSION',
    i18nKey: 'emailErrorAdviceNoMailPermission',
  },
  {
    /* Org-Wide Email Address profile access missing */
    match: (e) =>
      e.statusCode === 'INSUFFICIENT_ACCESS_OR_READONLY' &&
      /org.wide\s+email\s+address|orgwide\s+email\s+address/i.test(e.message),
    i18nKey: 'emailErrorAdviceOrgWideEmailAccess',
  },
  {
    /* Salesforce deliverability access level too restrictive (System Email Only) - generic fallback */
    match: (e) => /access\s+level|deliverability/i.test(e.message),
    i18nKey: 'emailErrorAdviceDeliverability',
  },
];

export function getEmailErrorAdviceKeys(errors: EmailSoapError[]): string[] {
  const seen = new Set<string>();
  for (const e of errors) {
    for (const remediation of EMAIL_ERROR_REMEDIATIONS) {
      if (remediation.match(e)) {
        seen.add(remediation.i18nKey);
        break;
      }
    }
  }
  return Array.from(seen);
}

export interface EmailMessage {
  subject: string;
  body_text?: string;
  body_html?: string;
  to?: string[];
  cc?: string[];
  cci?: string[];
  senderDisplayName?: string;
  attachments?: any[];
}
