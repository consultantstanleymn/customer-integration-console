import { z } from "zod";

// Discovery document fields we use. Extra fields are ignored.
const Discovery = z.object({
  issuer: z.string(),
  authorization_endpoint: z.string(),
  token_endpoint: z.string(),
  jwks_uri: z.string(),
});

export type DiscoveryDoc = z.infer<typeof Discovery>;

type FetchImpl = typeof fetch;

// One cache per process, keyed by the internal issuer URL.
const cache = new Map<string, Promise<DiscoveryDoc>>();

/** Clears the process cache. Tests use this to start from a clean state. */
export function clearDiscoveryCache(): void {
  cache.clear();
}

/**
 * Reads the OpenID Connect discovery document for an issuer.
 * The result is cached per process. The document `issuer` must equal the configured issuer (`expectedIssuer`, which is the public issuer URL).
 */
export function discover(issuerInternal: string, fetchImpl: FetchImpl = fetch, expectedIssuer: string = issuerInternal): Promise<DiscoveryDoc> {
  const key = `${issuerInternal}|${expectedIssuer}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const p = load(issuerInternal, fetchImpl, expectedIssuer);
  cache.set(key, p);
  // Do not keep a failed lookup in the cache.
  p.catch(() => cache.delete(key));
  return p;
}

async function load(issuerInternal: string, fetchImpl: FetchImpl, expectedIssuer: string): Promise<DiscoveryDoc> {
  const url = new URL("/.well-known/openid-configuration", issuerInternal);
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`discovery failed: ${res.status}`);
  const doc = Discovery.parse(await res.json());
  if (doc.issuer !== expectedIssuer) throw new Error("discovery issuer mismatch");
  return doc;
}
