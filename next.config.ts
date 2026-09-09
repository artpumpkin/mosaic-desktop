import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  // The player UI ships as a local package (@artpumpkin/mpv-player) with
  // "use client" React components. transpilePackages runs it through
  // Next's SWC pipeline so the client-boundary directives are honored.
  transpilePackages: ["@artpumpkin/mpv-player"],
};

export default nextConfig;
