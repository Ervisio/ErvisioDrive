/**
 * The ErvisioDrive page in Ervisio (round 008, variant A): a header with the drive's state, the update strip of round
 * 014 A (Update.tsx), an inner menu like plugin-docker's, and one section at a time (overview, address and Caddy,
 * limits, people and quotas). With no drive answering, the connection steps of round 010 A (Connect.tsx): start a
 * stopped drive or install one; an update still rebuilding the drive is shown above them.
 */
import { useState } from 'react';
import { getSdk } from '../sdk';
import * as drive from '../api/drive';
import { Badge, Button, EmptyState, Icon, Skeleton, type HueId } from '../kit';
import { Address } from './Address';
import { Connect } from './Connect';
import { Limits } from './Limits';
import { Overview } from './Overview';
import { Update } from './Update';
import { People } from './People';
import { errText, hostOf, isAdminError, isMissingError, t, useLoad } from './util';

export type SectionId = 'overview' | 'address' | 'limits' | 'people';

const SECTIONS: { id: SectionId; hue: HueId; icon: string }[] = [
  { id: 'overview', hue: 'ov', icon: 'overview' },
  { id: 'address', hue: 'svc', icon: 'globe' },
  { id: 'limits', hue: 'log', icon: 'cog' },
  { id: 'people', hue: 'usr', icon: 'user' },
];

export function DrivePage() {
  const st = useLoad(drive.status);
  const [section, setSection] = useState<SectionId>('overview');

  if (!st.data && st.loading) {
    return (
      <div className="dv-root hue-file">
        <Skeleton height={56} style={{ borderRadius: 18 }} />
        <div className="dv-inner"><Skeleton height={200} style={{ borderRadius: 18 }} /><Skeleton height={320} style={{ borderRadius: 18 }} /></div>
      </div>
    );
  }
  if (!st.data) {
    const existing = st.error instanceof drive.DriveError ? st.error.located?.app : null;
    return (
      <div className="dv-root hue-file">
        {/* Legacy Docker installs can be updated before their plugin API is reachable. */}
        <Update version={existing?.workingDir && !existing.integration ? null : getSdk().plugin.version} onDone={st.reload} />
        <Blocked error={st.error} onRetry={st.reload} />
      </div>
    );
  }

  const s = st.data;
  const host = hostOf(s.publicUrl);
  return (
    <div className="dv-root hue-file">
      <header className="dv-ph">
        <span className="dv-tile"><Icon name="disk" /></span>
        <div className="dv-ph-t">
          <h1>ErvisioDrive</h1>
          <p>
            <Badge tone="ok" dot>{t('drive.running')}</Badge>
            {s.version && <span>{t('drive.version', { v: s.version })}</span>}
            {host ? (
              <button type="button" className="dv-linkbtn" onClick={() => getSdk().openExternal(s.publicUrl!)}>{host}</button>
            ) : (
              <span>{t('drive.noUrl')}</span>
            )}
          </p>
        </div>
        {s.publicUrl && (
          <Button variant="primary" icon="externallink" onClick={() => getSdk().openExternal(s.publicUrl!)}>{t('drive.open')}</Button>
        )}
      </header>
      <Update version={s.version} onDone={st.reload} />

      <div className="dv-inner">
        <nav className="dv-nav" aria-label={t('nav.label')}>
          <div className="dv-nav-lab">{t('nav.label')}</div>
          {SECTIONS.map((it) => (
            <button key={it.id} type="button" className="dv-nav-it" aria-current={section === it.id ? 'page' : undefined} onClick={() => setSection(it.id)}>
              <span className={`dv-ki hue-${it.hue}`}><Icon name={it.icon} /></span>
              {t(`nav.${it.id}`)}
            </button>
          ))}
        </nav>
        <div className="dv-main">
          {section === 'overview' && <Overview status={s} go={setSection} />}
          {section === 'address' && <Address status={s} onChanged={st.reload} />}
          {section === 'limits' && <Limits />}
          {section === 'people' && <People />}
        </div>
      </div>
    </div>
  );
}

/** Why the page cannot show the drive: not installed or stopped (connection steps), rights not unlocked, or another error. */
export function Blocked({ error, onRetry }: { error: unknown; onRetry(): void }) {
  if (isMissingError(error)) return <Connect error={error} onRetry={onRetry} />;
  if (isAdminError(error)) {
    return (
      <EmptyState icon="lock" hue="svc" title={t('admin.title')} text={t('admin.text')}
        action={<Button variant="primary" icon="unlock" onClick={onRetry}>{t('admin.unlock')}</Button>} />
    );
  }
  return (
    <EmptyState icon="alert" hue="svc" title={t('error.title')} text={errText(error)}
      action={<Button icon="refresh" onClick={onRetry}>{t('retry')}</Button>} />
  );
}
