import type { Metadata } from "next";
import { config } from "@fortawesome/fontawesome-svg-core";
import "@fortawesome/fontawesome-svg-core/styles.css";
import "./globals.css";
config.autoAddCss = false;
export const metadata: Metadata = {
  title: { default: "ErvisioDrive", template: "%s · ErvisioDrive" },
  description: "Il tuo spazio di lavoro riservato.",
  robots: { index: false, follow: false },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="it" className="dark">
      <body>{children}</body>
    </html>
  );
}
