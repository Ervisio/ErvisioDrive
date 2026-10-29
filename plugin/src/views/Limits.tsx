/**
 * Limits of the workspace. 0 is unlimited everywhere; the upload size and the total space fall back to the .env file
 * when left empty (null), and a value typed here overrides it.
 */
import { useEffect, useState } from 'react';
import * as drive from '../api/drive';
import { Button, Icon, Input, Skeleton, toast } from '../kit';
import { Blocked } from './DrivePage';
import { errText, num, t, useLoad } from './util';

type Key = 'uploadMaxMb' | 'storageQuotaGb' | 'userQuotaGb' | 'maxFilesPerUpload' | 'editorMaxMb' | 'writeRequestsPerMinute' | 'apiRequestsPerMinute' | 'statsRetentionDays';

const FIELDS: { key: Key; label: string; hint?: string; unit: string; env?: 'uploadMaxMb' | 'quotaGb'; fraction?: boolean }[] = [
  { key: 'uploadMaxMb', label: 'li.uploadMax', unit: 'MB', env: 'uploadMaxMb', fraction: true },
  { key: 'storageQuotaGb', label: 'li.storageQuota', unit: 'GB', env: 'quotaGb', fraction: true },
  { key: 'userQuotaGb', label: 'li.userQuota', hint: 'li.userQuotaHint', unit: 'GB', fraction: true },
  { key: 'maxFilesPerUpload', label: 'li.maxFiles', hint: 'li.maxFilesHint', unit: 'unit.files' },
  { key: 'editorMaxMb', label: 'li.editor', hint: 'li.editorHint', unit: 'MB', fraction: true },
  { key: 'writeRequestsPerMinute', label: 'li.writes', hint: 'li.writesHint', unit: 'unit.min' },
  { key: 'apiRequestsPerMinute', label: 'li.api', hint: 'li.apiHint', unit: 'unit.min' },
  { key: 'statsRetentionDays', label: 'li.retention', hint: 'li.retentionHint', unit: 'unit.days' },
];

type Draft = Record<Key, string>;

/** Unlimited (0) shows as an empty box with "Unlimited"; an env-backed null shows as empty with the .env value. */
function toDraft(s: drive.WorkspaceSettings): Draft {
  const out = {} as Draft;
  for (const f of FIELDS) {
    const v = s[f.key] as number | null;
    out[f.key] = v === null || (v === 0 && !f.env) ? '' : String(v);
  }
  return out;
}

function parse(f: (typeof FIELDS)[number], text: string): number | null | undefined {
  const s = text.trim().replace(',', '.');
  if (!s) return f.env ? null : 0;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0 || (!f.fraction && !Number.isInteger(n))) return undefined;
  return n;
}

const unitText = (u: string) => (u.includes('.') ? t(u) : u);

export function Limits() {
  const st = useLoad(drive.getSettings);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (st.data) setDraft(toDraft(st.data.settings));
  }, [st.data]);

  if (!st.data || !draft) {
    if (st.loading) return <Skeleton height={420} style={{ borderRadius: 18 }} />;
    return <Blocked error={st.error} onRetry={st.reload} />;
  }
  const { settings, environment } = st.data;
  const base = toDraft(settings);
  const bad = FIELDS.filter((f) => parse(f, draft[f.key]) === undefined).map((f) => f.key);
  const changed = FIELDS.filter((f) => draft[f.key] !== base[f.key]);

  const save = async () => {
    const patch: Partial<drive.WorkspaceSettings> = {};
    for (const f of changed) patch[f.key] = parse(f, draft[f.key]) as never;
    setSaving(true);
    try {
      await drive.updateSettings(patch);
      toast.ok(t('li.saved'));
      st.reload();
    } catch (e) {
      toast.err(t('error.title'), errText(e));
    } finally {
      setSaving(false);
    }
  };

  const envText = (f: (typeof FIELDS)[number]) => {
    const v = environment[f.env!];
    return v === 0 ? t('li.envUnlimited') : `${num(v)} ${f.unit}`;
  };

  return (
    <section className="dv-card">
      <h3><span className="dv-ki hue-log"><Icon name="cog" /></span>{t('nav.limits')}<small>{t('li.sub')}</small></h3>
      <div className="dv-rows">
        {FIELDS.map((f) => {
          const placeholder = f.env ? (environment[f.env] === 0 ? t('li.unlimited') : String(environment[f.env])) : t('li.unlimited');
          return (
            <div key={f.key} className="dv-set">
              <div className="dv-set-t">
                <label htmlFor={`dv-${f.key}`}><b>{t(f.label)}</b></label>
                <span>{f.env ? t('li.fromEnv', { v: envText(f) }) : t(f.hint!)}</span>
              </div>
              <div className="dv-set-c">
                <Input
                  id={`dv-${f.key}`}
                  compact
                  inputMode={f.fraction ? 'decimal' : 'numeric'}
                  value={draft[f.key]}
                  placeholder={placeholder}
                  error={bad.includes(f.key) ? t('li.bad') : undefined}
                  end={<span className="dv-unit">{unitText(f.unit)}</span>}
                  onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}
                />
              </div>
            </div>
          );
        })}
      </div>
      <div className="dv-acts dv-acts--end">
        <Button variant="ghost" disabled={saving || (draft.uploadMaxMb === '' && draft.storageQuotaGb === '')}
          onClick={() => setDraft({ ...draft, uploadMaxMb: '', storageQuotaGb: '' })}>{t('li.reset')}</Button>
        <Button variant="primary" icon="check" loading={saving} disabled={!changed.length || bad.length > 0} onClick={save}>{t('li.save')}</Button>
      </div>
    </section>
  );
}
