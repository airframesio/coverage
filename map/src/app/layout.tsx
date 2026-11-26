import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

export const metadata: Metadata = {
  title: "Airframes Coverage Map",
  description: "Real-time coverage visualization of the Airframes feeder network",
  appleWebApp: { title: "Coverage" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`dark ${GeistSans.variable} ${GeistMono.variable}`}
    >
      <body className="h-screen w-screen overflow-hidden bg-zinc-950">{children}</body>
    </html>
  );
}
