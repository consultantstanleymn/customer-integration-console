import type { Config } from "../config.js";
import { buildSecretProvider, type SecretProvider } from "./provider.js";
import { decryptField, encryptField, isEnvelope, type Envelope } from "./envelope.js";

// Source credentials live in sources.config_secrets as envelope objects.
// The KEK for a key id comes from the secret provider under the name source-kek-<kid>.

export type SecretName = "secret" | "apiKey";

export type SourceLike = {
  config: Record<string, string>;
  config_secrets?: unknown;
};

export type SourceSecrets = {
  encryptInto(config: Record<string, string>): Promise<{ config: Record<string, string>; secrets: Record<string, Envelope> }>;
  get(source: SourceLike, name: SecretName): Promise<string | undefined>;
};

const SECRET_NAMES: SecretName[] = ["secret", "apiKey"];

function parseKek(text: string, kid: string): Buffer {
  const buf = Buffer.from(text.trim(), "base64");
  if (buf.length !== 32) throw new Error(`KEK for ${kid} must be 32 bytes of base64`);
  return buf;
}

export function createSourceSecrets(cfg: Config, provider: SecretProvider = buildSecretProvider(cfg)): SourceSecrets {
  const keyring = new Map<string, Buffer>();

  async function kekFor(kid: string): Promise<Buffer> {
    const hit = keyring.get(kid);
    if (hit) return hit;
    const text = await provider.get(`source-kek-${kid}`);
    const buf = parseKek(text, kid);
    keyring.set(kid, buf);
    return buf;
  }

  async function encryptInto(config: Record<string, string>) {
    const out: Record<string, string> = { ...config };
    const secrets: Record<string, Envelope> = {};
    const kid = cfg.SOURCE_KEK_ACTIVE;
    for (const name of SECRET_NAMES) {
      const plain = out[name];
      if (plain === undefined) continue;
      delete out[name];
      const kek = await kekFor(kid);
      secrets[name] = encryptField(plain, kek, kid);
    }
    return { config: out, secrets };
  }

  async function get(source: SourceLike, name: SecretName): Promise<string | undefined> {
    const stored = source.config_secrets;
    if (stored && typeof stored === "object") {
      const env = (stored as Record<string, unknown>)[name];
      if (isEnvelope(env)) {
        const kek = await kekFor(env.kid);
        return decryptField(env, new Map([[env.kid, kek]]));
      }
    }
    // Rows that the one-time migration has not touched yet still hold a plain value.
    const plain = source.config?.[name];
    return typeof plain === "string" ? plain : undefined;
  }

  return { encryptInto, get };
}
