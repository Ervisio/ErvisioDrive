/** People and quotas: space used per person, personal quota (default, personal, unlimited) and invitations. */
import { useState, type FormEvent } from 'react';
import * as drive from '../api/drive';
import { Button, Dialog, Icon, Input, Progress, Select, Skeleton, toast } from '../kit';
import { Blocked } from './DrivePage';
import { bytes, copy, errText, gbText, gbToBytes, initials, t, useLoad } from './util';

async function load() {
  const [members, { settings }, stats] = await Promise.all([drive.listMembers(), drive.getSettings(), drive.stats({ range: '30d' })]);
  const used = new Map(stats.storage.byMember.map((m) => [m.memberId, m.bytes]));
  return { members, defaultGb: settings.userQuotaGb, used };
}

export function People() {
  const st = useLoad(load);
  const [custom, setCustom] = useState<drive.Member | null>(null);
  const [invite, setInvite] = useState(false);

  if (!st.data) {
    if (st.loading) return <Skeleton height={360} style={{ borderRadius: 18 }} />;
    return <Blocked error={st.error} onRetry={st.reload} />;
  }
  const { members, defaultGb, used } = st.data;
  const defaultText = defaultGb === 0 ? t('pe.unlimited') : gbText(defaultGb);

  const setQuota = async (m: drive.Member, gb: number | null) => {
    try {
      await drive.setMemberQuota(m._id, gb);
      toast.ok(t('pe.saved'));
      st.reload();
    } catch (e) {
      toast.err(t('error.title'), errText(e));
    }
  };

  return (
    <section className="dv-card">
      <h3><span className="dv-ki hue-usr"><Icon name="user" /></span>{t('nav.people')}<small>{t('pe.count', { n: members.length })}</small></h3>
      <div className="dv-rows">
        {members.map((m) => {
          const name = m.name || m.email;
          const q = m.quotaGb ?? null;
          const effective = q ?? defaultGb;
          const u = used.get(m._id) ?? 0;
          const pct = effective > 0 ? (u / gbToBytes(effective)) * 100 : null;
          const kind = q === null ? 'default' : q === 0 ? 'unlimited' : 'custom';
          const role = m.isOwner ? t('pe.owner') : m.role === 'admin' ? t('pe.admin') : t('pe.member');
          const options = [
            { value: 'default', label: t('pe.default', { q: defaultText }) },
            ...(kind === 'custom' ? [{ value: 'custom', label: t('pe.customN', { q: gbText(q!) }) }] : []),
            { value: 'edit', label: t('pe.custom') },
            { value: 'unlimited', label: t('pe.unlimited') },
          ];
          return (
            <div key={m._id} className="dv-person">
              <span className="dv-av" aria-hidden="true">{initials(name)}</span>
              <div className="dv-person-t">
                <b>{name}</b>
                <span>{role} · {effective > 0 ? t('pe.usedOf', { u: bytes(u), q: gbText(effective) }) : bytes(u)}</span>
              </div>
              <div className="dv-person-m">
                {pct !== null && <Progress value={Math.min(100, pct)} tone={pct > 90 ? 'warn' : undefined} hue="usr" label={`${Math.round(pct)}%`} />}
              </div>
              <div className="dv-person-q" role="group" aria-label={t('pe.quotaOf', { name })}>
                <Select
                  compact
                  options={options}
                  value={kind}
                  onChange={(v) => {
                    if (v === 'edit') setCustom(m);
                    else if (v === 'default') void setQuota(m, null);
                    else if (v === 'unlimited') void setQuota(m, 0);
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div><Button variant="ghost" icon="plus" onClick={() => setInvite(true)}>{t('pe.invite')}</Button></div>

      {custom && <CustomQuota member={custom} onClose={() => setCustom(null)} onSave={(gb) => setQuota(custom, gb).then(() => setCustom(null))} />}
      {invite && <Invite onClose={() => setInvite(false)} onAdded={st.reload} />}
    </section>
  );
}

function CustomQuota({ member, onClose, onSave }: { member: drive.Member; onClose(): void; onSave(gb: number): Promise<void> }) {
  const [value, setValue] = useState(member.quotaGb ? String(member.quotaGb) : '');
  const [busy, setBusy] = useState(false);
  const gb = Number(value.replace(',', '.'));
  const ok = value.trim() !== '' && Number.isFinite(gb) && gb > 0;
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!ok) return;
    setBusy(true);
    await onSave(gb);
    setBusy(false);
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('pe.customTitle')}
      description={member.name || member.email}
      icon="disk"
      onSubmit={submit}
      footer={<>
        <Button variant="ghost" onClick={onClose}>{t('pe.cancel')}</Button>
        <Button variant="primary" type="submit" loading={busy} disabled={!ok}>{t('pe.save')}</Button>
      </>}
    >
      <Input label={t('pe.customLabel')} inputMode="decimal" autoFocus value={value} end={<span className="dv-unit">GB</span>} onChange={(e) => setValue(e.target.value)} />
    </Dialog>
  );
}

function Invite({ onClose, onAdded }: { onClose(): void; onAdded(): void }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<drive.Role>('member');
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!valid || link) return;
    setBusy(true);
    setError(null);
    try {
      const r = await drive.addMember(email.trim(), role, true);
      onAdded();
      if (r.invitation) setLink(r.invitation);
      else {
        toast.ok(t('pe.invited', { email: r.member.email }));
        onClose();
      }
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('pe.inviteTitle')}
      icon="user"
      onSubmit={submit}
      footer={link ? (
        <>
          <Button variant="ghost" onClick={onClose}>{t('pe.close')}</Button>
          <Button variant="primary" icon="copy" onClick={async () => { if (await copy(link)) toast.ok(t('ad.copied')); }}>{t('pe.copyLink')}</Button>
        </>
      ) : (
        <>
          <Button variant="ghost" onClick={onClose}>{t('pe.cancel')}</Button>
          <Button variant="primary" type="submit" loading={busy} disabled={!valid}>{t('pe.send')}</Button>
        </>
      )}
    >
      {link ? (
        <Input label={t('pe.link')} hint={t('pe.linkHint')} mono readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
      ) : (
        <>
          <Input label={t('pe.email')} type="email" autoFocus value={email} error={error ?? undefined} onChange={(e) => setEmail(e.target.value)} />
          <Select label={t('pe.role')} options={[{ value: 'member', label: t('pe.member') }, { value: 'admin', label: t('pe.admin') }]} value={role} onChange={(v) => setRole(v as drive.Role)} />
        </>
      )}
    </Dialog>
  );
}
