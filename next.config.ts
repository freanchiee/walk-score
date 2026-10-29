import path from "node:path";
import type { NextConfig } from "next";

const assetCache = [
  // The WASM runtime and model change only when the npm package / model version changes.
  { key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=604800" },
];

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    // Pin the project root so a stray lockfile in a parent folder is not picked up.
    root: path.resolve(process.cwd()),
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      { source: "/mediapipe/:path*", headers: assetCache },
      { source: "/models/:path*", headers: assetCache },
    ];
  },
};

export default nextConfig;
