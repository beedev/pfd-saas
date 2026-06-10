import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Sprint 6.1a — standalone output for the Docker self-host image.
  // Emits .next/standalone/server.js bundled with the minimal node_modules
  // tree Next.js needs at runtime. The Dockerfile copies this tree
  // verbatim and runs `node server.js` directly.
  output: 'standalone',
  // @dxp/ui ships TypeScript source — Next.js compiles it on demand.
  // The source is now vendored at src/lib/dxp-ui/ (no longer a symlink).
  transpilePackages: ["@dxp/ui"],
  // pdfjs-dist tries to spin up a worker even when worker is disabled, which
  // breaks under Turbopack server bundling. Marking it external keeps it as a
  // raw require() at runtime so its internal worker shim resolves correctly.
  serverExternalPackages: ["pdfjs-dist"],
  // Security headers (S13 — partial). Content-Security-Policy is
  // deliberately deferred until it can be browser-tested.
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
