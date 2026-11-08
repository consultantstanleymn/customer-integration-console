import client from "prom-client";

export function createMetrics() {
  const registry = new client.Registry();
  client.collectDefaultMetrics({ register: registry });
  return {
    registry,
    http: new client.Histogram({
      name: "http_request_duration_seconds", help: "HTTP request duration", labelNames: ["method", "route", "status"],
      buckets: [0.005, 0.025, 0.1, 0.5, 1, 5], registers: [registry],
    }),
    runs: new client.Counter({ name: "pipeline_runs_total", help: "Pipeline runs by outcome", labelNames: ["status", "source_type"], registers: [registry] }),
    rows: new client.Counter({ name: "pipeline_rows_total", help: "Rows processed by result", labelNames: ["result"], registers: [registry] }),
    runSeconds: new client.Histogram({ name: "pipeline_run_duration_seconds", help: "Pipeline run duration", buckets: [0.05, 0.25, 1, 5, 30], registers: [registry] }),
    deadLettersPending: new client.Gauge({ name: "dead_letters_pending", help: "Dead letters waiting for a human", registers: [registry] }),
    authEvents: new client.Counter({ name: "auth_events_total", help: "Login and access events", labelNames: ["event"], registers: [registry] }),
  };
}
export type Metrics = ReturnType<typeof createMetrics>;
