import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Both of these load native or CommonJS code that the bundler cannot
  // inline: @napi-rs/canvas resolves a platform-specific .node binary at
  // require time, and pdfjs's legacy build expects to be required whole.
  // Leaving them external makes the server load them from node_modules.
  serverExternalPackages: ["@napi-rs/canvas", "pdfjs-dist", "canvas"],

  // Dev-only: the browser may reach the server as 127.0.0.1 or by LAN IP
  // (handy for checking a phone layout). Without these, Next blocks its own
  // dev resources from those hosts and the page never hydrates.
  allowedDevOrigins: ["127.0.0.1", "localhost", "192.168.18.79"],

  // Uploads are multipart bodies holding a PDF and an audio track; the
  // default body limit is far too small for either.
  experimental: {
    serverActions: {
      bodySizeLimit: "150mb",
    },
  },
};

export default nextConfig;
