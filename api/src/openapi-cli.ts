import { buildOpenApi } from "./openapi.js";
import { routes } from "./routes.js";
import { authRoutes } from "./auth-routes.js";
import type { Deps } from "./routes.js";

const stub = {} as Deps; // handlers are never called here
console.log(JSON.stringify(buildOpenApi([...authRoutes(stub), ...routes(stub)]), null, 2));
