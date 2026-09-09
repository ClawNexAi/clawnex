import fs from 'node:fs';
import path from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

export interface EncryptedRoutingCredential { iv: string; tag: string; ciphertext: string }

function readKey(file: string): Buffer {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0 ||
        stat.uid !== process.getuid?.() || stat.size !== 32) throw new Error('Unsafe recovery key file');
    return fs.readFileSync(fd);
  } finally { fs.closeSync(fd); }
}

function encryptionKey(journal: string): Buffer {
  const file = `${journal}.credential-key`;
  if (fs.existsSync(file)) return readKey(file);
  // Never replace a key: older encrypted recovery records may still need it.
  const key = randomBytes(32);
  const fd = fs.openSync(file, 'wx', 0o600);
  try { fs.writeFileSync(fd, key); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  const directory = fs.openSync(path.dirname(file), 'r');
  try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
  return readKey(file);
}

export function sealRoutingCredential(journal: string, owner: string, value: unknown): EncryptedRoutingCredential {
  try {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', encryptionKey(journal), iv);
    cipher.setAAD(Buffer.from(owner));
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return { iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: ciphertext.toString('base64') };
  } catch { throw new Error('Unable to secure legacy credential recovery. No agent configuration was changed. Preserve the recovery journal and key.'); }
}

export function openRoutingCredential(journal: string, owner: string, value: EncryptedRoutingCredential): unknown {
  try {
    const decipher = createDecipheriv('aes-256-gcm', readKey(`${journal}.credential-key`), Buffer.from(value.iv, 'base64'));
    decipher.setAAD(Buffer.from(owner));
    decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.ciphertext, 'base64')), decipher.final()]).toString('utf8'));
  } catch { throw new Error('Credential recovery cannot be authenticated. Restore the original recovery key and journal; no agent configuration was changed.'); }
}
