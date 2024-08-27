import { Connection } from "jsforce";
import { getNested, uxLog } from "./index.js";
import c from "chalk";
import * as fs from "fs-extra";
import * as path from "path";

export async function sendEmail(emailMessage: EmailMessage) {
  const conn: Connection = globalThis.jsForceConn || null;
  if (!conn) {
    uxLog(this, c.grey("globalThis.jsForceConn is not set, can not send email"));
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
               <urn:senderDisplayName>${emailMessage.senderDisplayName || "SFDX-HARDIS Notifications"}</urn:senderDisplayName>
               <urn:subject>${emailMessage.subject}</urn:subject>
    `;

  // Plain text Body
  if (emailMessage.body_text) {
    soapBody += `           <urn:plainTextBody>${sanitizeForXml(emailMessage.body_text || "")}</urn:plainTextBody>\n`;
  } else if (emailMessage.body_html) {
    soapBody += `           <urn:htmlBody>${sanitizeForXml(emailMessage.body_html || "")}</urn:htmlBody>\n`;
  }
  // Addresses
  if (emailMessage?.to?.length > 0) {
    soapBody += buildArrayOfStrings(emailMessage.to, "             <urn:toAddresses>", "</urn:toAddresses>");
  }
  if (emailMessage?.cc?.length > 0) {
    soapBody += buildArrayOfStrings(emailMessage.cc, "             <urn:ccAddresses>", "</urn:ccAddresses>");
  }
  if (emailMessage?.cci?.length > 0) {
    soapBody += buildArrayOfStrings(emailMessage.cci, "             <urn:bccAddresses>", "</urn:bccAddresses>");
  }
  // Attachments
  if (emailMessage?.attachments?.length > 0) {
    let totalSize = 0;
    for (const attachment of emailMessage?.attachments || []) {
      if (fs.existsSync(attachment)) {
        const { size: fileSize } = fs.statSync(attachment);
        totalSize += fileSize;
        if (totalSize > 8e7) {
          // 10MB
          uxLog(this, `[EmailUtils] Skipped attachment ${attachment} to avoid the reach size limit`);
          continue;
        }
        const fileName = path.basename(attachment);
        const fileBody = fs.readFileSync(attachment).toString("base64");
        soapBody += `           <urn:fileAttachments xsi:type="urn:EmailFileAttachment">\n`;
        soapBody += `             <urn:fileName>${fileName}</urn:fileName>\n`;
        soapBody += `             <urn:body>${fileBody}</urn:body>\n`;
        soapBody += `           </urn:fileAttachments>\n`;
      } else {
        uxLog(this, `[EmailUtils] Skipped not found attachment ${attachment}`);
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
      method: "POST",
      url: `${conn.instanceUrl}/services/Soap/c/${conn.version}`,
      body: soapBody,
      headers: {
        "Content-Type": "text/xml;charset=utf-8",
        Accept: "text/xml;charset=utf-8",
        SOAPAction: '""',
      },
    },
    { responseType: "text/xml" },
  );
  const resultTag = getNested(soapResponse, ["soapenv:Envelope", "soapenv:Body", "sendEmailResponse", "result", "success"]);
  if (resultTag === "true") {
    return { success: true, detail: soapResponse };
  }
  return { success: false, detail: soapResponse };
}

function buildArrayOfStrings(elements: string[], openingTag: string, closingTag: string): string {
  let result = "";
  for (const element of elements) {
    result += `${openingTag}${element}${closingTag}\n`;
  }
  return result;
}

function sanitizeForXml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
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
