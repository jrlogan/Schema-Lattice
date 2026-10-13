// Seed sources and mappings onto concepts that already exist; mints nothing.
//
//   LATTICE_API_KEY=… npx tsx examples/public-sources/seed-sources.ts --target https://schemalattice.com [--seed civic|standards]
//
// Re-running is safe: known sources are refreshed, mappings re-asserted. Seed
// standards before civic: civic sources declare conformsTo standards.

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : null;
};
const SEEDS = { civic: "./new-haven-civic-seed.ts", standards: "./standards-seed.ts" } as const;
const seedName = (arg("seed") ?? "civic") as keyof typeof SEEDS;
if (!(seedName in SEEDS)) throw new Error(`--seed must be one of ${Object.keys(SEEDS).join(", ")}`);
const { MAPPINGS, SOURCES } = await import(SEEDS[seedName]);

const TARGET = arg("target");
const KEY = process.env.LATTICE_API_KEY;
if (!TARGET || !KEY) throw new Error("usage: LATTICE_API_KEY=… seed-sources.ts --target <instance url>");

async function call(name: string, args: Record<string, unknown>) {
  const res = await fetch(`${TARGET}/api/tools/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
    body: JSON.stringify(args),
  });
  return res.json() as Promise<any>;
}

let failed = 0;
for (const s of SOURCES as Array<Record<string, unknown> & { slug: string }>) {
  const r = await call("lattice_propose_source", { ...s });
  if (r.error) {
    failed++;
    console.log(`  ✗ ${s.slug}: ${r.error.message}`);
  } else {
    console.log(`  ${r.status.padEnd(8)} ${r.slug.padEnd(38)} ${String(r.fieldCount).padStart(3)} fields${r.fieldsVerified ? "" : " (hand-supplied)"}`);
  }
}
let pairs = 0;
for (const m of MAPPINGS as Array<{ source: string; conceptUri: string; role: string; fields: unknown[] }>) {
  const r = await call("lattice_map_source", { source: m.source, conceptUri: m.conceptUri, role: m.role, fields: m.fields });
  if (r.error) {
    failed++;
    console.log(`  ✗ ${m.source} → ${m.conceptUri.split("/").pop()}: ${r.error.message} ${JSON.stringify(r.error.details?.problems ?? "")}`);
  } else pairs += r.recorded;
}
console.log(`\n${SOURCES.length} sources, ${pairs} field pairs, ${failed} failures`);
if (failed) process.exit(1);
