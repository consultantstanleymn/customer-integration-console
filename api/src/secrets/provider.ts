import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Config } from "../config.js";

// A secret provider returns a secret value by name. Names are short and stable, for example "source-key".
export interface SecretProvider {
  get(name: string): Promise<string>;
  currentKeyId?(): Promise<string>;
}

// Reads CIC_SECRET_<NAME>. The name is upper-cased and dashes become underscores.
export class EnvSecretProvider implements SecretProvider {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  async get(name: string): Promise<string> {
    const key = "CIC_SECRET_" + name.toUpperCase().replace(/[^A-Z0-9]/g, "_");
    const value = this.env[key];
    if (value === undefined) throw new Error(`secret not found: ${name}`);
    return value;
  }
}

// Reads <dir>/<name>. Refuses names that try to leave the directory.
export class FileSecretProvider implements SecretProvider {
  constructor(private readonly dir: string) {}

  async get(name: string): Promise<string> {
    if (name.length === 0 || name.includes("..") || name.includes("/") || name.includes("\\")) {
      throw new Error(`invalid secret name: ${name}`);
    }
    const path = join(this.dir, name);
    try {
      return await readFile(path, "utf8");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") throw new Error(`secret not found: ${name}`);
      throw err;
    }
  }
}

export interface GcpSecretManagerOptions {
  project: string;
  fetchImpl?: typeof fetch;
  tokenProvider: () => Promise<string>;
}

interface GcpAccessResponse {
  payload?: { data?: string };
}

// Calls the Secret Manager REST API and decodes the base64 payload.
export class GcpSecretManagerProvider implements SecretProvider {
  private readonly project: string;
  private readonly fetchImpl: typeof fetch;
  private readonly tokenProvider: () => Promise<string>;

  constructor(opts: GcpSecretManagerOptions) {
    this.project = opts.project;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.tokenProvider = opts.tokenProvider;
  }

  async get(name: string): Promise<string> {
    const token = await this.tokenProvider();
    const url =
      `https://secretmanager.googleapis.com/v1/projects/${encodeURIComponent(this.project)}` +
      `/secrets/${encodeURIComponent(name)}/versions/latest:access`;
    const res = await this.fetchImpl(url, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
    });
    if (res.status === 404) throw new Error(`secret not found: ${name}`);
    if (!res.ok) throw new Error(`secret manager request failed with status ${res.status}`);
    const body = (await res.json()) as GcpAccessResponse;
    const data = body.payload?.data;
    if (typeof data !== "string") throw new Error(`secret manager response has no payload: ${name}`);
    return Buffer.from(data, "base64").toString("utf8");
  }
}

export interface BuildSecretProviderOptions {
  tokenProvider?: () => Promise<string>;
  fetchImpl?: typeof fetch;
}

// Builds the provider that the config selects.
export function buildSecretProvider(cfg: Config, opts: BuildSecretProviderOptions = {}): SecretProvider {
  switch (cfg.SECRET_BACKEND) {
    case "env":
      return new EnvSecretProvider();
    case "file": {
      if (!cfg.SECRET_DIR) throw new Error("SECRET_DIR is required when SECRET_BACKEND is file");
      return new FileSecretProvider(cfg.SECRET_DIR);
    }
    case "gcp": {
      if (!cfg.GCP_PROJECT) throw new Error("GCP_PROJECT is required when SECRET_BACKEND is gcp");
      if (!opts.tokenProvider) {
        throw new Error("a tokenProvider is required when SECRET_BACKEND is gcp");
      }
      return new GcpSecretManagerProvider({
        project: cfg.GCP_PROJECT,
        tokenProvider: opts.tokenProvider,
        fetchImpl: opts.fetchImpl,
      });
    }
  }
}
