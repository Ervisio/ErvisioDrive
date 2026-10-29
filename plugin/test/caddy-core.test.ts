import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  END_MARKER,
  IMPORT_COMMENT,
  MARKER,
  adapterFromArgv,
  baseDomain,
  configFromArgv,
  editBlocker,
  ensureImport,
  findInline,
  generateBlock,
  hostTaken,
  hostsOf,
  importsCovering,
  normalizeHost,
  parseManaged,
  proxyTarget,
  readInline,
  registrableDomain,
  removeImport,
  removeInline,
  scan,
  siteHosts,
  suggestHost,
  upsertInline,
  validHost,
  type Upstream,
} from '../src/api/caddy-core.ts';

const MAIN = '/etc/caddy/Caddyfile';
const FILE = '/etc/caddy/ervisio-drive.caddy';

const sample = `{
	email admin@example.com
}

(secure) {
	header X-Frame-Options DENY
}

ervisio.example.com {
	import secure
	reverse_proxy localhost:9090
}

shop.example.com, www.shop.example.com {
	reverse_proxy shop:80 {
		header_up Host {host}
	}
}

http://intranet.lan {
	respond "hi"
}

other.org {
	respond "x"
}
`;

const up: Upstream = { host: '127.0.0.1', port: 3000, container: 'ervisiodrive-app', containerPort: 3000, network: 'ervisiodrive_edge' };

test('host validation', () => {
  for (const h of ['drive.example.com', 'a.b.c.example.co.uk', 'x1.io', 'drive-1.example.com', 'xn--bcher-kva.example']) assert.ok(validHost(h), h);
  for (const h of ['', 'example', '*.example.com', 'Drive.example.com', '-a.example.com', 'a-.example.com', 'a..b.com', '1.2.3.4', 'example.123', 'a_b.example.com', 'drive.example.com:443', `${'a'.repeat(64)}.com`, 'drive.example.com/']) {
    assert.ok(!validHost(h), h);
  }
  assert.equal(normalizeHost('  Drive.Example.COM. '), 'drive.example.com');
  assert.equal(normalizeHost('https://drive.example.com/'), 'drive.example.com');
  assert.equal(normalizeHost('*.example.com'), null);
  assert.equal(normalizeHost('drive.example.com\n{'), null);
});

test('outline of a Caddyfile', () => {
  const r = scan(sample);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.deepEqual(r.outline.entries.map((e) => e.kind), ['global', 'snippet', 'site', 'site', 'site', 'site']);
  assert.deepEqual(r.outline.snippets, ['secure']);
  assert.deepEqual(r.outline.imports, []);
  assert.equal(r.outline.braceless, false);
  assert.deepEqual(siteHosts(r.outline), ['ervisio.example.com', 'shop.example.com', 'www.shop.example.com', 'intranet.lan', 'other.org']);
});

test('unsafe Caddyfiles are refused', () => {
  assert.match(String(editBlocker('a.com {\n\trespond x\n')), /never closed/);
  assert.match(String(editBlocker('a.com {\n}\n}\n')), /without a matching/);
  assert.match(String(editBlocker('a.com {\n\trespond "x\n}\n')), /Unterminated/);
  assert.match(String(editBlocker('a.com{\n\trespond x\n}\n')), /space before the brace/);
  assert.match(String(editBlocker('example.com\nreverse_proxy localhost:8080\n')), /without braces/);
  assert.equal(editBlocker(sample), null);
  assert.equal(editBlocker('{$DOMAIN} {\n\trespond x\n}\n'), null);
  assert.equal(editBlocker('a.com {\n\trespond <<EOF\n\t}{\n\tEOF 200\n}\n'), null);
  assert.throws(() => ensureImport('example.com\nreverse_proxy x:1\n', MAIN, FILE), /without braces/);
});

test('hosts of a site header', () => {
  assert.deepEqual(hostsOf(['https://a.example.com:8443,', 'b.example.com/path']), ['a.example.com', 'b.example.com']);
  assert.deepEqual(hostsOf([':80']), []);
});

