/**
 * Finds ErvisioDrive's container through Docker, for drives installed without the Ervisio integration: their socket
 * is bound to ./data/run (not /run/ervisio-drive) on the host, but inside the container it is always at PLUGIN_SOCKET.
 * The plugin then reaches the API with a small Node script run in the container (docker exec), which goes through the
 * same socket proxy, so the proxy still adds its secret and only /api/plugin is reachable.
 *
 *   const found = await locate();             // { docker: true, app: {id, name, running, project, workingDir} } or app null
 *   const r = await viaContainer(found.app.id, 'GET', '/api/plugin/status');
 */
import type { PluginError } from '../sdk';
import * as docker from './docker';

export interface DriveContainer {
  id: string;
  /** Container name without the leading slash. */
  name: string;
  running: boolean;
  /** Compose project (the folder the drive was installed in), '' when unknown. */
  project: string;
  /** Host folder the Compose project was started from (its compose.yaml), '' when unknown. */
  workingDir: string;
}

export interface Located {
  /** False when Docker is not installed or does not answer. */
  docker: boolean;
  /** The drive's app container, null when there is none. */
  app: DriveContainer | null;
}

/** The answer of a request sent through the container, shaped like sdk.api.http's. */
export interface Answer {
  status: number;
  body: string;
  json(): any;
}

const PROJECT = 'com.docker.compose.project';
const SERVICE = 'com.docker.compose.service';
const WORKING_DIR = 'com.docker.compose.project.working_dir';

/** Errors of the docker API that mean "no Docker here" rather than "Docker refused". */
function noDocker(e: unknown): boolean {
  const code = (e as Partial<PluginError>)?.code;
  return code === 'unavailable' || code === 'not_found';
}

/**
 * Looks for the drive's `app` service among the containers. Rethrows `needs_admin` (the user declined the unlock
 * dialog) and Docker's own errors; answers `{docker: false}` when there is no Docker socket.
 */
export async function locate(): Promise<Located> {
  let list: docker.ContainerSummary[];
  try {
    list = await docker.listContainers();
  } catch (e) {
    if (noDocker(e)) return { docker: false, app: null };
    throw e;
  }
  const candidates = list.filter((c) => c.Labels?.[SERVICE] === 'app' && /ervisio-?drive/i.test(`${c.Image} ${c.Labels?.[PROJECT] ?? ''}`));
  // A running container first, then any other; the image alone could be a fork, so the socket variable decides.
  candidates.sort((a, b) => Number(b.State === 'running') - Number(a.State === 'running'));
  for (const c of candidates) {
    const info = await docker.inspect(c.Id);
    if (!(info.Config.Env ?? []).some((v) => v.startsWith('PLUGIN_SOCKET='))) continue;
    return {
      docker: true,
      app: {
        id: c.Id,
        name: info.Name.replace(/^\//, ''),
        running: info.State.Running,
        project: c.Labels?.[PROJECT] ?? '',
        workingDir: c.Labels?.[WORKING_DIR] ?? '',
      },
    };
  }
  return { docker: true, app: null };
}

/**
 * Runs in the container with `node -e`: sends one request to the plugin socket and prints {status, body} or {error}.
 * argv: method, path with query, body ('' for none).
 */
const SCRIPT = [
  "const [m,p,b]=process.argv.slice(1),h={};if(b)h['content-type']='application/json';",
  "const out=(o)=>process.stdout.write(JSON.stringify(o));",
  "const r=require('http').request({socketPath:process.env.PLUGIN_SOCKET,method:m,path:p,headers:h},(res)=>{",
  "const d=[];res.on('data',(c)=>d.push(c));res.on('end',()=>out({status:res.statusCode,body:Buffer.concat(d).toString()}))});",
  "r.on('error',(e)=>out({error:e.message}));r.setTimeout(55000,()=>r.destroy(new Error('timeout')));if(b)r.write(b);r.end();",
].join('');

export class ContainerError extends Error {
  /** True when the container is gone or stopped, so the caller should look again. */
  lost: boolean;
  constructor(message: string, lost: boolean) {
    super(message);
    this.name = 'ContainerError';
    this.lost = lost;
  }
}

/** Sends one request to the drive's plugin API through its container. */
export async function viaContainer(id: string, method: string, path: string, body?: object): Promise<Answer> {
  let out: docker.ExecOutput;
  try {
    out = await docker.execIn(id, ['node', '-e', SCRIPT, method, path, body ? JSON.stringify(body) : '']);
  } catch (e) {
    if (e instanceof docker.DockerError) throw new ContainerError(e.message, e.status === 404 || e.status === 409);
    throw e;
  }
  let parsed: { status?: number; body?: string; error?: string };
  try {
    parsed = JSON.parse(out.stdout);
  } catch {
    throw new ContainerError((out.stderr || out.stdout).trim().slice(0, 300) || `exit ${out.exitCode}`, false);
  }
  // No socket in the container yet: the drive is starting.
  if (parsed.error) throw new ContainerError(parsed.error, true);
  const text = parsed.body ?? '';
  return { status: parsed.status ?? 0, body: text, json: () => JSON.parse(text) };
}

/**
 * Starts a stopped drive: the database and the long-running services of its Compose project, then the app. The
 * one-shot services (storage-init, bootstrap) already ran when the drive was installed.
 */
export async function startDrive(app: DriveContainer): Promise<void> {
  const all = await docker.listContainers();
  const mine = all.filter((c) => app.project && c.Labels?.[PROJECT] === app.project);
  const order = ['mongo', 'cleanup'];
  for (const service of order) {
    for (const c of mine.filter((x) => x.Labels?.[SERVICE] === service && x.State !== 'running')) await docker.start(c.Id);
  }
  await docker.start(app.id);
}
