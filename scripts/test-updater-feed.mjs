#!/usr/bin/env node

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ts = require('typescript');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function loadTsModule(filePath) {
  const resolvedPath = path.resolve(filePath);
  const source = fs.readFileSync(resolvedPath, 'utf8');
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: resolvedPath,
  });

  const module = { exports: {} };
  const sandbox = {
    module,
    exports: module.exports,
    require,
    console,
    process,
    Buffer,
    __dirname: path.dirname(resolvedPath),
    __filename: resolvedPath,
  };
  vm.runInNewContext(transpiled.outputText, sandbox);
  return module.exports;
}

const {
  parseGithubRepository: rawParseGithubRepository,
  resolveAppUpdaterFeedConfig: rawResolveAppUpdaterFeedConfig,
  APP_UPDATES_ENABLED,
  UPDATE_OWNER,
  UPDATE_REPO,
} = loadTsModule(
  path.join(root, 'src', 'main', 'updater-config.ts')
);

const parseGithubRepository = (input) => {
  const res = rawParseGithubRepository(input);
  return res ? { owner: String(res.owner), repo: String(res.repo) } : null;
};

const resolveAppUpdaterFeedConfig = (...args) => {
  const res = rawResolveAppUpdaterFeedConfig(...args);
  return res ? JSON.parse(JSON.stringify(res)) : null;
};

test('updater configuration has updates disabled by default for private repo', () => {
  assert.equal(APP_UPDATES_ENABLED, false, 'APP_UPDATES_ENABLED must be false by default for private repo');
  assert.equal(UPDATE_OWNER, 'MdicaL7');
  assert.equal(UPDATE_REPO, 'WUDI');
  // Default resolution without override must return null (disabled)
  const resolved = resolveAppUpdaterFeedConfig(null, [path.join(root, 'package.json')]);
  assert.equal(resolved, null, 'resolveAppUpdaterFeedConfig must return null when updates are disabled');
});

test('parseGithubRepository extracts owner and repo correctly', () => {
  assert.deepEqual(parseGithubRepository('https://github.com/MdicaL7/WUDI'), {
    owner: 'MdicaL7',
    repo: 'WUDI',
  });
  assert.deepEqual(parseGithubRepository('git@github.com:MdicaL7/WUDI.git'), {
    owner: 'MdicaL7',
    repo: 'WUDI',
  });
  assert.deepEqual(parseGithubRepository('MdicaL7/WUDI'), {
    owner: 'MdicaL7',
    repo: 'WUDI',
  });
  assert.equal(parseGithubRepository('invalid-url'), null);
});

test('resolveAppUpdaterFeedConfig resolves user repository MdicaL7/WUDI when enabled', () => {
  const customPkg = {
    repository: 'https://github.com/MdicaL7/WUDI',
    build: {
      publish: [
        {
          provider: 'github',
          owner: 'MdicaL7',
          repo: 'WUDI',
          releaseType: 'release',
        },
      ],
    },
  };

  const resolved = resolveAppUpdaterFeedConfig(customPkg, undefined, true);
  assert.ok(resolved, 'feed config must be resolved when enabled');
  assert.equal(resolved.provider, 'github');
  assert.equal(resolved.owner, 'MdicaL7');
  assert.equal(resolved.repo, 'WUDI');
});

test('resolveAppUpdaterFeedConfig strictly rejects SuperCmdLabs and legacy SuperCmd feed', () => {
  const legacySuperCmdLabsPkg = {
    repository: 'https://github.com/SuperCmdLabs/SuperCmd',
    build: {
      publish: [
        {
          provider: 'github',
          owner: 'SuperCmdLabs',
          repo: 'SuperCmd',
          releaseType: 'release',
        },
      ],
    },
  };

  const legacySuperCmdRepoPkg = {
    repository: 'https://github.com/MdicaL7/SuperCmd',
    build: {
      publish: [
        {
          provider: 'github',
          owner: 'MdicaL7',
          repo: 'SuperCmd',
          releaseType: 'release',
        },
      ],
    },
  };

  assert.equal(resolveAppUpdaterFeedConfig(legacySuperCmdLabsPkg, undefined, true), null);
  assert.equal(resolveAppUpdaterFeedConfig(legacySuperCmdRepoPkg, undefined, true), null);
});

test('resolveAppUpdaterFeedConfig reads actual package.json and matches MdicaL7/WUDI when enabled', () => {
  const resolved = resolveAppUpdaterFeedConfig(null, [path.join(root, 'package.json')], true);
  assert.ok(resolved, 'must resolve from project package.json when enabled');
  assert.equal(resolved.owner, 'MdicaL7');
  assert.equal(resolved.repo, 'WUDI');
  assert.notEqual(resolved.owner.toLowerCase(), 'supercmdlabs');
  assert.notEqual(resolved.repo.toLowerCase(), 'supercmd');
});
