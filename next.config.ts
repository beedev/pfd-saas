import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // @dxp/ui ships TypeScript source — Next.js compiles it on demand.
  // The source is now vendored at src/lib/dxp-ui/ (no longer a symlink).
  transpilePackages: ["@dxp/ui"],
  // pdfjs-dist tries to spin up a worker even when worker is disabled, which
  // breaks under Turbopack server bundling. Marking it external keeps it as a
  // raw require() at runtime so its internal worker shim resolves correctly.
  serverExternalPackages: ["pdfjs-dist"],
};

export default nextConfig;
