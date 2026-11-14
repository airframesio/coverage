import type { NextConfig } from "next";

// The map is a fully client-rendered app, so it can ship two ways:
//  - `standalone` (default): Node server used by the Docker image.
//  - `export`: static files in `out/`, deployed to Cloudflare Pages.
//    Selected with NEXT_OUTPUT=export (see `npm run build:static`).
const staticExport = process.env.NEXT_OUTPUT === "export";

const nextConfig: NextConfig = {
  output: staticExport ? "export" : "standalone",
  images: {
    // Only a local SVG logo is rendered; no image optimizer is needed
    // (and none exists on static hosting).
    unoptimized: true,
  },
};

export default nextConfig;
