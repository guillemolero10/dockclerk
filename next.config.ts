import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Live warehouse data on every request: classic dynamic rendering is simpler here.
  cacheComponents: false,
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
