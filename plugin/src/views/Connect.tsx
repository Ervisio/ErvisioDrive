/**
 * When no drive answers (round 010, variant A "Procedura a passi"): three steps, Search / Install / Activate. A drive
 * found in Docker but stopped is started here; with no drive at all the page installs one (install.ts) and follows the
 * installation, also after a reload, until the owner's activation link appears.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { getSdk, type PluginError } from '../sdk';
import * as drive from '../api/drive';
import * as install from '../api/install';
import { startDrive } from '../api/locate';
import { Badge, Button, Icon, Input, toast } from '../kit';
import { copy, errText, t } from './util';

const SOCKET = '/run/ervisio-drive/api.sock';
const UNIT = 'ervisio-drive-install';

function Steps({ at, done }: { at: number; done: number }) {
  return (
    <ol className="dv-wz-steps">
      {['search', 'install', 'activate'].map((s, k) => (
        <li key={s} className={k < done ? 'is-ok' : k === at ? 'is-on' : undefined} aria-current={k === at ? 'step' : undefined}>
          <b>{k < done ? <Icon name="check" /> : k + 1}</b>
          {t(`cn.step.${s}`)}
        </li>
      ))}
    </ol>
  );
}

export function Log({ lines }: { lines: string[] }) {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [lines.length]);
  if (!lines.length) return null;
  return (
    <pre className="dv-snip dv-wz-log" ref={ref}>
      {lines.slice(0, -1).join('\n')}
      {lines.length > 1 && '\n'}
      <b>{lines[lines.length - 1]}</b>
    </pre>
  );
}

export const adminDeclined = (e: unknown) => (e as Partial<PluginError>)?.code === 'needs_admin';

export function Connect({ error, onRetry }: { error: unknown; onRetry(): void }) {
  const located = error instanceof drive.DriveError ? error.located : undefined;
  const [prog, setProg] = useState<install.InstallProgress | null>(null);
  const [email, setEmail] = useState('');
  const [port, setPort] = useState('3000');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);

  // An installation started earlier (this session or not) is shown where it is.
  useEffect(() => {
    let live = true;
    install.progress().then((p) => live && p.state !== 'idle' && p.kind === 'install' && setProg(p), () => {});
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (prog?.state !== 'running') return;
    const id = setInterval(() => {
      install.progress().then(setProg, () => {});
    }, 2000);
    return () => clearInterval(id);
  }, [prog?.state]);

  const again = () => {
    drive.resetRoute();
    onRetry();
  };

  const start = async () => {
    if (!located?.app) return;
    setBusy(true);
    try {
      await startDrive(located.app);
      toast.ok(t('cn.started'));
      again();
    } catch (e) {
      toast.err(t('cn.startFailed'), adminDeclined(e) ? t('admin.text') : errText(e));
    } finally {
      setBusy(false);
    }
  };

  const portN = Number(port);
  const emailOk = install.EMAIL.test(email.trim());
  const portOk = install.validPort(portN);
  const submit = async () => {
    setTouched(true);
    if (!emailOk || !portOk) return;
    setBusy(true);
    try {
      await install.start({ email: email.trim(), port: portN });
      setProg({ state: 'running', log: [], link: null, kind: 'install' });
    } catch (e) {
      toast.err(t('cn.startInstallFailed'), adminDeclined(e) ? t('admin.text') : errText(e));
    } finally {
      setBusy(false);
    }
  };

  const searchBtn = <Button variant="ghost" icon="refresh" onClick={again}>{t('cn.search')}</Button>;
  const form = (
    <>
      <div className="dv-wz-form">
        <Input label={t('cn.email')} type="email" value={email} autoComplete="email" spellCheck={false}
          onChange={(e) => setEmail(e.target.value)} error={touched && !emailOk ? t('cn.emailBad') : undefined} />
        <Input label={t('cn.port')} inputMode="numeric" value={port}
          onChange={(e) => setPort(e.target.value.replace(/\D/g, ''))} error={touched && !portOk ? t('cn.portBad') : undefined} />
      </div>
      <p className="dv-wz-hint">{t('cn.hint', { v: getSdk().plugin.version, dir: install.INSTALL_DIR })}</p>
    </>
  );

  let at = 1;
  let done = 1;
  let body: ReactNode;
  if (prog?.state === 'running') {
    body = (
      <>
        <h2>{t('cn.running.title')}</h2>
        <p>{t('cn.running.text', { unit: UNIT })}</p>
        <Log lines={prog.log} />
      </>
    );
  } else if (located?.app) {
    at = 0;
    done = 0;
    const app = located.app;
    body = (
      <>
        <h2>{t(located.socketUnavailable ? 'cn.socket.title' : !app.integration ? 'cn.legacy.title' : app.running ? 'cn.starting.title' : 'cn.stopped.title')}</h2>
        <p>{t(located.socketUnavailable ? 'cn.socket.text' : !app.integration ? (app.workingDir ? 'cn.legacy.text' : 'cn.legacy.noFolder') : app.running ? 'cn.starting.text' : 'cn.stopped.text')}</p>
        <div className="dv-wz-ct">
          <span className="dv-ki hue-term"><Icon name="server" /></span>
          <div className="dv-wz-ct-t">
            <b>{app.name}</b>
            {app.project && <span>{t('cn.project', { p: app.project })}</span>}
          </div>
          <Badge tone={app.running ? 'info' : 'warn'} dot>{t(app.running ? 'cn.badge.starting' : 'cn.badge.stopped')}</Badge>
        </div>
        {located.connectionError && <div className="dv-note is-warn" role="alert"><Icon name="alert" /><span>{located.connectionError}</span></div>}
        <div className="dv-acts">
          {!app.running && app.integration && <Button variant="primary" icon="play" loading={busy} onClick={start}>{t('cn.start')}</Button>}
          {searchBtn}
        </div>
      </>
    );
  } else if (prog?.state === 'done') {
    at = 2;
    done = 2;
    const link = prog.link;
    body = (
      <>
        <h2>{t('cn.done.title')}</h2>
        <div className="dv-note is-ok">
          <Icon name="check" />
          <span>{link ? t('cn.done.text') : t('cn.done.noLink', { dir: install.INSTALL_DIR })}</span>
        </div>
        {link && (
          <div className="dv-wz-link">
            <span>{link}</span>
            <Button size="sm" icon="copy" onClick={async () => (await copy(link)) && toast.ok(t('cn.copied'))}>{t('cn.copy')}</Button>
          </div>
        )}
        <div className="dv-acts">
          {link && <Button variant="primary" icon="externallink" onClick={() => getSdk().openExternal(link)}>{t('cn.openLink')}</Button>}
          <Button variant={link ? 'ghost' : 'primary'} icon="overview" onClick={again}>{t('cn.panel')}</Button>
        </div>
      </>
    );
  } else if (prog?.state === 'failed') {
    body = (
      <>
        <h2>{t('cn.failed.title')}</h2>
        <div className="dv-note is-warn"><Icon name="alert" /><span>{t('cn.failed.text')}</span></div>
        <Log lines={prog.log} />
        {form}
        <div className="dv-acts">
          <Button variant="primary" icon="refresh" loading={busy} onClick={submit}>{t('cn.retry')}</Button>
          {searchBtn}
        </div>
      </>
    );
  } else if (located?.docker === false) {
    at = 0;
    done = 0;
    body = (
      <>
        <h2>{t('cn.nodocker.title')}</h2>
        <p>{t('cn.nodocker.text')}</p>
        <div className="dv-acts">{searchBtn}</div>
      </>
    );
  } else if (!located) {
    at = 0;
    done = 0;
    body = <><h2>{t('cn.searchFailed')}</h2><p>{errText(error)}</p><div className="dv-acts">{searchBtn}</div></>;
  } else {
    body = (
      <>
        <h2>{t('cn.missing.title')}</h2>
        <p>{t('cn.missing.text', { sock: SOCKET })}</p>
        {form}
        <div className="dv-acts">
          <Button variant="primary" icon="download" loading={busy} onClick={submit}>{t('cn.install')}</Button>
          {searchBtn}
        </div>
      </>
    );
  }

  return (
    <>
      <header className="dv-ph">
        <span className="dv-tile"><Icon name="disk" /></span>
        <div className="dv-ph-t">
          <h1>ErvisioDrive</h1>
          <p>{t('cn.sub')}</p>
        </div>
      </header>
      <div className="dv-wz">
        <Steps at={at} done={done} />
        <div className="dv-card dv-wz-card">{body}</div>
      </div>
    </>
  );
}
