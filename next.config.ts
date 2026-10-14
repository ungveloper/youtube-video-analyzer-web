import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Hide Next.js developer badge without hiding actual runtime errors.
  devIndicators: false,
  // PRD v1.0: Route Handlers use the default Node.js runtime and per-request data.
  // Cache Components / Partial Prefetching are intentionally not enabled here.
  // Next.js 16.4 rejects route segment `runtime` exports when cacheComponents is on.
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
