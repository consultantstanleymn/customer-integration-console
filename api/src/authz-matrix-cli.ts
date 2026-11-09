import { loadConfig } from "./config.js";
import { allRoutes, renderMatrixMarkdown } from "./authz-expected.js";

/**
 * Print the expected authorization matrix as a Markdown table.
 * The table has one row per route plus two header rows.
 * The route summary comes from the route table, so the document follows the code.
 */
async function main() {
  const cfg = loadConfig();
  // The route table only builds closures. It does not touch the database here.
  const db = {} as never;
  const defs = allRoutes({ db, cfg, metrics: { deadLettersPending: { set() {} }, authEvents: { inc() {} }, http: { observe() {} } } as never });

  process.stdout.write(renderMatrixMarkdown(defs));
}

main().catch((e) => {
  process.stderr.write(String(e instanceof Error ? e.stack ?? e.message : e) + "\n");
  process.exit(1);
});
