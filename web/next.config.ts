import type { NextConfig } from "next";
import path from "node:path";

// Build the Content-Security-Policy value.
// In development the app needs 'unsafe-eval' for hot reload.
// The production value never contains 'unsafe-eval'.
export function buildCsp(isDev: boolean): string {
  const scriptSrc = isDev
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : "script-src 'self' 'unsafe-inline'";
  return [
    "default-src 'self'",
    "img-src 'self' data:",
    "style-src 'self' 'unsafe-inline'",
    scriptSrc,
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

const isDev = process.env.NODE_ENV !== "production";

// Security headers for every response.
export const securityHeaders: { key: string; value: string }[] = [
  { key: "Content-Security-Policy", value: buildCsp(isDev) },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Frame-Options", value: "DENY" },
];

// The browser only talks to this origin. /api/* is forwarded to the API service,
// so session cookies are first-party and no CORS setup is needed.
// API_URL is read at build time (see web/Dockerfile).
const config: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(import.meta.dirname, ".."),
  devIndicators: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${process.env.API_URL ?? "http://localhost:4000"}/:path*` }];
  },
};
export default config;
