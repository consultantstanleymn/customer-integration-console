// Starts a throw-away local Postgres (no Docker needed). Used by tests and `npm run stack`.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import net from "node:net";

export function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });
}

export async function startLocalPostgres() {
  const dir = mkdtempSync(join(tmpdir(), "cic-pg-"));
  const port = await freePort();
  execFileSync("initdb", ["-D", dir, "-U", "cic", "--auth=trust", "-E", "UTF8"], { stdio: "ignore" });
  execFileSync("pg_ctl", ["-D", dir, "-o", `-p ${port} -k ${dir} -c listen_addresses=127.0.0.1 -c fsync=off`, "-w", "-l", join(dir, "log.txt"), "start"], { stdio: "ignore" });
  spawnSync("createdb", ["-h", "127.0.0.1", "-p", String(port), "-U", "cic", "cic"]);
  return {
    url: `postgres://cic@127.0.0.1:${port}/cic`,
    stop() {
      try { execFileSync("pg_ctl", ["-D", dir, "-m", "immediate", "stop"], { stdio: "ignore" }); } catch { /* already stopped */ }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
