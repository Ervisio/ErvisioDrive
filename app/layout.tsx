import type { Metadata } from "next";
import { Figtree } from "next/font/google";
import { config } from "@fortawesome/fontawesome-svg-core";
import "@fortawesome/fontawesome-svg-core/styles.css";
import "./globals.css";
import { LocaleProvider } from "@/components/LocaleProvider";
import { getLocale } from "@/lib/i18n/server";
config.autoAddCss = false;
const figtree = Figtree({
  subsets: ["latin"],
  variable: "--font-figtree",
  display: "swap",
});
export const metadata: Metadata = {
  title: { default: "ErvisioDrive", template: "%s · ErvisioDrive" },
  description: "Your private workspace.",
  robots: { index: false, follow: false },
};
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const locale = await getLocale();
  return (
    <html lang={locale} className={figtree.variable}>
      <body>
        <LocaleProvider initialLocale={locale}>{children}</LocaleProvider>
      </body>
    </html>
  );
}
