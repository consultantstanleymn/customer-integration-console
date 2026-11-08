import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createPool, migrate } from "./db.js";

const cfg = loadConfig();
const db = createPool(cfg.DATABASE_URL);
await migrate(db);
const app = await buildApp(db, cfg);
await app.listen({ port: cfg.PORT, host: "0.0.0.0" });

const stop = async () => { await app.close(); await db.end(); process.exit(0); };
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
