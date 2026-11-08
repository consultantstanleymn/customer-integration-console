import type { NextConfig } from "next";

// The browser only talks to this origin. /api/* is forwarded to the API service,
// so session cookies are first-party and no CORS setup is needed.
// API_URL is read at build time (see web/Dockerfile).
const config: NextConfig = {
  output: "standalone",
  devIndicators: false,
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${process.env.API_URL ?? "http://localhost:4000"}/:path*` }];
  },
};
export default config;
