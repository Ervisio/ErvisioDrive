/**
 * The update strip (round 014, variant A): between the header and the sections, so it shows from every section. When
 * the drive is older than this plugin it offers the update; while the unit runs it grows with the log; at the end it
 * turns green (dismissable) or shows the error with Retry. The work itself is install.update() in the systemd unit
 * ervisio-drive-install, so it goes on after the page is closed and is picked up again here.
 */
import { useEffect, useState } from 'react';
import { getSdk } from '../sdk';
import * as drive from '../api/drive';
import * as install from '../api/install';
import { locate } from '../api/locate';
import { Button, Icon, toast } from '../kit';
import { Log, adminDeclined } from './Connect';
import { errText, t } from './util';

export function Update({ version, onDone }: { version: string | null; onDone(): void }) {
  const [prog, setProg] = useState<install.InstallProgress | null>(null);
  const [busy, setBusy] = useState(false);
  // Set when this page saw the update finish, so an old run's success is not announced again.
  const [finished, setFinished] = useState(false);
  const target = getSdk().plugin.version;

  // An update started earlier (this session or not) is shown where it is.
  useEffect(() => {
    let live = true;
    install.progress().then((p) => live && p.kind === 'update' && (p.state === 'running' || p.state === 'failed') && setProg(p), () => {});
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (prog?.state !== 'running') return;
    const id = setInterval(() => {
      install.progress().then((p) => {
        setProg(p);
        if (p.state === 'done') {
          setFinished(true);
          drive.resetRoute();
          onDone();
        }
      }, () => {});
    }, 2000);
    return () => clearInterval(id);
  }, [prog?.state]);

  const run = async () => {
    setBusy(true);
    try {
      const found = await locate().catch(() => null);
      await install.update(found?.app?.workingDir || install.INSTALL_DIR);
      setProg({ state: 'running', log: [], link: null, kind: 'update' });
    } catch (e) {
      toast.err(t('up.startFailed'), adminDeclined(e) ? t('admin.text') : errText(e));
    } finally {
      setBusy(false);
    }
  };

  if (prog?.state === 'running') {
    return (
      <section className="dv-up is-run" aria-live="polite">
        <div className="dv-up-row">
          <span className="dv-up-ic"><Icon name="refresh" /></span>
          <div className="dv-up-t">
            <b>{t('up.running.title', { v: target })}</b>
            <span>{t('up.running.text')}</span>
          </div>
        </div>
        <Log lines={prog.log} />
        <div className="dv-up-bar" role="progressbar" aria-label={t('up.running.title', { v: target })}><span /></div>
      </section>
    );
  }
  if (prog?.state === 'failed') {
    return (
      <section className="dv-up is-run is-err" role="alert">
        <div className="dv-up-row">
          <span className="dv-up-ic"><Icon name="alert" /></span>
          <div className="dv-up-t">
            <b>{t('up.failed.title')}</b>
            <span>{t('up.failed.text')}</span>
          </div>
          <Button variant="primary" icon="refresh" loading={busy} onClick={run}>{t('retry')}</Button>
        </div>
        <Log lines={prog.log} />
      </section>
    );
  }
  if (finished && !install.outdated(version)) {
    return (
      <section className="dv-up is-ok">
        <span className="dv-up-ic"><Icon name="check" /></span>
        <div className="dv-up-t">
          <b>{t('up.done.title', { v: target })}</b>
          <span>{t('up.done.text')}</span>
        </div>
        <Button variant="ghost" onClick={() => setFinished(false)}>{t('up.close')}</Button>
      </section>
    );
  }
  if (!install.outdated(version)) return null;
  return (
    <section className="dv-up">
      <span className="dv-up-ic"><Icon name="download" /></span>
      <div className="dv-up-t">
        <b>{t('up.title', { v: target })}</b>
        <span>{version && !version.startsWith('1.') ? t('up.text', { from: version }) : t('up.textUnknown')}</span>
      </div>
      <Button variant="primary" icon="download" loading={busy} onClick={run}>{t('up.go')}</Button>
    </section>
  );
}
