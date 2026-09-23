/**
 * Safe Storage Vault
 *
 * Wraps Electron's `safeStorage` API to persist secrets encrypted on disk
 * (macOS Keychain on Mac, DPAPI on Windows, libsecret/kwallet on Linux).
 *
 * On disk format (~/Library/Application Support/SuperCmd/safe-storage.json):
 *   { "<key>": "enc:<base64-encrypted>" }
 *
 * If the OS keyring is not available we degrade gracefully and persist
 * plain text — which is no worse than the legacy settings.json behaviour
 * we are replacing — and never silently lose user data.
 *
 * IMPORTANT: encrypted entries we cannot decrypt in this session (e.g.
 * encryption temporarily unavailable, or a single corrupt blob) are
 * preserved verbatim through writes. Without this, a single failed
 * decrypt would mean a later setSecret/deleteSecret would clobber
 * unrelated secrets when the vault file was rewritten.
 */

import { app, safeStorage } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { execFileSync } from 'child_process';

const VAULT_FILENAME = 'safe-storage.json';
const ENCRYPTED_PREFIX = 'enc:';

// Decrypted/plaintext entries we own and can re-write.
let decryptedCache: Record<string, string> | null = null;
// Raw on-disk entries we couldn't read (or chose not to read because
// encryption was unavailable). These are passed through writes verbatim
// so we never destroy a user's secrets we just couldn't open right now.
let unknownRawCache: Record<string, string> | null = null;

let legacyKeychainPasswordCache: string | null | undefined = undefined;

export function getLegacySuperCmdKeychainPassword(): string | null {
  if (legacyKeychainPasswordCache !== undefined) {
    return legacyKeychainPasswordCache;
  }
  if (process.platform !== 'darwin') {
    legacyKeychainPasswordCache = null;
    return null;
  }
  try {
    const stdout = execFileSync('security', [
      'find-generic-password',
      '-s', 'SuperCmd Safe Storage',
      '-w'
    ], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 });
    const pw = stdout.trim();
    legacyKeychainPasswordCache = pw || null;
    return legacyKeychainPasswordCache;
  } catch {
    legacyKeychainPasswordCache = null;
    return null;
  }
}

export function setLegacySuperCmdKeychainPasswordForTesting(pw: string | null): void {
  legacyKeychainPasswordCache = pw;
}

/**
 * Decrypts Chromium macOS OSCrypt payload using the legacy password.
 * Format is 'v10' followed by AES-128-CBC ciphertext with IV = 16 spaces.
 */
export function decryptLegacyOscryptPayload(buf: Buffer, password: string): string | null {
  try {
    if (buf.length < 3) return null;
    const version = buf.subarray(0, 3).toString('utf8');
    if (version !== 'v10') return null;
    const ciphertext = buf.subarray(3);
    const key = crypto.pbkdf2Sync(password, 'saltysalt', 1003, 16, 'sha1');
    const iv = Buffer.alloc(16, ' ');
    const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
    let decrypted = decipher.update(ciphertext);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}

function getVaultPath(): string {
  return path.join(app.getPath('userData'), VAULT_FILENAME);
}

function isEncryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
}

