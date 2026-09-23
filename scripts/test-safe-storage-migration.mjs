#!/usr/bin/env node
/**
 * Safe Storage Cross-Brand Migration Integration Test
 *
 * Validates that secrets encrypted with Electron's real safeStorage
 * (macOS Keychain / OSCrypt) in legacy SuperCmd userData are successfully
 * migrated and decrypted in WUDI without data loss or corruption.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

// If running inside Electron main process
if (process.env.ELECTRON_SAFE_STORAGE_RUNNER === '1') {
  const { app, safeStorage } = require('electron');
  const fs = require('node:fs');
  const os = require('node:os');

  app.whenReady().then(async () => {
    try {
      const isAvailable = safeStorage.isEncryptionAvailable();
      if (!isAvailable) {
        console.warn('[test-safe-storage] safeStorage encryption is not available in current environment');
        process.exit(0);
      }

      const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wudi-test-safestorage-'));
      const sourceDir = path.join(tmpRoot, 'SuperCmd');
      const targetDir = path.join(tmpRoot, 'WUDI');
      fs.mkdirSync(sourceDir, { recursive: true });

      // 1. Synthetic secrets (never log these values)
      const SYNTHETIC_AI_SECRET = 'WUDI_MIGRATION_AI_KEY_SYNTHETIC_A1B2C3D4E5';
      const SYNTHETIC_OAUTH_SECRET = 'WUDI_MIGRATION_OAUTH_TOKEN_SYNTHETIC_Z9Y8X7W6V5';

      const encAi = 'enc:' + safeStorage.encryptString(SYNTHETIC_AI_SECRET).toString('base64');
      const encOAuth = 'enc:' + safeStorage.encryptString(SYNTHETIC_OAUTH_SECRET).toString('base64');

      const legacyVault = {
        'ai.openaiApiKey': encAi,
        'oauth.google': encOAuth,
      };

      fs.writeFileSync(path.join(sourceDir, 'safe-storage.json'), JSON.stringify(legacyVault, null, 2), 'utf-8');

      // 2. Transpile and import user-data-migration and safe-storage
      const ts = require('typescript');
      const loadTs = (relPath) => {
        const full = path.join(root, relPath);
        const code = fs.readFileSync(full, 'utf8');
        const transpiled = ts.transpileModule(code, {
          compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true },
        });
        const m = { exports: {} };
        const sandboxRequire = (id) => {
          if (id === 'electron') return { app, safeStorage };
          if (id === './dev-profile') return { isIsolatedDevProfile: false };
          return require(id);
        };
        const fn = new Function('module', 'exports', 'require', '__dirname', transpiled.outputText);
        fn(m, m.exports, sandboxRequire, path.dirname(full));
        return m.exports;
      };

      const migrationMod = loadTs('src/main/user-data-migration.ts');
      const safeStorageMod = loadTs('src/main/safe-storage.ts');

      // 3. Run migration
      const migRes = migrationMod.maybeMigrateUserDataFromSuperCmd({
        sourceDir,
        targetDir,
        isDevProfile: false,
      });

      assert.equal(migRes.migrated, true, 'Migration must succeed');
      assert.ok(migRes.migratedFiles.includes('safe-storage.json'), 'safe-storage.json must be migrated');

      // 4. Point userData to targetDir and verify secrets
      app.setPath('userData', targetDir);
      safeStorageMod.resetVaultCache();

      const aiDecrypted = safeStorageMod.getSecret('ai.openaiApiKey');
      const oauthDecrypted = safeStorageMod.getSecret('oauth.google');

      assert.equal(aiDecrypted === SYNTHETIC_AI_SECRET, true, 'AI secret must match decrypted plaintext');
      assert.equal(oauthDecrypted === SYNTHETIC_OAUTH_SECRET, true, 'OAuth secret must match decrypted plaintext');
      assert.equal(safeStorageMod.hasSecret('ai.openaiApiKey'), true);
      assert.equal(safeStorageMod.hasSecret('oauth.google'), true);

      // Log success evidence without revealing secret value
      console.log('safe-storage migration verification: secret readable: true');

      // 5. Verify source vault remains untouched
      const sourceVaultContent = fs.readFileSync(path.join(sourceDir, 'safe-storage.json'), 'utf-8');
      assert.deepEqual(JSON.parse(sourceVaultContent), legacyVault);

      // 6. Test legacy Keychain identity fallback:
      // When native safeStorage.decryptString throws (e.g. cross-identity keychain mismatch),
      // verify that legacy SuperCmd OSCrypt password fallback recovers the secret.
      const crypto = require('crypto');
      const testLegacyPw = 'legacy_supercmd_keychain_secret_pw_987';
      safeStorageMod.setLegacySuperCmdKeychainPasswordForTesting(testLegacyPw);

      const legacySecretValue = 'WUDI_LEGACY_MIGRATED_SECRET_RECOVERED_7788';
      const salt = 'saltysalt';
      const iterations = 1003;
      const derivedKey = crypto.pbkdf2Sync(testLegacyPw, salt, iterations, 16, 'sha1');
      const iv = Buffer.alloc(16, ' ');
      const cipher = crypto.createCipheriv('aes-128-cbc', derivedKey, iv);
      let legacyCiphertext = cipher.update(legacySecretValue, 'utf8');
      legacyCiphertext = Buffer.concat([legacyCiphertext, cipher.final()]);
      const legacyPayload = Buffer.concat([Buffer.from('v10', 'utf8'), legacyCiphertext]);
      const legacyEncString = 'enc:' + legacyPayload.toString('base64');

      // Put legacy cipher in target vault
      const targetVaultPath = path.join(targetDir, 'safe-storage.json');
      const currentVault = JSON.parse(fs.readFileSync(targetVaultPath, 'utf8'));
      currentVault['ai.anthropicApiKey'] = legacyEncString;
      fs.writeFileSync(targetVaultPath, JSON.stringify(currentVault, null, 2), 'utf8');

      safeStorageMod.resetVaultCache();
      const recoveredSecret = safeStorageMod.getSecret('ai.anthropicApiKey');
      assert.equal(recoveredSecret === legacySecretValue, true, 'Legacy OSCrypt secret must be recovered via fallback');
      assert.equal(safeStorageMod.hasSecret('ai.anthropicApiKey'), true);
      console.log('safe-storage legacy fallback verification: secret readable: true');

      // Clean up
      fs.rmSync(tmpRoot, { recursive: true, force: true });
      process.exit(0);
    } catch (err) {
      console.error('[test-safe-storage] Integration test failed:', err);
      process.exit(1);
    }
  });
} else {
  // Test suite entry when run with node --test
  test('Safe Storage: full cross-brand migration decrypts synthetic AI and OAuth secrets', () => {
    const electronBin = path.join(root, 'node_modules', '.bin', 'electron');
    const thisFile = fileURLToPath(import.meta.url);

    const output = execFileSync(electronBin, [thisFile], {
      env: {
        ...process.env,
        ELECTRON_SAFE_STORAGE_RUNNER: '1',
      },
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'inherit'],
    });

    assert.ok(
      output.includes('secret readable: true'),
      'Test output must confirm secrets were readable: true'
    );
  });
}