test('registrable domain and base domain', () => {
  assert.equal(registrableDomain('shop.example.com'), 'example.com');
  assert.equal(registrableDomain('example.com'), 'example.com');
  assert.equal(registrableDomain('a.b.example.co.uk'), 'example.co.uk');
  assert.equal(registrableDomain('*.example.org'), 'example.org');
  assert.equal(registrableDomain('intranet.lan'), null);
  assert.equal(registrableDomain('localhost'), null);
  assert.equal(registrableDomain('10.0.0.1'), null);
  assert.equal(registrableDomain('{$DOMAIN}'), null);
  assert.equal(registrableDomain('x.example.io'), 'example.io');
  assert.equal(baseDomain(['ervisio.example.com', 'shop.example.com', 'other.org']), 'example.com');
  assert.equal(baseDomain(['other.org', 'a.example.com', 'b.other.org', 'example.com']), 'other.org'); // first seen wins a tie
  assert.equal(baseDomain(['intranet.lan', 'localhost']), null);
  assert.equal(baseDomain([]), null);
});

test('suggestion', () => {
  assert.deepEqual(suggestHost(['ervisio.example.com', 'shop.example.com']), { host: 'drive.example.com', base: 'example.com', renamed: false });
  assert.deepEqual(suggestHost(['drive.example.com', 'shop.example.com']), { host: 'files.example.com', base: 'example.com', renamed: true });
  // Our own block may keep its name.
  assert.equal(suggestHost(['drive.example.com', 'shop.example.com'], 'drive.example.com')?.host, 'drive.example.com');
  // A wildcard at the same level covers drive.example.com and the other labels: fall back to driveN, also covered.
  assert.equal(suggestHost(['*.example.com', 'example.com']), null);
  assert.equal(suggestHost(['intranet.lan']), null);
  const r = scan(sample);
  assert.ok(r.ok && suggestHost(siteHosts(r.outline))?.host === 'drive.example.com');
});

test('host taken', () => {
  assert.ok(hostTaken(['drive.example.com'], 'drive.example.com'));
  assert.ok(hostTaken(['*.example.com'], 'drive.example.com'));
  assert.ok(!hostTaken(['*.example.com'], 'a.drive.example.com'));
  assert.ok(!hostTaken(['shop.example.com'], 'drive.example.com'));
});

test('proxy target', () => {
  assert.equal(proxyTarget('system', up), '127.0.0.1:3000');
  assert.equal(proxyTarget('system', { ...up, host: '0.0.0.0', port: 8080 }), '127.0.0.1:8080');
  assert.equal(proxyTarget('system', { ...up, host: '::' }), '127.0.0.1:3000');
  assert.equal(proxyTarget('system', { ...up, host: '192.168.1.5' }), '192.168.1.5:3000');
  assert.equal(proxyTarget('system', { ...up, host: 'fd00::5' }), '[fd00::5]:3000');
  assert.equal(proxyTarget('docker', up), 'ervisiodrive-app:3000');
});

test('site block', () => {
  const block = generateBlock('drive.example.com', '127.0.0.1:3000');
  assert.equal(block.split('\n')[0], MARKER);
  assert.ok(block.includes('drive.example.com {\n\treverse_proxy 127.0.0.1:3000\n\tencode zstd gzip\n}\n'));
  assert.ok(!block.includes(END_MARKER));
  assert.ok(generateBlock('drive.example.com', 'x:1', true).trimEnd().endsWith(END_MARKER));
  assert.throws(() => generateBlock('*.example.com', 'x:1'));
  assert.throws(() => generateBlock('drive.example.com', 'x:1 {\n}'));
  assert.deepEqual(parseManaged(block), { host: 'drive.example.com', target: '127.0.0.1:3000' });
  assert.equal(parseManaged('drive.example.com {\n\treverse_proxy x:1\n}\n'), null); // not ours
  const r = scan(block);
  assert.ok(r.ok && r.outline.sites.length === 1);
});

test('import line: added once, idempotent, removed exactly', () => {
  const a = ensureImport(sample, MAIN, FILE);
  assert.ok(a.changed);
  assert.ok(a.text.endsWith(`\n\n${IMPORT_COMMENT}\nimport ervisio-drive.caddy\n`));
  assert.ok(a.text.startsWith(sample.trimEnd()));
  const b = ensureImport(a.text, MAIN, FILE);
  assert.equal(b.changed, false);
  assert.equal(b.text, a.text);
  const c = removeImport(a.text, MAIN, FILE);
  assert.ok(c.changed);
  assert.equal(c.text, sample);
  assert.equal(removeImport(sample, MAIN, FILE).changed, false);
});

