/**
 * Typed client of ErvisioDrive's administration API, reached through the unix socket the drive container opens on the
 * host (/run/ervisio-drive/api.sock, capabilities.http "drive"). A drive installed without the Ervisio integration has
 * its socket elsewhere on the host: then the plugin finds its container through Docker and sends the same requests
 * from inside it (locate.ts). The socket proxy in the container adds its own secret, so no auth header is sent. Every
 * call resolves with the `data` of the drive's {success, data} answer or throws a DriveError.
 *
 *   if (await drive.available()) { const s = await drive.status(); ... }
 *
 * The socket belongs to the container's user (0660): only root can open it, so the API is declared `admin` and the
 * first call of a session from a non-root account brings up Ervisio's unlock dialog.
 */
import { getSdk, type PluginError, type Query } from '../sdk';
import type { Upstream } from './caddy-core';
import { ContainerError, locate, viaContainer, type Answer, type Located } from './locate';

export type { Upstream } from './caddy-core';

const NAME = 'drive';
const BASE = '/api/plugin';

/* ---------- errors ---------- */

/**
 * - `unavailable`: no drive answers, neither on the socket nor in a Docker container (not installed, stopped, starting);
 *   `located` tells which;
 * - `admin`: administrator rights are needed and the user did not unlock them;
 * - `forbidden`: Ervisio refused the call (plugin disabled, socket permission denied);
 * - `invalid`: the drive refused the input (HTTP 400/409/413) or Ervisio refused the request shape;
 * - `not_found`: the drive answered 404 (unknown member, token...);
 * - `failed`: any other error status from the drive.
 */
export type DriveErrorKind = 'unavailable' | 'admin' | 'forbidden' | 'invalid' | 'not_found' | 'failed';

export class DriveError extends Error {
  kind: DriveErrorKind;
  /** HTTP status from the drive, 0 when the request never reached it. */
  status: number;
  /** With `unavailable`: what Docker shows (no Docker, no drive container, or a stopped one). */
  located?: Located;
  constructor(kind: DriveErrorKind, message: string, status = 0, located?: Located) {
    super(message);
    this.name = 'DriveError';
    this.kind = kind;
    this.status = status;
    this.located = located;
  }
}

function fromPluginError(e: unknown): DriveError {
  if (e instanceof DriveError) return e;
  const err = e as Partial<PluginError> | undefined;
  const message = err?.message ?? String(e);
  switch (err?.code) {
    case 'needs_admin':
      return new DriveError('admin', message);
    case 'forbidden':
      return new DriveError('forbidden', message);
    case 'invalid':
      return new DriveError('invalid', message);
    case 'not_found':
    case 'unavailable':
      return new DriveError('unavailable', message);
    default:
      return new DriveError('failed', message);
  }
}

function fromResponse(r: Answer): DriveError {
  let message = '';
  try {
    message = (r.json() as { error?: string }).error ?? '';
  } catch {
    message = (r.body ?? '').slice(0, 300);
  }
  message ||= `ErvisioDrive answered ${r.status}`;
  // The socket proxy answers a bare 502 while Next.js is not up yet.
  if (r.status === 502 || r.status === 503) return new DriveError('unavailable', message, r.status);
  if (r.status === 404) return new DriveError('not_found', message, r.status);
  if (r.status === 400 || r.status === 409 || r.status === 413 || r.status === 422) return new DriveError('invalid', message, r.status);
  if (r.status === 401 || r.status === 403) return new DriveError('forbidden', message, r.status);
  return new DriveError('failed', message, r.status);
}

/** The full JSON answer (for the few endpoints that put fields next to `data`). */
/* ---------- transport ---------- */

/** The container the drive answered from last time; undefined while the host socket works (or nothing was tried). */
let container: string | undefined;
let containerLocation: Located | undefined;

/** Forget the route, for example after the drive was started or installed. */
export const resetRoute = () => {
  container = undefined;
  containerLocation = undefined;
};

function queryString(query?: Query): string {
  if (!query) return '';
  if (typeof query === 'string') return query ? `?${query.replace(/^\?/, '')}` : '';
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) for (const one of Array.isArray(v) ? v : [v]) q.append(k, String(one));
  const text = q.toString();
  return text ? `?${text}` : '';
}

/** Through the container; looks for it again once when it was replaced or stopped. */
async function sendDocker(method: string, path: string, opts: { query?: Query; body?: object }): Promise<Answer> {
  for (let attempt = 0; ; attempt++) {
    if (!container) {
      let found: Located;
      try {
        found = await locate();
      } catch (e) {
        throw fromPluginError(e);
      }
      if (!found.app?.running || !found.app.integration) throw new DriveError('unavailable', 'ErvisioDrive does not answer', 0, found);
      container = found.app.id;
      containerLocation = found;
    }
    try {
      return await viaContainer(container, method, `${path}${queryString(opts.query)}`, opts.body);
    } catch (e) {
      if (!(e instanceof ContainerError)) throw fromPluginError(e);
      container = undefined;
      if (!e.lost) throw new DriveError('failed', e.message);
      if (attempt > 0) {
        const found = containerLocation && { ...containerLocation, connectionError: e.message,
          socketUnavailable: /ENOENT|ECONNREFUSED|EACCES/.test(e.message) };
        throw new DriveError('unavailable', e.message, 0, found);
      }
    }
  }
}

