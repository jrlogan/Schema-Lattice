// Trail data pilot — can the lattice describe trails so that a volunteer
// stewardship app and a state trail inventory can line up?
//
// Trail Team (volunteer trail stewardship) wants to read Connecticut's trail
// data and link back to CT Trail Finder, whose data follows the CT GIS Trails
// Data Standard (2021). Neither side's model is in the catalog. This script
// replays what a builder would try against a private instance:
//
//   1. Discover: is there anything for trails at all?
//   2. Originate the state's own shape (CT Trail Line) as published.
//   3. Originate Trail Team's concepts: Trail System, Trail Segment (which
//      co-refers with CT Trail Line), Trail Point, Segment Adoption and
//      Condition Report — the stewardship half no standard covers.
//   4. Compare CT Trail Line with Trail Segment: the crosswalk two data
//      owners actually need.
//   5. Try to say "this follows CT Trails 2021 / FTDS / OSM" and to map
//      fields to those standards, and see what the catalog does with it.
//
// Nothing is published to schemalattice.com. Discovery is read-only and
// everything else lands in a throwaway local instance.
// Run with `npm run demo:trail-data`.
//
// See examples/trail-data-pilot.md in the repo root for findings.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LatticeInstance } from "../src/server/instance.ts";
import { callTool } from "../src/tools/tools.ts";
import { isToolError } from "../src/tools/errors.ts";

const LIVE = "https://schemalattice.com";

function show(label: string, value: unknown) {
  console.log(`\n── ${label}`);
  console.log(JSON.stringify(value, null, 2));
}

async function liveDiscover(description: string) {
  const url = new URL(`${LIVE}/discover`);
  url.searchParams.set("description", description);
  url.searchParams.set("limit", "3");
  url.searchParams.set("ephemeral", "true");
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) return { error: res.status };
  const body = (await res.json()) as { verdict: string; results: Array<{ prefLabel: string; similarity: number }> };
  return {
    verdict: body.verdict,
    top: body.results.slice(0, 2).map((r) => `${r.prefLabel} (${r.similarity.toFixed(3)})`),
  };
}

// CT GIS Trails Data Standard, 2021 — Trail Line Feature Class, as published
// at https://ctgis.uconn.edu/standards (CT_GIS_Trails_Data_Standard_012021.xlsx).
const CT_TRAIL_LINE_FIELDS = [
  { name: "TrailID", type: "string", classification: "public" },
  { name: "Trail_System", type: "string", classification: "public" },
  { name: "Trail_System_Type", type: "string", classification: "public" },
  { name: "Trail_Name", type: "string", classification: "public" },
  { name: "Blaze", type: "string", classification: "public" },
  { name: "Notes", type: "string", classification: "public" },
  { name: "ADA_Access", type: "string", classification: "public" },
  { name: "Designated_Use", type: "string", classification: "public" },
  { name: "Pedestrian", type: "string", classification: "public" },
  { name: "Mtn_Bike", type: "string", classification: "public" },
  { name: "Road_Bike", type: "string", classification: "public" },
  { name: "XC_Ski", type: "string", classification: "public" },
  { name: "Equestrian", type: "string", classification: "public" },
  { name: "Public_Access", type: "string", classification: "public" },
  { name: "Trail_Difficulty", type: "string", classification: "public" },
  { name: "Route_Type", type: "string", classification: "public" },
  { name: "Surface", type: "string", classification: "public" },
  { name: "Tread_Width", type: "number", unit: "ft", classification: "public" },
  { name: "Distance_Miles", type: "number", unit: "mi", classification: "public" },
  { name: "Min_Elev", type: "number", classification: "public" },
  { name: "Max_Elev", type: "number", classification: "public" },
  { name: "Avg_Grade", type: "number", unit: "percent", classification: "public" },
  { name: "Trail_Status", type: "string", classification: "public" },
  { name: "Town", type: "string", classification: "public" },
  { name: "Owner", type: "string", classification: "public" },
  { name: "Manager", type: "string", classification: "public" },
  { name: "Source", type: "string", classification: "public" },
  { name: "Fee", type: "string", classification: "public" },
  { name: "Data_Development_Date", type: "string", classification: "public" },
];