test('import line: empty file, no trailing newline, CRLF-free result', () => {
  assert.equal(ensureImport('', MAIN, FILE).text, `${IMPORT_COMMENT}\nimport ervisio-drive.caddy\n`);
  const t = ensureImport('a.com {\n\trespond x\n}', MAIN, FILE).text;
  assert.equal(t, `a.com {\n\trespond x\n}\n\n${IMPORT_COMMENT}\nimport ervisio-drive.caddy\n`);
  assert.equal(removeImport(t, MAIN, FILE).text, 'a.com {\n\trespond x\n}\n');
});

test('an existing glob import already loads our file', () => {
  const text = `${sample}\nimport *.caddy\n`;
  const r = scan(text);
  assert.ok(r.ok);
  if (r.ok) assert.deepEqual(importsCovering(r.outline, MAIN, FILE), ['*.caddy']);
  assert.equal(ensureImport(text, MAIN, FILE).changed, false);
  assert.equal(ensureImport(`${sample}\nimport /etc/caddy/*\n`, MAIN, FILE).changed, false);
  assert.equal(ensureImport(`${sample}\nimport sites/*.caddy\n`, MAIN, FILE).changed, true);
  // Globs are never removed: they load other files too.
  assert.equal(removeImport(text, MAIN, FILE).changed, false);
  // A snippet named like a file is not a file import.
  assert.equal(ensureImport(`(ervisio-drive.caddy) {\n\trespond x\n}\nimport ervisio-drive.caddy\n`, MAIN, FILE).changed, true);
});

test('import written by hand (absolute or ./) is recognised and removed', () => {
  assert.equal(ensureImport(`${sample}import /etc/caddy/ervisio-drive.caddy\n`, MAIN, FILE).changed, false);
  const r = removeImport(`${sample}import ./ervisio-drive.caddy\n`, MAIN, FILE);
  assert.ok(r.changed);
  assert.equal(r.text, sample);
  // A file elsewhere gets an absolute import.
  assert.ok(ensureImport(sample, '/etc/caddy/conf/Caddyfile', FILE).text.includes('import /etc/caddy/ervisio-drive.caddy'));
});

test('inline block', () => {
  const block = generateBlock('drive.example.com', 'ervisiodrive-app:3000', true);
  const a = upsertInline(sample, block);
  assert.ok(a.changed);
  assert.equal(readInline(a.text), block);
  assert.deepEqual(parseManaged(readInline(a.text)!), { host: 'drive.example.com', target: 'ervisiodrive-app:3000' });
  assert.ok(scan(a.text).ok);
  // Replaced in place, not duplicated.
  const b = upsertInline(a.text, generateBlock('files.example.com', 'ervisiodrive-app:3000', true));
  assert.equal(b.text.split(MARKER).length, 2);
  assert.equal(parseManaged(readInline(b.text)!)?.host, 'files.example.com');
  assert.equal(upsertInline(b.text, generateBlock('files.example.com', 'ervisiodrive-app:3000', true)).changed, false);
  // Removed exactly.
  assert.equal(removeInline(b.text).text, sample);
  assert.equal(removeInline(sample).changed, false);
  assert.equal(findInline(sample), null);
  assert.throws(() => findInline(`${MARKER}\n${MARKER}\n${END_MARKER}\n`));
});

test('caddy command lines', () => {
  assert.equal(configFromArgv(['/usr/bin/caddy', 'run', '--environ', '--config', '/etc/caddy/Caddyfile']), '/etc/caddy/Caddyfile');
  assert.equal(configFromArgv(['caddy', 'run', '--config=/srv/c.json']), '/srv/c.json');
  assert.equal(configFromArgv(['caddy', 'run']), '/etc/caddy/Caddyfile');
  assert.equal(adapterFromArgv(['caddy', 'run'], '/etc/caddy/Caddyfile'), 'caddyfile');
  assert.equal(adapterFromArgv(['caddy', 'run'], '/srv/c.json'), 'json');
  assert.equal(adapterFromArgv(['caddy', 'run', '--adapter', 'yaml'], '/etc/caddy/c.yaml'), 'yaml');
});
