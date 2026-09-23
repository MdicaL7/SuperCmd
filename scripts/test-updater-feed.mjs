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

const { parseGithubRepository: rawParseGithubRepository, resolveAppUpdaterFeedConfig: rawResolveAppUpdaterFeedConfig } = loadTsModule(
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

test('parseGithubRepository extracts owner and repo correctly', () => {
  assert.deepEqual(parseGithubRepository('https://github.com/MdicaL7/SuperCmd'), {
    owner: 'MdicaL7',
    repo: 'SuperCmd',
  });
  assert.deepEqual(parseGithubRepository('git@github.com:MdicaL7/SuperCmd.git'), {
    owner: 'MdicaL7',
    repo: 'SuperCmd',
  });
  assert.deepEqual(parseGithubRepository('MdicaL7/SuperCmd'), {
    owner: 'MdicaL7',
    repo: 'SuperCmd',
  });
  assert.equal(parseGithubRepository('invalid-url'), null);
});

test('resolveAppUpdaterFeedConfig resolves user repository MdicaL7/WUDI', () => {
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

  const resolved = resolveAppUpdaterFeedConfig(customPkg);
  assert.ok(resolved, 'feed config must be resolved');
  assert.equal(resolved.provider, 'github');
  assert.equal(resolved.owner, 'MdicaL7');
  assert.equal(resolved.repo, 'WUDI');
});

test('resolveAppUpdaterFeedConfig strictly rejects SuperCmdLabs feed', () => {
  const legacyPkg = {
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

  const resolved = resolveAppUpdaterFeedConfig(legacyPkg);
  assert.equal(resolved, null, 'SuperCmdLabs must be rejected by updater');
});

test('resolveAppUpdaterFeedConfig reads actual package.json and matches MdicaL7/WUDI', () => {
  const resolved = resolveAppUpdaterFeedConfig(null, [path.join(root, 'package.json')]);
  assert.ok(resolved, 'must resolve from project package.json');
  assert.equal(resolved.owner, 'MdicaL7');
  assert.equal(resolved.repo, 'WUDI');
  assert.notEqual(resolved.owner.toLowerCase(), 'supercmdlabs');
});
