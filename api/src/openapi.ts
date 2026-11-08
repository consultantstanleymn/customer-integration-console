import { z } from "zod";
import type { RouteDef } from "./routes.js";

/** Builds the OpenAPI 3.1 document from the route table, so docs cannot drift from the code. */
export function buildOpenApi(defs: RouteDef[]) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of defs) {
    const path = r.path.replace(/:(\w+)/g, "{$1}");
    const params = [...r.path.matchAll(/:(\w+)/g)].map((m) => ({ name: m[1], in: "path", required: true, schema: { type: "integer" } }));
    const op: Record<string, unknown> = {
      operationId: `${r.method.toLowerCase()}${path.replace(/[^a-zA-Z]+(\w)?/g, (_, c: string | undefined) => (c ?? "").toUpperCase())}`,
      summary: r.summary,
      parameters: params,
      security: r.auth === "public" ? [] : [{ session: [] }],
      "x-minimum-role": r.auth,
      responses: {
        "200": { description: "OK" },
        ...(r.auth === "public" ? {} : { "401": { description: "No session" }, "403": { description: "Role too low or CSRF token missing" } }),
        ...(r.body ? { "400": { description: "Validation error" } } : {}),
      },
    };
    if (r.body) op.requestBody = { required: true, content: { "application/json": { schema: z.toJSONSchema(r.body, { unrepresentable: "any" }) } } };
    if (r.rawText) op.requestBody = { required: true, content: { [r.path.startsWith("/webhooks") ? "application/json" : "text/csv"]: { schema: { type: "string" } } } };
    (paths[path] ??= {})[r.method.toLowerCase()] = op;
  }
  paths["/metrics"] = { get: { operationId: "getMetrics", summary: "Prometheus metrics", security: [], responses: { "200": { description: "OK" } } } };
  return {
    openapi: "3.1.0",
    info: { title: "Customer Integration Console API", version: "0.1.0" },
    components: { securitySchemes: { session: { type: "apiKey", in: "cookie", name: "sid" } } },
    paths,
  };
}