async function send(method: string, path: string, opts: { query?: Query; body?: object }): Promise<Answer> {
  if (!container) {
    try {
      return await getSdk().api.http(NAME, {
        method,
        path,
        query: opts.query,
        headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
        body: opts.body,
      });
    } catch (e) {
      const err = fromPluginError(e);
      // No socket on the host: maybe a drive in Docker without the Ervisio integration.
      if (err.kind !== 'unavailable') throw err;
    }
  }
  return sendDocker(method, path, opts);
}

async function call<T = Record<string, unknown>>(method: string, path: string, opts: { query?: Query; body?: object } = {}): Promise<T> {
  const r = await send(method, `${BASE}${path}`, opts);
  if (r.status >= 400) throw fromResponse(r);
  let out: { success?: boolean; error?: string } & Record<string, unknown>;
  try {
    out = r.body ? r.json() : {};
  } catch {
    throw new DriveError('failed', 'ErvisioDrive sent an answer that is not JSON', r.status);
  }
  if (out.success === false) throw new DriveError('failed', out.error || 'ErvisioDrive refused the request', r.status);
  return out as T;
}

async function data<T>(method: string, path: string, opts: { query?: Query; body?: object } = {}): Promise<T> {
  return (await call<{ data: T }>(method, path, opts)).data;
}

/* ---------- types ---------- */

export interface StorageUsage {
  usedBytes: number;
  /** null = unlimited. */
  quotaBytes: number | null;
}

export interface DriveStatus {
  version: string | null;
  /** The address people use to reach the drive (NEXTAUTH_URL), null when unset. */
  publicUrl: string | null;
  trustProxy: boolean;
  encryption: boolean;
  upstream: Upstream;
  storage: StorageUsage;
  members: number;
  files: number;
}

export interface WorkspaceSettings {
  siteName: string;
  defaultLocale: 'en' | 'it';
  /** null = the environment's value (UPLOAD_MAX_MB). */
  uploadMaxMb: number | null;
  /** null = the environment's value (STORAGE_QUOTA_GB). */
  storageQuotaGb: number | null;
  /** Default personal quota, 0 = unlimited. */
  userQuotaGb: number;
  maxFilesPerUpload: number;
  editorMaxMb: number;
  writeRequestsPerMinute: number;
  statsRetentionDays: number;
  sharingEnabled: boolean;
  maxShareLifetimeHours: number;
  apiEnabled: boolean;
  membersCanCreateTokens: boolean;
  defaultTokenLifetimeDays: number;
  maxTokenLifetimeDays: number;
  apiRequestsPerMinute: number;
  googleEnabled: boolean;
  cognitoEnabled: boolean;
  [key: string]: unknown;
}

/** Values fixed by the container's environment, shown next to the settings. */
export interface SettingsEnvironment {
  uploadMaxMb: number;
  quotaGb: number;
  encryption: boolean;
  trustProxy: boolean;
  googleConfigured: boolean;
  cognitoConfigured: boolean;
  cognitoIssuer: string;
  cognitoClientId: string;
  callbackBase: string;
}

export interface SettingsResult {
  settings: WorkspaceSettings;
  environment: SettingsEnvironment;
}

export type Role = 'admin' | 'member';

export interface Member {
  _id: string;
  email: string;
  name?: string;
  role: Role;
  isOwner?: boolean;
  /** null = the workspace default, 0 = unlimited. */
  quotaGb?: number | null;
  lastLogin?: string | null;
  createdAt?: string;
}

export interface AddedMember {
  member: { _id: string; email: string; role: Role };
  /** Activation link, when an invitation was issued. */
  invitation?: string;
}

export type StatsRange = '7d' | '30d' | '90d' | '365d';

export interface StatsQuery {
  range?: StatsRange;
  /** A member id: statistics of that member only. */
  member?: string;
}

export interface ActivityDay {
  date: string;
  uploads: number;
  uploadBytes: number;
  downloads: number;
  downloadBytes: number;
  views: number;
  shareDownloads: number;
  shareBytes: number;
  apiCalls: number;
}

export interface StatsOverview {
  scope: 'workspace' | 'member';
  member: string | null;
  range: { days: number; since: string };
  storage: StorageUsage & {
    files: number;
    byCategory: { category: string; bytes: number; files: number }[];
    largest: { id: string; name: string; size: number; mimeType: string; owner: string | null; createdAt: string }[];
    byMember: { memberId: string; email: string | null; name: string; bytes: number; files: number; quotaBytes: number | null }[];
  };
  totals: Omit<ActivityDay, 'date'>;
  activity: ActivityDay[];
  channels: { channel: string; events: number; bytes: number }[];
  topFiles: { id: string; name: string | null; mimeType: string | null; downloads: number; views: number; bytes: number; lastAt: string }[];
}

