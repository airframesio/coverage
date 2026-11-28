import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import "./globals.css";

const TITLE = "Airframes Coverage Map";
const DESCRIPTION = "Real-time coverage visualization of the Airframes feeder network";

// Share card (src/app/og-image.png/route.tsx). Absolute URLs: Discord and the
// other link-preview crawlers read only the static HTML.
const SHARE_IMAGE = {
  url: "https://coverage.airframes.io/og-image.png",
  width: 1200,
  height: 630,
  type: "image/png",
  alt: "Airframes Coverage: real-time reception coverage of the Airframes feeder network",
};

export const metadata: Metadata = {
  metadataBase: new URL("https://coverage.airframes.io"),
  title: TITLE,
  description: DESCRIPTION,
  appleWebApp: { title: "Coverage" },
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "Airframes Coverage",
    title: TITLE,
    description: DESCRIPTION,
    url: "/",
    locale: "en_US",
    images: [SHARE_IMAGE],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: [SHARE_IMAGE],
  },
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
