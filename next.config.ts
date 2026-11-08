import type { NextConfig } from "next";
const config: NextConfig = {
  agentRules: false,
  poweredByHeader: false,
  outputFileTracingExcludes: {
    "/*": [
      "./tools/**/*",
      "./.agents/**/*",
      "./.runtime-motion*",
      "./.runtime-MOTION.md",
    ],
  },
  // Local database mode loads PGlite's wasm/data files at runtime.
  serverExternalPackages: ["@electric-sql/pglite"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Cache-Control", value: "private, no-store" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};
export default config;
