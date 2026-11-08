import { loadConfig } from "./config.js";
import { createPool, migrate } from "./db.js";

const db = createPool(loadConfig().DATABASE_URL);
const applied = await migrate(db);
console.log(applied.length ? `applied: ${applied.join(", ")}` : "database is up to date");
await db.end();
