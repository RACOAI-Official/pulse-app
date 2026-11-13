import type { NextConfig } from "next";

// Served at the root of pulse.racoai.io beside apps/web. nginx sends `/`, the
// public files and everything under /landing-assets here; the prefix keeps this
// app's /_next bundles from colliding with the platform's.
const nextConfig: NextConfig = {
  output: "standalone",
  assetPrefix: "/landing-assets",
  turbopack: { root: process.cwd() },
};

export default nextConfig;
