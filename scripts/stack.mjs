// Starts the whole stack on this machine without Docker:
// Postgres (throw-away), mock OIDC, mock REST source, API and the Next.js web app.
// Ports are random free ports unless you set them. Writes the URLs to .stack/urls.json.
// Stop with Ctrl+C (only the processes started here are stopped).
import { spawn } from "node:child_process";
import { mkdirSync, openSync, writeFileSync } from "node:fs";
import os from "node:os";
import { freePort, startLocalPostgres } from "./pg-local.mjs";

os.setPriority(0, 10); // be nice to other work on this machine
mkdirSync(".stack", { recursive: true });

const pg = process.env.DATABASE_URL ? null : await startLocalPostgres();
const ports = {
  web: Number(process.env.WEB_PORT) || (await freePort()),
  api: Number(process.env.API_PORT) || (await freePort()),
  oidc: Number(process.env.OIDC_PORT) || (await freePort()),
  source: Number(process.env.SOURCE_PORT) || (await freePort()),
};
const urls = {
  web: `http://localhost:${ports.web}`, api: `http://localhost:${ports.api}`,
  oidc: `http://localhost:${ports.oidc}`, source: `http://localhost:${ports.source}`,
};
const common = { ...process.env, FORCE_COLOR: "0" };
const children = [];

function start(name, cmd, args, env) {
  const log = openSync(`.stack/${name}.log`, "w");
  const child = spawn(cmd, args, { env: { ...common, ...env }, stdio: ["ignore", log, log] });
  children.push(child);
  child.on("exit", (code) => { if (code) console.error(`${name} exited with code ${code} (see .stack/${name}.log)`); });
}

const tsx = "node_modules/.bin/tsx";
start("oidc", tsx, ["mocks/src/oidc.ts"], { PORT: ports.oidc, OIDC_ISSUER: urls.oidc });
start("source", tsx, ["mocks/src/source.ts"], { PORT: ports.source, RATE_LIMIT: process.env.RATE_LIMIT ?? "5", RATE_WINDOW_MS: process.env.RATE_WINDOW_MS ?? "2000" });
start("api", tsx, ["api/src/server.ts"], {
  PORT: ports.api, DATABASE_URL: process.env.DATABASE_URL ?? pg.url, OIDC_ISSUER: urls.oidc, WEB_URL: urls.web, LOG_LEVEL: "info",
  // Local test only KEK for key id dev1. Public value, never use outside local runs.
  // The browser tests sign in many times from one address, so the login limit is high here.
  LOGIN_RATE_PER_MIN: process.env.LOGIN_RATE_PER_MIN ?? "1000",
  CIC_SECRET_SOURCE_KEK_DEV1: process.env.CIC_SECRET_SOURCE_KEK_DEV1 ?? "bG9jYWwtdGVzdC1vbmx5LWtlay0wMTIzNDU2Nzg5YWI=",
});
start("web", "node_modules/.bin/next", ["dev", "web", "-p", String(ports.web)], { API_URL: urls.api });

async function waitFor(url) {
  for (let i = 0; i < 180; i++) {
    try { if ((await fetch(url)).status < 500) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timeout waiting for ${url}`);
}
await Promise.all([waitFor(`${urls.api}/health`), waitFor(`${urls.oidc}/jwks`), waitFor(`${urls.source}/health`), waitFor(`${urls.web}/login`)]);
writeFileSync(".stack/urls.json", JSON.stringify(urls));
console.log(`stack ready\n  web:    ${urls.web}\n  api:    ${urls.api}\n  oidc:   ${urls.oidc}\n  source: ${urls.source} (api key: demo-key)`);

const stop = () => {
  for (const c of children) c.kill("SIGTERM");
  pg?.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