function loadVault(): void {
  if (decryptedCache && unknownRawCache) return;
  const decrypted: Record<string, string> = {};
  const unknownRaw: Record<string, string> = {};
  let needsReEncrypt = false;
  try {
    const raw = fs.readFileSync(getVaultPath(), 'utf-8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      const canDecrypt = isEncryptionAvailable();
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof value !== 'string' || !value) continue;
        if (value.startsWith(ENCRYPTED_PREFIX)) {
          if (!canDecrypt) {
            unknownRaw[key] = value;
            continue;
          }
          try {
            const buf = Buffer.from(value.slice(ENCRYPTED_PREFIX.length), 'base64');
            try {
              decrypted[key] = safeStorage.decryptString(buf);
            } catch (decryptErr) {
              // Identity/keychain mismatch: attempt migration with legacy SuperCmd credentials
              let migrated = false;
              const legacyPassword = getLegacySuperCmdKeychainPassword();
              if (legacyPassword) {
                const legacyDecrypted = decryptLegacyOscryptPayload(buf, legacyPassword);
                if (legacyDecrypted !== null) {
                  decrypted[key] = legacyDecrypted;
                  needsReEncrypt = true;
                  migrated = true;
                  console.log(`safe-storage: secret readable: true (migrated key "${key}" from SuperCmd identity)`);
                }
              }
              if (!migrated) {
                console.warn(`safe-storage: failed to decrypt key "${key}", preserving raw blob:`, decryptErr);
                unknownRaw[key] = value;
              }
            }
          } catch (e) {
            console.warn(`safe-storage: failed to parse key "${key}", preserving raw blob:`, e);
            unknownRaw[key] = value;
          }
        } else {
          decrypted[key] = value;
        }
      }
    }
  } catch {
    // vault file doesn't exist yet — first run, that's fine
  }
  decryptedCache = decrypted;
  unknownRawCache = unknownRaw;
  if (needsReEncrypt) {
    persistVault();
  }
}

function persistVault(): boolean {
  loadVault();
  const canEncrypt = isEncryptionAvailable();
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(decryptedCache!)) {
    if (!value) continue;
    if (canEncrypt) {
      try {
        const buf = safeStorage.encryptString(value);
        out[key] = ENCRYPTED_PREFIX + buf.toString('base64');
      } catch (e) {
        console.warn(`safe-storage: failed to encrypt key "${key}", storing plaintext:`, e);
        out[key] = value;
      }
    } else {
      out[key] = value;
    }
  }
  // Preserve unreadable encrypted entries verbatim so we don't destroy them
  // by rewriting the file from a partial cache.
  for (const [key, raw] of Object.entries(unknownRawCache!)) {
    if (key in out) continue;
    out[key] = raw;
  }
  try {
    fs.writeFileSync(getVaultPath(), JSON.stringify(out, null, 2), { mode: 0o600 });
    return true;
  } catch (e) {
    console.error('safe-storage: failed to write vault:', e);
    return false;
  }
}

export function getSecret(key: string): string {
  loadVault();
  return decryptedCache![key] || '';
}

/**
 * Persist a secret to the vault. Returns `true` only when the on-disk
 * vault file is successfully written. Callers performing destructive
 * follow-ups (e.g. redacting plaintext from settings.json) MUST check
 * this return value first.
 *
 * Setting an empty value is treated as a delete.
 */
export function setSecret(key: string, value: string): boolean {
  loadVault();
  const next = String(value ?? '');
  if (!next) {
    let changed = false;
    if (decryptedCache![key] !== undefined) {
      delete decryptedCache![key];
      changed = true;
    }
    if (unknownRawCache![key] !== undefined) {
      delete unknownRawCache![key];
      changed = true;
    }
    if (!changed) return true;
    return persistVault();
  }
  if (decryptedCache![key] === next && unknownRawCache![key] === undefined) return true;
  decryptedCache![key] = next;
  delete unknownRawCache![key];
  return persistVault();
}

export function deleteSecret(key: string): boolean {
  loadVault();
  let changed = false;
  if (decryptedCache![key] !== undefined) {
    delete decryptedCache![key];
    changed = true;
  }
  if (unknownRawCache![key] !== undefined) {
    delete unknownRawCache![key];
    changed = true;
  }
  if (!changed) return true;
  return persistVault();
}

export function hasSecret(key: string): boolean {
  loadVault();
  const value = decryptedCache![key];
  return typeof value === 'string' && value.length > 0;
}

export function isSafeStorageAvailable(): boolean {
  return isEncryptionAvailable();
}

export function resetVaultCache(): void {
  decryptedCache = null;
  unknownRawCache = null;
}
