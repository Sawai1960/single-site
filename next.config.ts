import type { NextConfig } from "next";

/** Sub-path the site is served from: https://square.umin.ac.jp/single-site/ */
const basePath = process.env.BASE_PATH ?? "/single-site";

const nextConfig: NextConfig = {
  output: "export",
  basePath,
  trailingSlash: true,
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  allowedDevOrigins: ["127.0.0.1"],
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
