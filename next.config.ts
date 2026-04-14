import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Netlify deploys Next.js as serverless functions; no standalone needed
  // Suppress size warnings from viem/wagmi
  webpack(config) {
    config.externals = config.externals || [];
    return config;
  },
};

export default nextConfig;
