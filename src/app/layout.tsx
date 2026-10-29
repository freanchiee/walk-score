import type { Metadata, Viewport } from "next";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Walk Score – scan your walk",
  description:
    "Walk toward your phone, get a fun foot-angle score and a shareable card. Everything is processed on your device. For entertainment only.",
  applicationName: "Walk Score",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0a0f24",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body className="flex min-h-dvh flex-col">
        {children}
        <Analytics />
      </body>
    </html>
  );
}