async function main() {
  // 1. Is there anything for trails in the live catalog?
  const probes = {
    "named trail": "a named recreational trail, such as a hiking trail or rail trail, made of several physical segments",
    "trail segment": "one physical stretch of trail between two junctions, with surface, width, allowed uses and condition",
    trailhead: "a trailhead or access point with parking where people start a trail",
    "segment adoption": "a volunteer group adopting a stretch of trail and committing to maintain it",
  };
  for (const [label, description] of Object.entries(probes)) {
    show(`live discover: ${label}`, await liveDiscover(description));
  }

  const tmp = mkdtempSync(join(tmpdir(), "schemalattice-trail-data-"));
  const lattice = await LatticeInstance.create({ dataDir: tmp });
  const call = async (name: string, args: Record<string, unknown>) => {
    const out = await callTool(lattice, name, args);
    if (isToolError(out)) {
      show(`${name} refused`, out.error);
      return null;
    }
    return out as Record<string, unknown>;
  };
  const sessionId = "trail-data-pilot";
  // Checkpoint 1: every publish follows a discover in the same session.
  // Local discovery also shows whether earlier concepts in this run are found.
  const publishConcept = async (args: Record<string, unknown>) => {
    const found = await call("lattice_discover", { description: args.definition, sessionId });
    const top = (found?.results as Array<Record<string, unknown>> | undefined)?.[0];
    console.log(`\n   local discover for ${args.prefLabel}: ${found?.verdict}${top ? ` → ${top.prefLabel} (${(top.similarity as number).toFixed(3)})` : ""}`);
    return call("lattice_publish_concept", args);
  };
  const uriOf = (r: Record<string, unknown> | null) =>
    (r?.uri ?? (r?.existing as { uri: string } | undefined)?.uri) as string;
  const warningsOf = (r: Record<string, unknown> | null) =>
    [...((r?.warnings as unknown[]) ?? []), ...((r?.advisories as unknown[]) ?? [])];
  const location = lattice.skeletonUri("location")!;

  // 2. The state's shape, as its own context.
  const ctx = uriOf(await call("lattice_publish_context", {
    slug: "ct-trails-2021",
    title: "CT GIS Trails Data Standard 2021",
    definition:
      "Connecticut's statewide trail data standard, approved by the CT GIS Network in 2021. CT Trail Finder and the UConn CT Trails Program collect trail lines and points of interest from land trusts, towns and the state in this shape.",
  }));
  const ctLine = await publishConcept({
    contextUri: ctx,
    prefLabel: "CT Trail Line",
    definition:
      "One line feature in Connecticut's trail inventory: a mapped trail or trail segment with its system, blaze, allowed uses, difficulty, surface, status, owner and manager, as the 2021 state standard defines it.",
    conceptKind: "entity",
    broader: [location],
    closeMatch: ["wd:Q628179"],
    coRefersWith: [],
    coRefersRationale: "The catalog has no trail concepts; this records the state standard as published.",
    structure: { kind: "entity", fields: CT_TRAIL_LINE_FIELDS },
    sessionId,
  });
  show("publish: CT Trail Line", { uri: ctLine?.uri, warnings: warningsOf(ctLine) });

  // 3. Trail Team's concepts.
  const home = uriOf(await call("lattice_publish_context", {
    slug: "trail-stewardship",
    title: "Trail Stewardship",
    definition:
      "Vocabulary for volunteer groups that care for trails and greenways: the trails and segments they look after, who adopted which stretch, what condition it is in, and where else the trail is listed.",
  }));

  const trailSystem = await publishConcept({
    contextUri: home,
    prefLabel: "Trail System",
    definition:
      "A named trail or trail network that people know as one place, such as a rail trail, a greenway or a preserve's trail network, made up of physical segments and listed by its manager and by trail finders.",
    conceptKind: "entity",
    broader: [location],
    closeMatch: ["wd:Q2143825"],
    coRefersWith: [],
    coRefersRationale: "Nothing in the catalog describes a named trail; OpenTrails named_trails and OSM route relations are the outside equivalents but have no CURIE prefix.",
    structure: {
      kind: "entity",
      fields: [
        { name: "name", type: "string", classification: "public" },
        { name: "systemType", type: "string", classification: "public" },
        { name: "routeType", type: "string", classification: "public" },
        { name: "difficulty", type: "string", classification: "public" },
        { name: "towns", type: "string[]", classification: "public" },
        { name: "owner", type: "reference", classification: "public" },
        { name: "manager", type: "reference", classification: "public" },
        { name: "segments", type: "reference[]", classification: "public" },
        { name: "externalListings", type: "array", classification: "public" },
      ],
    },
    sessionId,
  });
  show("publish: Trail System", { uri: trailSystem?.uri, warnings: warningsOf(trailSystem) });

  const segmentFields = [
    { name: "trailSystem", type: "reference", classification: "public" },
    { name: "name", type: "string", classification: "public" },
    { name: "path", type: "geometry", classification: "public" },
    { name: "lengthMeters", type: "number", unit: "m", classification: "public" },
    { name: "blaze", type: "string", classification: "public" },
    { name: "surface", type: "string", classification: "public" },
    { name: "allowedUses", type: "string[]", classification: "public" },
    { name: "adaAccess", type: "string", classification: "public" },
    { name: "buildStatus", type: "string", classification: "public" },
    { name: "town", type: "string", classification: "public" },
    { name: "maintainer", type: "reference", classification: "public" },
    { name: "sourceRef", type: "string", classification: "public" },
    { name: "surveyedOn", type: "date", classification: "public" },
  ];
  const segment = await publishConcept({
    contextUri: home,
    prefLabel: "Trail Segment",
    definition:
      "One physical stretch of a trail that a volunteer group can walk, map and look after, with its route, length, blaze, surface, allowed uses and build status, and the group that maintains it.",
    conceptKind: "entity",
    broader: [location],
    closeMatch: ["wd:Q628179"],
    coRefersWith: ctLine?.uri ? [ctLine.uri] : [],
    coRefersRationale:
      "A CT Trail Line and a Trail Segment describe the same stretch of ground. The state records it for people finding trails; Trail Team records it for the people maintaining it.",
    structure: {
      kind: "entity",
      fields: segmentFields,
      lifecycle: {
        field: "buildStatus",
        initial: "envisioned",
        states: [
          { name: "envisioned" }, { name: "designed" }, { name: "under-construction" },
          { name: "passable" }, { name: "open" }, { name: "decommissioned", terminal: true },
        ],
        transitions: [
          { from: "envisioned", to: "designed", on: "design-approved" },
          { from: "designed", to: "under-construction", on: "build-started" },
          { from: "under-construction", to: "passable", on: "rough-opened" },
          { from: "under-construction", to: "open", on: "build-finished" },
          { from: "passable", to: "open", on: "build-finished" },
          { from: "open", to: "decommissioned", on: "closed-for-good" },
        ],
      },
    },
    sessionId,
  });
  show("publish: Trail Segment", { uri: segment?.uri, warnings: warningsOf(segment) });

  const point = await publishConcept({
    contextUri: home,
    prefLabel: "Trail Point",
    definition:
      "A fixed spot along a trail that visitors or volunteers need to find: a trailhead, a parking area, a bridge, a kiosk, an overlook or a gate, with its type and practical notes such as how many cars fit.",
    conceptKind: "entity",
    broader: [location],
    closeMatch: ["wd:Q7832815", "schema:Place"],
    coRefersWith: [],
    coRefersRationale: "CT's standard folds trailheads and points of interest into one point class; this follows it.",
    structure: {
      kind: "entity",
      fields: [
        { name: "type", type: "string", classification: "public" },
        { name: "name", type: "string", classification: "public" },
        { name: "latitude", type: "number", classification: "public" },
        { name: "longitude", type: "number", classification: "public" },
        { name: "segment", type: "reference", classification: "public" },
        { name: "notes", type: "string", classification: "public" },
      ],
    },
    sessionId,
  });
  show("publish: Trail Point", { uri: point?.uri, warnings: warningsOf(point) });

  const adoption = await publishConcept({
    contextUri: home,
    prefLabel: "Segment Adoption",
    definition:
      "A volunteer group's standing commitment to look after one or more trail segments for a period: who adopted them, what upkeep they promised, how often, and whether the commitment is still being kept.",
    conceptKind: "workflow",
    broader: [lattice.skeletonUri("workflow")!],
    closeMatch: ["wd:Q4684557", "wd:Q188844"],
    coRefersWith: [],
    coRefersRationale: "No trail standard models adoption; FTDS stops at a single Primary Trail Maintainer value.",
    structure: {
      kind: "workflow",
      fields: [
        { name: "adopter", type: "reference", classification: "public" },
        { name: "segments", type: "reference[]", classification: "public" },
        { name: "duties", type: "string[]", classification: "public" },
        { name: "visitsPerYear", type: "number", classification: "public" },
        { name: "contact", type: "reference", classification: "internal" },
        { name: "startedOn", type: "date", classification: "public" },
        { name: "status", type: "string", classification: "public" },
      ],
      lifecycle: {
        field: "status",
        initial: "proposed",
        states: [{ name: "proposed" }, { name: "active" }, { name: "lapsed" }, { name: "ended", terminal: true }],
        transitions: [
          { from: "proposed", to: "active", on: "adoption-approved" },
          { from: "active", to: "lapsed", on: "no-visit-logged" },
          { from: "lapsed", to: "active", on: "visit-logged" },
          { from: "active", to: "ended", on: "adoption-released" },
          { from: "lapsed", to: "ended", on: "adoption-released" },
        ],
      },
    },
    sessionId,
  });
  show("publish: Segment Adoption", { uri: adoption?.uri, warnings: warningsOf(adoption) });

  const report = await publishConcept({
    contextUri: home,
    prefLabel: "Condition Report",
    definition:
      "A dated observation of a trail segment's state by someone who walked it — open, has an issue, or closed — with surface conditions and photos, kept separate from the segment's intended design so each visit adds history.",
    conceptKind: "event",
    broader: [lattice.skeletonUri("event")!],
    closeMatch: ["wd:Q66314461"],
    coRefersWith: [],
    coRefersRationale: "CT's 2021 standard removed its Trail Condition field; FTDS keeps a single condition value; Trailforks-style reports are closed.",
    structure: {
      kind: "event",
      fields: [
        { name: "segment", type: "reference", classification: "public" },
        { name: "observedAt", type: "dateTime", classification: "public", provenance: "self-reported" },
        { name: "status", type: "string", classification: "public" },
        { name: "surfaceCondition", type: "string", classification: "public" },
        { name: "photos", type: "binary[]", classification: "public", provenance: "device-captured" },
        { name: "observer", type: "reference", classification: "internal" },
      ],
    },
    sessionId,
  });
  show("publish: Condition Report", { uri: report?.uri, warnings: warningsOf(report) });

  // 4. The crosswalk — two concepts that co-refer but were never forked.
  if (ctLine?.uri && segment?.uri) {
    const cmp = await call("lattice_compare", { a: ctLine.uri, b: segment.uri });
    if (cmp) {
      console.log("\n── compare: CT Trail Line vs Trail Segment");
      for (const line of cmp.summary as string[]) console.log(`  ${line}`);
      console.log(`\n${cmp.table}`);
    }
  }

  // 5a. Saying which standard a concept follows. There is no field for it,
  // so the nearest thing is a CURIE the catalog doesn't know.
  const conforms = await publishConcept({
    contextUri: home,
    prefLabel: "Trail Segment (with standard)",
    definition:
      "Experiment: the Trail Segment again, this time claiming the standards it lines up with — the CT 2021 trail standard, the federal trail data standard and OpenStreetMap path tagging.",
    conceptKind: "entity",
    broader: [location],
    closeMatch: ["wd:Q628179", "ctTrails2021:TrailLine", "ftds:TrailSegment", "osm:highway=path"],
    coRefersWith: [],
    coRefersRationale: "Experiment: anchoring to non-RDF standards.",
    structure: { kind: "entity", fields: segmentFields },
    sessionId,
  });
  show("5a. closeMatch to non-RDF standards", conforms ? { uri: conforms.uri, warnings: warningsOf(conforms) } : "refused (above)");

  // 5b. Field-level crosswalk keys. Nothing defines them, so nothing checks
  // them — including a misspelled standard name.
  const crosswalked = segmentFields.map((f) =>
    f.name === "surface" ? { ...f, crosswalk: { ctTrails2021: "Surface", ftds: "Trail Surface", osm: "surface" } }
    : f.name === "blaze" ? { ...f, crosswalk: { ctTrials2021: "Blaze", osm: "osmc:symbol" } }
    : f,
  );
  const fieldMapped = await publishConcept({
    contextUri: home,
    prefLabel: "Trail Segment (field crosswalk)",
    definition:
      "Experiment: the Trail Segment with each field annotated with its counterpart in other trail standards, including one deliberately misspelled standard name.",
    conceptKind: "entity",
    broader: [location],
    closeMatch: ["wd:Q628179"],
    coRefersWith: [],
    coRefersRationale: "Experiment: field-level crosswalks.",
    structure: { kind: "entity", fields: crosswalked },
    sessionId,
  });
  show("5b. field-level crosswalk keys", fieldMapped ? { uri: fieldMapped.uri, warnings: warningsOf(fieldMapped) } : "refused (above)");

  lattice.close();
  rmSync(tmp, { recursive: true, force: true });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
