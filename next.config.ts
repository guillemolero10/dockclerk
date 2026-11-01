import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Live warehouse data on every request: classic dynamic rendering is simpler here.
  cacheComponents: false,
  // Voice notes arrive as a 16 kHz WAV file in a server action (FormData): up to 60 s = 1.9 MB; photos as data URLs under 900 000 characters. The default limit is 1 MB.
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
