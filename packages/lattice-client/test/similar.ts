// `similar` ranks a platform's own schemas, declared or not, against a description, using the
// catalog's model through POST /api/embed. Boots a real server; checks ranking, that declared
// concepts are not counted twice, and that a repeat run sends only the query.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LatticeInstance } from "../../lattice-server/src/server/instance.ts";
import { startHttpServer } from "../../lattice-server/src/http/server.ts";
// @ts-ignore — plain ESM without types
import { similar, inventoryOf } from "../schemalattice.mjs";

let failed = 0;
function check(name: string, ok: boolean, note: string) {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  — ${note}`);
}

async function main() {
  const tmp = mkdtempSync(join(tmpdir(), "schemalattice-similar-"));
  const instance = await LatticeInstance.create({ dataDir: join(tmp, "data") });
  const handle = await startHttpServer(instance, { dataDir: join(tmp, "data"), host: "127.0.0.1", port: 0, apiKey: null });
  process.env.SCHEMALATTICE_URL = `http://127.0.0.1:${handle.port}`;

  const app = join(tmp, "app");
  const field = (name: string) => ({ name, type: "string" });
  writeFileSync(join(tmp, "inventory.json"), JSON.stringify({ entities: {
    sailInvite: {
      description: "An invitation to sail: a skipper asks one person to come sailing on one boat, on a day or open-ended, and sees the answer.",
      location: "src/sailInvite.ts#sailInvite", fields: ["vesselId", "toPersonId", "day", "status"].map(field),
    },
    engineHourReading: {
      description: "A reading of an engine's hour meter, used to schedule service work.",
      location: "src/maintenance.ts#engineHourReading", fields: ["vesselId", "hours", "readAt"].map(field),
    },
    // No doc comment: matched on its name and fields.
    raceParticipant: { fields: ["raceId", "entryId", "personId", "role"].map(field) },
    // Declared below, so the inventory copy must be skipped.
    trip: { fields: ["startedAt", "endedAt"].map(field) },
  } }));
  const config = {
    lattice: "https://schemalattice.com", app: { name: "Fixture" },
    inventory: { format: "dictionary", path: "../inventory.json" },
    concepts: [{ shortName: "Trip", entity: "trip" }],
  };
  const generated = { concepts: [{
    shortName: "Trip", uri: "https://schemalattice.com/c/fixture/trip@000000000000", localLocation: "src/trip.ts#trip",
    args: { prefLabel: "Trip", definition: "One outing on the water, recorded with a track.", structure: { fields: [field("startedAt")] } },
  }] };

  const items = inventoryOf(config, app, generated);
  check("declared-concepts-not-counted-twice", items.length === 4 && items.filter((i: any) => /trip/i.test(i.name)).length === 1,
    items.map((i: any) => i.name).join(", "));

  let embedCalls = 0;
  let embedded = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: any, init?: any) => {
    if (String(url).endsWith("/api/embed")) { embedCalls++; embedded += JSON.parse(init.body).texts.length; }
    return realFetch(url, init);
  }) as typeof fetch;

  const query = "Crew invite: a skipper invites several people to come sailing and sees who confirmed";
  const first = await similar(config, app, generated, query, { limit: 3 });
  check("invite-ranks-first", first.own[0]?.name === "sailInvite",
    first.own.map((o: any) => `${o.name} ${o.similarity}`).join(", "));
  check("first-run-embeds-everything", embedded === 5, `${embedded} texts in ${embedCalls} calls`);

  embedded = 0;
  const second = await similar(config, app, generated, "Engine hours since the last oil change", { limit: 3, catalog: false });
  check("repeat-run-sends-only-the-query", embedded === 1, `${embedded} texts`);
  check("engine-reading-ranks-first", second.own[0]?.name === "engineHourReading",
    second.own.map((o: any) => `${o.name} ${o.similarity}`).join(", "));
  check("own-schemas-never-listed-as-elsewhere", !first.elsewhere.some((r: any) => r.uri === generated.concepts[0].uri),
    `${first.elsewhere.length} catalog results`);

  globalThis.fetch = realFetch;
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
