import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Empty turbopack config is required when a webpack config is present in Next.js 16+
  turbopack: {},
  webpack: (config) => {
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
    };

    config.module.rules.push({
      test: /\.wasm$/,
      type: "asset/resource",
    });

    return config;
  },
};

export default nextConfig;
