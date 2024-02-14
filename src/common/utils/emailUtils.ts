export async function sendEmail(emailMessage: EmailMessage) {
    console.log(emailMessage);
    return;
}

export interface EmailMessage {
    subject: string;
    body?: string;
    to?: string[];
    cc?: string[];
    cci?: string[];
    attachments?: any[];
  }