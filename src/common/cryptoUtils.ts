'use strict';

import * as crypto from 'crypto';
import * as fs from 'fs-extra';

//const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY; // Must be 256 bits (32 characters)
const IV_LENGTH = 16; // For AES, this is always 16

export async function encryptFile(filePath) {
    const fileContent = await fs.readFile(filePath,"utf8");
    const encryptedFileContent = encrypt(fileContent);
    await fs.writeFile(filePath,encryptedFileContent.text);
    return encryptedFileContent.encryptionKey;
}

export async function decryptFile(filePath,targetFile,encryptionKey) {
    const fileContent = await fs.readFile(filePath,"utf8");
    const decryptedFileContent = decrypt(fileContent,encryptionKey);
    await fs.writeFile(targetFile,decryptedFileContent);
}

export function encrypt(text) {
 const iv = crypto.randomBytes(IV_LENGTH);
 const encryptionKey = crypto.randomBytes(16).toString('hex');
 const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(encryptionKey), iv);
 let encrypted = cipher.update(text);

 encrypted = Buffer.concat([encrypted, cipher.final()]);

 return {
     text: iv.toString('hex') + ':' + encrypted.toString('hex'),
     encryptionKey: encryptionKey
    };
}

export function decrypt(text, encryptionKey) {
 const textParts = text.split(':');
 const iv = Buffer.from(textParts.shift(), 'hex');
 const encryptedText = Buffer.from(textParts.join(':'), 'hex');
 const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(encryptionKey), iv);
 let decrypted = decipher.update(encryptedText);

 decrypted = Buffer.concat([decrypted, decipher.final()]);

 return decrypted.toString();
}

