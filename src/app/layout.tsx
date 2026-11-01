import type { Metadata } from "next";
import { Barlow, Barlow_Condensed, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { I18nProvider } from "@/lib/i18n/client";
import { dictionary } from "@/lib/i18n/dictionaries";
import { getLang } from "@/lib/i18n/server";

// Warehouse signage look: a condensed display face for headings/labels, a
// grotesque for body text, and a mono face for the agent's live log.
const barlow = Barlow({
  variable: "--font-barlow",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const barlowCondensed = Barlow_Condensed({
  variable: "--font-barlow-condensed",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

export async function generateMetadata(): Promise<Metadata> {
  const lang = await getLang();
  return {
    title: "DockClerk",
    description:
      lang === "es"
        ? "Un administrativo con IA que trabaja dentro del programa de tu almacén."
        : "An AI clerk that works inside your warehouse software.",
  };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const lang = await getLang();
  return (
    <html
      lang={lang}
      className={`${barlow.variable} ${barlowCondensed.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <I18nProvider lang={lang} dict={dictionary(lang)}>
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
