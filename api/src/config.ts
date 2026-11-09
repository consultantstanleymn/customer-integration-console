import { z } from "zod";

// All settings come from environment variables. Secrets are never in the repo.
const Env = z.object({
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().default("postgres://cic@127.0.0.1:5432/cic"),
  // Public URL of the identity provider (what the browser sees) and the URL the API uses to reach it.
  OIDC_ISSUER: z.string().default("http://localhost:4100"),
  OIDC_INTERNAL_URL: z.string().optional(),
  OIDC_CLIENT_ID: z.string().default("integration-console"),
  OIDC_CLIENT_SECRET: z.string().default("dev-only-secret"),
  // When "true", the API reads endpoints from the discovery document. When "false", it uses fixed paths.
  OIDC_DISCOVERY: z.enum(["true", "false"]).default("true"),
  // Audience that machine access tokens must carry.
  API_AUDIENCE: z.string().default("cic-api"),
  // Public URL of the web app. The OIDC callback lands on the web origin and is proxied to the API.
  WEB_URL: z.string().default("http://localhost:3000"),
  COOKIE_SECURE: z.enum(["true", "false"]).default("false"),
  SESSION_TTL_MINUTES: z.coerce.number().default(480),
  LOG_LEVEL: z.string().default("info"),
  // Secret provider backend. "env" reads CIC_SECRET_<NAME>, "file" reads <SECRET_DIR>/<name>, "gcp" uses Secret Manager.
  SECRET_BACKEND: z.enum(["env", "file", "gcp"]).default("env"),
  SECRET_DIR: z.string().optional(),
  GCP_PROJECT: z.string().optional(),
  // Active key id for source credential encryption. The KEK is the secret source-kek-<kid>.
  SOURCE_KEK_ACTIVE: z.string().default("dev1"),
});

export type Config = z.infer<typeof Env> & { oidcInternal: string };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const c = Env.parse(env);
  return { ...c, oidcInternal: c.OIDC_INTERNAL_URL ?? c.OIDC_ISSUER };
}
