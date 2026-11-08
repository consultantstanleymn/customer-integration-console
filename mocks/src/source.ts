// Mock customer REST API. Cursor pagination, an `updated_since` filter, an API key and a rate limit.
import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";

type Order = Record<string, string | number | null>;

/** 120 deterministic orders. A few are broken on purpose so the dead-letter flow has something to show. */
export function makeOrders(n = 120): Order[] {
  const base = Date.parse("2026-01-01T00:00:00Z");
  return Array.from({ length: n }, (_, i) => {
    const o: Order = {
      external_id: `ORD-${String(i + 1).padStart(4, "0")}`,
      customer_email: `customer${(i % 17) + 1}@shop.test`,
      amount: ((i * 37) % 500) + 5.5,
      currency: i % 5 === 0 ? "eur" : "USD",
      status: ["paid", "pending", "cancelled", "paid"][i % 4] as string,
      updated_at: new Date(base + i * 3_600_000).toISOString(),
    };
    if (i % 25 === 12) o.customer_email = "not-an-email";
    if (i % 40 === 33) o.amount = -1;
    return o;
  });
}

export function createSource(opts: { apiKey?: string; rateLimit?: number; windowMs?: number; orders?: Order[] } = {}): Server {
  const apiKey = opts.apiKey ?? "demo-key";
  const limit = opts.rateLimit ?? 5;
  const windowMs = opts.windowMs ?? 2000;
  const orders = opts.orders ?? makeOrders();
  let windowStart = Date.now();
  let count = 0;

  return createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const send = (code: number, body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(code, { "content-type": "application/json", ...headers });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === "/health") return send(200, { ok: true });
    if (url.pathname !== "/orders") return send(404, { error: "not found" });
    if (req.headers["x-api-key"] !== apiKey) return send(401, { error: "bad api key" });

    const now = Date.now();
    if (now - windowStart > windowMs) { windowStart = now; count = 0; }
    if (++count > limit) return send(429, { error: "rate limited" }, { "retry-after": String(Math.ceil((windowStart + windowMs - now) / 1000) || 1) });

    const since = url.searchParams.get("updated_since");
    const pageSize = Math.min(Number(url.searchParams.get("limit") ?? 50), 100);
    const offset = Number(url.searchParams.get("cursor") ?? 0);
    const rows = orders.filter((o) => !since || String(o.updated_at) > since);
    const page = rows.slice(offset, offset + pageSize);
    send(200, { data: page, next_cursor: offset + pageSize < rows.length ? String(offset + pageSize) : null });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 4200);
  createSource({ rateLimit: Number(process.env.RATE_LIMIT ?? 5), windowMs: Number(process.env.RATE_WINDOW_MS ?? 2000) })
    .listen(port, () => console.log(`mock-source on :${port}`));
}
