import type { NextConfig } from "next";

// Deployed as a GitHub Pages *project* site (https://devjonny.github.io/family-tree/),
// so every asset URL needs the repo name as a prefix. If you later move to a
// custom domain or a user/org page (devjonny.github.io itself), delete
// basePath/assetPrefix — those only serve root-hosted sites.
const repoName = "family-tree";

const nextConfig: NextConfig = {
  // GitHub Pages only serves static files - no Node server, no Next.js
  // Image Optimization API, no API routes. The whole app is client-side
  // already (GEDCOM parsing, undo/redo, and Drive sync all run in the
  // browser), so a static export is a straightforward fit.
  output: "export",
  basePath: `/${repoName}`,
  assetPrefix: `/${repoName}/`,
  // Defensive: `next/image` requires this under `output: "export"` since
  // the optimization server isn't available. Not used yet, but cheap
  // insurance against a future build break if someone adds <Image>.
  images: { unoptimized: true },
};

export default nextConfig;
