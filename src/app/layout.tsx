import type { Metadata } from "next";
import { Instrument_Sans, Noto_Sans_Ethiopic } from "next/font/google";
import "./globals.css";

const sans = Instrument_Sans({ variable: "--font-instrument", subsets: ["latin"] });
const ethiopic = Noto_Sans_Ethiopic({ variable: "--font-noto-ethiopic", subsets: ["ethiopic"], weight: ["400", "600"] });

export const metadata: Metadata = {
  title: { default: "Kaffa", template: "%s · Kaffa" },
  description: "An AI compliance team for Ethiopian coffee exporters, built for the EU deforestation regulation.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${sans.variable} ${ethiopic.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
