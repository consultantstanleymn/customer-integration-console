import { defineConfig } from "@playwright/test";
// @ts-expect-error plain .mjs helper without types
import { freePort } from "./scripts/pg-local.mjs";

// Random free ports, so this can run next to other projects. The stack script starts everything.
// The config is loaded again in each worker, so the ports are kept in the environment.
const ports: number[] = process.env.E2E_PORTS ? JSON.parse(process.env.E2E_PORTS) : await Promise.all([freePort(), freePort(), freePort(), freePort()]);
process.env.E2E_PORTS = JSON.stringify(ports);
const [web, api, oidc, source] = ports as [number, number, number, number];
process.env.E2E_WEB = `http://localhost:${web}`;
process.env.E2E_SOURCE = `http://localhost:${source}`;

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: process.env.E2E_WEB, trace: "retain-on-failure", viewport: { width: 1280, height: 900 } },
  webServer: {
    command: "node scripts/stack.mjs",
    url: `http://localhost:${web}/login`,
    timeout: 120_000,
    reuseExistingServer: false,
    env: { WEB_PORT: String(web), API_PORT: String(api), OIDC_PORT: String(oidc), SOURCE_PORT: String(source), RATE_LIMIT: "2", RATE_WINDOW_MS: "1000" },
  },
});
