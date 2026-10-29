/** Overview: space, people, files, encryption, the last 30 days and the address. */
import { getSdk } from '../sdk';
import * as drive from '../api/drive';
import { Badge, Button, Icon, Skeleton, StatCard } from '../kit';
import type { SectionId } from './DrivePage';
import { bytes, hostOf, num, t, useLoad } from './util';

export function Overview({ status: s, go }: { status: drive.DriveStatus; go(id: SectionId): void }) {
  const st = useLoad(() => drive.stats({ range: '30d' }));
  const mem = useLoad(drive.listMembers);
  const { usedBytes, quotaBytes } = s.storage;
  const pct = quotaBytes ? Math.min(100, (usedBytes / quotaBytes) * 100) : undefined;
  const admins = mem.data?.filter((m) => m.role === 'admin').length;
  const totals = st.data?.totals;
  const host = hostOf(s.publicUrl);
  const statsUrl = s.publicUrl ? `${s.publicUrl.replace(/\/$/, '')}/stats` : null;

  return (
    <>
      <div className="dv-grid4">
        <StatCard hue="file" icon="disk" label={t('ov.used')} value={bytes(usedBytes)}
          sub={quotaBytes ? t('ov.of', { q: bytes(quotaBytes) }) : t('ov.unlimited')} percent={pct} />
        <StatCard hue="usr" icon="user" label={t('ov.people')} value={num(s.members)}
          sub={admins === undefined ? undefined : admins === 1 ? t('ov.admin1') : t('ov.admins', { n: admins })} />
        <StatCard hue="ov" icon="files" label={t('ov.files')} value={num(s.files)}
          sub={totals ? t('ov.uploaded30', { n: num(totals.uploads) }) : undefined} />
        <StatCard hue="svc" icon="lock" label={t('ov.encryption')}
          value={<Badge tone={s.encryption ? 'ok' : 'warn'}>{s.encryption ? t('ov.encOn') : t('ov.encOff')}</Badge>}
          sub={s.encryption ? t('ov.encOnHint') : t('ov.encOffHint')} />
      </div>

      <section className="dv-card">
        <h3>
          <span className="dv-ki hue-ov"><Icon name="pulse" /></span>{t('ov.last30')}
          {statsUrl && <button type="button" className="dv-linkbtn dv-h3-end" onClick={() => getSdk().openExternal(statsUrl)}>{t('ov.fullStats')}</button>}
        </h3>
        {totals ? (
          <div className="dv-grid3">
            <Figure label={t('ov.uploads')} value={num(totals.uploads)} sub={bytes(totals.uploadBytes)} />
            <Figure label={t('ov.downloads')} value={num(totals.downloads)} sub={bytes(totals.downloadBytes)} />
            <Figure label={t('ov.apiCalls')} value={num(totals.apiCalls)} />
          </div>
        ) : (
          <Skeleton height={64} />
        )}
      </section>

      <section className="dv-card">
        <h3><span className="dv-ki hue-svc"><Icon name="globe" /></span>{t('ov.address')}</h3>
        {host ? (
          <dl className="dv-kv">
            <dt>{t('ad.host')}</dt><dd className="dv-mono">{s.publicUrl}</dd>
            <dt>Proxy</dt><dd>{s.trustProxy ? t('ov.proxy') : t('ov.noProxy')}</dd>
          </dl>
        ) : (
          <p className="dv-muted dv-pad">{t('ov.addrNone')}</p>
        )}
        <div><Button size="sm" icon="globe" onClick={() => go('address')}>{t(host ? 'nav.address' : 'ov.addrSet')}</Button></div>
      </section>
    </>
  );
}

function Figure({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="dv-fig">
      <span className="dv-fig-l">{label}</span>
      <b>{value}</b>
      {sub && <span className="dv-fig-s">{sub}</span>}
    </div>
  );
}
