import italian from "./it.json";
export type Locale = "en" | "it";
export function translate(
  locale: Locale,
  key: string,
  values: Record<string, string | number> = {},
) {
  if (locale === "it" && key.startsWith("Missing permission: "))
    return "Permesso mancante: " + key.slice(20);
  let message =
    locale === "it" ? (italian as Record<string, string>)[key] || key : key;
  return message.replace(/\{(\w+)\}/g, (_, name) =>
    String(values[name] ?? `{${name}}`),
  );
}
export const dateLocale = (locale: Locale) =>
  locale === "it" ? "it-IT" : "en-GB";