export interface TokenStats {
  range: { days: number; since: string };
  /** Client IPs are known only behind a proxy the drive trusts. */
  ipTracking: boolean;
  tokens: { id: string; name: string; prefix: string; owner: string | null; active: boolean; lastUsedAt: string | null; calls: number; errors: number; avgMs: number | null }[];
  activity: { date: string; calls: number; errors: number }[];
  endpoints: { endpoint: string; calls: number; errors: number; avgMs: number | null; lastAt: string }[];
  ips: { ip: string; country: string | null; calls: number; errors: number; lastAt: string }[];
  origins: { origin: string; calls: number; lastAt: string }[];
  userAgents: { userAgent: string; calls: number; lastAt: string }[];
  statuses: { status: number; calls: number }[];
  /** Last 50 calls, only for a single token. */
  recent: { at: string; endpoint: string; status: number; ip?: string; country?: string; origin?: string; userAgent?: string; durationMs?: number }[];
  /** Name of the token asked for, else null. */
  token: string | null;
}

export interface PublicUrlResult {
  publicUrl: string;
  trustProxy: boolean;
}

const OBJECT_ID = /^[a-f0-9]{24}$/;

function statsQuery(q: StatsQuery): Record<string, string> {
  const out: Record<string, string> = {};
  if (q.range) out.range = q.range;
  if (q.member) {
    if (!OBJECT_ID.test(q.member)) throw new DriveError('invalid', 'Invalid member id');
    out.member = q.member;
  }
  return out;
}

function memberId(id: string): string {
  if (!OBJECT_ID.test(id)) throw new DriveError('invalid', 'Invalid member id');
  return id;
}

/* ---------- endpoints ---------- */

/**
 * True when a drive answers on the socket; false when nothing does (socket missing, container stopped or starting).
 * Throws DriveError `admin` when the user declined the unlock dialog, and `forbidden` when Ervisio refused the call.
 */
export async function available(): Promise<boolean> {
  try {
    await status();
    return true;
  } catch (e) {
    const err = fromPluginError(e);
    if (err.kind === 'unavailable' || err.kind === 'not_found') return false;
    throw err;
  }
}

export const status = () => data<DriveStatus>('GET', '/status');

export async function getSettings(): Promise<SettingsResult> {
  const r = await call<{ data: WorkspaceSettings; environment: SettingsEnvironment }>('GET', '/settings');
  return { settings: r.data, environment: r.environment };
}

/** Changes some settings; `null` puts an environment-backed value (uploadMaxMb, storageQuotaGb) back to the default. */
export const updateSettings = (patch: Partial<WorkspaceSettings>) => data<WorkspaceSettings>('PATCH', '/settings', { body: patch });

export const listMembers = () => data<Member[]>('GET', '/members');

/** Adds an e-mail to the whitelist; with `issueInvitation` (default true) the answer has an activation link. */
export async function addMember(email: string, role: Role = 'member', issueInvitation = true): Promise<AddedMember> {
  const r = await call<{ data: AddedMember['member']; invitation?: string }>('POST', '/members', { body: { email, role, issueInvitation } });
  return { member: r.data, invitation: r.invitation };
}

/** Personal quota in GB: null follows the workspace default, 0 is unlimited. */
export async function setMemberQuota(id: string, quotaGb: number | null): Promise<void> {
  if (quotaGb !== null && !(Number.isFinite(quotaGb) && quotaGb >= 0)) throw new DriveError('invalid', 'Invalid quota');
  await call('PATCH', '/members', { body: { id: memberId(id), quotaGb } });
}

/** The owner cannot be demoted (DriveError `invalid`, status 409). */
export async function setMemberRole(id: string, role: Role): Promise<void> {
  await call('PATCH', '/members', { body: { id: memberId(id), role } });
}

/** A new activation link for a member (the old one stops working). */
export async function reinviteMember(id: string): Promise<string> {
  const r = await call<{ invitation: string }>('PATCH', '/members', { body: { id: memberId(id), action: 'invite' } });
  return r.invitation;
}

/** Removes a member: their share links are deleted and their API tokens revoked. The owner cannot be removed. */
export async function removeMember(id: string): Promise<void> {
  await call('DELETE', '/members', { body: { id: memberId(id) } });
}

export const stats = (q: StatsQuery = {}) => data<StatsOverview>('GET', '/stats', { query: statsQuery(q) });

/** API token usage: every token, or one token (with its last calls). */
export function tokenStats(q: StatsQuery & { token?: string } = {}): Promise<TokenStats> {
  if (q.token && !OBJECT_ID.test(q.token)) throw new DriveError('invalid', 'Invalid token id');
  return data<TokenStats>('GET', q.token ? `/stats/tokens/${q.token}` : '/stats/tokens', { query: statsQuery(q) });
}

/**
 * Sets the address the drive is reached at (sign-in callbacks, origin checks, invitation links), at once and across
 * restarts. `trustProxy` defaults to true for https (the drive then reads X-Forwarded-For from the proxy).
 */
export function setPublicUrl(url: string, trustProxy?: boolean): Promise<PublicUrlResult> {
  return data<PublicUrlResult>('PUT', '/public-url', { body: trustProxy === undefined ? { url } : { url, trustProxy } });
}
