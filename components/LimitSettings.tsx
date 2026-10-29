"use client";
// Space and limits: every limit can be set, switched off ("Unlimited", stored
// as 0) or, for total space and file size, left to the .env value (null).
import { useState } from "react";
import { useI18n } from "@/components/LocaleProvider";
import type { settingsDefaults } from "@/lib/settings";

type Settings = typeof settingsDefaults;
type Key =
  | "storageQuotaGb"
  | "userQuotaGb"
  | "uploadMaxMb"
  | "maxFilesPerUpload"
  | "editorMaxMb"
  | "writeRequestsPerMinute"
  | "apiRequestsPerMinute"
  | "statsRetentionDays";
type Mode = "env" | "set" | "off";

const FIELDS: {
  group: string;
  key: Key;
  label: string;
  hint: string;
  unit: string;
  env?: "quotaGb" | "uploadMaxMb";
  fraction?: boolean;
  fallback: number;
}[] = [
  { group: "Space", key: "storageQuotaGb", label: "Total space", hint: "How much the whole drive can hold.", unit: "GB", env: "quotaGb", fraction: true, fallback: 100 },
  { group: "Space", key: "userQuotaGb", label: "Quota per person", hint: "Default for everyone; change it for one person in Users and access.", unit: "GB", fraction: true, fallback: 20 },
  { group: "Uploads", key: "uploadMaxMb", label: "Maximum file size", hint: "Larger files are refused.", unit: "MB", env: "uploadMaxMb", fraction: true, fallback: 100 },
  { group: "Uploads", key: "maxFilesPerUpload", label: "Files per upload", hint: "How many files can be chosen at once.", unit: "files", fallback: 50 },
  { group: "Uploads", key: "editorMaxMb", label: "Text editor", hint: "Larger files open read-only.", unit: "MB", fraction: true, fallback: 10 },
  { group: "Requests", key: "writeRequestsPerMinute", label: "Writes per minute", hint: "Per person: uploads, edits and deletions.", unit: "/min", fallback: 120 },
  { group: "Requests", key: "apiRequestsPerMinute", label: "API calls per minute", hint: "Per API token.", unit: "/min", fallback: 120 },
  { group: "Statistics", key: "statsRetentionDays", label: "Statistics retention", hint: "Older events are deleted.", unit: "days", fallback: 365 },
];

export function LimitSettings({
  draft,
  environment,
  set,
}: {
  draft: Settings;
  environment: { quotaGb: number; uploadMaxMb: number };
  set: (key: Key, value: number | null) => void;
}) {
  const { t } = useI18n();
  // Typed text per field, so "1," or an empty box does not jump while typing.
  const [text, setText] = useState<Partial<Record<Key, string>>>({});
  let group = "";
  return (
    <div>
      <p className="muted">
        {t(
          "Every limit can be switched off: Unlimited removes the cap. Total space and file size can follow the .env file.",
        )}
      </p>
      {FIELDS.map((f) => {
        const value = draft[f.key] as number | null,
          mode: Mode = value === null ? "env" : value === 0 ? "off" : "set",
          unit = t(f.unit),
          heading = f.group !== group ? (group = f.group) : null;
        const choose = (next: Mode) => {
          if (next === mode) return;
          if (next === "env") set(f.key, null);
          else if (next === "off") set(f.key, 0);
          else {
            const envValue = f.env ? environment[f.env] : 0;
            set(f.key, envValue > 0 ? envValue : f.fallback);
          }
          setText((s) => ({ ...s, [f.key]: undefined }));
        };
        const envValue = f.env ? environment[f.env] : 0;
        return (
          <div key={f.key}>
            {heading && <h3 className="lim-group">{t(heading)}</h3>}
            <div className="lim-row">
              <div className="min-w-0">
                <strong id={`lim-${f.key}`}>{t(f.label)}</strong>
                <small>{t(f.hint)}</small>
              </div>
              <div className="lim-ctl">
                {mode === "set" && (
                  <span className="lim-unit">
                    <input
                      className="field"
                      inputMode={f.fraction ? "decimal" : "numeric"}
                      aria-labelledby={`lim-${f.key}`}
                      value={text[f.key] ?? String(value)}
                      onChange={(e) => {
                        const raw = e.target.value;
                        setText((s) => ({ ...s, [f.key]: raw }));
                        const n = Number(raw.trim().replace(",", "."));
                        if (
                          raw.trim() &&
                          Number.isFinite(n) &&
                          n > 0 &&
                          (f.fraction || Number.isInteger(n))
                        )
                          set(f.key, n);
                      }}
                    />
                    <span>{unit}</span>
                  </span>
                )}
                {mode === "env" && (
                  <span className="lim-env">
                    {envValue > 0 ? `${envValue} ${unit}` : t("Unlimited")}
                  </span>
                )}
                <div
                  className="seg"
                  role="group"
                  aria-label={t("{name}: mode", { name: t(f.label) })}
                >
                  {f.env && (
                    <button type="button" aria-pressed={mode === "env"} onClick={() => choose("env")}>
                      {t("Use .env")}
                    </button>
                  )}
                  <button type="button" aria-pressed={mode === "set"} onClick={() => choose("set")}>
                    {t("Limit")}
                  </button>
                  <button type="button" aria-pressed={mode === "off"} onClick={() => choose("off")}>
                    {t("Unlimited")}
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
