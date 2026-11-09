import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { EXPECTED, allRoutes, keyOf, missingEntries, staleEntries } from "./authz-expected.js";

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

  const missing = missingEntries(defs);
  const stale = staleEntries(defs);

  const lines: string[] = [];
  lines.push("# Authorization matrix (expected)");
  lines.push("");
  lines.push("Generated from the route table. Do not edit by hand.");
  lines.push("");
  lines.push("`allow` means the call passed authz. A 2xx, 404 or 422 all count as passed authz.");
  lines.push("");
  lines.push("| Method and path | Summary | Anonymous | Viewer | Engineer | Admin |");
  lines.push("|---|---|---|---|---|---|");
  for (const r of defs) {
    const k = keyOf(r);
    const e = EXPECTED[k];
    const cells = e ? [e.anonymous, e.viewer, e.engineer, e.admin] : ["MISSING", "MISSING", "MISSING", "MISSING"];
    lines.push(`| \`${k}\` | ${r.summary} | ${cells.join(" | ")} |`);
  }
  lines.push("");
  lines.push(`Routes: ${defs.length}. Matrix entries: ${Object.keys(EXPECTED).length}.`);
  if (missing.length) lines.push(`Missing entries: ${missing.join(", ")}.`);
  if (stale.length) lines.push(`Stale entries: ${stale.join(", ")}.`);
  process.stdout.write(lines.join("\n") + "\n");
}

main().catch((e) => {
  process.stderr.write(String(e instanceof Error ? e.stack ?? e.message : e) + "\n");
  process.exit(1);
});
