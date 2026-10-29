// apply() / remove() / propose() against a fake SDK: a system Caddy with files in memory, a scripted validate and
// reload, and a fake drive socket.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('./resolve-ts.mjs', import.meta.url);

const { setSdk } = await import('@ervisio/plugin-sdk');
const caddy = await import('../src/api/caddy.ts');

const MAIN = '/etc/caddy/Caddyfile';
const OURS = '/etc/caddy/ervisio-drive.caddy';
const original = `{
	email admin@example.com
}

ervisio.example.com {
	reverse_proxy localhost:9090
}

shop.example.com {
	reverse_proxy shop:80
}
`;

interface World {
  files: Map<string, string>;
  calls: string[];
  validateOk: (files: Map<string, string>) => boolean;
  reloadOk: (n: number) => boolean;
  reloads: number;
  publicUrl: string | null;
  driveUp: boolean;
}
let w: World;

const err = (code: string, message: string) => Object.assign(new Error(message), { code });
const res = (status: number, body: unknown) => ({
  status,
  headers: {},
  body: JSON.stringify(body),
  json: () => body,
  bytes: () => new TextEncoder().encode(JSON.stringify(body)),
});

function fakeSdk() {
  return {
    version: 3,
    api: {
      async exec(command: string, args: string[] = []) {
        w.calls.push(`exec ${command} ${args.join(' ')}`.trim());
        if (command === 'service-show')
          return {
            exitCode: 0,
            stderr: '',
            stdout: 'LoadState=loaded\nActiveState=active\nSubState=running\nExecStart={ path=/usr/bin/caddy ; argv[]=/usr/bin/caddy run --environ --config /etc/caddy/Caddyfile ; ignore_errors=no }\n',
          };
        if (command === 'validate') return w.validateOk(w.files) ? { exitCode: 0, stdout: 'Valid configuration', stderr: '' } : { exitCode: 1, stdout: '', stderr: 'Error: adapting config using caddyfile: bad' };
        if (command === 'reload') {
          w.reloads++;
          return w.reloadOk(w.reloads) ? { exitCode: 0, stdout: '', stderr: '' } : { exitCode: 1, stdout: '', stderr: 'Job for caddy.service failed' };
        }
        if (command === 'has-docker') return { exitCode: 1, stdout: '', stderr: '' };
        throw err('not_found', `unknown command ${command}`);
      },
      async http(name: string, req: { method: string; path: string; body?: { url?: string } }) {
        w.calls.push(`http ${name} ${req.method} ${req.path}`);
        if (name !== 'drive') throw err('not_found', 'no api');
        if (!w.driveUp) throw err('unavailable', 'dial unix /run/ervisio-drive/api.sock: connect: no such file or directory');
        if (req.path === '/api/plugin/status')
          return res(200, {
            success: true,
            data: {
              version: '1.0.0',
              publicUrl: w.publicUrl,
              trustProxy: false,
              encryption: false,
              upstream: { host: '127.0.0.1', port: 3000, container: 'ervisiodrive-app', containerPort: 3000, network: 'ervisiodrive_edge' },
              storage: { usedBytes: 0, quotaBytes: null },
              members: 1,
              files: 0,
            },
          });
        if (req.path === '/api/plugin/public-url' && req.method === 'PUT') {
          w.publicUrl = req.body!.url!;
          return res(200, { success: true, data: { publicUrl: w.publicUrl, trustProxy: true } });
        }
        return res(404, { success: false, error: 'Not found' });
      },
    },
    files: {
      async read(p: string) {
        if (!w.files.has(p)) throw err('not_found', `${p}: no such file`);
        return w.files.get(p)!;
      },
      async write(p: string, data: string) {
        w.calls.push(`write ${p}`);
        w.files.set(p, data);
      },
      async remove(p: string) {
        w.calls.push(`remove ${p}`);
        if (!w.files.delete(p)) throw err('not_found', `${p}: no such file`);
      },
      async list(dir: string) {
        const names = new Map<string, string>();
        for (const p of w.files.keys()) {
          if (!p.startsWith(`${dir}/`)) continue;
          const rest = p.slice(dir.length + 1);
          names.set(rest.split('/')[0], rest.includes('/') ? 'dir' : 'file');
        }
        return [...names].map(([name, type]) => ({ name, type, size: 0, mtime: 0 }));
      },
    },
  };
}

beforeEach(() => {
  w = { files: new Map([[MAIN, original]]), calls: [], validateOk: () => true, reloadOk: () => true, reloads: 0, publicUrl: 'http://localhost:3000', driveUp: true };
  setSdk(fakeSdk() as never);
});

const system = async () => (await caddy.detect()).instances[0];

test('propose: drive reachable and Caddy found → drive.<base domain>', async () => {
  const p = await caddy.propose();
  assert.equal(p.instance?.kind, 'system');
  assert.equal(p.instance?.configPath, MAIN);
  assert.equal(p.instance?.layout, 'file');
  assert.equal(p.suggestion?.host, 'drive.example.com');
  assert.equal(p.current, null);
  assert.equal(p.publishedHost, null);
});

test('propose: no drive on the socket → empty proposal, no throw', async () => {
  w.driveUp = false;
  const p = await caddy.propose();
  assert.equal(p.drive, null);
  assert.equal(p.instance, null);
});

