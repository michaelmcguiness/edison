import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@edison/contracts"],
  poweredByHeader: false,
};

export default nextConfig;
