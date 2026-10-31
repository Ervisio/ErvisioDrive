import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('./resolve-ts.mjs', import.meta.url);
const { setSdk } = await import('@ervisio/plugin-sdk');
const docker = await import('../src/api/docker.ts');
const { locate } = await import('../src/api/locate.ts');
const drive = await import('../src/api/drive.ts');
const SERVICE = 'com.docker.compose.service', PROJECT = 'com.docker.compose.project', DIR = 'com.docker.compose.project.working_dir';
const id = (n: number) => n.toString(16).padStart(64, '0');
let containers: any[], inspected: string[];
const reply = (body: unknown, status = 200) => ({ status, body: JSON.stringify(body), json: () => body });
function container(n: number, opts: { service?: string | null; image?: string; name?: string; project?: string; env?: string[]; running?: boolean; gone?: boolean } = {}) {
  return { Id: id(n), Image: opts.image ?? 'ervisiodrive:local', Names: [opts.name ?? '/custom-app'],
    Command: 'node scripts/start.mjs', State: opts.running === false ? 'exited' : 'running',
    Labels: { ...(opts.service === null ? {} : { [SERVICE]: opts.service ?? 'app' }), [PROJECT]: opts.project ?? 'custom', [DIR]: '/opt/stacks/ervisiodrive' }, opts };
}
beforeEach(() => {
  containers = []; inspected = []; docker.resetDocker(); drive.resetRoute();
  setSdk({ api: { http: async (name: string, req: { path: string }) => {
    if (name === 'drive') throw Object.assign(new Error('No host socket'), { code: 'unavailable' });
    if (req.path === '/version') return reply({ ApiVersion: '1.47' });
    if (req.path.endsWith('/containers/json')) return reply(containers);
    const c = containers.find((c) => req.path.endsWith(`/containers/${c.Id}/json`));
    if (c) {
      inspected.push(c.Id);
      if (c.opts.gone) return reply({ message: 'No such container' }, 404);
      return reply({ Id: c.Id, Name: c.Names[0], Config: { Image: c.Image, Labels: c.Labels, Env: c.opts.env ?? [] },
        State: { Running: c.State === 'running' } });
    }
    throw new Error(`Unexpected request: ${req.path}`);
  } } } as never);
});
test('finds legacy app without PLUGIN_SOCKET, keeping its existing Compose folder', async () => {
  containers = [container(1)];
  const found = await locate();
  assert.equal(found.app?.id, id(1)); assert.equal(found.app?.integration, false);
  assert.equal(found.app?.workingDir, '/opt/stacks/ervisiodrive');
});
test('finds renamed Compose services and standalone containers using image or name', async () => {
  containers = [container(1, { service: 'web', env: ['PLUGIN_SOCKET=/run/custom.sock'] })];
  assert.equal((await locate()).app?.integration, true);
  containers = [container(2, { service: null, image: 'custom-build:latest', name: '/ervisio-drive' })];
  assert.equal((await locate()).app?.id, id(2));
});
test('never picks auxiliary containers using the same image', async () => {
  containers = ['cleanup', 'bootstrap', 'storage-init', 'mongo'].map((service, i) => container(i + 1, { service }));
  containers.push(container(8, { env: ['PLUGIN_SOCKET=/run/ervisio-drive/api.sock'] }));
  assert.equal((await locate()).app?.id, id(8)); assert.deepEqual(inspected, [id(8)]);
});
test('prefers a running legacy app over stopped leftovers, and running integrated over legacy', async () => {
  containers = [container(1, { running: false, env: ['PLUGIN_SOCKET=/socket'] }), container(2)];
  assert.equal((await locate()).app?.id, id(2));
  containers.push(container(3, { env: ['PLUGIN_SOCKET=/socket'] }));
  assert.equal((await locate()).app?.id, id(3));
});
test('ignores disappearing containers and unrelated app services', async () => {
  containers = [container(1, { image: 'other:latest', name: '/other' }), container(2, { gone: true }), container(3)];
  assert.equal((await locate()).app?.id, id(3)); assert.deepEqual(inspected, [id(2), id(3)]);
});
test('status exposes a legacy container instead of claiming it is not installed', async () => {
  containers = [container(1)];
  await assert.rejects(drive.status(), (error: unknown) => {
    assert.ok(error instanceof drive.DriveError);
    assert.equal(error.located?.app?.id, id(1)); assert.equal(error.located?.app?.integration, false);
    return true;
  });
});