test('apply: writes our file, then the import, validates, reloads, sets the public URL', async () => {
  const inst = await system();
  const r = await caddy.apply(inst, ' Drive.Example.com ');
  assert.equal(r.ok, true, r.message);
  assert.equal(r.step, 'done');
  assert.equal(r.host, 'drive.example.com');
  assert.equal(r.target, '127.0.0.1:3000');
  assert.match(w.files.get(OURS)!, /^# Managed by the ErvisioDrive plugin\n/);
  assert.match(w.files.get(OURS)!, /drive\.example\.com \{\n\treverse_proxy 127\.0\.0\.1:3000\n\tencode zstd gzip\n\}/);
  assert.ok(w.files.get(MAIN)!.endsWith('import ervisio-drive.caddy\n'));
  const writes = w.calls.filter((c) => c.startsWith('write'));
  assert.deepEqual(writes, [`write ${OURS}`, `write ${MAIN}`]);
  assert.equal(w.reloads, 1);
  assert.equal(w.publicUrl, 'https://drive.example.com');

  const cur = await caddy.current(inst);
  assert.deepEqual(cur, { host: 'drive.example.com', target: '127.0.0.1:3000', layout: 'file', path: OURS, imported: true });
  // Applying again changes nothing and keeps one import line.
  const again = await caddy.apply(inst, 'drive.example.com');
  assert.equal(again.ok, true);
  assert.equal(w.files.get(MAIN)!.split('import ervisio-drive.caddy').length, 2);
  // The suggestion keeps our own host.
  assert.equal((await caddy.suggestHost(inst))?.host, 'drive.example.com');
});

test('apply: a failed check puts both files back exactly and does not touch the drive', async () => {
  w.validateOk = () => false;
  const r = await caddy.apply(await system(), 'drive.example.com');
  assert.equal(r.ok, false);
  assert.equal(r.step, 'validate');
  assert.equal(r.rolledBack, true);
  assert.match(r.message, /adapting config/);
  assert.equal(w.files.get(MAIN), original);
  assert.equal(w.files.has(OURS), false);
  assert.equal(w.reloads, 0);
  assert.equal(w.publicUrl, 'http://localhost:3000');
  assert.ok(r.snippet?.includes('reverse_proxy 127.0.0.1:3000'));
});

test('apply: a failed reload restores the files and reloads the old config', async () => {
  w.files.set(OURS, '# Managed by the ErvisioDrive plugin\nold.example.com {\n\treverse_proxy 127.0.0.1:3000\n}\n');
  const before = new Map(w.files);
  w.reloadOk = (n) => n > 1;
  const r = await caddy.apply(await system(), 'drive.example.com');
  assert.equal(r.step, 'reload');
  assert.equal(r.rolledBack, true);
  assert.deepEqual(w.files, before);
  assert.equal(w.reloads, 2);
  assert.equal(w.publicUrl, 'http://localhost:3000');
});

test('apply: refuses a bad host before touching anything', async () => {
  const r = await caddy.apply(await system(), '*.example.com');
  assert.equal(r.step, 'host');
  assert.equal(w.calls.filter((c) => c.startsWith('write') || c.startsWith('http')).length, 0);
});

test('apply: refuses a host another site already serves', async () => {
  const r = await caddy.apply(await system(), 'shop.example.com');
  assert.equal(r.step, 'conflict');
  assert.equal(w.files.get(MAIN), original);
});

test('apply: a host served from an imported file is a conflict too', async () => {
  w.files.set(MAIN, `${original}\nimport sites/*.caddy\n`);
  w.files.set('/etc/caddy/sites/a.caddy', 'drive.example.com {\n\trespond hi\n}\n');
  const r = await caddy.apply(await system(), 'drive.example.com');
  assert.equal(r.step, 'conflict');
});

test('apply: never edits a Caddyfile it cannot parse; offers the snippet', async () => {
  w.files.set(MAIN, 'example.com\nreverse_proxy localhost:8080\n');
  const r = await caddy.apply(await system(), 'drive.example.com');
  assert.equal(r.step, 'unsupported');
  assert.equal(r.reason, 'unsafe');
  assert.ok(r.snippet?.startsWith('# Managed by the ErvisioDrive plugin'));
  assert.equal(w.calls.filter((c) => c.startsWith('write')).length, 0);
});

test('apply: an ervisio-drive.caddy someone else wrote is left alone', async () => {
  w.files.set(OURS, 'drive.example.com {\n\trespond mine\n}\n');
  const r = await caddy.apply(await system(), 'files.example.com');
  assert.equal(r.step, 'conflict');
  assert.equal(r.reason, 'not-ours');
});

test('remove: takes the import line and our file away, back to the original', async () => {
  const inst = await system();
  assert.equal((await caddy.apply(inst, 'drive.example.com')).ok, true);
  const r = await caddy.remove(inst);
  assert.equal(r.ok, true, r.message);
  assert.equal(r.host, 'drive.example.com');
  assert.equal(w.files.get(MAIN), original);
  assert.equal(w.files.has(OURS), false);
  assert.equal(await caddy.current(inst), null);
});

test('remove: rolls back when Caddy refuses', async () => {
  const inst = await system();
  await caddy.apply(inst, 'drive.example.com');
  const before = new Map(w.files);
  w.validateOk = () => false;
  const r = await caddy.remove(inst);
  assert.equal(r.step, 'validate');
  assert.deepEqual(w.files, before);
});
