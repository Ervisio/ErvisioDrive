"use client";
import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { Icon } from "@/components/ui/Icon";
import {
  faFilm,
  faImage,
  faFileLines,
  faMusic,
  faBoxArchive,
  faFolder,
  faXmark,
  faCircleInfo,
  faFile,
} from "@fortawesome/free-solid-svg-icons";
import type { IconDefinition } from "@fortawesome/fontawesome-svg-core";
import { request } from "@/lib/client-request";
import { useI18n } from "@/components/LocaleProvider";

type Series = { label: string; color: string; values: number[] };
type Tip = { html: React.ReactNode; x: number; y: number } | null;

const RANGES = ["7d", "30d", "90d", "365d"] as const;
const RANGE_LABELS: Record<string, string> = { "7d": "7 days", "30d": "30 days", "90d": "90 days", "365d": "1 year" };
// Fixed categorical order: color follows the file type, never its rank.
const CATEGORIES: Record<string, { label: string; color: string; icon: IconDefinition }> = {
  videos: { label: "Videos", color: "--s1", icon: faFilm },
  images: { label: "Images", color: "--s2", icon: faImage },
  documents: { label: "Documents", color: "--s3", icon: faFileLines },
  audio: { label: "Audio", color: "--s4", icon: faMusic },
  folders: { label: "Folders", color: "--s5", icon: faFolder },
  other: { label: "Other files", color: "--s-other", icon: faBoxArchive },
};
const fetcher = (url: string) =>
  request(url).then((r) => (r.ok ? r.json() : Promise.reject(r)));
const initials = (value: string) =>
  value
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

type Fmt = {
  n: (value: number) => string;
  day: (date: string) => string;
  t: (key: string, values?: Record<string, string | number>) => string;
  setTip: (tip: Tip) => void;
  hide: () => void;
};

function Line({ series, dates, height = 200, fmt }: { series: Series[]; dates: string[]; height?: number; fmt: Fmt }) {
  const { n, day, t, setTip, hide } = fmt;
  const [hover, setHover] = useState<number | null>(null);
  const W = 600, pad = 22, last = Math.max(1, dates.length - 1),
    max = Math.max(1, ...series.flatMap((s) => s.values)) * 1.1;
  const x = (k: number) => (k / last) * W,
    y = (v: number) => height - pad - (v / max) * (height - pad - 6);
  const ticks = [0, 0.5, 1].map((f) => Math.round(max * f));
  const move = (event: React.PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect(),
      k = Math.round(((event.clientX - box.left) / box.width) * last);
    if (k < 0 || k > last) return;
    setHover(k);
    setTip({
      html: (
        <>
          <b>{day(dates[k])}</b>
          {series.map((s) => (
            <span key={s.label} className="block">
              <i className="st-dot" style={{ background: `var(${s.color})` }} />
              {s.label} <b>{n(s.values[k] ?? 0)}</b>
            </span>
          ))}
        </>
      ),
      x: box.left + (k / last) * box.width,
      y: box.top,
    });
  };
  return (
    <div className="st-chart">
      <svg
        viewBox={`0 0 ${W} ${height}`}
        preserveAspectRatio="none"
        style={{ height }}
        role="img"
        aria-label={series.map((s) => s.label).join(", ")}
        onPointerMove={move}
        onPointerLeave={() => (setHover(null), hide())}
      >
        {ticks.map((tick, i) => (
          <line key={i} className="st-grid" x1="0" x2={W} y1={y(tick)} y2={y(tick)} vectorEffect="non-scaling-stroke" />
        ))}
        {series.map((s) => (
          <path
            key={s.label}
            className="st-line"
            stroke={`var(${s.color})`}
            d={s.values.map((v, k) => `${k ? "L" : "M"}${x(k).toFixed(1)} ${y(v).toFixed(1)}`).join(" ")}
          />
        ))}
      </svg>
      {ticks.slice(1).map((tick, i) => (
        <span key={i} className="st-ylabel" style={{ top: y(tick) - 15 }}>
          {n(tick)}
        </span>
      ))}
      {hover !== null && <div className="st-cross" style={{ left: `${(hover / last) * 100}%` }} />}
      <div className="st-xaxis">
        <span>{dates[0] && day(dates[0])}</span>
        <span>{dates[Math.floor(last / 2)] && day(dates[Math.floor(last / 2)])}</span>
        <span>{t("today")}</span>
      </div>
    </div>
  );
}
function Key({ series }: { series: Pick<Series, "label" | "color">[] }) {
  return (
    <span className="st-key">
      {series.map((s) => (
        <span key={s.label}>
          <i style={{ background: `var(${s.color})` }} />
          {s.label}
        </span>
      ))}
    </span>
  );
}
function Ranked<T>({ rows, label, value, lead, fmt }: {
  rows: T[];
  label: (row: T) => React.ReactNode;
  value: (row: T) => number;
  lead?: (row: T) => React.ReactNode;
  fmt: Fmt;
}) {
  const top = Math.max(1, ...rows.map(value));
  if (!rows.length) return <p className="st-empty">{fmt.t("No data in this period")}</p>;
  return (
    <div className="st-rows">
      {rows.map((row, i) => (
        <div key={i} className="st-row is-plain">
          <div className="st-name">
            <div>
              {lead?.(row)}
              {label(row)}
            </div>
            <div className="st-bar">
              <span style={{ width: `${(100 * value(row)) / top}%` }} />
            </div>
          </div>
          <span className="st-val">{fmt.n(value(row))}</span>
        </div>
      ))}
    </div>
  );
}

