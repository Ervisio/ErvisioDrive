"use client";
import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
} from "react";
import { useRouter } from "next/navigation";
import { translate, dateLocale, type Locale } from "@/lib/i18n/core";
const Context = createContext({
  locale: "en" as Locale,
  dateLocale: "en-GB",
  t: (key: string, values?: Record<string, string | number>) =>
    translate("en", key, values),
  setLocale: (_locale: Locale) => {},
});
export function LocaleProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: React.ReactNode;
}) {
  const [locale, update] = useState(initialLocale),
    router = useRouter();
  useEffect(() => {
    update(initialLocale);
  }, [initialLocale]);
  const t = useCallback(
    (key: string, values?: Record<string, string | number>) =>
      translate(locale, key, values),
    [locale],
  );
  const setLocale = (next: Locale) => {
    update(next);
    document.documentElement.lang = next;
    document.cookie = `drive-locale=${next};path=/;max-age=31536000;samesite=lax${location.protocol === "https:" ? ";secure" : ""}`;
    router.refresh();
  };
  return (
    <Context.Provider
      value={{ locale, dateLocale: dateLocale(locale), t, setLocale }}
    >
      {children}
    </Context.Provider>
  );
}
export const useI18n = () => useContext(Context);
export function LanguageSwitch() {
  const { locale, setLocale, t } = useI18n();
  return (
    <label className="inline-flex min-h-11 shrink-0 items-center gap-2 text-xs text-white/50">
      <span className="sr-only">{t("Language")}</span>
      <select
        aria-label={t("Language")}
        value={locale}
        onChange={(e) => setLocale(e.target.value as Locale)}
        className="min-h-11 rounded-lg border border-white/10 bg-[#16161f] px-3 text-base sm:text-xs"
      >
        <option value="en">English</option>
        <option value="it">Italiano</option>
      </select>
    </label>
  );
}
