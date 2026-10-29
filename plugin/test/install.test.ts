// install.outdated() and install.update() against a fake SDK.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./resolve-ts.mjs', import.meta.url);

const { setSdk } = await import('@ervisio/plugin-sdk');
const install = await import('../src/api/install.ts');

const calls: [string, string[]][] = [];
setSdk({
  plugin: { version: '0.4.0' },
  api: {
    exec: async (name: string, args: string[] = []) => {
      calls.push([name, args]);
      return { exitCode: 0, stdout: '', stderr: '' };
    },
  },
} as never);

test('drives older than the plugin, or with no version, are outdated', () => {
  for (const v of [null, undefined, '', '1.1.0', '0.3.0', '0.3.9', '0.2.12']) assert.equal(install.outdated(v), true, String(v));
  for (const v of ['0.4.0', '0.4.1', '0.5.0']) assert.equal(install.outdated(v), false, v);
});

test('update passes the plugin version and the folder, and refuses odd folders', async () => {
  await install.update('/home/me/ErvisioDrive');
  assert.deepEqual(calls.at(-1), ['update', ['0.4.0', '/home/me/ErvisioDrive']]);
  for (const bad of ['relative', '/a/../etc', '/a b', '/a;rm', '']) await assert.rejects(install.update(bad), /invalid folder/, bad);
});
