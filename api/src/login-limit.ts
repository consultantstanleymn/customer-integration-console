// Token bucket per client IP for the login and callback routes.
// Each bucket holds perMinute tokens and refills at perMinute tokens per 60 seconds.

export type LoginLimiter = {
  take(ip: string): { ok: boolean; retryAfterSec: number };
};

type Bucket = { tokens: number; updated: number };

export function createLoginLimiter(opts: { perMinute: number; now?: () => number }): LoginLimiter {
  const perMinute = Math.max(1, Math.floor(opts.perMinute));
  const now = opts.now ?? (() => Date.now());
  const refillPerMs = perMinute / 60000;
  const buckets = new Map<string, Bucket>();

  return {
    take(ip: string) {
      const t = now();
      let b = buckets.get(ip);
      if (!b) {
        b = { tokens: perMinute, updated: t };
        buckets.set(ip, b);
      } else {
        const elapsed = Math.max(0, t - b.updated);
        b.tokens = Math.min(perMinute, b.tokens + elapsed * refillPerMs);
        b.updated = t;
      }
      if (b.tokens >= 1) {
        b.tokens -= 1;
        return { ok: true, retryAfterSec: 0 };
      }
      const missing = 1 - b.tokens;
      const retryAfterSec = Math.ceil(missing / refillPerMs / 1000);
      return { ok: false, retryAfterSec: Math.max(1, retryAfterSec) };
    },
  };
}
