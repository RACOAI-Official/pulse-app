import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  devIndicators: false,
  turbopack: { root: process.cwd() },
  async redirects() {
    return [{ source: "/ops", destination: "/admin", permanent: true }];
  },
};

export default nextConfig;
