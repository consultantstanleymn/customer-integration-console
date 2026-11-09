import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import {
  EnvSecretProvider,
  FileSecretProvider,
  GcpSecretManagerProvider,
  buildSecretProvider,
} from "../src/secrets/provider.js";

describe("env provider reads a value", () => {
  it("reads CIC_SECRET_<NAME>", async () => {
    const provider = new EnvSecretProvider({ CIC_SECRET_SOURCE_KEY: "s3cr3t" });
    await expect(provider.get("source-key")).resolves.toBe("s3cr3t");
  });

  it("throws a clear error when the value is missing", async () => {
    const provider = new EnvSecretProvider({});
    await expect(provider.get("source-key")).rejects.toThrow("secret not found: source-key");
  });
});

describe("file provider refuses path escape", () => {
  it("rejects a name with ..", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cic-secrets-"));
    const provider = new FileSecretProvider(dir);
    await expect(provider.get("../etc/passwd")).rejects.toThrow("invalid secret name");
  });

  it("reads a file in the directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cic-secrets-"));
    await writeFile(join(dir, "source-key"), "file-secret", "utf8");
    const provider = new FileSecretProvider(dir);
    await expect(provider.get("source-key")).resolves.toBe("file-secret");
  });
});

describe("gcp provider calls the access URL with a bearer token", () => {
  it("uses the project, secret name and bearer token", async () => {
    const calls: Array<{ url: string; auth: string | null }> = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      calls.push({ url: String(url), auth: headers.get("authorization") });
      return new Response(JSON.stringify({ payload: { data: Buffer.from("gcp-secret").toString("base64") } }), {
        status: 200,
      });
    }) as typeof fetch;
    const provider = new GcpSecretManagerProvider({
      project: "proj-1",
      fetchImpl,
      tokenProvider: async () => "tok-123",
    });
    await provider.get("source-key");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      "https://secretmanager.googleapis.com/v1/projects/proj-1/secrets/source-key/versions/latest:access",
    );
    expect(calls[0]?.auth).toBe("Bearer tok-123");
  });
});

describe("gcp provider decodes base64 payload", () => {
  it("returns the decoded text", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ payload: { data: Buffer.from("plain-value").toString("base64") } }), {
        status: 200,
      })) as typeof fetch;
    const provider = new GcpSecretManagerProvider({
      project: "proj-1",
      fetchImpl,
      tokenProvider: async () => "tok",
    });
    await expect(provider.get("source-key")).resolves.toBe("plain-value");
  });
});

describe("gcp provider maps 404 to a clear error", () => {
  it("throws secret not found", async () => {
    const fetchImpl = (async () => new Response("{}", { status: 404 })) as typeof fetch;
    const provider = new GcpSecretManagerProvider({
      project: "proj-1",
      fetchImpl,
      tokenProvider: async () => "tok",
    });
    await expect(provider.get("source-key")).rejects.toThrow("secret not found: source-key");
  });

  it("throws the status for other errors", async () => {
    const fetchImpl = (async () => new Response("{}", { status: 500 })) as typeof fetch;
    const provider = new GcpSecretManagerProvider({
      project: "proj-1",
      fetchImpl,
      tokenProvider: async () => "tok",
    });
    await expect(provider.get("source-key")).rejects.toThrow("status 500");
  });
});

describe("buildSecretProvider selects the backend", () => {
  it("builds the env provider by default", () => {
    const cfg = loadConfig({});
    expect(buildSecretProvider(cfg)).toBeInstanceOf(EnvSecretProvider);
  });

  it("requires a tokenProvider for gcp", () => {
    const cfg = loadConfig({ SECRET_BACKEND: "gcp", GCP_PROJECT: "proj-1" });
    expect(() => buildSecretProvider(cfg)).toThrow("tokenProvider");
  });
});