export function Stats({ admin }: { admin: boolean }) {
  const { t, dateLocale } = useI18n(),
    [range, setRange] = useState<(typeof RANGES)[number]>("30d"),
    [tip, setTip] = useState<Tip>(null),
    [tokenId, setTokenId] = useState<string | null>(null),
    drawer = useRef<HTMLDialogElement>(null);
  const { data: overview, error } = useSWR(`/api/stats?range=${range}`, fetcher),
    { data: keys } = useSWR(`/api/stats/tokens?range=${range}`, fetcher),
    { data: detail } = useSWR(
      tokenId ? `/api/stats/tokens/${tokenId}?range=${range}` : null,
      fetcher,
    );
  useEffect(() => {
    if (tokenId) drawer.current?.showModal();
    else drawer.current?.close();
  }, [tokenId]);

  const n = (value: number) => value.toLocaleString(dateLocale, { useGrouping: "always" } as Intl.NumberFormatOptions);
  const bytes = (value: number) => {
    const units = ["B", "KB", "MB", "GB", "TB"];
    let i = 0;
    while (value >= 1024 && i < units.length - 1) (value /= 1024), i++;
    return `${value.toLocaleString(dateLocale, { maximumFractionDigits: i >= 3 ? 1 : 0 })} ${units[i]}`;
  };
  const day = (date: string) =>
    new Date(date + "T00:00:00").toLocaleDateString(dateLocale, { day: "numeric", month: "short" });
  const ago = (date: string | null) => {
    if (!date) return t("Never used");
    const minutes = Math.round((Date.now() - new Date(date).getTime()) / 60000),
      format = new Intl.RelativeTimeFormat(dateLocale, { numeric: "auto" });
    if (minutes < 60) return format.format(-minutes, "minute");
    if (minutes < 1440) return format.format(-Math.round(minutes / 60), "hour");
    return format.format(-Math.round(minutes / 1440), "day");
  };
  const show = (html: React.ReactNode, event: React.PointerEvent) =>
    setTip({ html, x: event.clientX, y: event.clientY });
  const hide = () => setTip(null);
  const tipProps = (html: React.ReactNode) => ({
    onPointerMove: (event: React.PointerEvent) => show(html, event),
    onPointerLeave: hide,
  });

  const fmt = { n, day, t, setTip, hide };

  if (error)
    return (
      <div className="page-wrap">
        <p role="alert">{t("Statistics are not available.")}</p>
      </div>
    );
  const data = overview?.data,
    tokens = keys?.data;
  const dates: string[] = data?.activity.map((row: any) => row.date) ?? [];
  const transfers: Series[] = data
    ? [
        { label: t("Downloads"), color: "--s1", values: data.activity.map((r: any) => r.downloads) },
        { label: t("Uploads"), color: "--s2", values: data.activity.map((r: any) => r.uploads) },
        { label: t("Public links"), color: "--s3", values: data.activity.map((r: any) => r.shareDownloads) },
      ]
    : [];
  // Custom folders fold into one slot so the palette never runs out.
  const categories = data
    ? Object.entries(
        (data.storage.byCategory as { category: string; bytes: number; files: number }[]).reduce(
          (all, row) => {
            const key = CATEGORIES[row.category] ? row.category : "folders";
            all[key] = { bytes: (all[key]?.bytes ?? 0) + row.bytes, files: (all[key]?.files ?? 0) + row.files };
            return all;
          },
          {} as Record<string, { bytes: number; files: number }>,
        ),
      )
        .map(([key, value]) => ({ key, ...CATEGORIES[key], ...value }))
        .sort((a, b) => Object.keys(CATEGORIES).indexOf(a.key) - Object.keys(CATEGORIES).indexOf(b.key))
    : [];
  const storage = data?.storage,
    capacity = storage ? storage.quotaBytes ?? Math.max(1, storage.usedBytes) : 1;
  const apiCalls = tokens ? sum(tokens.tokens.map((k: any) => k.calls)) : 0,
    apiErrors = tokens ? sum(tokens.tokens.map((k: any) => k.errors)) : 0;
  const statusGroups = detail
    ? (["2", "3", "4", "5"] as const)
        .map((lead) => ({
          label: `${lead}xx`,
          calls: sum(detail.data.statuses.filter((s: any) => String(s.status)[0] === lead).map((s: any) => s.calls)),
          tone: lead === "2" ? "ok" : lead === "5" ? "err" : "",
        }))
        .filter((group) => group.calls)
    : [];
  const token = tokens?.tokens.find((k: any) => k.id === tokenId);

  return (
    <div className="stats lg:py-3">
      <section className="drive-sheet st-sheet">
        <div className="st-head">
          <h1 className="page-title">{t("Statistics")}</h1>
          <div className="st-seg" role="group" aria-label={t("Period")}>
            {RANGES.map((r) => (
              <button key={r} aria-pressed={r === range} onClick={() => setRange(r)}>
                {t(RANGE_LABELS[r])}
              </button>
            ))}
          </div>
        </div>
        {!data ? (
          <p className="st-empty" aria-busy>
            {t("Loading…")}
          </p>
        ) : (
          <>
            <div className="st-hero">
              <div className="st-big">
                {bytes(storage.usedBytes)}{" "}
                <span>
                  {storage.quotaBytes
                    ? t("used of {total}", { total: bytes(storage.quotaBytes) })
                    : t("used · no limit")}{" "}
                  · {t("{count} files", { count: n(storage.files) })}
                </span>
              </div>
              <div className="st-stack" role="img" aria-label={t("Space by file type")}>
                {categories.map((c) => (
                  <span
                    key={c.key}
                    style={{ width: `${(100 * c.bytes) / capacity}%`, background: `var(${c.color})` }}
                    {...tipProps(
                      <>
                        <b>{t(c.label)}</b>
                        <br />
                        {bytes(c.bytes)} · {t("{count} files", { count: n(c.files) })}
                      </>,
                    )}
                  />
                ))}
                {storage.quotaBytes ? (
                  <span
                    className="free"
                    {...tipProps(
                      <>
                        <b>{t("Free")}</b>
                        <br />
                        {bytes(Math.max(0, storage.quotaBytes - storage.usedBytes))}
                      </>,
                    )}
                  />
                ) : null}
              </div>
              <div className="st-legend">
                {categories.map((c) => (
                  <span key={c.key}>
                    <i className="st-dot" style={{ background: `var(${c.color})` }} />
                    {t(c.label)} <b>{bytes(c.bytes)}</b>
                  </span>
                ))}
              </div>
            </div>

            <div className="st-kpis">
              <div className="st-kpi">
                <div className="l">{t("Uploads")}</div>
                <div className="v">{n(data.totals.uploads)}</div>
                <div className="d">{bytes(data.totals.uploadBytes)}</div>
              </div>
              <div className="st-kpi">
                <div className="l">{t("Downloads")}</div>
                <div className="v">{n(data.totals.downloads + data.totals.shareDownloads)}</div>
                <div className="d">{t("{count} from public links", { count: n(data.totals.shareDownloads) })}</div>
              </div>
              <div className="st-kpi">
                <div className="l">{t("API calls")}</div>
                <div className="v">{n(apiCalls)}</div>
                <div className="d">
                  {apiCalls
                    ? t("{percent}% with errors", {
                        percent: ((100 * apiErrors) / apiCalls).toLocaleString(dateLocale, { maximumFractionDigits: 1 }),
                      })
                    : t("No calls in this period")}
                </div>
              </div>
            </div>

            <div className="st-sec">
              <h2>{t("Activity")}</h2>
              <div className="st-card">
                <h3>
                  {t("Transfers per day")} <Key series={transfers} />
                </h3>
                <Line series={transfers} dates={dates} height={220} fmt={fmt} />
              </div>
            </div>

            <div className="st-sec st-grid2">
              <div>
                <h2>{data.scope === "workspace" ? t("People") : t("Largest files")}</h2>
                <div className="st-card">
                  {data.scope === "workspace" ? (
                    <div className="st-rows">
                      {storage.byMember.map((m: any) => {
                        const top = storage.byMember[0]?.bytes || 1,
                          percent = m.quotaBytes ? Math.round((100 * m.bytes) / m.quotaBytes) : null,
                          who = m.name || m.email || t("Unknown");
                        return (
                          <div
                            key={m.memberId ?? who}
                            className="st-row"
                            {...tipProps(
                              <>
                                <b>{who}</b>
                                <br />
                                {bytes(m.bytes)}
                                {m.quotaBytes ? ` / ${bytes(m.quotaBytes)} (${percent}%)` : ` · ${t("no limit")}`}
                              </>,
                            )}
                          >
                            <span className="st-avatar">{initials(who)}</span>
                            <div className="st-name">
                              <div>{who}</div>
                              <div className="st-bar">
                                <span
                                  className={percent !== null && percent >= 90 ? "warn" : "quota"}
                                  style={{ width: `${percent ?? (100 * m.bytes) / top}%` }}
                                />
                              </div>
                            </div>
                            <span className="st-val">
                              {bytes(m.bytes)}
                              <br />
                              <span className="faint">
                                {m.quotaBytes ? t("of {total}", { total: bytes(m.quotaBytes) }) : t("Unlimited")}
                              </span>
                            </span>
                          </div>
                        );
                      })}
                      {!storage.byMember.length && <p className="st-empty">{t("No files yet")}</p>}
                    </div>
                  ) : (
                    <div className="st-rows">
                      {storage.largest.map((f: any) => (
                        <div key={f.id} className="st-row">
                          <span className="st-icon">
                            <Icon icon={faFile} />
                          </span>
                          <div className="st-name">
                            <div>{f.name}</div>
                          </div>
                          <span className="st-val">{bytes(f.size)}</span>
                        </div>
                      ))}
                      {!storage.largest.length && <p className="st-empty">{t("No files yet")}</p>}
                    </div>
                  )}
                </div>
              </div>
              <div>
                <h2>{t("Most downloaded")}</h2>
                <div className="st-card">
                  {data.topFiles.length ? (
                    <table className="st-table">
                      <thead>
                        <tr>
                          <th>{t("File")}</th>
                          <th className="num">{t("Downloads")}</th>
                          <th className="num hide-m">{t("Views")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.topFiles.map((f: any) => (
                          <tr key={f.id}>
                            <td className="truncate">{f.name ?? t("Deleted file")}</td>
                            <td className="num">{n(f.downloads)}</td>
                            <td className="num hide-m dim">{n(f.views)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="st-empty">{t("No downloads in this period")}</p>
                  )}
                </div>
              </div>
            </div>

            <div className="st-sec">
              <h2>
                {t("API keys")} <span className="st-sub">{t("open a key to see endpoints, IPs and origins")}</span>
              </h2>
              {tokens?.tokens.length ? (
                <div className="st-keys">
                  {tokens.tokens.map((k: any) => {
                    const top = Math.max(1, ...k.daily),
                      last = Math.max(1, k.daily.length - 1);
                    return (
                      <button key={k.id} className="st-keycard" onClick={() => setTokenId(k.id)}>
                        <div className="top">
                          <b>{k.name}</b>
                          <span className={`st-pill ${k.active ? "ok" : "off"}`}>
                            {t(k.active ? "active" : "inactive")}
                          </span>
                        </div>
                        <div className="st-keyid">
                          <span className="mono">{k.prefix}…</span>
                          {admin && k.owner ? <span>{k.owner}</span> : null}
                        </div>
                        <svg className="st-spark" viewBox="0 0 90 24" preserveAspectRatio="none" aria-hidden>
                          <path
                            d={k.daily
                              .map((v: number, i: number) => `${i ? "L" : "M"}${((i / last) * 90).toFixed(1)} ${(22 - (v / top) * 20).toFixed(1)}`)
                              .join(" ")}
                          />
                        </svg>
                        <div className="meta">
                          <span>
                            <b>{n(k.calls)}</b> {t("calls")}
                          </span>
                          <span>{t("{count} errors", { count: n(k.errors) })}</span>
                          <span>{ago(k.lastUsedAt)}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="st-empty">{t("No API keys yet")}</p>
              )}
            </div>
          </>
        )}
      </section>

      <dialog
        ref={drawer}
        className="st-drawer"
        aria-label={t("Key details")}
        onClose={() => setTokenId(null)}
        onClick={(event) => event.target === event.currentTarget && setTokenId(null)}
      >
        <div className="st-drawer-head">
          <div className="min-w-0 flex-1">
            <h2>{token?.name ?? detail?.data.token ?? ""}</h2>
            <div className="mono faint">
              {token?.prefix}…{token?.owner ? ` · ${token.owner}` : ""}
            </div>
          </div>
          <button className="icon-button" onClick={() => setTokenId(null)} aria-label={t("Close")}>
            <Icon icon={faXmark} />
          </button>
        </div>
        {!detail ? (
          <p className="st-empty">{t("Loading…")}</p>
        ) : (
          <>
            <div className="st-card">
              <h3>
                {t("Calls")}{" "}
                <Key series={[{ label: t("Calls"), color: "--s1" }, { label: t("Errors"), color: "--s2" }]} />
              </h3>
              <Line
                fmt={fmt}
                height={160}
                dates={detail.data.activity.map((r: any) => r.date)}
                series={[
                  { label: t("Calls"), color: "--s1", values: detail.data.activity.map((r: any) => r.calls) },
                  { label: t("Errors"), color: "--s2", values: detail.data.activity.map((r: any) => r.errors) },
                ]}
              />
              <div className="st-pills">
                {statusGroups.map((group) => (
                  <span key={group.label} className={`st-pill ${group.tone}`}>
                    {group.label} <b>{n(group.calls)}</b>
                  </span>
                ))}
              </div>
            </div>
            <div className="st-card">
              <h3>{t("Where calls come from")}</h3>
              {!detail.data.ipTracking && (
                <p className="st-note">
                  <Icon icon={faCircleInfo} />
                  {t("Real client IPs are recorded only behind a trusted proxy (TRUST_PROXY=true).")}
                </p>
              )}
              <Ranked
                fmt={fmt}
                rows={detail.data.ips}
                label={(r: any) => <span className="mono">{r.ip}</span>}
                value={(r: any) => r.calls}
                lead={(r: any) => (r.country ? <span className="st-cc">{r.country}</span> : null)}
              />
            </div>
            <div className="st-card">
              <h3>{t("Endpoints")}</h3>
              <Ranked fmt={fmt} rows={detail.data.endpoints} label={(r: any) => <span className="mono">{r.endpoint}</span>} value={(r: any) => r.calls} />
            </div>
            <div className="st-card">
              <h3>{t("Origins and clients")}</h3>
              <Ranked fmt={fmt} rows={detail.data.origins} label={(r: any) => r.origin} value={(r: any) => r.calls} />
              <div className="h-2" />
              <Ranked fmt={fmt} rows={detail.data.userAgents} label={(r: any) => <span className="mono">{r.userAgent}</span>} value={(r: any) => r.calls} />
            </div>
            <div className="st-card">
              <h3>{t("Latest calls")}</h3>
              {detail.data.recent.length ? (
                <table className="st-table">
                  <thead>
                    <tr>
                      <th>{t("Time")}</th>
                      <th>{t("Endpoint")}</th>
                      <th className="num">{t("Status")}</th>
                      <th className="hide-m">IP</th>
                      <th className="num hide-m">{t("Duration")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.data.recent.map((r: any, i: number) => (
                      <tr key={i}>
                        <td className="mono">
                          {new Date(r.at).toLocaleTimeString(dateLocale, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                        </td>
                        <td className="mono truncate">{r.endpoint}</td>
                        <td className="num">
                          <span className={`st-pill ${r.status < 400 ? "ok" : "err"}`}>{r.status}</span>
                        </td>
                        <td className="mono hide-m">
                          {r.country && <span className="st-cc">{r.country}</span>}
                          {r.ip ?? "—"}
                        </td>
                        <td className="num hide-m">{r.durationMs != null ? `${r.durationMs} ms` : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p className="st-empty">{t("No calls in this period")}</p>
              )}
            </div>
          </>
        )}
      </dialog>

      {tip && (
        <div
          className="st-tip"
          role="tooltip"
          style={{ left: Math.min(tip.x, (typeof window !== "undefined" ? window.innerWidth : 9999) - 120), top: tip.y - 12 }}
        >
          {tip.html}
        </div>
      )}
    </div>
  );
}
