/** Overview widget: the drive's state, the space used and the counts. It never asks for administrator rights. */
import { getSdk } from '../sdk';
import * as drive from '../api/drive';
import { Button, Progress } from '../kit';
import { bytes, errText, isMissingError, num, t, useLoad } from './util';

export function UsageWidget() {
  const st = useLoad(drive.status);
  const open = () => getSdk().open('drive');

  if (!st.data) {
    if (st.loading) return <p className="dv-w-muted">{t('w.loading')}</p>;
    return <p className="dv-w-muted">{isMissingError(st.error) ? t('w.missing') : errText(st.error)}</p>;
  }
  const { usedBytes, quotaBytes } = st.data.storage;
  const pct = quotaBytes ? Math.min(100, (usedBytes / quotaBytes) * 100) : undefined;
  return (
    <div className="dv-w">
      <div className="dv-w-st"><i /><b>{t('drive.running')}</b></div>
      <div className="dv-w-big">
        <b>{bytes(usedBytes)}</b>
        <span>{quotaBytes ? t('ov.of', { q: bytes(quotaBytes) }) : t('ov.unlimited')}</span>
      </div>
      {pct !== undefined && <Progress value={pct} hue="file" tone={pct > 90 ? 'warn' : undefined} />}
      <div className="dv-w-n">
        <span><b>{num(st.data.members)}</b> {t('ov.people')}</span>
        <span><b>{num(st.data.files)}</b> {t('ov.files')}</span>
      </div>
      <Button size="sm" onClick={open}>{t('w.open')}</Button>
    </div>
  );
}
