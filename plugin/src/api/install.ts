/**
 * Installs ErvisioDrive on this machine when there is none: the release matching this plugin is downloaded to
 * /opt/ervisio-drive and set up with the Ervisio integration (./setup.sh --non-interactive --ervisio yes), which
 * builds the image and starts the Compose stack. The work runs in a transient systemd unit (ervisio-drive-install), so
 * it survives the page being closed and has no command time limit; the page follows it through the unit's state and
 * its journal.
 *
 *   await install.start({ email: 'me@example.com', port: 3000 });
 *   const p = await install.progress();        // { state: 'running' | 'done' | 'failed' | 'idle', log, link }
 *
 * An installed drive is updated the same way, in the same unit: the folder its containers were started from gets the
 * release matching this plugin, then the stack is rebuilt.
 *
 *   if (install.outdated(status.version)) await install.update(app.workingDir);
 */
import { getSdk } from '../sdk';

export const INSTALL_DIR = '/opt/ervisio-drive';

export type InstallState = 'idle' | 'running' | 'done' | 'failed';

export interface InstallProgress {
  state: InstallState;
  /** The unit's output, newest last. */
  log: string[];
  /** The owner's activation link printed by the drive's bootstrap, when it appeared. */
  link: string | null;
  /** What the unit's last run was (its description), null when it never ran. */
  kind: 'install' | 'update' | null;
}

export const EMAIL = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(\.[A-Za-z0-9-]{1,63}){1,8}$/;

export function validPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

/** Docker must be there: the drive runs as a Compose stack. */
export async function hasDocker(): Promise<boolean> {
  return (await getSdk().api.exec('has-docker')).exitCode === 0;
}

/** Starts the installation (administrator rights; Ervisio asks to unlock them). */
export async function start(opts: { email: string; port: number }): Promise<void> {
  if (!EMAIL.test(opts.email)) throw new Error('invalid email');
  if (!validPort(opts.port)) throw new Error('invalid port');
  const r = await getSdk().api.exec('install', [getSdk().plugin.version, opts.email.toLowerCase(), String(opts.port)]);
  if (r.exitCode !== 0) throw new Error((r.stderr || r.stdout).trim() || `systemd-run exited with ${r.exitCode}`);
}

/** Folders the update command accepts: absolute, no `..`, no shell characters. */
export const FOLDER = /^\/[A-Za-z0-9._/-]{1,199}$/;

/** Numeric x.y.z, null for anything else. */
function semver(v: string | null | undefined): number[] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v ?? '');
  return m ? m.slice(1).map(Number) : null;
}

/**
 * True when the drive is older than this plugin. Drives before 0.4.0 report no version (or the old 1.x package one):
 * they count as older, since the plugin cannot tell.
 */
export function outdated(driveVersion: string | null | undefined): boolean {
  const mine = semver(getSdk().plugin.version);
  const theirs = semver(driveVersion);
  if (!mine) return false;
  if (!theirs || theirs[0] >= 1) return true;
  for (let i = 0; i < 3; i++) if (theirs[i] !== mine[i]) return theirs[i] < mine[i];
  return false;
}

/** Starts the update of the drive installed in `folder` (administrator rights). */
export async function update(folder: string): Promise<void> {
  if (!FOLDER.test(folder) || folder.includes('..')) throw new Error('invalid folder');
  const r = await getSdk().api.exec('update', [getSdk().plugin.version, folder]);
  if (r.exitCode !== 0) throw new Error((r.stderr || r.stdout).trim() || `systemd-run exited with ${r.exitCode}`);
}

function props(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const i = line.indexOf('=');
    if (i > 0) out[line.slice(0, i)] = line.slice(i + 1).trim();
  }
  return out;
}

const LINK = /https?:\/\/\S+\/(activate|invite|set-password)\S*/i;

/** Where the installation is, with the output of its last run. */
export async function progress(): Promise<InstallProgress> {
  const sdk = getSdk();
  const p = props((await sdk.api.exec('install-state')).stdout);
  if (p.LoadState !== 'loaded' || !p.InvocationID) return { state: 'idle', log: [], link: null, kind: null };
  const state: InstallState =
    p.ActiveState === 'failed' || (p.Result && p.Result !== 'success')
      ? 'failed'
      : p.ActiveState === 'active' && p.SubState === 'exited'
        ? 'done'
        : p.ActiveState === 'inactive'
          ? 'idle'
          : 'running';
  const journal = await sdk.api.exec('install-log', [p.InvocationID]);
  const log = journal.stdout.split('\n').filter((l) => l.trim());
  const link = log.map((l) => LINK.exec(l)?.[0] ?? null).filter(Boolean).pop() ?? null;
  return { state, log, link, kind: /update/i.test(p.Description ?? '') ? 'update' : 'install' };
}
