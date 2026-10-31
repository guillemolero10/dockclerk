import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Live warehouse data on every request: classic dynamic rendering is simpler here.
  cacheComponents: false,
  // Voice notes arrive as 16 kHz WAV inside a server action: up to 60 s = 1.9 MB (2.6 MB as base64). The default limit is 1 MB.
  experimental: { serverActions: { bodySizeLimit: "4mb" } },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
