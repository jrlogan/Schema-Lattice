// The skill's commands — discover, resolve, propose, contexts — run with no config file, against
// a real server, and print compact text. Boots a fresh instance (skeleton only).
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { LatticeInstance } from "../../lattice-server/src/server/instance.ts";
import { startHttpServer } from "../../lattice-server/src/http/server.ts";

let failed = 0;
function check(name: string, ok: boolean, note: string) {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  — ${note}`);
}

const CLIENT = fileURLToPath(new URL("../schemalattice.mjs", import.meta.url));

async function main() {
  const tmp = mkdtempSync(join(tmpdir(), "schemalattice-lookups-"));
  const instance = await LatticeInstance.create({ dataDir: join(tmp, "data") });
  const handle = await startHttpServer(instance, { dataDir: join(tmp, "data"), host: "127.0.0.1", port: 0, apiKey: null });
  // Run where there is no schemalattice.config.json: the lookups must not need one.
  const run = (...args: string[]) => new Promise<{ code: number; out: string }>((done) => {
    const child = spawn(process.execPath, [CLIENT, ...args], {
      cwd: tmp, env: { ...process.env, SCHEMALATTICE_URL: `http://127.0.0.1:${handle.port}` },
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", (code) => done({ code: code ?? 1, out }));
  });

  const found = await run("discover", "a human individual", "--limit", "2");
  const session = found.out.match(/^session (\S+)$/m)?.[1];
  const uri = found.out.match(/(https:\/\/schemalattice\.com\/c\/\S+)/)?.[1];
  check("discover-prints-verdict-session-and-results", found.code === 0 && /^(adopt|fork|distant|no-match): /.test(found.out) && !!session && !!uri,
    found.out.split("\n").slice(0, 3).join(" | "));
  const events = (instance.store.db.prepare("SELECT payload FROM events WHERE kind = 'discover' ORDER BY id DESC LIMIT 1").get() as { payload: string } | undefined)?.payload ?? "";
  check("discover-is-ephemeral-by-default", !events.includes("a human individual"), events.slice(0, 80) || "no discover event");

  const resolved = await run("resolve", uri!, "--session", session!);
  check("resolve-prints-label-and-definition", resolved.code === 0 && resolved.out.startsWith("Person") && resolved.out.split("\n").length >= 2,
    resolved.out.split("\n")[0]);

  const proposed = await run("propose", session!, uri!, "right");
  check("propose-records-a-verdict", proposed.code === 0 && proposed.out.startsWith("recorded: right"), proposed.out.trim());

  const contexts = await run("contexts");
  check("contexts-lists-the-skeleton", contexts.code === 0 && contexts.out.includes("schemalattice"), contexts.out.split("\n")[0]);

  const bad = await run("propose", session!, uri!, "maybe");
  check("bad-arguments-explain-usage", bad.code !== 0 && bad.out.includes("usage:"), bad.out.trim().slice(0, 80));

  await handle.close();
  instance.close();
  rmSync(tmp, { recursive: true, force: true });
  console.log(failed ? `\n${failed} failed` : "\nall passed");
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
