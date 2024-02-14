import { Connection } from "jsforce";
import { uxLog } from ".";
import * as c from "chalk";

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
        soapBody += `           <urn:plainTextBody>${sanitizeForXml(emailMessage.body_text || '')}</urn:plainTextBody>\n`
    }
    else if (emailMessage.body_html) {
        soapBody += `           <urn:htmlBody>${sanitizeForXml(emailMessage.body_html || '')}</urn:htmlBody>\n`
    }
    // Adresses
    if (emailMessage.to) {
        soapBody += `           <urn:toAddresses>${emailMessage.to.join(',')}</urn:toAddresses>\n`
    }
    if (emailMessage.cc) {
        soapBody += `           <urn:ccAddresses>${emailMessage.cc.join(',')}</urn:ccAddresses>\n`
    }
    if (emailMessage.cci) {
        soapBody += `           <urn:bccAddresses>${emailMessage.cci.join(',')}</urn:bccAddresses>\n`
    }
    soapBody += `           
            </urn:messages>
         </urn:sendEmail>
      </soapenv:Body>
    </soapenv:Envelope>
    `;
    uxLog(this, c.grey(soapBody));
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
    uxLog(this, c.grey(JSON.stringify(soapResponse,null,2)));
    if (soapResponse["soapenv:Body"]["sendEmailResponse"]["result"]["success"] === "true") {
        return true;
    }

    return false;
}

function sanitizeForXml(value) {
    return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
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