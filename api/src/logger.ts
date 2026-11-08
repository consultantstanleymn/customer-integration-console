import pino from "pino";

// One JSON object per line. Log shippers (Loki, CloudWatch, Cloud Logging) parse this directly.
export function createLogger(level = "info") {
  return pino({ level, base: { service: "api" }, redact: ["req.headers.cookie", "req.headers.authorization"] });
}
