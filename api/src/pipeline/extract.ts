import { parse } from "csv-parse/sync";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Db } from "../db.js";
import type { RawRow } from "../quality.js";

/** CSV: the whole file becomes rows. Empty cells stay empty strings. */
export function extractCsv(text: string): RawRow[] {
  return parse(text, { columns: true, skip_empty_lines: true, trim: true, relax_column_count: true, bom: true }) as RawRow[];
}

type RestCfg = { baseUrl: string; apiKey?: string };
type RestOpts = { sleep?: (ms: number) => Promise<void>; maxRetries?: number; pageSize?: number };

/** REST: follows next_cursor pages, asks only for rows newer than the watermark, waits when rate limited (HTTP 429). */
export async function extractRest(cfg: RestCfg, since: string | null, opts: RestOpts = {}): Promise<RawRow[]> {
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const maxRetries = opts.maxRetries ?? 5;
  const rows: RawRow[] = [];
  let cursor: string | null = null;
  do {
    const url = new URL("/orders", cfg.baseUrl);
    url.searchParams.set("limit", String(opts.pageSize ?? 50));
    if (since) url.searchParams.set("updated_since", since);
    if (cursor) url.searchParams.set("cursor", cursor);
    let attempt = 0;
    for (;;) {
      const res = await fetch(url, { headers: cfg.apiKey ? { "x-api-key": cfg.apiKey } : {} });
      if (res.status === 429 && attempt < maxRetries) {
        attempt++;
        const wait = Math.min(Number(res.headers.get("retry-after") ?? "1") * 1000, 10_000);
        await sleep(wait);
        continue;
      }
      if (!res.ok) throw new Error(`source returned HTTP ${res.status}`);
      const body = (await res.json()) as { data: RawRow[]; next_cursor: string | null };
      rows.push(...body.data);
      cursor = body.next_cursor;
      break;
    }
  } while (cursor);
  return rows;
}

/** Webhook: events were stored by the webhook endpoint. This reads the unprocessed ones. */
export async function extractWebhook(db: Db, sourceId: number): Promise<{ rows: RawRow[]; eventIds: number[] }> {
  const { rows: ev } = await db.query("SELECT id, payload FROM webhook_events WHERE source_id=$1 AND processed_run_id IS NULL ORDER BY id", [sourceId]);
  const rows: RawRow[] = [];
  for (const e of ev) rows.push(...(Array.isArray(e.payload) ? e.payload : [e.payload]));
  return { rows, eventIds: ev.map((e) => e.id as number) };
}

export const signBody = (secret: string, body: string) => "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

/** Constant-time check of the X-Signature header. */
export function verifySignature(secret: string, body: string, header: string | undefined): boolean {
  if (!header) return false;
  const a = Buffer.from(signBody(secret, body));
  const b = Buffer.from(header);
  return a.length === b.length && timingSafeEqual(a, b);
}
