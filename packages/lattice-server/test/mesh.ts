// Mesh report: grades every connection between two sides (apps, public sources,
// pasted manifests), compares fields where the sides say which they fill, flags
// personal data crossing, resolves old versions forward, and stores nothing
// about a pasted manifest.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LatticeInstance } from "../src/server/instance.ts";
import { callTool } from "../src/tools/tools.ts";
import { isToolError } from "../src/tools/errors.ts";

let passed = 0;
let failed = 0;
function check(name: string, ok: boolean, detail = "") {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

async function main() {
  const tmp = mkdtempSync(join(tmpdir(), "schemalattice-mesh-"));
  const instance = await LatticeInstance.create({ dataDir: tmp });
  const call = (name: string, args: Record<string, unknown>) => callTool(instance, name, args) as Promise<any>;
  const sessionId = "sess-mesh";
  await call("lattice_discover", { description: "members, meetings and gifts", sessionId });
  const ctx = await call("lattice_publish_context", { slug: "mesh-test", title: "Mesh test", definition: "Test fixture context for the mesh report: members, meetings, gifts and tools." });
  const pub = async (label: string, definition: string, fields: Array<Record<string, unknown>>, extra: Record<string, unknown> = {}) => {
    const r = await call("lattice_publish_concept", {
      contextUri: ctx.uri, prefLabel: label, definition, conceptKind: "entity", broader: [instance.skeletonUri("record")!],
      closeMatch: ["schema:Thing", "wd:Q1"], coRefersWith: [], coRefersRationale: "Test fixture.",
      structure: { kind: "entity", fields }, sessionId, ...extra,
    });
    if (isToolError(r)) throw new Error(`${label}: ${r.error.message}`);
    return r.uri as string;
  };
  const MEMBER = await pub("Club Member", "Someone enrolled in a recreational association, recorded with contact details, the date they enrolled and the dues plan they pay.", [
    { name: "name", type: "string", classification: "personal-identity" },
    { name: "email", type: "string", classification: "personal-contact" },
    { name: "joinedOn", type: "date", classification: "public" },
    { name: "plan", type: "string", classification: "public" },
  ]);
  const MEETING = await pub("Club Gathering", "A convening of a club's members at a set time and place, with an agenda and a record of who came.", [
    { name: "startsAt", type: "datetime" }, { name: "place", type: "string" }, { name: "agenda", type: "string" },
  ]);
  const fork = await call("lattice_publish_fork", {
    parentUri: MEETING, contextUri: ctx.uri, prefLabel: "Committee Sitting",
    definition: "A convening of one committee of a club, at a set time and room, with an agenda and the quorum it needs to act.",
    changeset: { ops: [{ op: "rename", from: "place", to: "room" }, { op: "add", field: "quorum", type: "integer", required: false }] },
    structure: { kind: "entity", fields: [{ name: "startsAt", type: "datetime" }, { name: "room", type: "string" }, { name: "agenda", type: "string" }, { name: "quorum", type: "integer" }] },
    sessionId,
  });
  const SITTING = fork.uri as string;
  const GIFT = await pub("Club Gift", "Money a supporter gives to a club, with the amount, the date it arrived and what it is meant for.", [
    { name: "amount", type: "number" }, { name: "receivedOn", type: "date" },
  ]);
  const DONATION = await pub("Supporter Donation", "Money a supporter gives to a club, with the amount, the date it arrived and the purpose it supports.", [
    { name: "amount", type: "number" }, { name: "receivedOn", type: "date" },
  ]);
  const LOCKER = await pub("Tool Locker", "A lockable cabinet in a workshop where one person may keep their own tools for a monthly fee.", [
    { name: "number", type: "string" },
  ]);
  // A newer version of the member concept: references to the old one resolve forward.
  const MEMBER2 = (await call("lattice_publish_concept", {
    contextUri: ctx.uri, prefLabel: "Club Member", conceptSlug: "club-member",
    definition: "Someone enrolled in a recreational association, recorded with contact details, the date they enrolled, and which dues plan they pay.",
    conceptKind: "entity", broader: [instance.skeletonUri("record")!], closeMatch: ["schema:Thing", "wd:Q1"], coRefersWith: [], coRefersRationale: "Test fixture.",
    structure: { kind: "entity", fields: [
      { name: "name", type: "string", classification: "personal-identity" }, { name: "email", type: "string", classification: "personal-contact" },
      { name: "joinedOn", type: "date", classification: "public" }, { name: "plan", type: "string", classification: "public" }] },
    sessionId, previousVersion: MEMBER,
  })).uri as string;

  const reg = async (slug: string, concepts: Array<Record<string, unknown>>) => {
    const r = await call("lattice_register_app", { slug, name: slug, unit: "test", owner: "test", status: "pilot", concepts });
    if (isToolError(r)) throw new Error(`${slug}: ${r.error.message}`);
  };
  await reg("club-a", [
    { uri: MEMBER, status: "adopted", shortName: "Member", fields: ["name", "email", "plan"] },
    { uri: MEETING, status: "adopted", shortName: "Meeting", fields: ["startsAt", "place"] },
    { uri: GIFT, status: "originated", shortName: "Gift" },
    { uri: LOCKER, status: "originated", shortName: "Locker" },
  ]);
  await reg("club-b", [
    { uri: MEMBER2, status: "adopted", shortName: "Person", fields: ["name", "email", "joinedOn"] },
    { uri: SITTING, status: "originated", shortName: "Sitting", fields: ["startsAt", "room", "quorum"] },
    { uri: DONATION, status: "originated", shortName: "Donation" },
  ]);
  const badFields = await call("lattice_register_app", { slug: "club-c", name: "c", unit: "t", owner: "t", status: "pilot", concepts: [{ uri: MEMBER2, status: "adopted", fields: ["nmae"] }] });
  check("usage-fields-validated", isToolError(badFields) && /nmae/.test(badFields.error.message), isToolError(badFields) ? badFields.error.message : "accepted");

  const r = await call("lattice_mesh_report", { a: "app:club-a", b: "app:club-b" });
  check("report-ok", !isToolError(r), isToolError(r) ? r.error.message : "");
  const pairOf = (label: string) => r.pairs.find((p: any) => p.a?.label === label || p.b?.label === label);
  const member = pairOf("Club Member");
  check("old-version-resolves-forward-to-direct", member?.grade === "direct" && member.a.uri === MEMBER2 && member.b.uri === MEMBER2, member?.grade);
  const mf = (name: string) => member.fields.find((f: any) => f.conceptField === name);
  check("fields-both-fill-direct", mf("name")?.status === "direct" && mf("email")?.status === "direct");
  check("field-only-a", mf("plan")?.status === "a-only");
  check("field-only-b", mf("joinedOn")?.status === "b-only");
  check("personal-data-flagged", mf("email")?.personal === "personal-contact" && r.challenges.some((c: string) => /Personal data would cross/.test(c)));
  const meeting = pairOf("Club Gathering");
  check("fork-is-translate", meeting?.grade === "translate" && meeting.match === "lineage", meeting?.grade);
  check("rename-found-from-changeset", meeting.fields.some((f: any) => f.a === "place" && f.b === "room" && f.status === "convert"), JSON.stringify(meeting.fields));
  check("child-only-field", meeting.fields.some((f: any) => f.b === "quorum" && f.status === "b-only"));
  const gift = pairOf("Club Gift");
  check("similar-is-manual", gift?.grade === "manual" && gift.b?.label === "Supporter Donation" && gift.similarity >= 0.72, `${gift?.grade} ${gift?.similarity}`);
  const locker = pairOf("Tool Locker");
  check("unmatched-is-gap", locker?.grade === "gap" && !locker.b);
  check("score-in-range", r.score > 0 && r.score < 100, String(r.score));
  check("fit-ignores-gaps", r.fit === r.score && r.overlap.connected === r.pairs.filter((p: any) => p.grade !== "gap").length && r.overlap.ofSmaller > 0, JSON.stringify(r.overlap));
  check("counts-add-up", r.counts.direct + r.counts.translate + r.counts.manual + r.counts.gap === r.pairs.length);

  // A pasted manifest: same answer, nothing stored.
  const eventsBefore = (instance.store.db.prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number }).n;
  const manifest = {
    project: { name: "friends-app" },
    concepts: { Person: { uri: MEMBER2, status: "adopted" }, Ghost: { uri: "https://schemalattice.com/c/nope/nope@000000000000", status: "adopted" } },
    fieldMaps: { "person-in": { target: { concept: MEMBER2 }, fields: [{ target: "name", from: "full_name" }, { target: "email", from: "mail" }] } },
  };
  const m = await call("lattice_mesh_report", { a: "app:club-a", b: { manifest } });
  check("manifest-side-works", !isToolError(m) && m.b.name === "friends-app" && m.pairs.some((p: any) => p.grade === "direct"), isToolError(m) ? m.error.message : "");
  check("manifest-unknown-concept-noted", !isToolError(m) && m.notes.some((n: string) => /Ghost/.test(n)));
  check("manifest-field-maps-used", !isToolError(m) && m.pairs.find((p: any) => p.a?.label === "Club Member").fields.find((f: any) => f.conceptField === "plan")?.status === "a-only");
  const eventsAfter = (instance.store.db.prepare("SELECT COUNT(*) AS n FROM events").get() as { n: number }).n;
  check("manifest-not-stored", eventsAfter === eventsBefore, `${eventsBefore} → ${eventsAfter}`);

  // An unpublished fork is compared through its parent, never dropped.
  const forked = {
    project: { name: "fork-app" },
    concepts: {
      Sitting: { status: "forked", forkedFrom: MEETING },
      Draft: { status: "originated", definition: "Something not yet published." },
    },
    fieldMaps: { out: { source: { concept: "Sitting" }, target: { concept: "Sitting" }, fields: [{ target: "startsAt", from: "when" }, { target: "wire_code", from: "x" }] } },
  };
  const fk = await call("lattice_mesh_report", { a: "app:club-a", b: { manifest: forked } });
  const sitting = !isToolError(fk) && fk.pairs.find((p: any) => p.b?.locals?.includes("Sitting"));
  check("unpublished-fork-compared-through-parent", sitting?.grade === "translate" && sitting.match === "lineage" && /unpublished fork/.test(sitting.how), JSON.stringify(sitting).slice(0, 300));
  check("fork-noted", !isToolError(fk) && fk.notes.some((n: string) => /unpublished fork/.test(n)) && fk.notes.some((n: string) => /Draft: originated/.test(n)));
  check("field-map-local-names-and-wire-names", !isToolError(fk) && fk.notes.some((n: string) => /1 of 2 target field\(s\) are wire names/.test(n)) &&
    sitting.fields.some((f: any) => f.conceptField === "startsAt" && f.status === "direct"), JSON.stringify(fk.notes));
  const arr = await call("lattice_mesh_report", { a: "app:club-a", b: { manifest: { concepts: [{ shortName: "Person", uri: MEMBER2, status: "adopted" }] } } });
  check("array-manifest-shape", !isToolError(arr) && arr.pairs.some((p: any) => p.b?.locals?.includes("Person") && p.grade === "direct"), isToolError(arr) ? arr.error.message : "");

  // Location: records with latitude/longitude meet a polygon layer by point in polygon.
  const SPOT = await pub("Reported Spot", "A place a resident flagged on a map, with its coordinates and when it was flagged for the city to look at.", [
    { name: "latitude", type: "number" }, { name: "longitude", type: "number" }, { name: "flaggedAt", type: "datetime" },
  ]);
  await instance.sources.propose({
    accessUrl: "https://gis.example.gov/wards.geojson", platform: "manual", slug: "test-wards", title: "Wards", publisher: "City",
    jurisdiction: "US-CT/new-haven", recordDescription: "One ward of the city with its boundary.",
    fields: [{ name: "ward", type: "integer" }, { name: "shape", type: "polygon" }],
  }, "operator");
  const sp = await call("lattice_mesh_report", { a: { manifest: { project: { name: "spots" }, concepts: { Spot: { uri: SPOT, status: "adopted" } } } }, b: "source:test-wards" });
  check("spatial-connection-found", !isToolError(sp) && sp.spatial.length === 1 && sp.counts.spatial === 1 && sp.challenges[0].includes("point in polygon") &&
    !sp.challenges.some((c: string) => /nothing in common to connect/.test(c)), isToolError(sp) ? sp.error.message : JSON.stringify(sp.challenges));

  const bad = await call("lattice_mesh_report", { a: "app:nope", b: "app:club-b" });
  check("unknown-app-refused", isToolError(bad) && bad.error.code === "invalid-parameter");
  const badShape = await call("lattice_mesh_report", { a: "club-a", b: "app:club-b" });
  check("bad-side-refused", isToolError(badShape));

  instance.close();
  rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
