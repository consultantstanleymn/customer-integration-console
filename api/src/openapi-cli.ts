import { buildOpenApi } from "./openapi.js";
import { routes } from "./routes.js";
import { authRoutes } from "./auth-routes.js";
import { loadConfig } from "./config.js";
import type { Deps } from "./routes.js";

const stub = { cfg: loadConfig() } as Deps; // handlers are never called here
console.log(JSON.stringify(buildOpenApi([...authRoutes(stub), ...routes(stub)]), null, 2));
